import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { transform, originalPosition } from '../src/compiler';
import { parseSyntax } from '../src/syntax';
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
  const root = mkdtempSync(join(tmpdir(), 'twill-match-'));
  const filename = join(root, 'main.twill');
  writeFileSync(filename, source);
  writeFileSync(join(root, 'native.ts'), native);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
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
  return { project, filename };
}
function run(body: string, input?: unknown, record?: (value?: any) => any) {
  const code = transform(`function run(input,record){${body}}`, { language: 'js' }).code;
  return Function(code + ';return run;')()(input, record);
}
const declaration =
  'export enum State<T>{case idle;case loaded(value:T);case failed(error:Error);}';
const read =
  'export function read(state:State<number>){return match(state){case State.idle():0;case State.loaded({value:amount}):amount;case State.failed({error}):throw error;};}';

it('checks match descriptors, payloads, result inference and exhaustiveness', () => {
  expect(checked(declaration + read).project.diagnostics()).toEqual([]);
  expect(
    checked(declaration + read.replace('case State.idle():0;', ''))
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2344);
  const code = transform(declaration + read).code;
  expect(code).not.toContain('match(');
  const exports: Record<string, any> = {};
  Function(
    'exports',
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
  )(exports);
  expect(exports.read(exports.State.idle())).toBe(0);
  expect(exports.read(exports.State.loaded(42))).toBe(42);
  const error = new Error('failed');
  expect(() => exports.read(exports.State.failed(error))).toThrow(error);
});
it.each([
  [
    'return match(input){case State.loaded({value}):value;default:0;};',
    'return switch(input){case enum State.loaded({value}):value;default:0;};',
  ],
  [
    'const result=match(input){case State.loaded({value}):value;default:0;};return result;',
    'const result=switch(input){case enum State.loaded({value}):value;default:0;};return result;',
  ],
  [
    'return 1+match(input){case State.loaded():3;default:0;};',
    'return 1+switch(input){case enum State.loaded():3;default:0;};',
  ],
])('keeps emitted JS identical to the optimized prototype: %s', (preferred, legacy) => {
  const js = (body: string) =>
    ts.transpileModule(transform(`function run(input){${body}}`, { language: 'js' }).code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true },
    }).outputText;
  expect(js(preferred)).toBe(js(legacy));
});
it.each([
  'const match=(value)=>value; const result=match(3);',
  'const result=object.match(input);',
  'const result=match?.(input);',
  'const result=match<number>(input);',
  'const result=(match)(input);',
  'const result=m\\u0061tch(input);',
  'const match={value:1}; match.value++;',
  'const text="match(input){case State.idle():0;}"; // match(input){case State.idle():0;}',
])('preserves ordinary native uses of match: %s', (source) => {
  expect(transform(source).code).toBe(source);
});
it.each([
  'return match(input) { return 4; };',
  'return match(input) {};',
  'return match(input) { /* case State.idle():0; */ return 4; };',
  'return match(input) { "case"; return 4; };',
])('preserves existing trailing closures named match: %s', (body) => {
  const result = transform(
    `function run(input){const match=(value,callback)=>[value,callback()];${body}}`,
    { language: 'js' },
  );
  expect(result.switches).toBe(0);
  expect(result.closures).toBe(1);
  expect(Function(result.code + ';return run;')()(7)[0]).toBe(7);
});
it('recognizes arm-leading comments and newlines after parsing the subject once', () => {
  const calls: unknown[] = [];
  expect(
    run(
      'return match /* subject */ (record(input))\n{/* arm */\ncase State.loaded({value}):value;default:0;};',
      { kind: 'loaded', value: 5 },
      (v) => {
        calls.push(v);
        return v;
      },
    ),
  ).toBe(5);
  expect(calls).toHaveLength(1);
  expect(
    run(
      'return match((record(1),input),){case State.loaded():9;default:0;};',
      { kind: 'loaded' },
      (v) => v,
    ),
  ).toBe(9);
});
it.each(['ts', 'tsx', 'js', 'jsx'] as const)('accepts native subject syntax in %s', (language) => {
  const subject = language.endsWith('x') ? '(<Card value={record(input)} />)' : 'record(input)';
  const source = `function read(input){return match(${subject}){case State.loaded():1;default:0;};}`;
  expect(transform(source, { language }).switches).toBe(1);
  expect(parseSyntax(source, { language }).switches[0].keyword).toBe('match');
});
it('retains tag/getter/default/rest timing and never reads or calls the descriptor', () => {
  const events: unknown[] = [];
  const input = {
    get kind() {
      events.push('tag');
      return 'loaded';
    },
    get value() {
      events.push('payload');
      return undefined;
    },
    extra: true,
  };
  const result = run(
    'const State={get loaded(){throw new Error("descriptor read");}};return match(input){case State.loaded({value=record("default"),...rest}):[value,rest];default:0;};',
    input,
    (v) => {
      events.push(v);
      return 3;
    },
  );
  expect(result).toEqual([3, { kind: 'loaded', extra: true }]);
  expect(events).toEqual(['tag', 'payload', 'default', 'tag']);
});
it('selects only one arm, keeps duplicate-label order and scopes bindings per arm', () => {
  const events: unknown[] = [];
  expect(
    run(
      'const value=9;const result=match(input){case State.loaded({value}):record(value);case State.loaded({value}):record(value*2);default:record(0);};return [value,result];',
      { kind: 'loaded', value: 3 },
      (v) => {
        events.push(v);
        return v;
      },
    ),
  ).toEqual([9, 3]);
  expect(events).toEqual([3]);
});
it('preserves unknown-tag failures, thrown arm errors and default-only matches', () => {
  expect(() => run('return match(input){case State.loaded():1;};', { kind: 'absent' })).toThrow(
    'Non-exhaustive switch expression',
  );
  expect(() =>
    run('return match(input){case State.failed({error}):throw error;default:0;};', {
      kind: 'failed',
      error: new Error('arm'),
    }),
  ).toThrow('arm');
  expect(run('return match(input){default:7;};', null)).toBe(7);
});
it('mixes enum and kind object patterns, and nests matches and native value switches', () => {
  expect(
    run(
      'return match(input){case {kind:"idle"}:0;case State.loaded({value}):match(value){case Nested.loaded({value}):switch(value){case 3:9;default:0;};default:0;};};',
      { kind: 'loaded', value: { kind: 'loaded', value: 3 } },
    ),
  ).toBe(9);
});
it('preserves native switch statement fallthrough, grouped labels and call-valued cases', () => {
  const events: unknown[] = [];
  expect(
    run(
      'switch(input){case 1: record(1);case 2:record(2);break;case 3:case 4:record(4);break;default:record(0);}return 7;',
      1,
      (v) => events.push(v),
    ),
  ).toBe(7);
  expect(events).toEqual([1, 2]);
  events.length = 0;
  run('switch(input){case 3:case 4:record(4);break;default:record(0);}', 3, (v) => events.push(v));
  expect(events).toEqual([4]);
  const identity = {};
  expect(
    run(
      'const State={loaded(){return record();}};return switch(input){case State.loaded():1;default:0;};',
      identity,
      () => identity,
    ),
  ).toBe(1);
  expect(
    run('const fallthrough=()=>3;return switch(input){case 1:fallthrough();default:0;};', 1),
  ).toBe(3);
});
it('keeps initializer TDZ and original const binding without introducing a function', () => {
  expect(() =>
    run('const value=match(input){case State.loaded():value;default:0;};return value;', {
      kind: 'loaded',
    }),
  ).toThrow(ReferenceError);
  const source =
    'function read(input){const result=match(input){case State.loaded({value}):value;default:0;};return result;}';
  expect(transform(source, { language: 'js' }).code).not.toContain('=>');
});
it('preserves async/generator suspension and defer cleanup in direct returns', async () => {
  const events: unknown[] = [];
  const source =
    'async function read(input,record){defer {record("cleanup");}return match(await input){case State.loaded({value}):await Promise.resolve(value);default:0;};}function* readGenerator(input){return match(input){case State.loaded({value}):yield value;default:0;};}';
  const code = transform(source, { language: 'js' }).code;
  const { read, readGenerator } = Function(code + ';return {read,readGenerator};')();
  expect(
    await read(Promise.resolve({ kind: 'loaded', value: 4 }), (v: unknown) => events.push(v)),
  ).toBe(4);
  expect(events).toEqual(['cleanup']);
  const iterator = readGenerator({ kind: 'loaded', value: 5 });
  expect(iterator.next()).toEqual({ value: 5, done: false });
  expect(iterator.next(8)).toEqual({ value: 8, done: true });
  expect(() =>
    transform(
      'async function read(input){const result=match(input){case State.loaded():await input;default:0;};}',
      { language: 'js' },
    ),
  ).toThrow('requires a direct return');
});
it('checks type-only aliases/native factories and maps invalid payload diagnostics', () => {
  const native =
    'export declare const Factory:{loaded(value:number):{kind:"loaded";value:number}};';
  const prefix = 'import type {Factory as Cases} from "./native";\n';
  const source =
    prefix +
    'export function read(input:{kind:"loaded";value:number}){return match(input){case Cases.loaded({value}):value;};}';
  expect(checked(source, native).project.diagnostics()).toEqual([]);
  const invalid = source.replace('{value}):value', '{missing}):missing');
  const diagnostics = checked(invalid, native).project.diagnostics();
  expect(diagnostics.map((d) => d.code)).toContain(2339);
  expect(diagnostics.every((d) => d.line === 2)).toBe(true);
});
it('preserves completion/navigation, safe binding rename and withheld descriptor rename', () => {
  const source = declaration + read;
  const { project, filename } = checked(source);
  const editor = new TwillEditor(project);
  const descriptor = source.indexOf('State.loaded({') + 6;
  expect(editor.completions(filename, descriptor).info?.entries.map((e) => e.name)).toEqual(
    expect.arrayContaining(['idle', 'loaded', 'failed']),
  );
  expect(editor.renameInfo(filename, descriptor).canRename).toBe(false);
  expect(
    editor.rename(filename, source.indexOf('amount}'), 'answer')?.map((e) => e.newText),
  ).toEqual(['answer', 'answer']);
  const result = transform(source);
  const generated = result.code.indexOf('switch');
  const lines = result.code.slice(0, generated).split('\n');
  const point = originalPosition(result, lines.length, lines.at(-1)!.length);
  expect(point.column).toBe(source.indexOf('match'));
});
it('recovers unfinished match descriptors without enabling unsafe renames', () => {
  const source =
    declaration +
    'const incomplete=Math.;export function read(input:State<number>){return match(input){case State.loaded({value}):value;default:0;};}';
  const { project, filename } = checked(source, '', true);
  expect(new TwillEditor(project).renameInfo(filename, source.indexOf('loaded({')).canRename).toBe(
    false,
  );
});
it.each([
  'match(){case State.idle():0;}',
  'match(input,input){case State.idle():0;}',
  'match(...input){case State.idle():0;}',
  'match(input){case State.loaded(value):0;}',
  'match(input){case State.loaded({value},other):0;}',
  'match(input){case State["loaded"]():0;}',
  'match(input){case State?.loaded():0;}',
  'match(input){case State():0;}',
  'match(input){case enum State.loaded():0;}',
  'match(input){case 1:0;}',
  'match(input){case State.loaded():0;case {status:"idle"}:0;}',
  'match(input){case {status:"idle"}:0;case State.loaded():0;}',
  'match(input){default:0;default:1;}',
  'match(input){case State.loaded():break;}',
])('rejects unsupported/ambiguous match syntax: %s', (expression) => {
  expect(() =>
    transform(`function read(input){return ${expression};}`, { language: 'js' }),
  ).toThrow();
});

