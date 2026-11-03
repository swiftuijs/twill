import { afterEach, expect, it } from 'vitest';
import ts from 'typescript';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportProject } from '../src/index.twill';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const compilerOptions = {
  strict: true,
  target: 'ES2022',
  module: 'ESNext',
  moduleResolution: 'Bundler',
  types: [],
};
it('exports branch bindings with native scopes, narrowing and declarations', async () => {
  const { tsconfig, outDir } = fixture({
    'index.twill':
      'export function read(input:{value:number}|null){const value=7;if const {value}=input{return value.toFixed();}else{return value.toFixed();}}',
    'consumer.ts': 'import {read} from "./index.twill"; export const value:string=read(null);',
  });
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics).toEqual([]);
  expect(nativeDiagnostics(result.tsconfig)).toEqual([]);
  const native = readFileSync(join(outDir, 'index.ts'), 'utf8');
  expect(native).not.toContain('if const');
  expect(native).toContain('!== null');
  const module: Record<string, any> = {};
  Function(
    'exports',
    ts.transpileModule(native, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(module);
  expect(module.read({ value: 0 })).toBe('0');
  expect(module.read(null)).toBe('7');
});

it('exports imported enum patterns as checked native switches and declarations', async () => {
  const { tsconfig, outDir } = fixture({
    'state.twill': 'export enum State<T>{case idle;case loaded(value:T);}',
    'index.twill':
      'import {State as Factory} from "./state.twill";export function read(state:Factory<number>){return match(state){case Factory.idle():0;case Factory.loaded({value}):value;};}',
  });
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics).toEqual([]);
  expect(nativeDiagnostics(result.tsconfig)).toEqual([]);
  const output = readFileSync(join(outDir, 'index.ts'), 'utf8');
  expect(output).not.toContain('match(');
  expect(output).toContain('typeof Factory.loaded');
});
function fixture(
  files: Record<string, string>,
  config: unknown = { compilerOptions, include: ['**/*'] },
) {
  const directory = mkdtempSync(join(tmpdir(), 'twill-export-'));
  roots.push(directory);
  const root = join(directory, 'source');
  mkdirSync(root);
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, source);
  }
  const tsconfig = join(root, 'tsconfig.json');
  writeFileSync(tsconfig, JSON.stringify(config));
  return { directory, root, tsconfig, outDir: join(directory, 'native') };
}
function nativeDiagnostics(config: string) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} },
  )!;
  return [
    ...parsed.errors,
    ...ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options)),
  ].map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'));
}

it('exports associated enums as ordinary checked TS with precise constructors', async () => {
  const source =
    'export enum State<T>{case idle;case loaded(value:T);} export const state:State<number>=State.loaded(42);';
  const { root, tsconfig, outDir } = fixture({
    'state.twill': source,
    'consumer.ts':
      'import {State,state} from "./state.twill"; export const value:State<number>=state; export const tag:"idle"=State.idle().kind;',
  });
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics).toEqual([]);
  expect(result.written).toBe(true);
  expect(nativeDiagnostics(result.tsconfig)).toEqual([]);
  const output = readFileSync(join(outDir, 'state.ts'), 'utf8');
  expect(output).toContain('export type State<T>');
  expect(output).toContain('export const State');
  expect(readFileSync(join(root, 'state.twill'), 'utf8')).toBe(source);
  const exports: any = {};
  Function(
    'exports',
    ts.transpileModule(output, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  )(exports);
  expect(exports.state).toEqual({ kind: 'loaded', value: 42 });
});

it('exports a checked mixed graph with rewritten imports, native TS checking and execution', async () => {
  const input = {
    'values.twill':
      'export type Amount = number; export const doubled = [1,2,3].map { n in n * 2 }; export const names=[{name:"Ada",active:true}].filter { .active }.map { .name };',
    'cleanup.twill':
      'export function calculate(value:number|undefined) { let closed = false; defer { closed=true; } guard const amount=value else { return 0; } return amount * 2; }',
    'consumer.ts':
      'import {doubled} from "./values.twill";export {doubled as values} from "./values.twill";export const sum=doubled.reduce((a,b)=>a+b,0);export const load=()=>import(`./values.twill`);export type Amount=import("./values.twill").Amount;',
    'client.js':
      'import {doubled} from "./values.twill"; export const first = doubled[0]; // keep layout',
    'other.ts': 'export const mention="./values.twill"; // ./values.twill stays an ordinary string',
  };
  const { root, tsconfig, outDir } = fixture(input);
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics).toEqual([]);
  expect(result.written).toBe(true);
  expect(nativeDiagnostics(result.tsconfig)).toEqual([]);
  expect(readFileSync(join(outDir, 'consumer.ts'), 'utf8')).not.toContain('.twill');
  expect(readFileSync(join(outDir, 'client.js'), 'utf8')).toContain('// keep layout');
  expect(readFileSync(join(outDir, 'other.ts'), 'utf8')).toBe(input['other.ts']);
  const source = readFileSync(join(outDir, 'values.ts'), 'utf8');
  expect(source).toContain('const doubled = [1, 2, 3].map');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function('exports', code)(exports);
  expect(exports.doubled).toEqual([2, 4, 6]);
  expect(exports.names).toEqual(['Ada']);
  for (const [name, text] of Object.entries(input))
    expect(readFileSync(join(root, name), 'utf8')).toBe(text);
});

