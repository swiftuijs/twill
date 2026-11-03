import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { transform, originalPosition, generatedPosition } from '../src/compiler';
import { parse } from '../src/parser.js';
import { TwillProject } from '../src/project';
import { TwillEditor } from '../src/editor';
import { emitDeclarations } from '../src/declarations';
import { transform as esbuildTransform } from 'esbuild';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function checked(source: string, native = '') {
  const root = mkdtempSync(join(tmpdir(), 'twill-enums-'));
  const filename = join(root, 'main.twill');
  writeFileSync(filename, source);
  if (native) writeFileSync(join(root, 'native.ts'), native);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        declaration: true,
        skipLibCheck: true,
      },
      include: ['*.twill', '*.ts'],
    }),
  );
  const project = new TwillProject(join(root, 'tsconfig.json'));
  cleanups.push(() => {
    project.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, filename, project };
}

function run(source: string) {
  const output = transform(`function execute(){${source}}`).code;
  expect(
    (ts.createSourceFile('output.ts', output, ts.ScriptTarget.Latest) as any).parseDiagnostics,
  ).toEqual([]);
  return Function(
    ts.transpileModule(output, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText +
      ';return execute();',
  )();
}

it('constructs precise tagged records, evaluates arguments once and retains payload identity', () => {
  const result = run(`enum State<T> { case idle; case loaded(value:T, count:number); }
    const events:number[]=[]; const payload={value:42};
    const state=State.loaded((events.push(1),payload),(events.push(2),3));
    return [State.idle(),State.idle() !== State.idle(),state,state.value===payload,events];`);
  expect(result).toEqual([
    { kind: 'idle' },
    true,
    { kind: 'loaded', value: { value: 42 }, count: 3 },
    true,
    [1, 2],
  ]);
});

it('handles exports, generics, constraints/defaults, native consumers and exhausted switches', () => {
  const source = `export enum Outcome<T extends object, K extends keyof T, E=Error> {
    case ok(value:T, key:K);
    case bad(error:E);
    case idle();
  }
  export function handle(outcome:Outcome<{value:number},'value'>) {
    return switch(outcome) { case {kind:'ok',value,key}: value[key]; case {kind:'bad',error}: error.message; case {kind:'idle'}: 0; };
  }`;
  const { project } = checked(
    source,
    `import {Outcome,handle} from './main.twill';
    const value:Outcome<{value:number},'value'>=Outcome.ok({value:42},'value');
    export const result:number|string=handle(value);
    export const error:Error=Outcome.bad(new Error()).error;`,
  );
  expect(project.diagnostics()).toEqual([]);
  expect(transform(source).code).toContain('ok<T extends object, K extends keyof T>');
  expect(transform(source).code).toContain('bad<E=Error>');
});

it('reports a missing enum case and invalid construction through native TS checking', () => {
  const { project } = checked(`export enum State<T> {case idle;case loaded(value:T);}
    export function run(state:State<number>) { return switch(state) {case {kind:'loaded',value}: value;}; }
    export const wrong:State<number>=State.loaded('bad');`);
  const diagnostics = project.diagnostics();
  expect(diagnostics.map((d) => d.code)).toContain(2344);
  expect(diagnostics.map((d) => d.code)).toContain(2322);
});

it('preserves native enums and checks associated enums in TSX and nested lexical scopes', () => {
  const source = `export enum Native { A, B='b' } export const enum Const { A=1 }
    export enum NativeKeyword {case=1, value=2} export enum NativeImplicitKeyword {case,value}
    export function make() { enum Inner {case value(data:number);} return Inner.value(2); }
    enum View<T> {case ready(value:T);} export const value=View.ready(3);`;
  expect(transform(source, { filename: 'view.twillx' }).code).toContain(
    'export enum Native { A, B=',
  );
  expect(parse(source).enums).toHaveLength(2);
  expect(
    run('enum Native{case=1,value=2}enum Implicit{case,value}return [Native.case,Implicit.case];'),
  ).toEqual([1, 0]);
  expect(checked(source).project.diagnostics()).toEqual([]);
  expect(
    run(
      'function make(){enum Inner{case value(data:number);}return Inner.value(3);}return make();',
    ),
  ).toEqual({ kind: 'value', data: 3 });
});

it('keeps malformed native enum diagnostics at their original position', () => {
  const source = 'export const before=1;\nenum Broken @ {}';
  try {
    transform(source);
    throw new Error('Expected syntax error');
  } catch (error) {
    expect(error).toMatchObject({ line: 2, column: 12 });
  }
  expect(() => transform('declare namespace Ambient{enum A{case idle;}}')).toThrow(
    /cannot be const or ambient/,
  );
});

it.each([
  ['enum A{case ok;case ok;}', /Duplicate enum case/],
  ['enum A{case ok(value:number,value:string);}', /Duplicate enum payload/],
  ['enum A{case ok(kind:string);}', /discriminator/],
  ['enum A{case ok(value);}', /require a name and type/],
  ['enum A{case ok(value?:number);}', /optional\/default\/rest/],
  ['enum A{case ok(value:number=1);}', /Unexpected/],
  ['enum A{case ok(...value:number[]);}', /Unexpected/],
  ['enum A<T>{}', /at least one/],
  ['const enum A{case ok;}', /cannot be const or ambient/],
  ['declare enum A{case ok;}', /cannot be const or ambient/],
  ['export declare enum A{case ok;}', /cannot be const or ambient/],
  ['enum A{case ok; wrong;}', /Unexpected/],
])('rejects unsupported associated enum syntax: %s', (source, error) => {
  expect(() => transform(source)).toThrow(error);
});

it('preserves comments and semicolon-free cases through lowering', () => {
  const source =
    'enum /*name*/ State<T>{case /*case*/ idle /*after*/;case loaded(value: /*type*/ T)\n}';
  const output = transform(source).code;
  for (const comment of ['/*name*/', '/*case*/', '/*after*/', '/*type*/'])
    expect(output).toContain(comment);
  expect(
    (ts.createSourceFile('output.ts', output, ts.ScriptTarget.Latest) as any).parseDiagnostics,
  ).toEqual([]);
  expect(run('enum State{case idle\ncase loaded(value:number)\n}return State.loaded(3);')).toEqual({
    kind: 'loaded',
    value: 3,
  });
});

it('selects transitive generic dependencies without capturing local type binders', () => {
  const source = `export enum A<T,U> {case first(value:T);case second(value:U);case callback(value:<T>(item:{[K in keyof T]:T[K]})=>U);case local(value:{[T in keyof T]:T});}
    export enum M<T>{case mapped(value:{[K in keyof T]:T[K]});}
    export enum C<T>{case item(value:T extends infer T ? T : never);}
    export const a=A.callback(item=>String(item));`;
  expect(checked(source).project.diagnostics()).toEqual([]);
  const code = transform(source).code;
  expect(code).toContain('callback<U>');
  expect(code).toContain('local(value:');
  expect(code).toContain('mapped<T>');
  expect(code).toContain('item<T>');
});

it('retains readonly payloads, recursive union references and defer/closure composition', () => {
  const source = `export enum Tree<T>{case leaf(value:T);case branch(left:Tree<T>,right:Tree<T>);}
    export const tree:Tree<number>=Tree.branch(Tree.leaf(1),Tree.leaf(2));`;
  expect(checked(source).project.diagnostics()).toEqual([]);
  expect(
    run(
      'let closed=false;const work=(body:()=>unknown)=>body();const result=work { enum State{case idle;}defer {closed=true;}return State.idle(); };return [result,closed];',
    ),
  ).toEqual([{ kind: 'idle' }, true]);
  expect(
    checked(
      'export enum State{case loaded(value:number);}export const state=State.loaded(3);state.value=4;',
    )
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2540);
});

it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])(
  'maps copied payload and generic errors to original tokens with %j',
  (newline) => {
    const source = [
      'export enum State<T extends Missing> {',
      'case loaded(value: Missing);',
      'case generic(value:T);',
      '}',
    ].join(newline);
    const errors = checked(source)
      .project.diagnostics()
      .filter((d) => d.code === 2304);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(
      errors.every(
        (d) =>
          (d.line === 1 && d.column === source.indexOf('Missing')) ||
          (d.line === 2 && d.column === 'case loaded(value: '.length),
      ),
    ).toBe(true);
  },
);

