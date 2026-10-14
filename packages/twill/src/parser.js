// Acorn's extension hooks intentionally use its internal AST shape. Keep that
// boundary here; the public compiler API is typed in compiler.ts.
import { Parser, tokTypes as tt } from 'acorn';
import { tsPlugin } from 'acorn-typescript';
import jsx from 'acorn-jsx';

const options = { ecmaVersion: 'latest', sourceType: 'module', locations: true };
const bases = {
  js: Parser,
  jsx: Parser.extend(jsx()),
  ts: Parser.extend(tsPlugin({ allowSatisfies: true })),
  tsx: Parser.extend(tsPlugin({ allowSatisfies: true })),
};

// Keep native uses of the contextual identifier, but also recognize an
// unambiguous malformed guard without `else`. Token lookahead ignores lexical
// contents and balanced groups; it never rewrites or parses an expression.
function guardAt(input, offset, implicitMember = false) {
  const lexer = Parser.tokenizer(input.slice(offset), { ecmaVersion: 'latest' });
  const stack = [];
  let first = true;
  let missingElse = false;
  try {
    for (;;) {
      const token = lexer.getToken();
      const label = token.type.label;
      if (
        first &&
        ['=', '.', '?.', ':', '++/--', '*', '/', '%', '==/!=/===/!==', 'in', 'instanceof'].includes(
          label,
        ) &&
        !(implicitMember && label === '.')
      )
        return false;
      if (first) {
        // Juxtaposition with these tokens cannot continue an identifier
        // expression. A newline may instead terminate a native statement;
        // calls, member/index access, templates and TS assertions stay native.
        missingElse =
          !/[\r\n\u2028\u2029]/.test(input.slice(offset, offset + token.start)) &&
          ((token.type === tt.name && !['as', 'satisfies'].includes(token.value)) ||
            [
              'const',
              'num',
              'string',
              'true',
              'false',
              'null',
              'this',
              'new',
              'typeof',
              'void',
              'delete',
            ].includes(label) ||
            (token.type === tt.prefix && ['!', '~'].includes(token.value)) ||
            (implicitMember && label === '.'));
      }
      if (
        !stack.length &&
        ['if', 'for', 'while', 'switch', 'try', 'return', 'throw', 'var', 'export'].includes(label)
      )
        return missingElse ? 'missingElse' : false;
      if (!first && !stack.length && label === 'const')
        return missingElse ? 'missingElse' : false;
      first = false;
      if (!stack.length && label === 'else') return true;
      if (!stack.length && ['eof', ';', '}'].includes(label))
        return missingElse ? 'missingElse' : false;
      if (['(', '[', '{', '${'].includes(label)) stack.push(label);
      else if ([')', ']', '}'].includes(label)) {
        if (!stack.length) return false;
        stack.pop();
      }
    }
  } catch {
    return false;
  }
}

// Deliberately conservative: do not infer exits from calls, loops or a nested
// function's return. JS/TS still checks the legality of break/continue/return.
function exits(node) {
  switch (node.type) {
    case 'ReturnStatement':
    case 'ThrowStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return true;
    case 'BlockStatement':
      return node.body.some(exits);
    case 'IfStatement':
    case 'TwillIfBinding':
      return !!node.alternate && exits(node.consequent) && exits(node.alternate);
    default:
      return false;
  }
}

function awaits(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'AwaitExpression' || node.await === true || node.kind === 'await using')
    return true;
  if (node.type === 'DeferStatement') return node.awaited;
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type))
    return false;
  if (['ClassDeclaration', 'ClassExpression'].includes(node.type)) {
    return (
      awaits(node.superClass) ||
      node.body.body.some((member) => member.computed && awaits(member.key))
    );
  }
  return Object.entries(node).some(([key, value]) => {
    if (key === 'loc' || key === 'trailing') return false;
    return Array.isArray(value) ? value.some(awaits) : !!value?.type && awaits(value);
  });
}

