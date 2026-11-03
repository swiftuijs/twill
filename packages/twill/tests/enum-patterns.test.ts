import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { transform } from '../src/compiler';
import { TwillProject } from '../src/project';
import { TwillEditor } from '../src/editor';
const roots: { root: string; project: TwillProject }[] = [];
afterEach(() => {
  for (const { root, project } of roots.splice(0)) {
    project.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
function checked(source: string, native = '', recover = false) {
  const root = mkdtempSync(join(tmpdir(), 'twill-patterns-'));
  const filename = join(root, 'main.twill');
  writeFileSync(filename, source);
  writeFileSync(join(root, 'native.ts'), native);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        types: [],
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        skipLibCheck: true,
      },
      include: ['*.twill', '*.ts'],
    }),
  );
  const project = new TwillProject(join(root, 'tsconfig.json'), {}, { recover });
  roots.push({ root, project });
  return { root, filename, project };
}
const declaration =
  'export enum State<T>{case idle;case loaded(value:T);case failed(error:Error);}';
const read = `export function read(state:State<number>){return switch(state){case enum State.idle():0;case enum State.loaded({value:amount}):amount;case enum State.failed({error}):throw error;};}`;
it('checks case references, binds narrowed payloads and preserves exhaustive checking', () => {
  expect(checked(declaration + read).project.diagnostics()).toEqual([]);
  const code = transform(declaration + read).code;
  expect(code).toMatch(/typeof\s+State\.loaded/);
  expect(code).not.toContain('State.loaded(');
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  Function('exports', js)(exports);
  expect(exports.read(exports.State.idle())).toBe(0);
  expect(exports.read(exports.State.loaded(3))).toBe(3);
  const error = new Error('fail');
  expect(() => exports.read(exports.State.failed(error))).toThrow(error);
  expect(
    checked(declaration + read.replace('case enum State.idle():0;', ''))
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2344);
});
it('checks imported and native factories without runtime calls', () => {
  const source = `import {State as Native} from './native';export function read(state:{kind:'loaded';value:number}){return switch(state){case enum Native.loaded({value}):value;};}`;
  const native = `export const State={loaded(value:number){return{kind:'loaded',value} as const;}};`;
  expect(checked(source, native).project.diagnostics()).toEqual([]);
});
it('rejects unknown factory cases and wrong payload fields at source locations', () => {
  const source =
    declaration +
    `\nexport function read(state:State<number>){return switch(state){case enum State.absent():0;case enum State.loaded({missing}):missing;default:0;};}`;
  const errors = checked(source).project.diagnostics();
  expect(errors.map((d) => d.code)).toContain(2339);
  expect(errors.every((d) => d.line === 2)).toBe(true);
});
it('supports native value calls unchanged', () => {
  const code = transform(
    'function read(value){return switch(value){case Factory.loaded(3):1;default:0;};}',
    { language: 'js' },
  ).code;
  expect(code).toContain('case Factory.loaded(3):');
});
it('provides enum reference completion and safe local binding rename', () => {
  const source = declaration + read;
  const { project, filename } = checked(source);
  const editor = new TwillEditor(project);
  expect(
    editor
      .completions(filename, source.indexOf('State.loaded({') + 6)
      .info?.entries.map((e) => e.name),
  ).toEqual(expect.arrayContaining(['loaded', 'idle', 'failed']));
  expect(editor.renameInfo(filename, source.indexOf('State.loaded({') + 6).canRename).toBe(false);
  expect(
    editor.rename(filename, source.indexOf('amount}'), 'answer')?.map((e) => e.newText),
  ).toEqual(['answer', 'answer']);
});

