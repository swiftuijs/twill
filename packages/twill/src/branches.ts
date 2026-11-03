import MagicString from 'magic-string';
import { Parser, tokTypes } from 'acorn';
import type { Language } from './compiler.js';

type Node = { type: string; start: number; end: number; [key: string]: any };
function suspension(node: Node): Node | undefined {
  if (['AwaitExpression', 'YieldExpression'].includes(node.type)) return node;
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type))
    return;
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'trailing', 'tag'].includes(key)) continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child?.type) {
        const found = suspension(child);
        if (found) return found;
      }
    }
  }
}

function directEval(node: Node): boolean {
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type))
    return false;
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'eval' &&
    !node.optional
  )
    return true;
  return Object.entries(node).some(
    ([key, value]) =>
      !['loc', 'trailing', 'tag'].includes(key) &&
      (Array.isArray(value) ? value : [value]).some((child) => child?.type && directEval(child)),
  );
}

/** Preserve the existing expression boundary for direct eval and suspension. */
export function canInlineSwitchExpression(node: Node): boolean {
  return !directEval(node) && !suspension(node);
}

/** Reuse authored blocks only when no direct eval (including a captured one)
 * can observe the added temporary's broader lifetime/temporal dead zone.
 * Memoize shared parser nodes so this analysis stays linear in the AST size. */
export function reusableStatements(ast: Node, usedNames: Set<string>): Set<Node> {
  const reusable = new Set<Node>();
  const observed = new Map<Node, boolean>();
  const visit = (node: Node): boolean => {
    const known = observed.get(node);
    if (known !== undefined) return known;
    if (node.type === 'Identifier' || node.type === 'JSXIdentifier') usedNames.add(node.name);
    let observable =
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'eval';
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'trailing'].includes(key)) continue;
      for (const child of Array.isArray(value) ? value : [value])
        if (child?.type && visit(child)) observable = true;
    }
    if (!observable && node.type === 'BlockStatement')
      for (const statement of node.body)
        if (
          statement.type === 'TwillIfBinding' ||
          (statement.argument ?? statement.expression)?.type === 'TwillSwitchExpression'
        )
          reusable.add(statement);
    observed.set(node, observable);
    return observable;
  };
  visit(ast);
  return reusable;
}

/** Native switches with per-arm scopes. Direct returns and standalone variable
 * initializers need no extra function; other expressions keep a lexical IIFE. */