it('previews without writing and refuses existing or source directories', async () => {
  const { tsconfig, root, outDir } = fixture({ 'index.twill': 'export const value=42;' });
  const result = await exportProject(tsconfig, { outDir, dryRun: true });
  expect(result.written).toBe(false);
  expect(result.files).toHaveLength(1);
  expect(existsSync(outDir)).toBe(false);
  await expect(exportProject(tsconfig, { outDir: join(root, 'native') })).rejects.toThrow(
    /outside/,
  );
  mkdirSync(outDir);
  writeFileSync(join(outDir, 'keep'), 'keep');
  await expect(exportProject(tsconfig, { outDir })).rejects.toThrow(/already exists/);
  expect(readFileSync(join(outDir, 'keep'), 'utf8')).toBe('keep');
});

it('exports destructured guards and exhaustive matching to checked native TS', async () => {
  const { tsconfig, outDir } = fixture({
    'model.ts': 'export type Result={kind:"ok";value:number}|{kind:"bad";error:string};',
    'main.twill':
      'import type {Result} from "./model.ts";export function describe(input:{result:Result}|null){guard const {result}=input else{return "empty";}return switch(result){case {kind:"ok",value}: value.toFixed();case {kind:"bad",error}: error;};}',
    'consumer.ts':
      'import {describe} from "./main.twill";export const value:string=describe({result:{kind:"ok",value:3}});',
  });
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics).toEqual([]);
  expect(nativeDiagnostics(result.tsconfig)).toEqual([]);
  const source = readFileSync(join(outDir, 'main.ts'), 'utf8');
  expect(source).toContain('extends never');
  expect(source).not.toContain('=>');
});

it('exports TSX with native JSX typing and serializes standard TS enum options', async () => {
  const { tsconfig, outDir } = fixture(
    {
      'ui.d.ts':
        'declare namespace JSX { interface Element {} interface ElementChildrenAttribute { children: {}; } }',
      'view.twillx':
        'declare function Card(props: { title: string; children?: string }): JSX.Element; export const view=Card({title:"Hi"}) { "Hello" };',
      'consumer.ts': 'import {view} from "./view.twillx";export const result=view;',
    },
    {
      compilerOptions: {
        ...compilerOptions,
        jsx: 'preserve',
        lib: ['ES2022'],
        newLine: 'lf',
        moduleDetection: 'force',
      },
      include: ['**/*'],
    },
  );
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics).toEqual([]);
  expect(nativeDiagnostics(result.tsconfig)).toEqual([]);
  expect(readFileSync(join(outDir, 'view.tsx'), 'utf8')).toContain('<Card');
  expect(readFileSync(join(outDir, 'consumer.ts'), 'utf8')).toContain('./view.tsx');
  const config = JSON.parse(readFileSync(result.tsconfig, 'utf8'));
  expect(config.compilerOptions.jsx).toBe('preserve');
  expect(config.compilerOptions.lib).toEqual(['es2022']);
  expect(config.compilerOptions.newLine).toBe('lf');
});

it('escapes rewritten module literals without changing quoted filename semantics', async () => {
  const { tsconfig, outDir } = fixture({
    "quote's.twill": 'export const value=42;',
    'consumer.ts': "export {value} from './quote\\'s.twill';",
  });
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics).toEqual([]);
  expect(nativeDiagnostics(result.tsconfig)).toEqual([]);
  expect(readFileSync(join(outDir, 'consumer.ts'), 'utf8')).toContain("quote's.ts");
});

it.each(['export const value:number="wrong";', 'export const value=[1].map { n in n+ };'])(
  'writes nothing when source checking fails: %s',
  async (source) => {
    const { tsconfig, outDir } = fixture({ 'index.twill': source });
    const result = await exportProject(tsconfig, { outDir });
    expect(result.diagnostics.some((item) => item.category === 'error')).toBe(true);
    expect(existsSync(outDir)).toBe(false);
  },
);

it.each(['index.ts', 'INDEX.ts'])('rejects portable output collisions with %s', async (native) => {
  const { tsconfig, outDir } = fixture({
    'index.twill': 'export const value=1;',
    [native]: 'export const other=2;',
  });
  await expect(exportProject(tsconfig, { outDir })).rejects.toThrow(/collision/);
  expect(existsSync(outDir)).toBe(false);
});

it('rejects a new TS/JS resolution collision before an extensionless import can change meaning', async () => {
  const { tsconfig, outDir } = fixture({
    'values.twill': 'export const value=1;',
    'values.js': 'export const value=2;',
    'consumer.ts': 'import {value} from "./values";export const result=value;',
  });
  await expect(exportProject(tsconfig, { outDir })).rejects.toThrow(/module resolution collision/);
  expect(existsSync(outDir)).toBe(false);
});