function run(body: string, input?: unknown, record: (...args: any[]) => any = () => {}) {
  const output = transform(`function execute(input,record){${body}}`, { language: 'js' }).code;
  expect(
    (ts.createSourceFile('output.js', output, ts.ScriptTarget.Latest) as any).parseDiagnostics,
  ).toEqual([]);
  return Function(output + ';return execute;')()(input, record);
}
it('evaluates subject once and performs no descriptor lookup or constructor call', () => {
  const events: string[] = [];
  const input = {
    get kind() {
      events.push('kind');
      return 'loaded';
    },
    get value() {
      events.push('value');
      return 3;
    },
  };
  const result = run(
    'const Factory={get loaded(){record("factory");return ()=>record("call");}};return switch(record(input)){case enum Factory.loaded({value}):value;default:0;};',
    input,
    (value) => {
      if (typeof value === 'string') events.push(value);
      else events.push('subject');
      return value;
    },
  );
  expect(result).toBe(3);
  expect(events).toEqual(['subject', 'kind', 'value']);
});
it('retains native defaults, nested bindings and rest including discriminator getter timing', () => {
  let tags = 0,
    defaults = 0;
  const input = {
    get kind() {
      tags++;
      return 'loaded';
    },
    nested: { id: 3 },
    extra: 7,
  };
  expect(
    run(
      'return switch(input){case enum Factory.loaded({value=record(),nested:{id},...rest}):[value,id,rest];default:0;};',
      input,
      () => {
        defaults++;
        return 4;
      },
    ),
  ).toEqual([4, 3, { kind: 'loaded', extra: 7 }]);
  expect(tags).toBe(2);
  expect(defaults).toBe(1);
  expect(
    run(
      'return switch(input){case enum Factory.loaded({value=record()}):value;default:0;};',
      { kind: 'idle' },
      () => {
        defaults++;
      },
    ),
  ).toBe(0);
  expect(defaults).toBe(1);
});
it('ignores payloads explicitly and preserves extra tag reads only for explicit bindings', () => {
  let reads = 0;
  const input = {
    get kind() {
      reads++;
      return 'loaded';
    },
  };
  expect(run('return switch(input){case enum Factory.loaded():3;default:0;};', input)).toBe(3);
  expect(reads).toBe(1);
  expect(
    run('return switch(input){case enum Factory.loaded({kind}):kind;default:0;};', input),
  ).toBe('loaded');
  expect(reads).toBe(3);
});
it('propagates subject/payload/default exceptions and fails unexpected unchecked variants', () => {
  const error = new Error('getter');
  expect(() =>
    run('return switch(input){case enum Factory.loaded({value}):value;default:0;};', {
      kind: 'loaded',
      get value() {
        throw error;
      },
    }),
  ).toThrow(error);
  expect(() =>
    run(
      'return switch(input){case enum Factory.loaded({value=record()}):value;default:0;};',
      { kind: 'loaded' },
      () => {
        throw error;
      },
    ),
  ).toThrow(error);
  expect(() =>
    run('return switch(record()){case enum Factory.loaded():1;};', undefined, () => {
      throw error;
    }),
  ).toThrow(error);
  expect(() =>
    run('return switch(input){case enum Factory.loaded():1;};', { kind: 'unknown' }),
  ).toThrow(/Non-exhaustive/);
  expect(() =>
    run('return switch(input){case enum Factory.loaded({nested:{id}}):id;default:0;};', {
      kind: 'loaded',
    }),
  ).toThrow(TypeError);
});
it('preserves native call-value case evaluation and strict identity', () => {
  let calls = 0;
  const input = { kind: 'loaded' };
  expect(
    run(
      'const Factory={loaded(){return record();}};return switch(input){case Factory.loaded():1;default:0;};',
      input,
      () => {
        calls++;
        return input;
      },
    ),
  ).toBe(1);
  expect(calls).toBe(1);
});
it('uses independent immutable scopes and preserves outer bindings and hygienic names', () => {
  const source =
    declaration +
    `export function read(state:State<number>){const amount=9;const __twillSubject0=10;const __twillKind1=11;const result=switch(state){case enum State.loaded({value:amount}):amount;default:0;};return [amount,result,__twillSubject0,__twillKind1];}`;
  expect(checked(source).project.diagnostics()).toEqual([]);
  const immutable =
    declaration +
    `export function read(state:State<number>){return switch(state){case enum State.loaded({value:amount}):(amount=3);default:0;};}`;
  expect(
    checked(immutable)
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2588);
  expect(
    checked(
      declaration +
        `export function read(state:State<number>){const result=switch(state){case enum State.loaded({value:amount}):amount;default:0;};return amount+result;}`,
    )
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2304);
});
it('supports single-variant records, declaration-only descriptors and namespace aliases', () => {
  expect(
    checked(
      'export enum Amount{case value(amount:number);}export function read(input:Amount){return switch(input){case enum Amount.value({amount}):amount;};}',
    ).project.diagnostics(),
  ).toEqual([]);
  expect(
    checked(
      `import type {Factory} from './native';export function read(input:{kind:'value';amount:number}){return switch(input){case enum Factory.value({amount}):amount;};}`,
      `export declare const Factory:{value(amount:number):{readonly kind:'value';readonly amount:number}};`,
    ).project.diagnostics(),
  ).toEqual([]);
  expect(
    checked(
      `export namespace NS{export enum State<T>{case 加载(数据:T);}}export function read(state:NS.State<number>){return switch(state){case enum NS.State.加载({数据:amount}):amount;};}`,
    ).project.diagnostics(),
  ).toEqual([]);
});
it('rejects non-callable, widened and mismatched descriptor tags', () => {
  for (const descriptor of [
    'loaded:3',
    'loaded(){return {kind:"different"} as const;}',
    'loaded(){return {kind:"loaded"};}',
  ]) {
    const source = `const Factory={${descriptor}};export function read(input:{kind:'loaded'}){return switch(input){case enum Factory.loaded():1;default:0;};}`;
    expect(
      checked(source)
        .project.diagnostics()
        .map((d) => d.code),
    ).toContain(1360);
  }
});
it.each([
  'case enum State():0;',
  'case enum State["loaded"]():0;',
  'case enum State?.loaded():0;',
  'case enum State.loaded(value):0;',
  'case enum State.loaded({value},more):0;',
  'case enum State.loaded({value,value: value}):0;',
  'case enum State.loaded():0;case 1:0;',
  'case 1:0;case enum State.loaded():0;',
  'case {status:"loaded"}:0;case enum State.loaded():0;',
  'case enum State.loaded():0;case {status:"loaded"}:0;',
  'case enum State.loaded({value}) where value>0:0;',
])('rejects unsupported or ambiguous enum patterns: %s', (cases) => {
  expect(() => transform(`const result=switch(state){${cases}};`)).toThrow();
});
it('preserves existing object-arm getter timing in mixed patterns and nested expression execution', () => {
  let reads = 0;
  expect(
    run('return switch(input){case {kind:"idle"}:1;case enum Factory.loaded():2;};', {
      get kind() {
        reads++;
        return 'idle';
      },
    }),
  ).toBe(1);
  expect(reads).toBe(2);
  expect(
    run(
      'const result=switch(input){case enum Factory.loaded({value}):switch(value){case 1:2;default:0;};case {kind:"idle"}:0;};return result;',
      { kind: 'loaded', value: 1 },
    ),
  ).toBe(2);
});
it('retains direct-return await, lexical this and defer while rejecting hidden suspension', async () => {
  const source =
    declaration +
    `export async function read(state:State<number>){defer {}return switch(await Promise.resolve(state)){case enum State.idle():0;case enum State.loaded({value}):await Promise.resolve(value);case enum State.failed({error}):throw error;};}`;
  expect(checked(source).project.diagnostics()).toEqual([]);
  expect(() =>
    transform(
      declaration +
        `export async function read(state:State<number>){const result=switch(state){case enum State.loaded({value}):await Promise.resolve(value);default:0;};return result;}`,
    ),
  ).toThrow(/direct return/);
  expect(
    run(
      'const holder={value:7,read(){return switch(input){case enum Factory.loaded():this.value;default:0;};}};return holder.read();',
      { kind: 'loaded' },
    ),
  ).toBe(7);
});
it('withholds native case-descriptor rename from either file and supports owner/binding renames', () => {
  const native =
    'export const Factory={loaded(value:number){return{kind:"loaded",value} as const;}};';
  const source =
    'import {Factory} from "./native";export function read(state:{kind:"loaded";value:number}){return switch(state){case enum Factory.loaded({value:amount}):amount;};}';
  const { project, filename, root } = checked(source, native);
  const editor = new TwillEditor(project);
  expect(project.diagnostics()).toEqual([]);
  expect(editor.renameInfo(join(root, 'native.ts'), native.indexOf('loaded')).canRename).toBe(
    false,
  );
  expect(editor.rename(filename, source.indexOf('loaded'), 'renamed')).toBeUndefined();
  const edits = editor.rename(join(root, 'native.ts'), native.indexOf('Factory'), 'States')!;
  expect(edits).toBeDefined();
  for (const [file, original] of [
    [filename, source],
    [join(root, 'native.ts'), native],
  ]) {
    let changed = original;
    for (const edit of edits
      .filter((edit) => edit.filename === file)
      .sort((a, b) => b.span.start - a.span.start))
      changed =
        changed.slice(0, edit.span.start) +
        edit.newText +
        changed.slice(edit.span.start + edit.span.length);
    project.update(file, changed);
  }
  expect(project.diagnostics()).toEqual([]);
});
it('emits native declarations, maps binding references and keeps TSX case values', () => {
  const source = declaration + read;
  const { project, filename, root } = checked(source);
  const editor = new TwillEditor(project);
  const declarations = project.declarationOutput(join(root, 'types'));
  expect(declarations.diagnostics).toEqual([]);
  const output = declarations.files.find(
    (file) => file.filename.includes('main.') && file.filename.endsWith('.d.ts'),
  )!.text;
  expect(output).toContain('read(state: State<number>): number');
  expect(output).not.toContain('case enum');
  const body = source.lastIndexOf('amount;');
  expect(editor.referenceGroups(filename, body)?.[0]?.definition.textSpan.start).toBe(
    source.indexOf('amount}'),
  );
  const result = transform(
    declaration +
      'export function view(state:State<number>){return switch(state){case enum State.loaded({value}):<span>{value}</span>;default:<span/>;};}',
    { filename: 'view.twillx' },
  );
  expect(
    (
      ts.createSourceFile(
        'view.tsx',
        result.code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      ) as any
    ).parseDiagnostics,
  ).toEqual([]);
});

