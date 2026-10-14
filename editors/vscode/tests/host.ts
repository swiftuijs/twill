import * as vscode from 'vscode';
import extensionManifest from '../package.json';
import assert from 'node:assert/strict';
import { join, isAbsolute } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Registry, INITIAL } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import { checkProviderContracts } from './provider-contracts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually<T>(action: () => PromiseLike<T>, accept: (value: T) => boolean) {
  const deadline = Date.now() + 15000;
  let last: T | undefined;
  let error: unknown;
  do {
    try {
      last = await action();
      if (accept(last)) return last;
    } catch (value) {
      error = value;
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error('Editor request did not become ready: ' + (error ?? JSON.stringify(last)));
}

export async function run() {
  const root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  const extension = vscode.extensions.getExtension(
    `${extensionManifest.publisher}.${extensionManifest.name}`,
  )!;
  assert(extension, 'The extracted VSIX must be installed');
  await extension.activate();
  const require = createRequire(join(root, '../tests.cjs'));
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const grammars = ['twill', 'twillx'].map((name) =>
    JSON.parse(
      readFileSync(join(extension.extensionPath, 'syntaxes', name + '.tmLanguage.json'), 'utf8'),
    ),
  );
  const nativeExtension = vscode.extensions.all.find((extension) =>
    extension.packageJSON.contributes?.grammars?.some(
      (grammar: { scopeName: string }) => grammar.scopeName === 'source.ts',
    ),
  );
  assert(nativeExtension, 'The built-in TypeScript grammar extension must be available');
  const nativeGrammars = ['TypeScript', 'TypeScriptReact'].map((name) =>
    JSON.parse(
      readFileSync(
        join(nativeExtension.extensionPath, 'syntaxes', name + '.tmLanguage.json'),
        'utf8',
      ),
    ),
  );
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (text) => new OnigString(text),
    }),
    loadGrammar: async (scope) =>
      [...grammars, ...nativeGrammars].find((grammar) => grammar.scopeName === scope) ?? null,
  });
  try {
    for (const grammar of grammars) {
      const loaded = (await registry.loadGrammar(grammar.scopeName))!;
      const memberLine = 'users.filter { .active }';
      assert(
        loaded
          .tokenizeLine(memberLine, INITIAL)
          .tokens.some(
            (token) =>
              memberLine.slice(token.startIndex, token.endIndex) === 'active' &&
              token.scopes.includes('variable.other.property.twill'),
          ),
        `${grammar.name}: implicit property highlighting`,
      );
      for (const line of [
        'items.map { (value: number) in value + 1 };',
        'items.map { async (value: number): Promise<number> in await read(value) };',
        'const value = `${items.map { value in value.name }}`;',
      ]) {
        const tokens = loaded.tokenizeLine(line, INITIAL).tokens;
        assert(
          tokens.some(
            (token) =>
              line.slice(token.startIndex, token.endIndex) === 'in' &&
              token.scopes.includes('keyword.control.twill'),
          ),
          `${grammar.name}: typed/template closure header ${line}`,
        );
      }
      for (const line of [
        'object.guard (true); object.defer();',
        'const literal = "guard true else { return; } defer { close(); } .active";',
        'const literal = `${"guard true else { return; } defer { close(); } .active"}`;',
      ]) {
        assert(
          !loaded
            .tokenizeLine(line, INITIAL)
            .tokens.some(
              (token) =>
                token.scopes.includes('keyword.control.twill') ||
                token.scopes.includes('variable.other.property.twill'),
            ),
          `${grammar.name}: literal/property exclusion ${line}`,
        );
      }
      if (grammar.scopeName.endsWith('.tsx')) {
        const line = 'const view = <div>{items.map { value in <span>{value.name}</span> }}</div>;';
        assert(
          loaded
            .tokenizeLine(line, INITIAL)
            .tokens.some(
              (token) =>
                line.slice(token.startIndex, token.endIndex) === 'span' &&
                token.scopes.some((scope) => scope.startsWith('entity.name.tag')),
            ),
          'Native TSX tags inside trailing closures must remain highlighted',
        );
      }
      let state = INITIAL;
      const controls: string[] = [];
      for (const line of [
        'function describe(input: Result) {',
        'guard const { result } = input else { return "missing"; }',
        'return switch (result) {',
        'case { kind: "ok", value }: value.toFixed();',
        'default: "unknown";',
        '};',
        'const words = "guard else switch case default";',
        'object.switch();',
        '}',
      ]) {
        const tokens = loaded.tokenizeLine(line, state);
        state = tokens.ruleStack;
        for (const token of tokens.tokens)
          if (token.scopes.some((scope) => scope.startsWith('keyword.control')))
            controls.push(line.slice(token.startIndex, token.endIndex));
      }
      for (const word of ['guard', 'else', 'switch', 'case', 'default'])
        assert.equal(
          controls.filter((control) => control === word).length,
          1,
          `${grammar.name}: ${word} must highlight once, excluding strings/properties`,
        );
    }
  } finally {
    registry.dispose();
  }
  console.log(
    'PASS: shipped TS/TSX grammars highlight guard and switch expressions with actual built-in TS grammars',
  );
  const open = async (name: string) => {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(isAbsolute(name) ? name : join(root, name)),
    );
    await vscode.window.showTextDocument(doc);
    return doc;
  };
  const position = (doc: vscode.TextDocument, needle: string, delta = 0) => {
    const offset = doc.getText().indexOf(needle);
    assert(offset >= 0, 'Missing source needle: ' + needle);
    return doc.positionAt(offset + delta);
  };
  const completions = (doc: vscode.TextDocument, at: vscode.Position, resolve = 0) =>
    vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      at,
      undefined,
      resolve,
    );
  const label = (item: vscode.CompletionItem) =>
    typeof item.label === 'string' ? item.label : item.label.label;

  const formatting = await open('api.twill');
  const formatEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatDocumentProvider',
    formatting.uri,
    { tabSize: 2, insertSpaces: true },
  );
  assert(formatEdits?.length, 'The packaged formatter must return edits');
  const formatted = new vscode.WorkspaceEdit();
  formatted.set(formatting.uri, formatEdits!);
  assert(await vscode.workspace.applyEdit(formatted));
  assert(formatting.getText().includes('map { item in'));
  assert(formatting.getText().includes('value: number'));
  console.log('PASS: packaged formatter preserves Twill syntax and TypeScript annotations');
  const definitions = await eventually(
    () =>
      vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        formatting.uri,
        position(formatting, 'scale(item)', 1),
      ),
    (locations) => !!locations?.some((location) => location.uri.fsPath.endsWith('scale.ts')),
  );
  const definition = definitions!.find((location) => location.uri.fsPath.endsWith('scale.ts'))!;
  const definitionSource = await vscode.workspace.openTextDocument(definition.uri);
  assert.equal(definitionSource.getText(definition.range), 'scale');
  const signature = await eventually(
    () =>
      vscode.commands.executeCommand<vscode.SignatureHelp>(
        'vscode.executeSignatureHelpProvider',
        formatting.uri,
        position(formatting, 'scale(item)', 6),
      ),
    (help) => !!help?.signatures.length,
  );
  assert(signature!.signatures[0].label.includes('value: number'));
  assert.equal(signature!.activeParameter, 0);
  console.log(
    'PASS: definition navigation and signature help map from trailing closures to native TS',
  );

  const implicitDocument = await open('members.twill');
  const memberItems = await eventually(
    () => completions(implicitDocument, position(implicitDocument, '.act }', 4)),
    (list) => !!list?.items.some((item) => label(item) === 'active'),
  );
  assert(memberItems!.items.some((item) => label(item) === 'name'));
  const memberHover = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    implicitDocument.uri,
    position(implicitDocument, '.active }', 2),
  );
  assert(
    memberHover?.some((hover) =>
      hover.contents.some(
        (content) =>
          typeof content !== 'string' &&
          'value' in content &&
          content.value.includes('active: boolean'),
      ),
    ),
  );
  const memberFormats = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatDocumentProvider',
    implicitDocument.uri,
    { tabSize: 2, insertSpaces: true },
  );
  assert(memberFormats?.length);
  const memberFormat = new vscode.WorkspaceEdit();
  memberFormat.set(implicitDocument.uri, memberFormats!);
  assert(await vscode.workspace.applyEdit(memberFormat));
  assert(implicitDocument.getText().includes('.active'));
  assert(!implicitDocument.getText().includes('__twillImplicit'));
  const memberRename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    implicitDocument.uri,
    position(implicitDocument, '.active', 2),
    'enabled',
  );
  assert(memberRename && (await vscode.workspace.applyEdit(memberRename)));
  assert(implicitDocument.getText().includes('.enabled'));
  assert(implicitDocument.getText().includes('enabled: true'));
  console.log('PASS: implicit member completion, hover, formatting and property rename');

  const branching = await open('branching.twill');
  const optional = await open('if-bindings.twill');
  await eventually(
    () => completions(optional, position(optional, 'value.toFixed', 6)),
    (list) => !!list?.items.some((item) => label(item) === 'toPrecision'),
  );
  const optionalRename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    optional.uri,
    position(optional, '{value}', 1),
    'amount',
  );
  assert(optionalRename && (await vscode.workspace.applyEdit(optionalRename)));
  assert(optional.getText().includes('{value: amount}'));
  assert(optional.getText().includes('return amount.toFixed();'));
  assert(optional.getText().includes('const value=7;'));
  assert(optional.getText().includes('else{return value.toFixed();}'));
  const optionalFormats = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatDocumentProvider',
    optional.uri,
    { tabSize: 2, insertSpaces: true },
  );
  assert(optionalFormats?.length);
  const optionalFormatEdit = new vscode.WorkspaceEdit();
  optionalFormatEdit.set(optional.uri, optionalFormats!);
  assert(await vscode.workspace.applyEdit(optionalFormatEdit));
  assert(optional.getText().includes('if const { value: amount } = input'));
  assert(!optional.getText().includes('__twill'));
  await eventually(
    async () => vscode.languages.getDiagnostics(optional.uri),
    (items) => items.length === 0,
  );
  console.log(
    'PASS: branch binding narrowing, completion, local rename, outer scope and formatting',
  );
  const branchMembers = await eventually(
    () => completions(branching, position(branching, 'amount.toFixed', 7)),
    (list) => !!list?.items.some((item) => label(item) === 'toFixed'),
  );
  assert(branchMembers!.items.some((item) => label(item) === 'toPrecision'));
  const branchRename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    branching.uri,
    position(branching, 'amount}', 1),
    'total',
  );
  assert(branchRename && (await vscode.workspace.applyEdit(branchRename)));
  assert(branching.getText().includes('value: total}'));
  assert(branching.getText().includes('total.toFixed()'));
  const branchFormats = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatDocumentProvider',
    branching.uri,
    { tabSize: 2, insertSpaces: true },
  );
  assert(branchFormats?.length);
  const branchFormatEdit = new vscode.WorkspaceEdit();
  branchFormatEdit.set(branching.uri, branchFormats!);
  assert(await vscode.workspace.applyEdit(branchFormatEdit));
  assert(branching.getText().includes('guard const { result: item }'));
  assert(branching.getText().includes('return switch (item)'));
  await eventually(
    async () => vscode.languages.getDiagnostics(branching.uri),
    (items) => items.length === 0,
  );
  const omit = new vscode.WorkspaceEdit();
  omit.replace(
    branching.uri,
    new vscode.Range(new vscode.Position(0, 0), branching.positionAt(branching.getText().length)),
    branching.getText().replace(/\s*case \{ kind: "bad", error \}: error;/, ''),
  );
  assert(await vscode.workspace.applyEdit(omit));
  await eventually(
    async () => vscode.languages.getDiagnostics(branching.uri),
    (items) => items.some((item) => item.code === 1360),
  );
  console.log(
    'PASS: destructured guard and pattern switch completion, rename, formatting and exhaustive diagnostics',
  );

  const nativePattern = await open('native-patterns.twill');
  const nativeFactory = await open('pattern-factory.ts');
  await eventually(
    async () => vscode.languages.getDiagnostics(nativePattern.uri),
    (items) => items.length === 0,
  );
  const patternMembers = await eventually(
    () => completions(nativePattern, position(nativePattern, 'Cases.loaded', 6)),
    (list) => !!list?.items.some((item) => label(item) === 'loaded'),
  );
  assert(patternMembers!.items.some((item) => label(item) === 'loaded'));
  const patternDefinitions = await vscode.commands.executeCommand<
    (vscode.Location | vscode.LocationLink)[]
  >(
    'vscode.executeDefinitionProvider',
    nativePattern.uri,
    position(nativePattern, 'Cases.loaded', 6),
  );
  assert(
    patternDefinitions?.some(
      (item) => ('uri' in item ? item.uri : item.targetUri).fsPath === nativeFactory.uri.fsPath,
    ),
  );
  await eventually(
    () =>
      vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        nativeFactory.uri,
        position(nativeFactory, 'loaded', 0),
      ),
    (items) => !!items?.some((item) => item.uri.fsPath === nativePattern.uri.fsPath),
  );
  for (const document of [nativePattern, nativeFactory]) {
    let edits: vscode.WorkspaceEdit | undefined;
    try {
      edits = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        'vscode.executeDocumentRenameProvider',
        document.uri,
        position(document, 'loaded', 0),
        'renamedCase',
      );
    } catch (error) {
      assert.match(String(error), /renam/i);
    }
    assert(
      !edits || edits.size === 0,
      'Descriptor rename must keep its linked tag intact: ' + document.uri.fsPath,
    );
  }
  const nativeOwnerRename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    nativeFactory.uri,
    position(nativeFactory, 'Factory', 0),
    'LibraryFactory',
  );
  assert(nativeOwnerRename && nativeOwnerRename.size > 0);
  assert(await vscode.workspace.applyEdit(nativeOwnerRename));
  assert(nativePattern.getText().includes('LibraryFactory as Cases'));
  assert(nativePattern.getText().includes('case Cases.loaded'));
  await eventually(
    async () => vscode.languages.getDiagnostics(nativePattern.uri),
    (items) => items.length === 0,
  );

  const enumeration = await open('enums.twill');
  await eventually(
    async () => vscode.languages.getDiagnostics(enumeration.uri),
    (items) => items.length === 0,
  );
  const enumMembers = await eventually(
    () => completions(enumeration, position(enumeration, 'State.loaded', 6)),
    (list) => !!list?.items.some((item) => label(item) === 'loaded'),
  );
  assert(enumMembers!.items.some((item) => label(item) === 'idle'));
  const enumConsumer = await open('enums-consumer.ts');
  await eventually(
    async () => vscode.languages.getDiagnostics(enumConsumer.uri),
    (items) => items.length === 0,
  );
  for (const [document, token, offset] of [
    [enumeration, 'value:T', 0],
    [enumConsumer, 'result.value', 7],
  ] as const) {
    let edits: vscode.WorkspaceEdit | undefined;
    try {
      edits = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        'vscode.executeDocumentRenameProvider',
        document.uri,
        position(document, token, offset),
        'renamedPayload',
      );
    } catch (error) {
      assert.match(String(error), /renam/i);
    }
    assert(!edits || edits.size === 0, 'Unsafe enum payload rename must be withheld');
  }
  const enumFormats = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatDocumentProvider',
    enumeration.uri,
    { tabSize: 2, insertSpaces: true },
  );
  assert(enumFormats?.length);
  const enumFormatEdit = new vscode.WorkspaceEdit();
  enumFormatEdit.set(enumeration.uri, enumFormats!);
  assert(await vscode.workspace.applyEdit(enumFormatEdit));
  assert(enumeration.getText().includes('case loaded(value: T)'));
  assert(enumeration.getText().includes('case State.loaded({ value: amount })'));
  const patternRename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    enumeration.uri,
    position(enumeration, 'amount }', 0),
    'payloadAmount',
  );
  assert(patternRename && patternRename.size > 0);
  assert(await vscode.workspace.applyEdit(patternRename));
  assert(enumeration.getText().includes('value: payloadAmount'));
  assert(enumeration.getText().includes('payloadAmount.toFixed()'));
  const omitEnumCase = new vscode.WorkspaceEdit();
  omitEnumCase.replace(
    enumeration.uri,
    new vscode.Range(
      new vscode.Position(0, 0),
      enumeration.positionAt(enumeration.getText().length),
    ),
    enumeration.getText().replace(/\s*case State\.idle\(\): 0;/, ''),
  );
  assert(await vscode.workspace.applyEdit(omitEnumCase));
  await eventually(
    async () => vscode.languages.getDiagnostics(enumeration.uri),
    (items) => items.some((item) => item.code === 1360),
  );
  console.log(
    'PASS: associated enum constructor completion, native consumer, formatting and exhausted switch diagnostics',
  );

  const view = await open('view.twillx');
  const props = await eventually(
    () => completions(view, position(view, 'tit }', 3)),
    (list) => !!list?.items.some((item) => label(item) === 'title'),
  );
  const title = props!.items.find((item) => label(item) === 'title')!;
  assert(title.insertText instanceof vscode.SnippetString);
  assert.match(title.insertText.value, /^title: /);
  assert.equal(view.getText(title.range as vscode.Range), 'tit');
  console.log('PASS: partial React props use original source ranges and value snippets');

  const patch = new vscode.WorkspaceEdit();
  patch.replace(
    view.uri,
    new vscode.Range(new vscode.Position(0, 0), view.positionAt(view.getText().length)),
    view.getText().replace('tit }', "title: 'Hi', onClick: event => event. }"),
  );
  assert(await vscode.workspace.applyEdit(patch));
  const members = await eventually(
    () => completions(view, position(view, 'event. }', 6)),
    (list) => !!list?.items.some((item) => label(item) === 'x'),
  );
  assert.equal(members!.items.find((item) => label(item) === 'x')!.insertText, 'x');
  const member = members!.items.find((item) => label(item) === 'x')!;
  const memberEdit = new vscode.WorkspaceEdit();
  const memberPosition = position(view, 'event. }', 6);
  const memberRange =
    member.range instanceof vscode.Range
      ? member.range
      : (member.range?.replacing ??
        view.getWordRangeAtPosition(memberPosition) ??
        new vscode.Range(memberPosition, memberPosition));
  memberEdit.replace(view.uri, memberRange, member.insertText as string);
  assert(await vscode.workspace.applyEdit(memberEdit));
  assert(view.getText().includes("event.x }) { 'Hello' }"));
  console.log('PASS: unsaved incomplete React callbacks retain contextual member completion');

  const auto = await open('auto.twill');
  const imported = await eventually(
    () => completions(auto, position(auto, 'twice', 3), 2000),
    (list) =>
      !!list?.items.some((item) => label(item) === 'twice' && item.additionalTextEdits?.length),
  );
  const twice = imported!.items.find(
    (item) => label(item) === 'twice' && item.additionalTextEdits?.length,
  )!;
  const importEdit = new vscode.WorkspaceEdit();
  importEdit.set(auto.uri, twice.additionalTextEdits!);
  assert(await vscode.workspace.applyEdit(importEdit));
  assert.match(auto.getText(), /import.*twice.*api/);
  assert(!auto.getText().includes('.twill.ts'));
  await eventually(
    async () => vscode.languages.getDiagnostics(auto.uri),
    (items) => !items.some((item) => item.code === 2304),
  );
  console.log('PASS: selecting auto-import completion applies source imports');

  const imports = await open('imports.twill');
  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    'vscode.executeCodeActionProvider',
    imports.uri,
    new vscode.Range(new vscode.Position(0, 0), imports.positionAt(imports.getText().length)),
    'source.organizeImports',
  );
  const organize = actions!.find((action) => action.edit);
  assert(organize?.edit);
  assert(await vscode.workspace.applyEdit(organize.edit));
  assert(!imports.getText().includes('unused'));
  assert(imports.getText().includes('[1].map { n in twice(n) }'));
  console.log('PASS: organize imports preserves trailing syntax');

  const fix = await open('fix.twill');
  const problems = await eventually(
    async () => vscode.languages.getDiagnostics(fix.uri),
    (items) => items.some((item) => item.code === 2551),
  );
  const diagnostic = problems.find((item) => item.code === 2551)!;
  const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    'vscode.executeCodeActionProvider',
    fix.uri,
    diagnostic.range,
    'quickfix',
  );
  const spelling = fixes!.find((action) => action.title.includes('toFixed'));
  assert(spelling?.edit);
  assert(await vscode.workspace.applyEdit(spelling.edit));
  assert(fix.getText().includes('.map { value in value.toFixed(2) }'));
  console.log('PASS: mapped diagnostics and spelling code fixes edit original callbacks');

  const api = await open('api.twill');
  const scaleUri = vscode.Uri.file(join(root, 'scale.ts'));
  const originalScale = await vscode.workspace.fs.readFile(scaleUri);
  try {
    await vscode.workspace.fs.writeFile(
      scaleUri,
      Buffer.from('export function scale(value: number): string { return String(value); }\n'),
    );
    await eventually(
      async () => vscode.languages.getDiagnostics(api.uri),
      (items) => items.some((item) => item.code === 2322),
    );
    assert(view.getText().includes('event.x'));
    assert(auto.getText().includes('import'));
  } finally {
    await vscode.workspace.fs.writeFile(scaleUri, originalScale);
  }
  await eventually(
    async () => vscode.languages.getDiagnostics(api.uri),
    (items) => !items.some((item) => item.code === 2322),
  );
  console.log('PASS: dependency disk changes refresh diagnostics without losing unsaved buffers');

  const references = await eventually(
    () =>
      vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        api.uri,
        position(api, 'twice', 1),
      ),
    (entries) => !!entries?.some((entry) => entry.uri.fsPath.endsWith('consumer.ts')),
  );
  assert(references!.some((entry) => entry.uri.fsPath.endsWith('auto.twill')));
  for (const entry of references!) {
    const document = await vscode.workspace.openTextDocument(entry.uri);
    assert.equal(
      document.getText(entry.range),
      'twice',
      JSON.stringify({ file: entry.uri.fsPath, range: entry.range, source: document.getText() }),
    );
    assert(!/\.twill\.ts$/.test(entry.uri.fsPath));
  }
  const nativeConsumer = await open('consumer.ts');
  const nativeReferences = await eventually(
    () =>
      vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        nativeConsumer.uri,
        position(nativeConsumer, 'twice', 1),
      ),
    (entries) => !!entries?.some((entry) => entry.uri.fsPath.endsWith('api.twill')),
  );
  for (const entry of nativeReferences!) {
    const document = await vscode.workspace.openTextDocument(entry.uri);
    assert.equal(
      document.getText(entry.range),
      'twice',
      JSON.stringify({ file: entry.uri.fsPath, range: entry.range, source: document.getText() }),
    );
  }
  console.log('PASS: references from Twill and native TS map to unsaved original source');

  const renamed = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    api.uri,
    position(api, 'twice', 1),
    'double',
  );
  assert(renamed && renamed.entries().some(([uri]) => uri.fsPath.endsWith('consumer.ts')));
  assert(await vscode.workspace.applyEdit(renamed));
  const consumer = await open('consumer.ts');
  assert(consumer.getText().includes('double(21)'));
  const scale = await open('scale.ts');
  const nativeRename = await eventually(
    () =>
      vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        'vscode.executeDocumentRenameProvider',
        scale.uri,
        position(scale, 'scale', 2),
        'timesTwo',
      ),
    (edits) => !!edits?.entries().some(([uri]) => uri.fsPath.endsWith('api.twill')),
  );
  assert(await vscode.workspace.applyEdit(nativeRename!));
  assert(
    api.getText().includes('timesTwo(item)'),
    JSON.stringify({
      source: api.getText(),
      edits: nativeRename!.entries().map(([uri, edits]) => ({ uri: uri.fsPath, edits })),
    }),
  );
  console.log('PASS: cross-file rename works from Twill and native TS with unsaved overlays');

  const settings = await open('settings-consumer.ts');
  const settingsUri = vscode.Uri.file(join(root, 'twill.config.json'));
  const hoverType = async () => {
    const items = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      settings.uri,
      position(settings, 'values;', 2),
    );
    return (
      items
        ?.flatMap((item) => item.contents)
        .map((item) => (typeof item === 'string' ? item : item.value))
        .join('\n') ?? ''
    );
  };
  await eventually(hoverType, (text) => text.includes('number[]'));
  try {
    await vscode.workspace.fs.writeFile(settingsUri, Buffer.from('{"implicitReturn":false}'));
    await eventually(hoverType, (text) => text.includes('void[]'));
    await eventually(
      async () => vscode.languages.getDiagnostics(settings.uri),
      (items) => items.some((item) => item.code === 2322),
    );
    assert(
      api.getText().includes('timesTwo(item)'),
      'Configuration reload must retain unsaved source',
    );
  } finally {
    await vscode.workspace.fs.delete(settingsUri);
  }
  await eventually(hoverType, (text) => text.includes('number[]'));
  await eventually(
    async () => vscode.languages.getDiagnostics(settings.uri),
    (items) => !items.some((item) => item.code === 2322),
  );
  console.log(
    'PASS: configuration saves refresh native TS hover and diagnostics with unsaved overlays',
  );

  const runtimeDocument = await open('runtime.twill');
  try {
    await vscode.workspace.fs.writeFile(settingsUri, Buffer.from('{"runtime":"external"}'));
    await eventually(
      async () => {
        await vscode.window.showTextDocument(runtimeDocument);
        await vscode.commands.executeCommand('twill.showGenerated');
        return vscode.window.activeTextEditor?.document.getText() ?? '';
      },
      (text) => text.includes('@swiftuijs/twill-runtime/helpers/v1'),
    );
    await eventually(
      async () => vscode.languages.getDiagnostics(runtimeDocument.uri),
      (items) => !items.some((item) => item.severity === vscode.DiagnosticSeverity.Error),
    );
    const edits = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      'vscode.executeDocumentRenameProvider',
      runtimeDocument.uri,
      position(runtimeDocument, 'value=input', 1),
      'amount',
    );
    assert(edits && (await vscode.workspace.applyEdit(edits)));
    assert(runtimeDocument.getText().includes('events.push(amount+1)'));
    assert(!runtimeDocument.getText().includes('__twill'));
  } finally {
    await vscode.workspace.fs.delete(settingsUri);
  }
  await eventually(
    async () => {
      await vscode.window.showTextDocument(runtimeDocument);
      await vscode.commands.executeCommand('twill.showGenerated');
      return vscode.window.activeTextEditor?.document.getText() ?? '';
    },
    (text) => !text.includes('twill-runtime'),
  );
  console.log('PASS: external runtime config reload, generated preview, types and mapped rename');

  await vscode.window.showTextDocument(api);
  const originalSource = api.getText();
  await vscode.commands.executeCommand('twill.showGenerated');
  assert.equal(vscode.window.activeTextEditor?.document.languageId, 'typescript');
  const generated = vscode.window.activeTextEditor!.document.getText();
  assert(generated.includes('=>'));
  assert.match(generated, /=>\s*\{\n\s+return/);
  assert.equal(api.getText(), originalSource, 'Generated display must not edit source');
  const invalidView = new vscode.WorkspaceEdit();
  invalidView.replace(
    view.uri,
    new vscode.Range(position(view, "'Hi'"), position(view, "'Hi'", 4)),
    '123',
  );
  assert(await vscode.workspace.applyEdit(invalidView));
  await vscode.window.showTextDocument(api);
  await vscode.commands.executeCommand('twill.projectInfo');
  const report = JSON.parse(vscode.window.activeTextEditor!.document.getText());
  assert.equal(report.twillVersion, extension.packageJSON.version);
  assert(report.files.twill > 0);
  assert.equal(report.ok, false);
  assert(
    report.diagnostics.some((item: { filename?: string }) =>
      item.filename?.endsWith('view.twillx'),
    ),
    'Project report must include diagnostics from other unsaved files',
  );
  const validView = new vscode.WorkspaceEdit();
  validView.replace(
    view.uri,
    new vscode.Range(position(view, '123'), position(view, '123', 3)),
    "'Hi'",
  );
  assert(await vscode.workspace.applyEdit(validView));
  console.log('PASS: generated-source viewer and project diagnostic report');

  const debug = await open('debug.twill');
  const breakpoint = new vscode.SourceBreakpoint(
    new vscode.Location(debug.uri, position(debug, 'console.log')),
  );
  vscode.debug.addBreakpoints([breakpoint]);
  const stopped: { session: vscode.DebugSession; thread: number }[] = [];
  const trackers = ['node', 'pwa-node'].map((type) =>
    vscode.debug.registerDebugAdapterTrackerFactory(type, {
      createDebugAdapterTracker(session) {
        return {
          onDidSendMessage(message) {
            if (message.event === 'stopped')
              stopped.push({ session, thread: message.body.threadId });
          },
        };
      },
    }),
  );
  let session: vscode.DebugSession | undefined;
  try {
    await vscode.commands.executeCommand('twill.debugFile');
    const first = await eventually(
      async () => stopped.shift(),
      (event) => !!event,
    );
    session = first!.session;
    const trace = await session.customRequest('stackTrace', { threadId: first!.thread });
    assert.equal(
      trace.stackFrames[0].source.path.replaceAll('\\', '/'),
      debug.uri.fsPath.replaceAll('\\', '/'),
    );
    assert.equal(trace.stackFrames[0].line, 4, 'Debugger statement must map to original Twill');
    await session.customRequest('continue', { threadId: first!.thread });
    const second = await eventually(
      async () => stopped.shift(),
      (event) => !!event,
    );
    const atBreakpoint = await session.customRequest('stackTrace', { threadId: second!.thread });
    assert.equal(
      atBreakpoint.stackFrames[0].source.path.replaceAll('\\', '/'),
      debug.uri.fsPath.replaceAll('\\', '/'),
    );
    assert.equal(
      atBreakpoint.stackFrames[0].line,
      5,
      'Source breakpoint must map to original Twill',
    );
    console.log('PASS: Node debugging stops at original Twill lines and source breakpoints');
  } finally {
    await vscode.debug.stopDebugging(session);
    vscode.debug.removeBreakpoints([breakpoint]);
    trackers.forEach((tracker) => tracker.dispose());
  }
  const broken = await open('broken.twill');
  await eventually(
    async () => vscode.languages.getDiagnostics(broken.uri),
    (items) => items.some((item) => item.source === 'twill' && item.code === 90001),
  );
  const brokenEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatDocumentProvider',
    broken.uri,
    { tabSize: 2, insertSpaces: true },
  );
  assert.equal(brokenEdits?.length ?? 0, 0, 'Invalid source must never return a formatting edit');
  const guardSource =
    'export function divide(a: number, b: number) {\n  guard b != 0 { return 0; }\n  return a / b;\n}';
  const malformedGuard = new vscode.WorkspaceEdit();
  malformedGuard.replace(
    broken.uri,
    new vscode.Range(broken.positionAt(0), broken.positionAt(broken.getText().length)),
    guardSource,
  );
  assert(await vscode.workspace.applyEdit(malformedGuard));
  const guardProblems = await eventually(
    async () => vscode.languages.getDiagnostics(broken.uri),
    (items) =>
      items.some(
        (item) => item.code === 90001 && item.message.includes("Missing 'else' in guard statement"),
      ),
  );
  const guardProblem = guardProblems.find((item) => item.code === 90001)!;
  assert.equal(guardProblem.range.start.line, 1);
  assert.equal(guardProblem.range.start.character, 2);
  assert(guardProblem.message.includes('guard condition else { return ...; }'));
  const correctGuard = new vscode.WorkspaceEdit();
  correctGuard.insert(broken.uri, position(broken, 'b != 0 {', 7), 'else ');
  assert(await vscode.workspace.applyEdit(correctGuard));
  await eventually(
    async () => vscode.languages.getDiagnostics(broken.uri),
    (items) => items.length === 0,
  );
  console.log(
    'PASS: guard diagnostics explain missing else at the original token and clear after correction',
  );
  const noHover = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    formatting.uri,
    position(formatting, 'export'),
  );
  assert.equal(noHover?.length ?? 0, 0);
  const temporary = await open('temporary.twill');
  const temporaryTabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === temporary.uri.toString(),
    );
  assert(temporaryTabs.length, 'Temporary document must be open in a real editor tab');
  await vscode.window.tabGroups.close(temporaryTabs);
  assert(
    !vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some(
        (tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === temporary.uri.toString(),
      ),
    'Closing the tab must succeed',
  );
  const { inferredFile } = JSON.parse(readFileSync(join(root, 'host-fixtures.json'), 'utf8'));
  const inferred = await open(inferredFile);
  const inferredHover = await eventually(
    () =>
      vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        inferred.uri,
        position(inferred, 'n in', 0),
      ),
    (items) => !!items?.length,
  );
  assert(
    inferredHover!.some((hover) =>
      hover.contents.some(
        (content) =>
          typeof content !== 'string' && 'value' in content && content.value.includes('number'),
      ),
    ),
  );
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  console.log(
    'PASS: invalid source diagnostics, formatter failure, tab closure and config-free inferred project',
  );
  await checkProviderContracts(extension, root);
  console.log('Twill packaged VSIX extension-host integration checks passed.');
  if (process.env.NODE_V8_COVERAGE) (await import('node:v8')).takeCoverage();
}
