import ts from 'typescript';
import { TwillProject, sourceFilename, virtualFilename } from './project.js';
import { isTwillFile, type TransformResult } from './compiler.js';

export interface SourceEdit {
  filename: string;
  span: ts.TextSpan;
  newText: string;
}

export interface CompletionRequest {
  offset: number;
  info: ts.CompletionInfo | undefined;
  props?: { start: number; end: number };
}

/** Shared semantic requests and conservative source edits for both editor hosts. */
export class TwillEditor {
  private attributeCache = new WeakMap<ts.SourceFile, ts.JsxAttribute[]>();
  private descriptorCache = new WeakMap<ts.Program, Set<ts.Symbol>>();
  private internalBindingCache = new WeakMap<ts.SourceFile, Set<string>>();
  constructor(readonly project: TwillProject) {}

  private sourceFile(filename: string) {
    return this.project.service.getProgram()?.getSourceFile(virtualFilename(filename));
  }

  private attributes(filename: string) {
    const file = this.sourceFile(filename);
    if (!file) return [];
    const cached = this.attributeCache.get(file);
    if (cached) return cached;
    const result: ts.JsxAttribute[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node)) result.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    this.attributeCache.set(file, result);
    return result;
  }

  completionLocation(filename: string, position: number) {
    let offset = this.project.toGeneratedOffset(filename, position);
    // A repaired member name and generated arm punctuation can share the same
    // original boundary. Anchor requests at the source-backed dot instead.
    const prefix = this.project.text(filename)?.slice(0, position);
    const member = prefix?.match(/\.([\p{ID_Continue}$\u200c\u200d]*)$/u);
    const missingMember = prefix?.match(/\.\s*$/);
    if (member) offset = this.project.toGeneratedOffset(filename, member.index!) + member[0].length;
    else if (missingMember)
      offset = this.project.toGeneratedOffset(filename, missingMember.index!) + 1;
    let props: CompletionRequest['props'];
    const metadata = this.project.transformed(filename)?.componentProps;
    const property = metadata
      ?.flatMap((object) => object.properties)
      .find((item) => item.shorthand && position >= item.start && position <= item.end);
    if (property) {
      const attribute = this.attributes(filename).find(
        (item) =>
          item.name.getText() === property.name &&
          item.initializer &&
          ts.isJsxExpression(item.initializer) &&
          item.initializer.expression &&
          this.project.toOriginalOffset(filename, item.initializer.expression.getStart()) ===
            property.start,
      );
      if (attribute) {
        offset = attribute.name.getStart() + position - property.start;
        props = { start: property.start, end: property.end };
      }
    } else if (
      metadata?.some((object) => position > object.start && position < object.end) &&
      !this.attributes(filename).some(
        (attribute) => offset >= attribute.name.end && offset <= attribute.end,
      )
    ) {
      // Empty objects and gaps between properties already map to JSX attribute
      // positions. Only classify requests that TS identifies as member lists.
      props = { start: position, end: position };
    }
    return { offset, props };
  }

  completions(filename: string, position: number, preferences: ts.UserPreferences = {}) {
    let { offset, props } = this.completionLocation(filename, position);
    let info = this.project.service.getCompletionsAtPosition(virtualFilename(filename), offset, {
      includeCompletionsForModuleExports: true,
      includeCompletionsWithInsertText: true,
      ...preferences,
    });
    if (
      info &&
      !info.isMemberCompletion &&
      isTwillFile(sourceFilename(filename)) &&
      this.project.transformed(filename)?.changed
    ) {
      const file = this.sourceFile(filename);
      if (file) {
        let internal = this.internalBindingCache.get(file);
        if (!internal) {
          internal = new Set<string>();
          const visit = (node: ts.Node) => {
            if (ts.isIdentifier(node) && node.text.startsWith('__twill')) {
              const parent = node.parent;
              if (
                (ts.isVariableDeclaration(parent) ||
                  ts.isBindingElement(parent) ||
                  ts.isParameter(parent) ||
                  ts.isTypeAliasDeclaration(parent) ||
                  ts.isFunctionDeclaration(parent)) &&
                parent.name === node &&
                !this.mapSpan(filename, { start: node.getStart(), length: node.getWidth() })
              )
                internal!.add(node.text);
            }
            ts.forEachChild(node, visit);
          };
          visit(file);
          this.internalBindingCache.set(file, internal);
        }
        const hidden = internal;
        if (hidden.size)
          info = { ...info, entries: info.entries.filter((entry) => !hidden.has(entry.name)) };
      }
    }
    if (props && !info?.isMemberCompletion) props = undefined;
    return { offset, info, props } satisfies CompletionRequest;
  }

  /** Never stretch a generated edit across lowered punctuation or helper code. */
  mapSpan(filename: string, span: ts.TextSpan): ts.TextSpan | undefined {
    filename = sourceFilename(filename);
    const source = this.project.text(filename);
    if (source === undefined) return undefined;
    if (!isTwillFile(filename))
      return span.start >= 0 && span.start + span.length <= source.length ? span : undefined;
    const transformed = this.project.transformed(filename);
    const generated = transformed?.code;
    if (generated === undefined) return undefined;
    const start = this.project.toOriginalOffset(filename, span.start);
    if (
      start < 0 ||
      start + span.length > source.length ||
      (this.project.toGeneratedOffset(filename, start) !== span.start &&
        !transformed!.enumCopies.some(
          (copy) =>
            (span.start >= copy.generatedStart &&
              span.start + span.length <= copy.generatedStart + copy.length &&
              start === copy.sourceStart + span.start - copy.generatedStart) ||
            (start >= copy.sourceStart &&
              start + span.length <= copy.sourceStart + copy.length &&
              this.project.toOriginalOffset(filename, span.start + span.length - 1) ===
                start + span.length - 1),
        )) ||
      source.slice(start, start + span.length) !==
        generated.slice(span.start, span.start + span.length)
    )
      return undefined;
    return { start, length: span.length };
  }

  mapChanges(changes: readonly ts.FileTextChanges[]): SourceEdit[] | undefined {
    const edits: SourceEdit[] = [];
    for (const file of changes) {
      if (file.isNewFile) return undefined;
      const filename = sourceFilename(file.fileName);
      for (const change of file.textChanges) {
        let span = this.mapSpan(filename, change.span);
        // Inferred JSX runtime pragmas can precede the first source token.
        // A fresh import can safely be inserted before the original module.
        if (!span && change.span.length === 0 && /^\s*import\b/.test(change.newText)) {
          const firstStatement = this.sourceFile(filename)?.statements[0];
          if (change.span.start <= (firstStatement?.getStart() ?? 0))
            span = { start: 0, length: 0 };
        }
        if (!span) return undefined;
        edits.push({ filename, span, newText: this.importText(change.newText) });
      }
    }
    return edits;
  }

  private importText(text: string) {
    // Edit only module literals, never user strings in an unrelated code fix.
    const file = ts.createSourceFile('edits.ts', text, ts.ScriptTarget.Latest, true);
    const replacements: { start: number; end: number; text: string }[] = [];
    for (const statement of file.statements) {
      if (
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const literal = statement.moduleSpecifier;
        const value = sourceFilename(literal.text);
        if (value !== literal.text)
          replacements.push({ start: literal.getStart() + 1, end: literal.end - 1, text: value });
      }
    }
    for (const replacement of replacements.reverse())
      text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end);
    return text;
  }

  organizeImports(filename: string, mode = ts.OrganizeImportsMode.All) {
    return this.mapChanges(
      this.project.service.organizeImports(
        { type: 'file', fileName: virtualFilename(filename), mode },
        {},
        {},
      ),
    );
  }

  /** Read-only navigation must also exclude generated helpers and duplicate JSX tags. */
  referenceGroups(filename: string, position: number): ts.ReferencedSymbol[] | undefined {
    const groups = this.project.service.findReferences(
      virtualFilename(filename),
      this.project.toGeneratedOffset(filename, position),
    );
    const mapped = <T extends ts.DocumentSpan>(entry: T): T | undefined => {
      const fileName = sourceFilename(entry.fileName);
      const textSpan = this.mapSpan(fileName, entry.textSpan);
      if (!textSpan) return undefined;
      const contextSpan = entry.contextSpan && this.mapSpan(fileName, entry.contextSpan);
      return { ...entry, fileName, textSpan, contextSpan };
    };
    return groups?.flatMap((group) => {
      const definition = mapped(group.definition);
      if (!definition) return [];
      const seen = new Set<string>();
      const references = group.references.flatMap((reference) => {
        const entry = mapped(reference);
        if (!entry) return [];
        // Some TS versions omit isDefinition from findReferences results.
        // Preserve supplied flags; otherwise compare the source-backed span
        // with this symbol group's definition for includeDeclaration requests.
        entry.isDefinition ??=
          entry.fileName === definition.fileName &&
          entry.textSpan.start === definition.textSpan.start &&
          entry.textSpan.length === definition.textSpan.length;
        const key = `${entry.fileName}:${entry.textSpan.start}:${entry.textSpan.length}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [entry];
      });
      return [{ definition, references }];
    });
  }

  references(filename: string, position: number) {
    return this.referenceGroups(filename, position)?.flatMap((group) => group.references);
  }

  private descriptorSymbols(program: ts.Program) {
    const cached = this.descriptorCache.get(program);
    if (cached) return cached;
    const symbols = new Set<ts.Symbol>();
    const checker = program.getTypeChecker();
    for (const file of program.getSourceFiles()) {
      const original = sourceFilename(file.fileName);
      if (!isTwillFile(original)) continue;
      let patterns: TransformResult['enumPatterns'] | undefined;
      try {
        patterns = this.project.transformed(original)?.enumPatterns;
      } catch {
        // One malformed document must not disable safe edits in other files.
        // Strict diagnostics and mapChanges still reject its unmappable edits.
        continue;
      }
      if (!patterns?.length) continue;
      const offsets = new Set(
        patterns.map((pattern) =>
          this.project.toGeneratedOffset(original, pattern.reference.property.start),
        ),
      );
      // Index each source once, rather than traversing it for every arm.
      // Program identity invalidates the cached symbols on any source edit.
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && offsets.has(node.getStart())) {
          const symbol = checker.getSymbolAtLocation(node);
          if (symbol) for (const root of checker.getRootSymbols(symbol)) symbols.add(root);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    this.descriptorCache.set(program, symbols);
    return symbols;
  }

  renameInfo(filename: string, position: number): ts.RenameInfo {
    const offset = this.project.toGeneratedOffset(filename, position);
    const definitions = this.project.service.getDefinitionAtPosition(
      virtualFilename(filename),
      offset,
    );
    const program = this.project.service.getProgram()!;
    const descriptors = this.descriptorSymbols(program);
    for (const definition of definitions ?? []) {
      const file = sourceFilename(definition.fileName);
      const definitionFile = this.sourceFile(file);
      let descriptor = false;
      const visitDefinition = (node: ts.Node) => {
        if (definition.textSpan.start < node.getStart() || definition.textSpan.start >= node.end)
          return;
        if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
          const symbol = program.getTypeChecker().getSymbolAtLocation(node);
          descriptor =
            !!symbol &&
            program
              .getTypeChecker()
              .getRootSymbols(symbol)
              .some((root) => descriptors.has(root));
        } else ts.forEachChild(node, visitDefinition);
      };
      if (descriptors.size && definitionFile) visitDefinition(definitionFile);
      if (descriptor)
        return {
          canRename: false,
          localizedErrorMessage:
            'Renaming an enum-pattern case descriptor requires linked discriminator edits and is not supported yet.',
        };
      const declarations = this.project.transformed(file)?.associatedEnums;
      if (!declarations?.length) continue;
      const sourceFile = this.sourceFile(file);
      let generatedEnum = false;
      const visit = (node: ts.Node) => {
        if (definition.textSpan.start < node.getStart() || definition.textSpan.start >= node.end)
          return;
        if (
          (ts.isTypeAliasDeclaration(node) || ts.isVariableDeclaration(node)) &&
          ts.isIdentifier(node.name)
        ) {
          const start = this.project.toOriginalOffset(file, node.name.getStart());
          if (declarations.some((declaration) => declaration.id.start === start)) {
            generatedEnum = true;
            return;
          }
        }
        ts.forEachChild(node, visit);
      };
      if (sourceFile) visit(sourceFile);
      if (generatedEnum)
        return {
          canRename: false,
          localizedErrorMessage:
            'Renaming associated-value enum declarations, cases, payload fields and type parameters is not supported yet.',
        };
    }
    const info = this.project.service.getRenameInfo(virtualFilename(filename), offset, {
      allowRenameOfImportPath: false,
    });
    if (!info.canRename) return info;
    const span = this.mapSpan(filename, info.triggerSpan);
    return span
      ? { ...info, triggerSpan: span }
      : {
          canRename: false,
          localizedErrorMessage: 'This generated symbol cannot be renamed in Twill source.',
        };
  }

  renameLocations(
    filename: string,
    position: number,
    preferences: ts.UserPreferences | boolean = true,
  ) {
    const info = this.renameInfo(filename, position);
    if (!info.canRename) return undefined;
    const locations = this.project.service.findRenameLocations(
      virtualFilename(filename),
      this.project.toGeneratedOffset(filename, position),
      false,
      false,
      typeof preferences === 'boolean'
        ? { providePrefixAndSuffixTextForRename: preferences }
        : preferences,
    );
    if (!locations) return undefined;
    const result: ts.RenameLocation[] = [];
    for (const location of locations) {
      const file = sourceFilename(location.fileName);
      let span = this.mapSpan(file, location.textSpan);
      let prefixText = location.prefixText;
      let suffixText = location.suffixText;
      if (isTwillFile(file)) {
        const attribute = this.attributes(file).find(
          (item) =>
            item.name.getStart() === location.textSpan.start &&
            item.initializer &&
            ts.isJsxExpression(item.initializer) &&
            item.initializer.expression,
        );
        if (attribute && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
          const original = this.project.toOriginalOffset(
            file,
            attribute.initializer.expression!.getStart(),
          );
          const property = this.project
            .transformed(file)
            ?.componentProps.flatMap((object) => object.properties)
            .find(
              (item) =>
                item.name === attribute.name.getText() &&
                (item.shorthand
                  ? item.start === original
                  : item.start === this.project.toOriginalOffset(file, attribute.name.getStart())),
            );
          if (property) {
            span = { start: property.start, length: property.end - property.start };
            if (property.shorthand) suffixText = `: ${property.name}`;
            else {
              const quote = this.project.text(file)?.[property.start];
              if (quote === '"' || quote === "'") {
                prefixText = quote;
                suffixText = quote;
              }
            }
          }
        } else if (span) {
          const property = this.project
            .transformed(file)
            ?.componentProps.flatMap((object) => object.properties)
            .find((item) => item.shorthand && item.start === span!.start);
          if (property) prefixText = `${property.name}: `;
        }
      }
      if (!span) {
        const generated = this.project.transformed(file)?.code;
        const start = this.project.toOriginalOffset(file, location.textSpan.start);
        if (
          generated &&
          this.project.text(file)?.slice(start, start + location.textSpan.length) !==
            generated.slice(
              location.textSpan.start,
              location.textSpan.start + location.textSpan.length,
            )
        )
          continue; // A compiler-inserted guard/defer reference is regenerated.
        // Generated closing JSX tags duplicate a source component reference;
        // they have no independent source occurrence to edit.
        const sf = this.sourceFile(file);
        let closing = false;
        const visit = (node: ts.Node) => {
          if (
            ts.isJsxClosingElement(node) &&
            location.textSpan.start >= node.tagName.getStart() &&
            location.textSpan.start < node.tagName.end
          )
            closing = true;
          else if (
            location.textSpan.start >= node.getFullStart() &&
            location.textSpan.start < node.end
          )
            ts.forEachChild(node, visit);
        };
        if (sf) visit(sf);
        if (closing) continue;
        return undefined;
      }
      result.push({
        ...location,
        fileName: file,
        textSpan: span,
        prefixText,
        suffixText,
        contextSpan: location.contextSpan ? this.mapSpan(file, location.contextSpan) : undefined,
      });
    }
    return result.filter(
      (item, index) =>
        result.findIndex(
          (other) =>
            item.fileName === other.fileName &&
            item.textSpan.start === other.textSpan.start &&
            item.textSpan.length === other.textSpan.length,
        ) === index,
    );
  }

  rename(
    filename: string,
    position: number,
    name: string,
    preferences: ts.UserPreferences | boolean = true,
  ): SourceEdit[] | undefined {
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      false,
      ts.LanguageVariant.Standard,
      name,
    );
    if (
      scanner.scan() !== ts.SyntaxKind.Identifier ||
      scanner.scan() !== ts.SyntaxKind.EndOfFileToken
    )
      return undefined;
    return this.renameLocations(filename, position, preferences)?.map((location) => ({
      filename: location.fileName,
      span: location.textSpan,
      newText: (location.prefixText ?? '') + name + (location.suffixText ?? ''),
    }));
  }

  fixes(filename: string, start: number, end: number, codes: readonly number[]) {
    return this.project.service
      .getCodeFixesAtPosition(
        virtualFilename(filename),
        this.project.toGeneratedOffset(filename, start),
        this.project.toGeneratedOffset(filename, end),
        codes,
        {},
        {},
      )
      .flatMap((fix) => {
        const edits = this.mapChanges(fix.changes);
        return edits?.length && !fix.commands?.length
          ? [{ description: fix.description, edits }]
          : [];
      });
  }
}