it.each(['\n', '\r\n'])(
  'maps multiline Unicode patterns across %j and invalidates descriptor rename caches',
  (newline) => {
    const source = [
      'export const Factory={"加载"(value:number){return{kind:"加载",value} as const;}};',
      'export function read(input:{kind:"加载";value:number}){',
      'return switch(input){',
      'case enum Factory.加载({value:数据}):数据;',
      '};}',
    ].join(newline);
    const { project, filename } = checked(source);
    const editor = new TwillEditor(project);
    expect(project.diagnostics()).toEqual([]);
    expect(editor.renameInfo(filename, source.indexOf('"加载"') + 1).canRename).toBe(false);
    expect(
      editor.referenceGroups(filename, source.lastIndexOf('加载'))?.[0]?.definition.textSpan.start,
    ).toBe(source.indexOf('"加载"') + 1);
    expect(
      editor.rename(filename, source.indexOf('数据}'), 'answer')?.map((edit) => edit.newText),
    ).toEqual(['answer', 'answer']);
    const changed = source.replace(
      'case enum Factory.加载({value:数据}):数据;',
      'case {kind:"加载",value:数据}:数据;default:0;',
    );
    project.update(filename, changed);
    expect(project.diagnostics()).toEqual([]);
    expect(editor.renameInfo(filename, changed.indexOf('"加载"') + 1).canRename).toBe(true);
  },
);