it('rejects explicit aliased dialect extensions rather than emitting unresolved native imports', async () => {
  const { tsconfig, outDir } = fixture(
    {
      'src/values.twill': 'export const value=1;',
      'consumer.ts': 'export {value} from "@data/values.twill";',
    },
    {
      compilerOptions: { ...compilerOptions, baseUrl: '.', paths: { '@data/*': ['src/*'] } },
      include: ['**/*'],
    },
  );
  await expect(exportProject(tsconfig, { outDir })).rejects.toThrow(
    /Aliased dialect extension imports/,
  );
  expect(existsSync(outDir)).toBe(false);
});

it('flattens inherited settings and copies local ambient types and JSON', async () => {
  const { root, tsconfig, outDir } = fixture(
    {
      'src/index.twill':
        'import {value} from "@data/value";import data from "./data.json";export const output:string=String(value+data.count);',
      'src/value.ts': 'export const value=1;',
      'src/data.json': '{"count":2}',
      'types/custom.d.ts': 'declare const TWILL_TEST: string;',
      'tsconfig.base.json': JSON.stringify({
        compilerOptions: {
          ...compilerOptions,
          baseUrl: '.',
          paths: { '@data/*': ['src/*'] },
          resolveJsonModule: true,
        },
      }),
    },
    { extends: './tsconfig.base.json', include: ['src/**/*', 'types/**/*'] },
  );
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics).toEqual([]);
  expect(nativeDiagnostics(result.tsconfig)).toEqual([]);
  expect(readFileSync(join(outDir, 'src/data.json'), 'utf8')).toBe('{"count":2}');
  expect(existsSync(join(outDir, 'types/custom.d.ts'))).toBe(true);
  const config = JSON.parse(readFileSync(result.tsconfig, 'utf8'));
  expect(config.extends).toBeUndefined();
  expect(config.compilerOptions.baseUrl).toBe('.');
  expect(config.compilerOptions.paths).toEqual({ '@data/*': ['src/*'] });
  expect(readFileSync(join(root, 'tsconfig.base.json'), 'utf8')).not.toContain(outDir);
});

it('rejects computed module paths and project references before writing', async () => {
  const { tsconfig, outDir, root } = fixture({
    'index.twill': 'const target="./other.twill";export const load=()=>import(target);',
  });
  await expect(exportProject(tsconfig, { outDir })).rejects.toThrow(/Computed dynamic imports/);
  expect(existsSync(outDir)).toBe(false);
  mkdirSync(join(root, 'reference'));
  writeFileSync(join(root, 'reference/tsconfig.json'), '{}');
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions,
      include: ['*.twill'],
      references: [{ path: './reference' }],
    }),
  );
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics.some((item) => item.code === 90002)).toBe(true);
  expect(existsSync(outDir)).toBe(false);
});

it('does not copy secrets or install metadata outside the checked graph', async () => {
  const { tsconfig, root, outDir } = fixture({
    'index.twill': 'export const value=1;',
    '.env': 'SECRET=example',
    'package.json': '{"private":true}',
  });
  const result = await exportProject(tsconfig, { outDir });
  expect(result.written).toBe(true);
  expect(readdirSync(outDir).sort()).toEqual(['index.ts', 'tsconfig.json']);
  expect(existsSync(join(root, '.env'))).toBe(true);
});

it.skipIf(process.platform === 'win32')(
  'rejects symlink escapes for inputs and output parents',
  async () => {
    const { directory, root, tsconfig, outDir } = fixture({
      'index.twill': 'export const value=1;',
    });
    const external = join(directory, 'external.twill');
    writeFileSync(external, 'export const outside=1;');
    symlinkSync(external, join(root, 'linked.twill'));
    await expect(exportProject(tsconfig, { outDir })).rejects.toThrow(/outside the export project/);
    rmSync(join(root, 'linked.twill'));
    symlinkSync(root, join(directory, 'alias'));
    await expect(
      exportProject(tsconfig, { outDir: join(directory, 'alias/native') }),
    ).rejects.toThrow(/outside the source/);
  },
);
it('exports configured external cleanup with native types and an explicit runtime dependency', async () => {
  const { directory, root, tsconfig, outDir } = fixture({
    'main.twill':
      'export function run(events:number[]){if(true)defer {events.push(1);}defer {events.push(2);}return 3;}',
    'twill.config.json': '{"runtime":"external"}',
  });
  const runtime = join(import.meta.dirname, '../../runtime');
  mkdirSync(join(directory, 'node_modules', '@swiftuijs'), { recursive: true });
  symlinkSync(
    runtime,
    join(directory, 'node_modules', '@swiftuijs', 'twill-runtime'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = await exportProject(tsconfig, { outDir });
  expect(result.diagnostics).toEqual([]);
  expect(result.written).toBe(true);
  expect(readFileSync(join(outDir, 'main.ts'), 'utf8')).toContain(
    '@swiftuijs/twill-runtime/helpers/v1',
  );
  expect(nativeDiagnostics(result.tsconfig)).toEqual([]);
  expect(readFileSync(join(root, 'twill.config.json'), 'utf8')).toContain('external');
  expect(existsSync(join(outDir, 'node_modules'))).toBe(false);
});