it('provides constructor completion and maps original factory parameter type positions', () => {
  const source = `export enum State<T>{case idle;case loaded(value:T);} export const value=State.loaded(3);`;
  const { project, filename } = checked(source);
  const editor = new TwillEditor(project);
  const offset = source.indexOf('State.loaded') + 'State.'.length;
  expect(editor.completions(filename, offset).info?.entries.map((e) => e.name)).toEqual(
    expect.arrayContaining(['idle', 'loaded']),
  );
  expect(editor.renameInfo(filename, offset + 1).canRename).toBe(false);
  const result = transform(source);
  const typeOffset = source.indexOf('value:T') + 6;
  const pos = generatedPosition(result, 1, typeOffset);
  expect(originalPosition(result, pos.line!, pos.column!).column).toBe(typeOffset);
});

it('emits ordinary declaration types and precise native factory returns', () => {
  const { root } = checked('export enum State<T>{case idle;case loaded(value:T);}');
  const result = emitDeclarations(join(root, 'tsconfig.json'), { outDir: join(root, 'dist') });
  expect(result.diagnostics).toEqual([]);
  const declarations = readFileSync(join(root, 'dist/main.d.ts'), 'utf8');
  expect(declarations).toContain('readonly kind: "loaded"');
  expect(declarations).toContain('loaded<T>(value: T)');
});

