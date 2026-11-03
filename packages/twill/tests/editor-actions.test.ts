import { fixtureRoot } from './helpers/fixture.js';
import { afterEach, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TwillProject, virtualFilename } from '../src/project';
import { TwillEditor, type SourceEdit } from '../src/editor';

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
function fixture(files: Record<string, string>) {
  // Framework declarations resolve through the real repository dependencies.
  const root = fixtureRoot('.editor-actions-');
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        checkJs: true,
        skipLibCheck: true,
      },
      include: ['**/*'],
    }),
  );
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  const project = new TwillProject(join(root, 'tsconfig.json'), {}, { recover: true });
  cleanups.push(() => {
    project.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const editor = new TwillEditor(project);
  const file = (name: string) => join(root, name).replaceAll('\\', '/');
  const apply = (edits: SourceEdit[]) => {
    for (const filename of new Set(edits.map((edit) => edit.filename))) {
      let source = project.text(filename)!;
      for (const edit of edits
        .filter((edit) => edit.filename === filename)
        .sort((a, b) => b.span.start - a.span.start))
        source =
          source.slice(0, edit.span.start) +
          edit.newText +
          source.slice(edit.span.start + edit.span.length);
      project.update(filename, source);
    }
  };
  return { root, project, editor, file, apply };
}

const card = `import type { ReactNode } from 'react';
declare function Card(props: { title: string; onClick?: (event: { x: number }) => void; children?: ReactNode }): ReactNode;
`;

it('hides lifted compiler bindings from local completions while preserving authored names and refreshed files', () => {
  let source =
    'export function run(input:number|null){const __twillIf0=7;if const value=input{}return __twillIf0;}';
  const { project, editor, file } = fixture({ 'main.twill': source });
  const names = () =>
    editor
      .completions(file('main.twill'), source.indexOf('return ') + 7)
      .info?.entries.map((entry) => entry.name);
  expect(names()).toContain('__twillIf0');
  expect(names()).not.toContain('__twillIf1');
  source = source.replaceAll('__twillIf0', '__twillIf1');
  project.update(file('main.twill'), source);
  expect(names()).toContain('__twillIf1');
  expect(names()).not.toContain('__twillIf0');
});

it('completes partially typed React prop names in source coordinates', () => {
  const source = card + `export const view = Card({ tit }) { 'Hello' };`;
  const { editor, file } = fixture({ 'view.twillx': source });
  const request = editor.completions(file('view.twillx'), source.indexOf('tit }') + 3);
  expect(request.info?.entries.map((entry) => entry.name)).toContain('title');
  expect(request.props).toEqual({
    start: source.indexOf('tit }'),
    end: source.indexOf('tit }') + 3,
  });
});

it('keeps callback member completion separate from prop-key completion', () => {
  const source =
    card + `export const view = Card({ title: 'Hi', onClick: event => event. }) { 'Hello' };`;
  const { editor, file, project } = fixture({ 'view.twillx': source });
  const request = editor.completions(file('view.twillx'), source.indexOf('event. }') + 6);
  expect(request.info?.entries.map((entry) => entry.name)).toContain('x');
  expect(request.props).toBeUndefined();
  project.update(file('view.twillx'), source.replace('event. }', 'event.x }'));
  const info = project.service.getQuickInfoAtPosition(
    virtualFilename(file('view.twillx')),
    project.toGeneratedOffset(file('view.twillx'), source.indexOf('event =>') + 1),
  );
  expect(ts.displayPartsToString(info?.displayParts)).toContain('x: number');
});

it.each(['ts', 'twill'])('auto-imports a %s export into a trailing closure', (extension) => {
  const source = `export const values = [1].map { value in twice(value) };`;
  const { project, editor, file, apply } = fixture({
    [`math.${extension}`]: 'export function twice(value: number) { return value * 2; }',
    'main.twill': source,
  });
  const request = editor.completions(file('main.twill'), source.indexOf('twice') + 3);
  const entry = request.info?.entries.find((entry) => entry.name === 'twice' && entry.source);
  expect(entry).toBeDefined();
  const details = project.service.getCompletionEntryDetails(
    virtualFilename(file('main.twill')),
    request.offset,
    entry!.name,
    {},
    entry!.source,
    {},
    entry!.data,
  )!;
  const edits = editor.mapChanges(details.codeActions!.flatMap((action) => action.changes));
  expect(edits).toBeDefined();
  apply(edits!);
  expect(project.text(file('main.twill'))).not.toContain('.twill.ts');
  expect(project.diagnostics()).toEqual([]);
});

it('finds references across unsaved Twill, TS and JS sources in original coordinates', () => {
  const source = 'export function twice(value: number) { return value * 2; }';
  const { project, editor, file } = fixture({
    'math.twill': source,
    'consumer.ts': 'import { twice } from "./math.twill"; export const result = twice(2);',
    'client.js': 'import { twice } from "./math.twill"; export const result = twice(3);',
    'caller.twill':
      'import { twice } from "./math.twill"; export const result = [1].map { n in twice(n) };',
  });
  project.update(file('caller.twill'), project.text(file('caller.twill'))! + '\nvoid twice(4);');
  const references = editor.references(file('math.twill'), source.indexOf('twice') + 1)!;
  expect(new Set(references.map((entry) => entry.fileName))).toEqual(
    new Set(['math.twill', 'consumer.ts', 'client.js', 'caller.twill'].map(file)),
  );
  expect(references.filter((entry) => entry.isDefinition)).toHaveLength(1);
  expect(references.filter((entry) => entry.fileName === file('caller.twill'))).toHaveLength(3);
  for (const entry of references)
    expect(
      project
        .text(entry.fileName)!
        .slice(entry.textSpan.start, entry.textSpan.start + entry.textSpan.length),
    ).toBe('twice');
  const native = project.text(file('consumer.ts'))!;
  expect(editor.references(file('consumer.ts'), native.lastIndexOf('twice') + 1)?.length).toBe(
    references.length,
  );
});

it('does not expose generated component closing tags or cleanup helpers as references', () => {
  const source = card + `export const view = Card({ title: 'Hi' }) { 'Hello' };`;
  const { editor, project, file } = fixture({ 'view.twillx': source });
  const references = editor.references(file('view.twillx'), source.indexOf('function Card') + 10)!;
  expect(references).toHaveLength(2);
  expect(references.map((entry) => entry.textSpan.start)).toEqual([
    source.indexOf('function Card') + 9,
    source.indexOf('Card({'),
  ]);
  const cleanup = 'export function run() { defer { void 1; } return 2; }';
  project.update(file('cleanup.twill'), cleanup);
  expect(editor.references(file('cleanup.twill'), cleanup.indexOf('defer')) ?? []).toEqual([]);
});

it('renames exports and references across Twill, TS and JS', () => {
  const source =
    'export function twice(value: number) { return [value].map { item in item * 2 }[0]!; }';
  const { project, editor, file, apply } = fixture({
    'math.twill': source,
    'consumer.ts': 'import { twice } from "./math.twill"; export const value: number = twice(2);',
    'client.js': 'import { twice } from "./math.twill"; export const value = twice(3);',
  });
  const edits = editor.rename(file('math.twill'), source.indexOf('twice') + 1, 'double');
  expect(new Set(edits?.map((edit) => edit.filename))).toEqual(
    new Set([file('math.twill'), file('consumer.ts'), file('client.js')]),
  );
  apply(edits!);
  expect(project.diagnostics()).toEqual([]);
  expect(project.text(file('consumer.ts'))).toContain('double(2)');
});

it('preserves React shorthand prop keys when renaming their local value', () => {
  const source = card + `const title = 'Hi'; export const view = Card({ title }) { title };`;
  const { editor, project, file, apply } = fixture({ 'view.twillx': source });
  const edits = editor.rename(file('view.twillx'), source.indexOf('const title') + 7, 'heading');
  expect(edits).toBeDefined();
  apply(edits!);
  expect(project.text(file('view.twillx'))).toContain('Card({ title: heading })');
  expect(project.diagnostics()).toEqual([]);
});

it('renames a shorthand React prop contract while preserving the local value', () => {
  const source = card + `const title = 'Hi'; export const view = Card({ title }) { title };`;
  const { editor, project, file, apply } = fixture({ 'view.twillx': source });
  const edits = editor.rename(file('view.twillx'), source.indexOf('title: string') + 1, 'heading');
  expect(edits).toBeDefined();
  apply(edits!);
  expect(project.text(file('view.twillx'))).toContain('Card({ heading: title })');
  expect(project.diagnostics()).toEqual([]);
});

it('preserves quoted React prop keys when renaming their contract', () => {
  const source = card + `export const view = Card({ 'title': 'Hi' }) { 'Hello' };`;
  const { editor, project, file, apply } = fixture({ 'view.twillx': source });
  const edits = editor.rename(file('view.twillx'), source.indexOf('title: string') + 1, 'heading');
  expect(edits).toBeDefined();
  apply(edits!);
  expect(project.text(file('view.twillx'))).toContain("Card({ 'heading': 'Hi' })");
  expect(project.diagnostics()).toEqual([]);
});

it('renames a local import alias without changing the exported contract', () => {
  const source =
    'import { twice } from "./math.twill"; export const values = [1].map { n in twice(n) };';
  const { editor, project, file, apply } = fixture({
    'math.twill': 'export function twice(n: number) { return n * 2; }',
    'main.twill': source,
  });
  const edits = editor.rename(file('main.twill'), source.lastIndexOf('twice') + 1, 'double');
  expect(edits?.every((edit) => edit.filename === file('main.twill'))).toBe(true);
  apply(edits!);
  expect(project.text(file('main.twill'))).toContain('import { twice as double }');
  expect(project.diagnostics()).toEqual([]);
});

it.each(['return', 'new name', 'name; injected()', '1value'])(
  'rejects invalid rename identifier %s',
  (name) => {
    const source = 'export const value = 1;';
    const { editor, file } = fixture({ 'main.twill': source });
    expect(editor.rename(file('main.twill'), source.indexOf('value') + 1, name)).toBeUndefined();
  },
);

it('renames component tags without duplicating generated closing tags', () => {
  const source = card + `export const view = Card({ title: 'Hi' }) { 'Hello' };`;
  const { editor, project, file, apply } = fixture({ 'view.twillx': source });
  const edits = editor.rename(file('view.twillx'), source.indexOf('function Card') + 10, 'Panel');
  expect(edits).toHaveLength(2);
  apply(edits!);
  expect(project.diagnostics()).toEqual([]);
  expect(project.text(file('view.twillx'))).toContain("Panel({ title: 'Hi' })");
});

it('organizes imports while preserving the dialect body and comments', () => {
  const source = `// A real source comment\nimport { unused, twice } from './math.twill';\nimport { once } from './math.twill';\nexport const values = [1].map { value in twice(once(value)) };`;
  const { editor, project, file, apply } = fixture({
    'math.twill':
      'export const twice=(n:number)=>n*2; export const once=(n:number)=>n; export const unused=0;',
    'main.twill': source,
  });
  const edits = editor.organizeImports(file('main.twill'));
  expect(edits).toBeDefined();
  apply(edits!);
  const updated = project.text(file('main.twill'))!;
  expect(updated).toContain('// A real source comment');
  expect(updated).toContain('[1].map { value in twice(once(value)) };');
  expect(updated).not.toContain('unused');
  expect(project.diagnostics()).toEqual([]);
});

it('refuses an edit that would replace lowered callback syntax', () => {
  const { editor, file, project } = fixture({
    'main.twill': 'export const values = [1].map { value in value * 2 };',
  });
  const generated = project.transformed(file('main.twill'))!.code;
  expect(
    editor.mapChanges([
      {
        fileName: virtualFilename(file('main.twill')),
        textChanges: [{ span: { start: generated.indexOf('=>'), length: 2 }, newText: 'function' }],
      },
    ]),
  ).toBeUndefined();
});

it('refreshes one disk file while retaining other transforms and unsaved content', () => {
  const { project, file } = fixture({
    'one.twill': 'export const one = [1].map { n in n };',
    'two.twill': 'export const two = [2].map { n in n };',
  });
  const original = project.transformed(file('two.twill'));
  project.update(file('one.twill'), 'export const one = 3;');
  writeFileSync(file('one.twill'), 'export const one = 4;');
  project.refresh(file('one.twill'));
  expect(project.text(file('one.twill'))).toBe('export const one = 3;');
  expect(project.transformed(file('two.twill'))).toBe(original);
  project.update(file('one.twill'));
  expect(project.text(file('one.twill'))).toBe('export const one = 4;');
});

it('offers safe spelling fixes inside trailing callbacks', () => {
  const source = 'export const values = [1].map { value in value.toFixd(2) };';
  const { editor, project, file, apply } = fixture({ 'main.twill': source });
  const start = source.indexOf('toFixd');
  const fixes = editor.fixes(file('main.twill'), start, start + 6, [2551]);
  const fix = fixes.find((item) => item.edits.some((edit) => edit.newText === 'toFixed'));
  expect(fix).toBeDefined();
  apply(fix!.edits);
  expect(project.diagnostics()).toEqual([]);
});

it('renames guard bindings and defer captures without editing generated helpers', () => {
  const source = `export function run(input: string | null) {
    guard const value = input else { return ''; }
    defer { console.log(value); }
    return value.toUpperCase();
  }`;
  const { editor, project, file, apply } = fixture({ 'main.twill': source });
  const edits = editor.rename(file('main.twill'), source.indexOf('const value') + 7, 'label');
  expect(edits).toHaveLength(3);
  apply(edits!);
  expect(project.diagnostics()).toEqual([]);
  expect(project.text(file('main.twill'))).toContain('guard const label');
  expect(project.text(file('main.twill'))).toContain('defer { console.log(label); }');
});

it('renames and completes moved destructuring bindings in guards and switch arms', () => {
  const source = `type Result={kind:'ok';value:number}|{kind:'bad';error:string};
  export function run(input: {result:Result}|null) {
    guard const {result: item}=input else {return '';}
    return switch(item){case {kind:'ok',value: amount}: amount.toFixed();case {kind:'bad',error}: error;};
  }`;
  const { editor, project, file, apply } = fixture({ 'main.twill': source });
  expect(project.diagnostics()).toEqual([]);
  const declaration = source.indexOf('amount}');
  const usages = editor.references(file('main.twill'), declaration + 1)!;
  expect(usages).toHaveLength(2);
  for (const usage of usages)
    expect(source.slice(usage.textSpan.start, usage.textSpan.start + usage.textSpan.length)).toBe(
      'amount',
    );
  const edits = editor.rename(file('main.twill'), declaration + 1, 'total')!;
  expect(edits).toHaveLength(2);
  apply(edits);
  expect(project.diagnostics()).toEqual([]);
  const guardEdits = editor.rename(
    file('main.twill'),
    source.indexOf('item}=') + 1,
    'resultValue',
  )!;
  expect(guardEdits).toHaveLength(2);
  apply(guardEdits);
  expect(project.diagnostics()).toEqual([]);
  const incomplete = project.text(file('main.twill'))!.replace('total.toFixed()', 'total.');
  project.update(file('main.twill'), incomplete);
  const completions = editor.completions(file('main.twill'), incomplete.indexOf('total.') + 6);
  expect(completions.info?.entries.map((entry) => entry.name)).toContain('toFixed');
});

it('renames union discriminator contracts and payload shorthand bindings', () => {
  const source =
    'type Result={kind:"ok";value:number}|{kind:"bad";error:string};export function run(input:Result){return switch(input){case {kind:"ok",value}: value;case {kind:"bad",error}: error;};}';
  const { editor, project, file, apply } = fixture({ 'main.twill': source });
  const rename = editor.rename(file('main.twill'), source.indexOf('kind:') + 1, 'tag');
  expect(rename).toBeDefined();
  apply(rename!);
  expect(project.diagnostics()).toEqual([]);
  const updated = project.text(file('main.twill'))!;
  expect(updated).toContain('case {tag:"ok",value}');
  const binding = editor.rename(file('main.twill'), updated.indexOf('value}') + 1, 'amount');
  expect(binding).toBeDefined();
  apply(binding!);
  expect(project.text(file('main.twill'))).toContain('value: amount');
  expect(project.diagnostics()).toEqual([]);
});

it('discovers created files and drops deleted roots without resetting other transforms', () => {
  const { project, editor, file } = fixture({
    'main.twill': 'export const values = [1].map { n in n };',
  });
  const cached = project.transformed(file('main.twill'));
  writeFileSync(file('new.twill'), 'export const added = 1;');
  project.refresh(file('new.twill'), true);
  expect(project.sourceFiles()).toContain(file('new.twill'));
  expect(project.transformed(file('main.twill'))).toBe(cached);
  rmSync(file('new.twill'));
  project.refresh(file('new.twill'), true);
  expect(project.sourceFiles()).not.toContain(file('new.twill'));
  expect(editor.organizeImports(file('main.twill'))).toEqual([]);
});

it('completes empty and separated JSX prop gaps without confusing prop values', () => {
  const source = card + 'export const view=Card({  }) { "child"; };';
  const { project, editor, file } = fixture({ 'view.twillx': source });
  const position = source.indexOf('{  }') + 2;
  const request = editor.completions(file('view.twillx'), position);
  expect(request.props).toEqual({ start: position, end: position });
  expect(request.info?.entries.map((entry) => entry.name)).toContain('title');
  const updated = source.replace('{  }', '{ title: "Hello",  }');
  project.update(file('view.twillx'), updated);
  expect(
    editor
      .completions(file('view.twillx'), updated.indexOf(',  }') + 2)
      .info?.entries.map((entry) => entry.name),
  ).toContain('onClick');
});
it('completes a dot followed by whitespace and blocks edits of missing files or newly generated files', () => {
  const source = 'export const values=[1].map { n in n. };';
  const { editor, file } = fixture({ 'main.twill': source });
  expect(
    editor
      .completions(file('main.twill'), source.indexOf('n. }') + 3)
      .info?.entries.map((entry) => entry.name),
  ).toContain('toFixed');
  expect(editor.mapSpan(file('missing.ts'), { start: 0, length: 0 })).toBeUndefined();
  expect(
    editor.mapChanges([
      {
        fileName: file('generated.ts'),
        isNewFile: true,
        textChanges: [{ span: { start: 0, length: 0 }, newText: 'export {};' }],
      },
    ]),
  ).toBeUndefined();
  expect(editor.renameLocations(file('main.twill'), source.indexOf('export'))).toBeUndefined();
});
it('rewrites only virtual import/export literals in mapped source edits', () => {
  const source = 'export const values=[1].map { n in n };';
  const { project, editor, file } = fixture({ 'main.twill': source });
  const filename = file('main.twill');
  const edits = editor.mapChanges([
    {
      fileName: virtualFilename(filename),
      textChanges: [
        {
          span: { start: 0, length: 0 },
          newText:
            'import {value} from "./api.twill.ts";\nexport {view} from "./view.twillx.tsx";\nconst mention="./api.twill.ts";\n',
        },
      ],
    },
  ]);
  expect(edits?.[0]?.newText).toContain('from "./api.twill"');
  expect(edits?.[0]?.newText).toContain('from "./view.twillx"');
  expect(edits?.[0]?.newText).toContain('mention="./api.twill.ts"');
  project.update(file('bad.twill'), 'users.map { . };');
  expect(editor.mapSpan(file('native.ts'), { start: -1, length: 3 })).toBeUndefined();
});

it('identifies declaration references when the backend omits its optional flag', () => {
  const source = 'export const users=[{name:"Ada"}];export const selected=users.map { .name };';
  const { project, editor, file } = fixture({
    'main.twill': source,
    'consumer.ts': 'import {users} from "./main.twill";export const selected=users;',
  });
  const refs = editor.references(file('main.twill'), source.lastIndexOf('users'))!;
  expect(
    refs.find(
      (ref) =>
        ref.fileName === file('main.twill') && ref.textSpan.start === source.indexOf('users'),
    )?.isDefinition,
  ).toBe(true);
  expect(
    refs.find(
      (ref) =>
        ref.fileName === file('main.twill') && ref.textSpan.start === source.lastIndexOf('users'),
    )?.isDefinition,
  ).toBe(false);
  expect(
    refs.some((ref) => ref.fileName === file('consumer.ts') && ref.isDefinition === false),
  ).toBe(true);
  const original = project.service.findReferences.bind(project.service);
  vi.spyOn(project.service, 'findReferences').mockImplementation((...args) =>
    original(...args)?.map((group) => ({
      ...group,
      references: group.references.map((ref) => ({ ...ref, isDefinition: false })),
    })),
  );
  expect(
    editor
      .references(file('main.twill'), source.lastIndexOf('users'))!
      .every((ref) => ref.isDefinition === false),
  ).toBe(true);
});

it('rejects out-of-bounds native edits and requests with no generated program', () => {
  const { project, editor, file } = fixture({
    'native.ts': 'export const value=1;',
    'view.twillx':
      'declare function Card(props:{title?:string}):any; const view=Card({ tit }) { "child" };',
  });
  expect(editor.mapSpan(file('native.ts'), { start: -1, length: 1 })).toBeUndefined();
  expect(editor.mapSpan(file('native.ts'), { start: 0, length: 100 })).toBeUndefined();
  const realTransformed = project.transformed.bind(project);
  vi.spyOn(project, 'transformed').mockReturnValue(undefined);
  expect(editor.mapSpan(file('view.twillx'), { start: 0, length: 1 })).toBeUndefined();
  vi.mocked(project.transformed).mockImplementation(realTransformed);
  vi.spyOn(project.service, 'getProgram').mockReturnValue(undefined);
  const source = project.text(file('view.twillx'))!;
  expect(
    editor.completionLocation(file('view.twillx'), source.indexOf('tit }') + 3).props,
  ).toBeUndefined();
});

it('rejects unresolved rename locations, unsafe definitions and duplicate generated references', () => {
  const source = 'export const values=[1].map { n in n + 1 };';
  const { project, editor, file } = fixture({ 'main.twill': source });
  const filename = file('main.twill');
  const offset = source.indexOf('values');
  const info = editor.renameInfo(filename, offset);
  expect(info.canRename).toBe(true);
  vi.spyOn(project.service, 'findRenameLocations').mockReturnValue(undefined);
  expect(editor.renameLocations(filename, offset, false)).toBeUndefined();
  vi.spyOn(project.service, 'getRenameInfo').mockReturnValue({
    ...info,
    canRename: true,
    triggerSpan: { start: project.transformed(filename)!.code.indexOf('=>'), length: 2 },
  } as ts.RenameInfo);
  expect(editor.renameInfo(filename, offset)).toMatchObject({ canRename: false });
  vi.mocked(project.service.getRenameInfo).mockReturnValue(info);
  const generated = project.transformed(filename)!.code;
  const makeSpan = (start: number, length: number) => ({
    fileName: virtualFilename(filename),
    textSpan: { start, length },
  });
  const nativeStart = project.toGeneratedOffset(filename, offset);
  vi.spyOn(project.service, 'findReferences').mockReturnValue([
    {
      definition: {
        ...makeSpan(nativeStart, 6),
        kind: ts.ScriptElementKind.constElement,
        name: 'values',
        displayParts: [],
        containerKind: ts.ScriptElementKind.unknown,
        containerName: '',
      },
      references: [
        { ...makeSpan(nativeStart, 6), isWriteAccess: true },
        { ...makeSpan(nativeStart, 6), isWriteAccess: true },
        { ...makeSpan(generated.indexOf('=>'), 2), isWriteAccess: false },
      ],
    },
  ]);
  expect(editor.references(filename, offset)).toHaveLength(1);
  const groups = project.service.findReferences(virtualFilename(filename), nativeStart)!;
  vi.mocked(project.service.findReferences).mockReturnValue([
    {
      ...groups[0]!,
      definition: {
        ...groups[0]!.definition,
        textSpan: { start: generated.indexOf('=>'), length: 2 },
      },
    },
  ]);
  expect(editor.references(filename, offset)).toEqual([]);
});

it('withholds command-based and empty fixes and unsafe late import insertions', () => {
  const source = 'export const values=[1].map { n in n + 1 };';
  const { project, editor, file } = fixture({ 'main.twill': source });
  const filename = file('main.twill');
  const code = project.transformed(filename)!.code;
  expect(
    editor.mapChanges([
      {
        fileName: virtualFilename(filename),
        textChanges: [
          { span: { start: code.indexOf('=>'), length: 0 }, newText: 'import {x} from "./x";' },
        ],
      },
    ]),
  ).toBeUndefined();
  const fixes: ts.CodeFixAction[] = [
    { fixName: 'empty', description: 'empty', changes: [] },
    {
      fixName: 'command',
      description: 'command',
      changes: [
        {
          fileName: virtualFilename(filename),
          textChanges: [{ span: { start: 0, length: 0 }, newText: '// edit' }],
        },
      ],
      commands: [
        {
          type: 'install package',
          file: filename,
          packageName: 'dependency',
        } as ts.CodeActionCommand,
      ],
    },
  ];
  vi.spyOn(project.service, 'getCodeFixesAtPosition').mockReturnValue(fixes);
  expect(editor.fixes(filename, 0, 1, [1234])).toEqual([]);
});