it('keeps editing assistance when an enum descriptor cannot be resolved', () => {
  const source =
    'export function read(input:{kind:"loaded"}){return switch(input){case enum Missing.loaded():0;default:0;};}';
  const { project, filename } = checked(source);
  const editor = new TwillEditor(project);
  expect(project.diagnostics().map((error) => error.code)).toContain(2304);
  expect(editor.renameInfo(filename, source.indexOf('read')).canRename).toBe(true);
  expect(editor.renameInfo(filename, source.indexOf('Missing')).canRename).toBe(false);
});
it('retains case scope, duplicate-label order and nullary throw semantics', () => {
  expect(
    run(
      'return switch(input){case enum State.loaded({value:amount}):amount;case enum State.loaded({value:amount}):amount*2;default:0;};',
      { kind: 'loaded', value: 3 },
    ),
  ).toBe(3);
  expect(() =>
    run('return switch(input){case enum State.failed():throw new Error("failed");default:0;};', {
      kind: 'failed',
    }),
  ).toThrow('failed');
  expect(
    run('return switch(input){case enum State.loaded({}):3;default:0;};', { kind: 'loaded' }),
  ).toBe(3);
});

it('withholds descriptor renames after editor recovery shifts an earlier source token', () => {
  const source =
    'export const incomplete=Math.;export function read(input:{kind:"loaded";value:number}){return switch(input){case enum Native.loaded({value}):value;};}';
  const native =
    'export const Native={loaded(value:number){return {kind:"loaded",value} as const;}};';
  const { project, root, filename } = checked(
    'import {Native} from "./native";' + source,
    native,
    true,
  );
  const editor = new TwillEditor(project);
  expect(project.transformed(filename)?.code).toContain('__twillIncomplete');
  expect(editor.renameInfo(join(root, 'native.ts'), native.indexOf('loaded')).canRename).toBe(
    false,
  );
});