it('matches the emitted JS size of equivalent handwritten record factories', async () => {
  const dialect =
    'enum State<T>{case idle;case loaded(value:T);}export function run(value:number){return State.loaded(value).value;}';
  const native =
    'const State={idle(){return{kind:"idle"};},loaded(value){return{kind:"loaded",value};}};export function run(value){return State.loaded(value).value;}';
  const options = { loader: 'ts' as const, target: 'es2022', minify: true };
  const [generated, baseline] = await Promise.all([
    esbuildTransform(transform(dialect).code, options),
    esbuildTransform(native, options),
  ]);
  expect(generated.code).toBe(baseline.code);
});

it('keeps nested conditional infer scopes separate when selecting factory generics', () => {
  const { project } = checked(`export enum State<T,U> {
    case item(value:U extends (U extends infer T ? T : never) ? T : never);
    case keep(value:T);
  }
  export const result:string=State.item<string,number>('value').value;`);
  expect(project.diagnostics()).toEqual([]);
});

it.each([
  'if(true) enum State{case idle;}',
  'if(false) {} else enum State{case idle;}',
  'while(false) enum State{case idle;}',
  'for(;;) enum State{case idle;}',
  'do enum State{case idle;} while(false);',
  'label: enum State{case idle;}',
])('rejects associated enums in unbraced statement bodies: %s', (source) => {
  expect(() => transform(source)).toThrow(/requires a block/);
});

it.each(['const', 'in', 'out'])(
  'rejects the unsupported %s type parameter modifier',
  (modifier) => {
    expect(() => transform(`enum State<${modifier} T>{case item(value:T);}`)).toThrow(
      /cannot have const\/in\/out modifiers/,
    );
  },
);

it('accepts a type parameter named out and follows native namespace and static block scopes', () => {
  expect(
    checked(
      'export enum State<out>{case item(value:out);}export const item=State.item(3);',
    ).project.diagnostics(),
  ).toEqual([]);
  const source = `namespace Outer{export enum State<T>{case item(value:T);}}
    let result=0;class Holder{static{enum State{case item(value:number);}result=State.item(3).value;}}
    return [Outer.State.item('value'),result,Holder.name];`;
  expect(run(source)).toEqual([{ kind: 'item', value: 'value' }, 3, 'Holder']);
});

it('composes nested enum declarations with switch lowering and moved defer functions', () => {
  const source = `function make(){defer {}function inner(){enum State<T>{case item(value:T);}return State.item(3);}return inner();}
    const result=switch(0){case 0:(()=>{enum State<T>{case item(value:T);}return State.item(make());})();default:0;};
    return result;`;
  expect(run(source)).toEqual({ kind: 'item', value: { kind: 'item', value: 3 } });
  expect(checked(`export function execute(){${source}}`).project.diagnostics()).toEqual([]);
});

it('preserves own prototype-named payloads, contextual identifiers and falsy values', () => {
  const result =
    run(`enum State<T>{case __proto__(__proto__:T);case constructor(constructor:T);case async(async:T);case get(get:T);case 蜂鸟(数据:T);}
    const payload={value:3};const state=State.__proto__(payload);
    return [Object.hasOwn(State,'__proto__'),Object.hasOwn(state,'__proto__'),Object.getPrototypeOf(state)===Object.prototype,state.__proto__===payload,
      State.constructor(0),State.async(false),State.get(null),State.蜂鸟(undefined)];`);
  const expected: unknown[] = [
    true,
    true,
    true,
    true,
    { kind: 'constructor', constructor: 0 },
    { kind: 'async', async: false },
    { kind: 'get', get: null },
    { kind: '蜂鸟', 数据: undefined },
  ];
  expect(result).toEqual(expected);
});

it('retains native argument short-circuiting when a factory argument throws', () => {
  expect(
    run(`enum State{case item(left:number,right:number);}const events:number[]=[];
    try{State.item((()=>{events.push(1);throw new Error('stop');})(),(events.push(2),2));}catch(error){events.push(3);}
    return events;`),
  ).toEqual([1, 3]);
});