function deferAt(input, offset) {
  try {
    const next = Parser.tokenizer(input.slice(offset), { ecmaVersion: 'latest' }).getToken();
    return (
      next.type === tt.braceL &&
      !/[\r\n\u2028\u2029]/.test(input.slice(offset, offset + next.start))
    );
  } catch {
    // The isolated tokenizer may read JS division as a regexp. Let the real
    // expression parser handle ordinary uses of the identifier instead.
    return false;
  }
}

// Inspect only the possible parameter header, using real tokens so comments,
// strings, default arguments and destructuring cannot confuse the delimiter.
function headerAt(input, offset) {
  const lexer = Parser.tokenizer(input.slice(offset), options);
  const stack = [];
  let first = true;
  const tokens = [];
  try {
    for (;;) {
      const token = lexer.getToken();
      const label = token.type.label;
      if (first && label !== 'name' && label !== '(') return null;
      first = false;
      if (!stack.length && label === 'in') {
        const async = tokens.length > 1 && tokens[0].value === 'async';
        const firstParam = tokens[async ? 1 : 0];
        return {
          start: offset,
          end: offset + token.end,
          inStart: offset + token.start,
          text: input.slice(offset + tokens[0].start, offset + tokens.at(-1).end),
          textStart: offset + tokens[0].start,
          async,
          asyncEnd: async ? offset + tokens[0].end : null,
          parenthesized: firstParam.type.label === '(',
        };
      }
      if (label === 'eof' || (!stack.length && [';', '{', '}', '=>'].includes(label))) return null;
      if (['(', '[', '{'].includes(label)) stack.push(label);
      if ([')', ']', '}'].includes(label)) {
        if (!stack.length) return null;
        stack.pop();
      }
      tokens.push(token);
    }
  } catch {
    return null;
  }
}

function moveNodes(node, delta, locate) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.start === 'number') {
    node.start += delta;
    node.end += delta;
    node.loc = { start: locate(node.start), end: locate(node.end) };
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) value.forEach((item) => moveNodes(item, delta, locate));
    else if (value && typeof value === 'object') moveNodes(value, delta, locate);
  }
}

const parsers = new Map();
function associatedEnumAt(input, offset) {
  try {
    const tokens = Parser.tokenizer(input.slice(offset), { ecmaVersion: 'latest' });
    tokens.getToken(); // Declaration name; the TS parser validates it.
    const next = tokens.getToken();
    return (
      next.value === '<' ||
      (next.type === tt.braceL &&
        tokens.getToken().type === tt._case &&
        tokens.getToken().type === tt.name)
    );
  } catch {
    // Let the original parser diagnose malformed native syntax at its real offset.
    return false;
  }
}