export function lowerSwitchExpressions(
  source: string,
  ast: Node,
  switches: Node[],
  code: MagicString,
  language: Language,
  usedNames: Set<string>,
  comments: { start: number; end: number }[],
  fail: (node: Node, message: string) => never,
  implicitReturns: Node[] = [],
  reusable: Set<Node> = new Set(),
) {
  const returns = new Set<Node>();
  const implicit = new Set(implicitReturns);
  const sharedScopes = new Set<Node>();
  const initializers = new Map<Node, { declaration: Node; statement: Node; prefixStart: number }>();
  const leadingDoc = (start: number) => {
    let low = 0,
      high = comments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (comments[middle]!.end <= start) low = middle + 1;
      else high = middle;
    }
    const comment = comments[low - 1];
    return comment && /^\s*$/.test(source.slice(comment.end, start)) ? comment : undefined;
  };
  const grouping = (start: number, end: number, initializer = false) => {
    const parentheses: { start: number; end: number }[] = [];
    const tokens = Parser.tokenizer(source.slice(start, end), { ecmaVersion: 'latest' });
    for (;;) {
      const token = tokens.getToken();
      if (token.type === tokTypes.eof) break;
      if (initializer && token.type === tokTypes.eq) parentheses.length = 0;
      if (token.type === tokTypes.parenL || token.type === tokTypes.parenR) parentheses.push(token);
    }
    for (const token of parentheses) {
      code.remove(start + token.start, start + token.end);
    }
  };
  const visit = (node: Node, parent?: Node) => {
    if (node.type === 'BlockStatement') {
      for (const statement of node.body) {
        const value =
          statement.type === 'ReturnStatement' ? statement.argument : statement.expression;
        if (
          value?.type === 'TwillSwitchExpression' &&
          (node.body.length === 1 || reusable.has(statement)) &&
          (statement.type === 'ReturnStatement' || implicit.has(value))
        )
          sharedScopes.add(value);
      }
    }
    if (node.type === 'ExpressionStatement' && implicit.has(node.expression)) {
      grouping(node.start, node.expression.start);
      grouping(node.expression.end, node.end);
      if (source[node.end - 1] === ';') code.remove(node.end - 1, node.end);
    }
    if (node.type === 'VariableDeclaration' && node.declarations.length === 1) {
      const declaration = node.declarations[0];
      if (
        declaration.id.type === 'Identifier' &&
        declaration.init?.type === 'TwillSwitchExpression' &&
        ['Program', 'BlockStatement', 'SwitchCase', 'ExportNamedDeclaration'].includes(
          parent?.type ?? '',
        )
      ) {
        const statement = parent?.type === 'ExportNamedDeclaration' ? parent : node;
        const comment = leadingDoc(statement.start);
        const prefixStart =
          comment && source.startsWith('/**', comment.start) ? comment.start : statement.start;
        const pragma =
          comment &&
          /@ts-(?:ignore|expect-error|nocheck|check)\b/.test(
            source.slice(comment.start, comment.end),
          );
        // A direct eval can observe the old wrapper's function scope. JS JSDoc
        // contextual typing also stays on the existing expression path.
        if (
          !pragma &&
          !directEval(declaration.init) &&
          (language.startsWith('ts') || prefixStart === statement.start)
        )
          initializers.set(declaration.init, { declaration, statement, prefixStart });
      }
    }
    if (node.type === 'ReturnStatement' && node.argument?.type === 'TwillSwitchExpression') {
      returns.add(node.argument);
      code.remove(node.start, node.start + 6);
      if (source[node.end - 1] === ';') code.remove(node.end - 1, node.end);
      // Acorn omits grouping parentheses from expression node ranges.
      // Preserve comments while removing only the return's outer grouping.
      for (const [start, end] of [
        [node.start + 6, node.argument.start],
        [node.argument.end, node.end],
      ]) {
        grouping(start, end);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'trailing', 'tag'].includes(key)) continue;
      for (const child of Array.isArray(value) ? value : [value])
        if (child?.type) visit(child, node);
    }
  };
  visit(ast);
  let counter = 0;
  const fresh = (part: string) => {
    let name: string;
    do name = `__twill${part}${counter++}`;
    while (usedNames.has(name));
    usedNames.add(name);
    return name;
  };
  for (const node of switches) {
    const direct = returns.has(node) || implicit.has(node);
    const suspended = !returns.has(node) && suspension(node);
    if (suspended)
      fail(
        suspended,
        `await/yield inside a ${node.keyword} expression requires a direct return. Bind the subject first, or await the whole result explicitly.`,
      );
    const initializer = initializers.get(node);
    const result = initializer ? fresh('Result') : undefined;
    const exit = initializer ? fresh('Exit') : undefined;
    const subject = fresh('Subject');
    if (initializer) {
      const { declaration, statement, prefixStart } = initializer;
      // Keep the user's const/let/var declaration and its TDZ unchanged. Native
      // control-flow inference computes the temporary's union across the arms.
      // An explicit annotation supplies contextual typing without copying tokens.
      const annotation =
        language.startsWith('ts') && declaration.id.typeAnnotation
          ? `: typeof ${declaration.id.name}`
          : '';
      grouping(declaration.id.end, node.start, true);
      grouping(node.end, statement.end);
      code.appendLeft(prefixStart, `let ${result}${annotation}; ${exit}: {const ${subject} = `);
      if (prefixStart < statement.start) code.prependRight(prefixStart, '\n');
      code.move(prefixStart, node.start, node.end);
      code.appendRight(node.end, ` ${result}`);
    }
    const valuePrefix = result ? `${result} = (` : 'return ';
    const valueSuffix = result ? `); break ${exit};` : ';';
    const kind = node.cases.some((branch: Node) => branch.enumPattern) ? fresh('Kind') : undefined;
    if (!initializer) {
      const opening = direct ? (sharedScopes.has(node) ? '' : '{') : '(() => {';
      code.appendLeft(node.start, `${opening}const ${subject} = `);
    }
    code.remove(node.parenStart, node.parenStart + 1);
    if (node.keyword === 'match') {
      // The native call parser permits a trailing comma. It is not part of the
      // subject initializer; preserve intervening comments/grouping tokens.
      const tokens = Parser.tokenizer(source.slice(node.discriminant.end, node.parenEnd), {
        ecmaVersion: 'latest',
      });
      for (;;) {
        const token = tokens.getToken();
        if (token.type === tokTypes.eof) break;
        if (token.type === tokTypes.comma)
          code.remove(node.discriminant.end + token.start, node.discriminant.end + token.end);
      }
    }
    // Keep the keyword source-backed for mapped lint diagnostics.
    const keywordEnd = node.start + (node.keyword === 'match' ? 5 : 6);
    if (node.keyword === 'match') code.overwrite(node.start, keywordEnd, 'switch');
    code.move(node.start, keywordEnd, node.parenEnd);
    code.appendLeft(node.parenEnd, `; ${kind ? `const ${kind} = ${subject}["kind"]; ` : ''}`);
    code.overwrite(
      node.parenEnd,
      node.parenEnd + 1,
      ` (${kind ?? subject}${kind || node.discriminator === undefined ? '' : `[${JSON.stringify(node.discriminator)}]`})`,
    );
    for (const branch of node.cases) {
      if (branch.enumPattern) {
        const { reference, binding, start, parenStart, parenEnd, explicitKeyword } =
          branch.enumPattern;
        const tag = JSON.stringify(reference.property.name);
        if (language.startsWith('ts')) {
          // A type-only factory witness checks the reference and literal tag.
          // Native TS erases it; matching performs no factory/property lookup.
          const witness = `(${tag} satisfies (typeof `;
          if (explicitKeyword) code.overwrite(start, start + 4, witness);
          else code.appendLeft(start, witness);
          code.appendLeft(
            reference.end,
            ` extends (...args: never[]) => { readonly kind: ${tag} } ? ${tag} : never))`,
          );
        } else {
          if (explicitKeyword) {
            code.overwrite(start, start + 4, tag);
            code.remove(reference.start, reference.end);
          } else code.overwrite(reference.start, reference.end, tag);
        }
        code.remove(parenStart, parenStart + 1);
        code.remove(parenEnd, parenEnd + 1);
        if (binding) {
          code.appendLeft(binding.start, ': { const ');
          code.overwrite(
            branch.colonStart,
            branch.colonStart + 1,
            ` = ${subject}; ${branch.throw ? '' : valuePrefix}`,
          );
          code.appendLeft(branch.valueEnd, `${branch.throw ? ';' : valueSuffix} }`);
          if (source[branch.end - 1] === ';') code.remove(branch.end - 1, branch.end);
        } else if (!branch.throw) {
          code.appendLeft(branch.colonStart + 1, ` ${valuePrefix}`);
          if (result) {
            code.appendLeft(branch.valueEnd, valueSuffix);
            if (source[branch.end - 1] === ';') code.remove(branch.end - 1, branch.end);
          }
        }
      } else if (branch.pattern) {
        const { pattern, tag } = branch;
        // A discarded discriminator binding preserves native rest exclusion.
        // Its key remains source-backed; the literal moves to the case label.
        code.appendLeft(tag.value.start, fresh('Tag'));
        code.move(tag.value.start, tag.value.end, pattern.start);
        code.appendLeft(tag.value.end, ': { const ');
        code.overwrite(
          branch.colonStart,
          branch.colonStart + 1,
          ` = ${subject}; ${branch.throw ? '' : valuePrefix}`,
        );
        code.appendLeft(branch.valueEnd, `${branch.throw ? ';' : valueSuffix} }`);
        if (source[branch.end - 1] === ';') code.remove(branch.end - 1, branch.end);
      } else if (!branch.throw) {
        code.appendLeft(branch.colonStart + 1, ` ${valuePrefix}`);
        if (result) {
          code.appendLeft(branch.valueEnd, valueSuffix);
          if (source[branch.end - 1] === ';') code.remove(branch.end - 1, branch.end);
        }
      }
    }
    const hasDefault = node.cases.some(
      (branch: Node) => !branch.pattern && !branch.enumPattern && branch.test === null,
    );
    // Transpile-only JS hosts cannot prove unions. Unexpected values fail
    // visibly rather than returning an accidental undefined.
    // Keep the assertion result never even for invalid unions, so the type
    // constraint is the only diagnostic, without cascading cast/ctor errors.
    const check = !hasDefault && language.startsWith('ts') ? fresh('Check') : undefined;
    const failure = hasDefault
      ? ''
      : `${check ? ` type ${check}<T extends never = typeof ${kind ?? subject}> = T & never;` : ''} throw new TypeError('Non-exhaustive switch expression'${check ? ` as ${check}` : ''});`;
    const closing = initializer || (direct && !sharedScopes.has(node)) ? '}' : direct ? '' : '})()';
    code.overwrite(node.end - 1, node.end, `}${failure}${closing}`, {
      contentOnly: true,
    });
  }
}