it('keeps new/class heritage calls named match and trailing closure subjects compatible', () => {
  const native =
    'class Derived extends match(input){case(){return 1;}} const result=new match(input);';
  expect(transform(native).code).toBe(native);
  expect(
    run(
      'const list=[input];return match(list.map { value in value }[0]){case State.loaded({value}):value;default:0;};',
      { kind: 'loaded', value: 6 },
    ),
  ).toBe(6);
});
it('preserves lexical captures and composes property/conditional expressions', () => {
  expect(
    run(
      'const holder={value:4,read(){return match(input){case State.loaded():this.value;default:0;};}};return holder.read();',
      { kind: 'loaded' },
    ),
  ).toBe(4);
  expect(
    run(
      'return true ? match(input){case State.loaded({value}):({value});default:({value:0});}.value : 0;',
      { kind: 'loaded', value: 7 },
    ),
  ).toBe(7);
});
it('does not leak or mutate payload bindings and maps result/type errors', () => {
  const source =
    declaration +
    'export function read(input:State<number>){const result:number=match(input){case State.loaded({value}):value;default:"wrong";};return result;}';
  expect(
    checked(source)
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2322);
  expect(
    checked(
      declaration +
        'function read(input:State<number>){return match(input){case State.loaded({value}):(value=3);default:0;};}',
    )
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2588);
  expect(
    checked(
      declaration +
        'function read(input:State<number>){const result=match(input){case State.loaded({value}):value;default:0;};return value+result;}',
    )
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2304);
});
it('preserves Unicode/namespace descriptors and incomplete-member editor recovery', () => {
  const source =
    'namespace NS{export enum State<T>{case 加载(数据:T);}}export function read(input:NS.State<number>){return match(input){case NS.State.加载({数据:value}):value;};}';
  expect(checked(source).project.diagnostics()).toEqual([]);
  const incomplete =
    declaration +
    'function read(input:State<number>){return match(input){case State.():0;default:0;};}';
  const { project, filename } = checked(incomplete, '', true);
  const editor = new TwillEditor(project);
  expect(
    editor
      .completions(filename, incomplete.indexOf('State.()') + 6)
      .info?.entries.map((e) => e.name),
  ).toEqual(expect.arrayContaining(['idle', 'loaded']));
});

it('reports malformed arm-leading comments at their original source offsets', () => {
  const source = 'function read(input){return match(input){/* unterminated';
  try {
    transform(source, { language: 'js' });
    throw new Error('Expected a lexical error');
  } catch (error) {
    expect(error).toMatchObject({
      offset: source.indexOf('/*'),
      line: 1,
      column: source.indexOf('/*'),
    });
  }
});