function parserFor(language) {
  if (parsers.has(language)) return parsers.get(language);
  const Base = bases[language];
  class TwillParser extends Base {
    declareName(name, bindingType, position) {
      // acorn-typescript 1.4.13 passes 6/7 for aliases/interfaces, but its
      // zero type mask incorrectly registers them as runtime bindings.
      // TS has separate type/value namespaces; its checker owns type merging.
      if (bindingType === 6 || bindingType === 7) {
        const scope = this.currentScope();
        // Its namespace blocks enter Acorn scopes without initializing types.
        (scope.types ??= []).push(name);
        if (this.inModule && scope.flags & 1) delete this.undefinedExports[name];
        return;
      }
      super.declareName(name, bindingType, position);
    }

    skipHeader = null;
    closures = [];
    lineStarts = null;
    classSuperDepth = null;
    subscriptDepth = 0;
    conditionDepth = null;
    derivedClassElement = false;
    implicitClosure = null;

    tsParseEnumDeclaration(node, modifiers = {}) {
      if (!associatedEnumAt(this.input, this.end))
        return super.tsParseEnumDeclaration(node, modifiers);
      if (modifiers.const || modifiers.declare || this.isAmbientContext)
        this.raise(node.start, 'Associated-value enums cannot be const or ambient declarations.');
      this.expectContextual('enum');
      node.id = this.parseIdent();
      this.checkLValSimple(node.id, 2);
      node.typeParameters = this.tsTryParseTypeParameters(() => {
        if (this.type === tt._in || (this.isContextual('out') && this.lookahead().type === tt.name))
          this.raise(
            this.start,
            'Associated-value enum type parameters cannot have const/in/out modifiers.',
          );
      });
      const constant = node.typeParameters?.params.find((parameter) => parameter.const);
      if (constant)
        this.raise(
          constant.start,
          'Associated-value enum type parameters cannot have const/in/out modifiers.',
        );
      node.braceStart = this.start;
      this.expect(tt.braceL);
      node.cases = [];
      const names = new Set();
      while (this.type !== tt.braceR) {
        const branch = this.startNode();
        this.expect(tt._case);
        branch.id = this.parseIdent();
        if (names.has(branch.id.name)) this.raise(branch.id.start, 'Duplicate enum case.');
        names.add(branch.id.name);
        branch.params = [];
        branch.hasParens = this.eat(tt.parenL);
        if (branch.hasParens) {
          const fields = new Set();
          while (this.type !== tt.parenR) {
            const field = this.parseIdent();
            this.checkLValSimple(field);
            if (field.name === 'kind')
              this.raise(
                field.start,
                'Enum payload fields cannot use the discriminator name kind.',
              );
            if (fields.has(field.name)) this.raise(field.start, 'Duplicate enum payload field.');
            fields.add(field.name);
            if (this.type !== tt.colon)
              this.raise(
                this.start,
                'Enum payload fields require a name and type; optional/default/rest fields are unsupported.',
              );
            field.typeAnnotation = this.tsParseTypeAnnotation();
            branch.params.push(field);
            if (!this.eat(tt.comma)) break;
          }
          this.expect(tt.parenR);
        }
        branch.valueEnd = this.lastTokEnd;
        this.semicolon();
        node.cases.push(this.finishNode(branch, 'TwillEnumCase'));
      }
      if (!node.cases.length)
        this.raise(node.start, 'An associated-value enum needs at least one case.');
      this.next();
      return this.finishNode(node, 'TwillEnumDeclaration');
    }

    locate(offset) {
      if (!this.lineStarts) {
        this.lineStarts = [0];
        const breaks = /\r\n?|\n|\u2028|\u2029/g;
        let match;
        while ((match = breaks.exec(this.input))) this.lineStarts.push(breaks.lastIndex);
      }
      let low = 0;
      let high = this.lineStarts.length;
      while (low + 1 < high) {
        const mid = (low + high) >>> 1;
        if (this.lineStarts[mid] <= offset) low = mid;
        else high = mid;
      }
      return { line: low + 1, column: offset - this.lineStarts[low] };
    }

    parseStatement(context, ...args) {
      if (this.isContextual('defer') && deferAt(this.input, this.end)) {
        // A newline leaves an ordinary identifier expression and separate JS
        // block. Calls, member access, assignments and labels are unchanged.
        const node = this.startNode();
        const async = this.canAwait;
        this.next();
        const enclosing = this.implicitClosure;
        const implicit =
          enclosing && this.currentVarScope() === this.scopeStack[enclosing.scopeIndex]
            ? enclosing
            : null;
        const previousScope = implicit?.scopeIndex;
        if (implicit) implicit.scopeIndex = this.scopeStack.length;
        let cleanup;
        try {
          // A defer body captures its enclosing callback's receiver, like a
          // named parameter. Ordinary nested functions remain separate scopes.
          cleanup = this.parseArrowExpression(this.startNode(), [], async, false);
        } finally {
          if (implicit) implicit.scopeIndex = previousScope;
        }
        node.awaited = awaits(cleanup.body);
        cleanup.async = node.awaited;
        node.cleanup = cleanup;
        return this.finishNode(node, 'DeferStatement');
      }
      const guard =
        this.isContextual('guard') && guardAt(this.input, this.end, !!this.implicitClosure);
      if (guard === 'missingElse')
        this.raise(
          this.start,
          "Missing 'else' in guard statement. Put 'else' before the failure block: 'guard condition else { return ...; }'.",
        );
      if (!guard) {
        const statement = super.parseStatement(context, ...args);
        if (context && statement.type === 'TwillEnumDeclaration')
          this.raise(
            statement.start,
            'An associated-value enum requires a block; add braces around this body.',
          );
        return statement;
      }
      const node = this.startNode();
      node.singleStatement = !!context;
      this.next();
      node.binding = null;
      if (this.type === tt._else)
        this.raise(this.start, "Guard needs a condition or 'const' binding before 'else'.");
      if (this.type === tt._const) {
        if (context)
          this.raise(node.start, 'A guard binding requires a block; add braces around this body.');
        const declaration = this.startNode();
        this.next();
        this.parseVar(declaration, false, 'const');
        node.binding = this.finishNode(declaration, 'VariableDeclaration');
        if (node.binding.declarations.length !== 1)
          this.raise(node.start, 'guard const requires one binding declaration.');
      } else node.test = this.parseExpression();
      node.elseStart = this.start;
      if (this.type !== tt._else)
        this.raise(this.start, "Expected 'else' after the guard condition or binding.");
      this.next();
      if (this.type !== tt.braceL)
        this.raise(
          this.start,
          "Guard 'else' must be followed by a block, for example 'else { return ...; }'.",
        );
      node.failure = this.parseBlock();
      if (!exits(node.failure))
        this.raise(
          node.failure.start,
          'Every guard else path must exit with return, throw, break or continue.',
        );
      return this.finishNode(node, 'GuardStatement');
    }

    parseIfStatement(node) {
      // Native parenthesized if statements keep the host parser's contract.
      // Look only for the new binding introducer; lexical errors belong to
      // the main parser so their offsets remain absolute.
      if (/^\s*\(/.test(this.input.slice(this.end))) return super.parseIfStatement(node);
      let binding;
      try {
        binding = Parser.tokenizer(this.input.slice(this.end), options).getToken().type;
      } catch {}
      if (binding !== tt._const) return super.parseIfStatement(node);
      this.next();
      const declaration = this.startNode();
      this.next();
      this.enterScope(0);
      const previous = this.conditionDepth;
      this.conditionDepth = this.subscriptDepth;
      try {
        this.parseVar(declaration, false, 'const');
      } finally {
        this.conditionDepth = previous;
      }
      node.binding = this.finishNode(declaration, 'VariableDeclaration');
      if (node.binding.declarations.length !== 1)
        this.raise(node.start, 'if const requires one binding declaration.');
      if (this.type !== tt.braceL)
        this.raise(this.start, 'if const requires a braced success branch.');
      // The binding and success body share a scope; else belongs to the outer
      // scope. The initializer's references are checked in the lowered outer
      // scope, before the successful const declaration exists.
      node.consequent = this.parseBlock(false);
      this.exitScope();
      node.alternate = null;
      if (this.eat(tt._else)) {
        if (this.type !== tt.braceL && this.type !== tt._if)
          this.raise(this.start, 'if const else requires a block or another if.');
        node.alternate = this.parseStatement('if');
      }
      return this.finishNode(node, 'TwillIfBinding');
    }

    tsParseTypeParameter(...args) {
      const start = this.start;
      const loc = this.startLoc;
      const constant = this.type === tt._const;
      if (constant) this.next();
      const parameter = super.tsParseTypeParameter(...args);
      if (constant) {
        parameter.const = true;
        parameter.start = start;
        parameter.loc.start = loc;
      }
      return parameter;
    }

    parseExprSubscripts(...args) {
      this.subscriptDepth++;
      try {
        return super.parseExprSubscripts(...args);
      } finally {
        this.subscriptDepth--;
      }
    }

    parseClassSuper(...args) {
      const previous = this.classSuperDepth;
      this.classSuperDepth = this.subscriptDepth;
      try {
        return super.parseClassSuper(...args);
      } finally {
        this.classSuperDepth = previous;
      }
    }

    parseClassElement(...args) {
      const previous = this.derivedClassElement;
      this.derivedClassElement = !!args[0];
      try {
        return super.parseClassElement(...args);
      } finally {
        this.derivedClassElement = previous;
      }
    }

    raise(position, message, ...args) {
      // acorn-typescript 1.4.13 inverts the subclass check for `override`.
      // Permit this valid syntax; TypeScript still checks override semantics.
      if (
        language.startsWith('ts') &&
        this.derivedClassElement &&
        typeof message === 'string' &&
        message.includes("cannot have an 'override' modifier")
      )
        return;
      return super.raise(position, message, ...args);
    }

    readToken(code) {
      // acorn-typescript enables JSX by default. Plain .twill follows TypeScript's
      // non-JSX grammar, including angle-bracket assertions.
      if (language === 'ts' && code === 60 && !this.inType && this.exprAllowed)
        return this.readToken_lt_gt(code);
      return super.readToken(code);
    }

    parseExprAtom(...args) {
      if (this.type === tt.dot) {
        const closure = this.implicitClosure;
        if (!closure || this.currentVarScope() !== this.scopeStack[closure.scopeIndex])
          this.raise(
            this.start,
            'Implicit member access requires a trailing closure without a parameter header.',
          );
        // A zero-width receiver lets Acorn parse the original dot/property chain.
        // The compiler supplies one hygienic parameter; property tokens stay mapped.
        const node = this.startNode();
        node.name = '__twillImplicit';
        closure.members.push(node);
        return this.finishNodeAt(node, 'Identifier', this.start, this.startLoc);
      }
      if (this.type === tt._switch) return this.parseSwitchExpression();
      if (language === 'ts' && this.type === tt.relational && this.value === '<') {
        const node = this.startNode();
        this.tsInType(() => {
          this.next();
          node.typeAnnotation = this.tsParseType();
          if (!this.tsMatchRightRelational()) this.unexpected();
          this.next();
        });
        node.expression = this.parseMaybeUnary(null, false, false, args[1]);
        // Let the TS plugin backtrack and recognize a generic arrow function.
        if (node.expression.type === 'ArrowFunctionExpression') this.unexpected(node.start);
        return this.finishNode(node, 'TSTypeAssertion');
      }
      return super.parseExprAtom(...args);
    }

    parseSwitchExpression(call) {
      const node = call ? this.startNodeAt(call.start, call.loc.start) : this.startNode();
      node.keyword = call ? 'match' : 'switch';
      if (call) {
        if (call.arguments.length !== 1 || call.arguments[0].type === 'SpreadElement')
          this.raise(
            call.start,
            'A match expression requires one subject; parenthesize comma expressions.',
          );
        const opening = Parser.tokenizer(this.input.slice(call.callee.end), options).getToken();
        node.parenStart = call.callee.end + opening.start;
        node.discriminant = call.arguments[0];
        node.parenEnd = call.end - 1;
      } else {
        this.next();
        node.parenStart = this.start;
        node.discriminant = this.parseParenExpression();
        node.parenEnd = this.lastTokStart;
      }
      this.expect(tt.braceL);
      node.cases = [];
      let mode,
        discriminator,
        sawDefault = false;
      while (this.type !== tt.braceR) {
        const branch = this.startNode();
        const isCase = this.type === tt._case;
        if (!isCase && this.type !== tt._default) this.unexpected();
        this.next();
        this.enterScope(0); // Each expression arm has its own lexical bindings.
        if (!isCase) {
          if (sawDefault) this.raise(branch.start, 'Multiple default clauses.');
          sawDefault = true;
          branch.test = null;
        } else if (
          (call && this.type !== tt.braceL) ||
          (!call && this.type.label === 'name' && this.value === 'enum' && !this.containsEsc)
        ) {
          if (mode === 'value')
            this.raise(branch.start, 'Cannot mix enum patterns and value cases.');
          if (discriminator !== undefined && discriminator !== 'kind')
            this.raise(branch.start, 'Enum patterns require the kind discriminator.');
          mode = 'pattern';
          discriminator = 'kind';
          const pattern = this.startNode();
          pattern.explicitKeyword = !call;
          if (!call) this.next();
          let reference = this.parseIdent();
          while (this.eat(tt.dot)) {
            const member = this.startNodeAt(reference.start, reference.loc.start);
            member.object = reference;
            member.property = this.parseIdent(true);
            member.computed = false;
            member.optional = false;
            reference = this.finishNode(member, 'MemberExpression');
          }
          if (reference.type !== 'MemberExpression')
            this.raise(reference.start, 'An enum pattern requires a qualified case reference.');
          pattern.reference = reference;
          pattern.parenStart = this.start;
          this.expect(tt.parenL);
          if (this.type === tt.braceL) {
            pattern.binding = this.parseObj(true);
            this.checkLValPattern(pattern.binding, 2, false);
          }
          pattern.parenEnd = this.start;
          this.expect(tt.parenR);
          branch.enumPattern = this.finishNode(pattern, 'TwillEnumPattern');
        } else if (this.type === tt.braceL) {
          if (mode === 'value')
            this.raise(branch.start, 'Cannot mix object patterns and value cases.');
          mode = 'pattern';
          const errors = {
            shorthandAssign: -1,
            trailingComma: -1,
            parenthesizedAssign: -1,
            parenthesizedBind: -1,
            doubleProto: -1,
          };
          const pattern = this.parseObj(false, errors);
          const tags = pattern.properties.filter(
            (property) =>
              property.type === 'Property' &&
              !property.computed &&
              !property.method &&
              property.kind === 'init' &&
              ((property.value.type === 'Literal' && !property.value.regex) ||
                (property.value.type === 'UnaryExpression' &&
                  ['+', '-'].includes(property.value.operator) &&
                  property.value.argument.type === 'Literal' &&
                  typeof property.value.argument.value === 'number')),
          );
          if (tags.length !== 1)
            this.raise(
              pattern.start,
              'An object case needs exactly one literal discriminator; other properties bind values.',
            );
          const tag = tags[0];
          const key = String(tag.key.name ?? tag.key.value);
          if (discriminator !== undefined && key !== discriminator)
            this.raise(tag.start, 'Object cases must use the same discriminator property.');
          discriminator = key;
          pattern.properties = pattern.properties.filter((property) => property !== tag);
          this.toAssignable(pattern, true, errors);
          this.checkLValPattern(pattern, 2, false);
          pattern.properties.push(tag);
          pattern.properties.sort((a, b) => a.start - b.start);
          branch.pattern = pattern;
          branch.tag = tag;
        } else {
          if (mode === 'pattern')
            this.raise(branch.start, 'Cannot mix object patterns and value cases.');
          mode = 'value';
          branch.test = this.parseExpression();
        }
        branch.colonStart = this.start;
        this.expect(tt.colon);
        if (this.type === tt._throw) {
          const thrown = this.parseThrowStatement(this.startNode());
          branch.value = thrown.argument;
          branch.throw = true;
          branch.valueEnd = thrown.end;
        } else {
          branch.value = this.parseMaybeAssign();
          branch.valueEnd = this.lastTokEnd;
          this.semicolon();
        }
        this.exitScope();
        node.cases.push(this.finishNode(branch, 'TwillSwitchCase'));
      }
      this.next();
      if (!node.cases.length)
        this.raise(node.start, `A ${node.keyword} expression requires at least one arm.`);
      node.discriminator = discriminator;
      return this.finishNode(node, 'TwillSwitchExpression');
    }

    next(...args) {
      super.next(...args);
      if (this.skipHeader !== null) {
        const end = this.skipHeader;
        this.skipHeader = null;
        while (this.start < end && this.type !== tt.eof) super.next(...args);
      }
    }

    parseTrailingClosure(callee, label) {
      const start = this.start;
      const header = headerAt(this.input, this.end);
      let params = [];
      let async = false;
      let parameterText = '()';
      if (header) {
        let text = header.text.trim();
        async = header.async;
        if (async) text = text.replace(/^async\s+/, '');
        parameterText = text.startsWith('(') ? text : `(${text})`;
        const prefix = async ? 'async ' : '';
        try {
          const arrow = Base.parse(`${prefix}${parameterText} => {}`, {
            ...options,
            sourceType: this.options.sourceType,
          }).body[0].expression;
          params = arrow.params;
          const sourceStart = header.textStart + header.text.indexOf(text);
          const addedParen = text.startsWith('(') ? 0 : 1;
          params.forEach((param) =>
            moveNodes(param, sourceStart - prefix.length - addedParen, (offset) =>
              this.locate(offset),
            ),
          );
        } catch (error) {
          this.raise(start, `Invalid trailing closure parameters: ${error.message}`);
        }
      }
      const node = this.startNode();
      // parseArrowExpression supplies the real function scope, including return,
      // await, lexical this/super, duplicate bindings and strict-mode checks.
      this.skipHeader = header?.end ?? null;
      const previous = this.implicitClosure;
      const implicit = header ? null : { scopeIndex: this.scopeStack.length, members: [] };
      this.implicitClosure = implicit;
      let arrow;
      try {
        arrow = this.parseArrowExpression(node, params, async, false);
      } finally {
        this.implicitClosure = previous;
      }
      this.closures.push({
        node: arrow,
        callee,
        label,
        header,
        parameterText,
        async,
        implicitMembers: implicit?.members ?? [],
      });
      return arrow;
    }

    parseSubscript(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit) {
      // The TS parser treats a same-line brace after type arguments as an
      // expression operand. In this dialect it can instead begin the callback.
      const classBody =
        this.classSuperDepth !== null && this.subscriptDepth === this.classSuperDepth + 1;
      // Inspect only the arm-leading token after the ordinary call parser has
      // parsed the subject once. Native calls/TSX subjects and trailing closures
      // named match remain intact; case/default cannot start a native callback.
      if (
        !noCalls &&
        !classBody &&
        this.type === tt.braceL &&
        base.type === 'CallExpression' &&
        !base.optional &&
        !base.typeParameters &&
        base.callee.type === 'Identifier' &&
        base.callee.name === 'match' &&
        base.callee.start === base.start &&
        this.input.slice(base.callee.start, base.callee.end) === 'match'
      ) {
        let first;
        try {
          first = Parser.tokenizer(this.input.slice(this.end), options).getToken().type;
        } catch {
          // The main parser reports lexical errors at their original offsets,
          // rather than the lookahead tokenizer's relative slice positions.
        }
        if (first === tt._case || first === tt._default) return this.parseSwitchExpression(base);
      }
      if (!noCalls && !classBody && this.tsMatchLeftRelational?.() && this.start === base.end) {
        const parameters = this.tsTryParseAndCatch(() => {
          const parsed = this.tsParseTypeArgumentsInExpression();
          return parsed &&
            this.type === tt.braceL &&
            !/[\r\n\u2028\u2029]/.test(this.input.slice(parsed.end, this.start))
            ? parsed
            : undefined;
        });
        if (parameters) {
          const instantiation = this.startNodeAt(startPos, startLoc);
          instantiation.expression = base;
          instantiation.typeParameters = parameters;
          base = this.finishNode(instantiation, 'TSInstantiationExpression');
        }
      }
      const supported = [
        'CallExpression',
        'Identifier',
        'MemberExpression',
        'TSInstantiationExpression',
      ].includes(base.type);
      // Swift separates statement conditions from ordinary expressions. At
      // condition depth, the brace starts the statement body. Parentheses and
      // arguments enter deeper expression contexts and retain trailing calls.
      const conditionBody =
        this.conditionDepth !== null && this.subscriptDepth === this.conditionDepth + 1;
      if (conditionBody && this.type === tt.braceL) return base;
      // Only the outer heritage expression owns the class body brace. Nested
      // calls, parenthesized expressions and computed lookups allow callbacks.
      if (!noCalls && supported && this.type === tt.braceL && !classBody) {
        if (base.trailing)
          this.raise(
            this.start,
            'Additional trailing closures require labels (for example completion: { ... }).',
          );
        // Bare names on a new line remain ordinary JavaScript statements.
        if (base.type !== 'CallExpression' && /[\r\n]/.test(this.input.slice(base.end, this.start)))
          return base;
        const hadParens = base.type === 'CallExpression' && base.end === this.lastTokEnd;
        const callee = hadParens
          ? base.callee
          : base.type === 'TSInstantiationExpression'
            ? base.expression
            : base;
        const node = this.startNodeAt(startPos, startLoc);
        node.callee = callee;
        node.arguments = hadParens ? [...base.arguments] : [];
        node.optional = base.optional ?? false;
        if ((hadParens || base.type === 'TSInstantiationExpression') && base.typeParameters)
          node.typeParameters = base.typeParameters;
        const callEnd = this.lastTokEnd;
        const args = [this.parseTrailingClosure(callee, null)];
        while (this.type === tt.name) {
          const tail = this.input.slice(this.end);
          // Only recognize a label when a colon and opening brace follow it.
          const lexer = Parser.tokenizer(tail, options);
          const colon = lexer.getToken();
          if (colon.type !== tt.colon || lexer.getToken().type !== tt.braceL) break;
          const label = { name: this.value, start: this.start, end: this.end };
          this.next();
          this.expect(tt.colon);
          args.push(this.parseTrailingClosure(callee, label));
        }
        node.arguments.push(...args);
        node.trailing = {
          callEnd,
          hadParens,
          originalArgs: hadParens ? base.arguments : [],
          closures: args,
        };
        return this.finishNode(node, 'CallExpression');
      }
      return super.parseSubscript(
        base,
        startPos,
        startLoc,
        noCalls,
        maybeAsyncArrow,
        optionalChained,
        forInit,
      );
    }
  }
  parsers.set(language, TwillParser);
  return TwillParser;
}

export function parse(source, language = 'ts', sourceType = 'module') {
  const TwillParser = parserFor(language);
  const comments = [];
  const parser = new TwillParser(
    { ...options, sourceType, allowHashBang: true, onComment: comments },
    source,
  );
  const ast = parser.parse();
  const live = new Set();
  const calls = [];
  const guards = [];
  const ifBindings = [];
  const defers = [];
  const switches = [];
  const enums = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      node.type === 'ArrowFunctionExpression' ||
      (node.type === 'Identifier' && node.start === node.end && node.name === '__twillImplicit')
    )
      live.add(node);
    if (node.trailing) calls.push(node);
    if (node.type === 'GuardStatement') guards.push(node);
    if (node.type === 'TwillIfBinding') ifBindings.push(node);
    if (node.type === 'DeferStatement') defers.push(node);
    if (node.type === 'TwillSwitchExpression') switches.push(node);
    if (node.type === 'TwillEnumDeclaration') enums.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'trailing' || key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else if (value?.type) visit(value);
    }
  };
  visit(ast);
  return {
    ast,
    calls,
    guards,
    ifBindings,
    defers,
    switches,
    enums,
    comments,
    closures: parser.closures
      .filter((closure) => live.has(closure.node))
      .map((closure) => ({
        ...closure,
        // TS backtracking can discard tentative expression parses. Only receivers
        // reachable in the final tree may add a parameter or source insertion.
        implicitMembers: closure.implicitMembers
          .filter((node) => live.has(node))
          .map((node) => node.start),
      })),
  };
}