it('keeps safe edits and descriptor protection when another project file is malformed', () => {
  const source =
    'const Factory={loaded(value:number){return{kind:"loaded",value} as const;}};export function read(input:{kind:"loaded";value:number}){return switch(input){case enum Factory.loaded({value:amount}):amount;};}';
  const { root, project, filename } = checked(source, '', true);
  const editor = new TwillEditor(project);
  project.update(join(root, 'broken.twill'), 'export const broken= [1].map { value in value + };');
  expect(project.diagnostics().some((error) => error.code === 90001)).toBe(true);
  expect(editor.rename(filename, source.indexOf('amount}'), 'result')?.length).toBe(2);
  expect(editor.renameInfo(filename, source.indexOf('Factory')).canRename).toBe(true);
  expect(editor.renameInfo(filename, source.indexOf('loaded')).canRename).toBe(false);
});

it('does not read shadowed global values in the erased exhaustiveness witness', () => {
  const source =
    'declare const Factory:{loaded():{kind:"loaded"}};function execute(input:{kind:"loaded"}){return switch(input){case enum Factory.loaded():1;};const undefined=3;return undefined;}';
  const code = ts.transpileModule(transform(source).code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const execute = Function(code + ';return execute;')();
  expect(execute({ kind: 'loaded' })).toBe(1);
  expect(() => execute({ kind: 'invalid' })).toThrow('Non-exhaustive switch expression');
});

it('keeps generator suspension in direct-return enum patterns', () => {
  const source =
    'function* execute(input){return switch(input){case enum State.loaded({value}):yield value;default:0;};}';
  const code = transform(source, { language: 'js' }).code;
  const iterator = Function(code + ';return execute;')()({ kind: 'loaded', value: 3 });
  expect(iterator.next()).toEqual({ value: 3, done: false });
  expect(iterator.next(7)).toEqual({ value: 7, done: true });
  expect(() =>
    transform(
      'function* execute(input){const result=switch(input){case enum State.loaded({value}):yield value;default:0;};return result;}',
      { language: 'js' },
    ),
  ).toThrow(/direct return/);
});