it('checks arity, payload constraints and readonly tags at original call sites', () => {
  const source = `export enum State<T extends {id:number}>{case idle;case item(value:T);}
    export const missing=State.item();
    export const extra=State.idle(1);
    export const invalid=State.item({id:'wrong'});
    export const valid=State.item({id:1});
    valid.kind='idle';`;
  const errors = checked(source).project.diagnostics();
  expect(errors.map((error) => error.code)).toEqual(expect.arrayContaining([2554, 2322, 2540]));
  expect(errors.every((error) => error.line >= 2 && error.line <= 6)).toBe(true);
});

it('withholds enum symbol and inferred payload renames from both Twill and native TS', () => {
  const source = `export enum State<T>{case idle;case loaded(value:T);}
    export const state=State.loaded(3);export const number=state.value;export const tag=state.kind;`;
  const native = `import {State,state} from './main.twill';
    export const value=state.value;export const tag=state.kind;export const factory=State.loaded;
    export function read(input:State<number>){return input.kind==='loaded'?input.value:0;}`;
  const { project, filename, root } = checked(source, native);
  expect(project.diagnostics()).toEqual([]);
  const editor = new TwillEditor(project);
  for (const [file, text, tokens] of [
    [
      filename,
      source,
      [
        'State<T>',
        'T>',
        'loaded(value',
        'value:T',
        'T);',
        'state.value',
        'state.kind',
        'State.loaded',
      ],
    ],
    [
      join(root, 'native.ts'),
      native,
      ['State,state', 'state.value', 'state.kind', 'State.loaded', 'State<number>', 'input.value'],
    ],
  ] as const) {
    for (const token of tokens) {
      const offset = text.indexOf(token) + (token.includes('.') ? token.indexOf('.') + 1 : 0);
      expect(editor.renameInfo(file, offset).canRename, token).toBe(false);
      expect(editor.rename(file, offset, 'renamed'), token).toBeUndefined();
    }
  }
});

it('renames external types completely across duplicated annotations and generic constraints', () => {
  const source = `import type {User} from './native';
    export enum State<T extends User=User>{case item(value:T,owner:User);case other(value:User);}
    export const result=State.item({id:1},{id:2});`;
  const native = 'export interface User{id:number}';
  const { project, filename, root } = checked(source, native);
  expect(project.diagnostics()).toEqual([]);
  const nativeFile = join(root, 'native.ts');
  const editor = new TwillEditor(project);
  const edits = editor.rename(nativeFile, native.indexOf('User'), 'Person')!;
  expect(edits).toBeDefined();
  expect(new Set(edits.map((edit) => `${edit.filename}:${edit.span.start}`)).size).toBe(
    edits.length,
  );
  for (const [file, original] of [
    [filename, source],
    [nativeFile, native],
  ]) {
    let updated = original;
    for (const edit of edits
      .filter((edit) => edit.filename === file)
      .sort((a, b) => b.span.start - a.span.start))
      updated =
        updated.slice(0, edit.span.start) +
        edit.newText +
        updated.slice(edit.span.start + edit.span.length);
    expect(updated).not.toContain('User');
    writeFileSync(file, updated);
    project.update(file, updated);
  }
  expect(project.diagnostics()).toEqual([]);
});

it('emits declarations consumed by native TypeScript with mapped generic and payload types', () => {
  const source = 'export enum State<T extends object>{\ncase idle;\ncase loaded(value:T);\n}\n';
  const { root } = checked(source);
  expect(
    emitDeclarations(join(root, 'tsconfig.json'), { outDir: join(root, 'dist') }).diagnostics,
  ).toEqual([]);
  const declarations = readFileSync(join(root, 'dist/main.d.ts'), 'utf8');
  const map = new TraceMap(JSON.parse(readFileSync(join(root, 'dist/main.d.ts.map'), 'utf8')));
  const offset = declarations.indexOf('(value: T)') + '(value: '.length;
  const prefix = declarations.slice(0, offset).split('\n');
  expect(
    originalPositionFor(map, { line: prefix.length, column: prefix.at(-1)!.length }),
  ).toMatchObject({ line: 3, column: 'case loaded(value:'.length });
  const consumer = join(root, 'consumer.ts');
  writeFileSync(
    consumer,
    `import {State} from './dist/main.js';
    const item=State.loaded({id:1});const kind:'loaded'=item.kind;const value:number=item.value.id;
    const state:State<{id:number}>=State.idle();
    // @ts-expect-error payload is required
    State.loaded();
    // @ts-expect-error constrained payload
    State.loaded(3);
    // @ts-expect-error immutable tag
    item.kind='idle';
    // @ts-expect-error immutable field
    item.value={id:2};`,
  );
  const program = ts.createProgram([consumer], {
    strict: true,
    noEmit: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
});
