import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
import { createRequire } from 'node:module';
import twill from '../dist/esbuild.js';
import { runtimeReport } from './runtime-size.mjs';

const root = mkdtempSync(join(tmpdir(), 'twill-bundle-size-'));
const fixtures = [
  {
    name: 'optional-branch-binding',
    // Keep the hygienic snapshot required for initializer shadowing/global
    // reads. V8 can eliminate scalar aliases; minified source retains 10 bytes.
    maxExtraBytes: 10,
    extension: 'twill',
    nativeExtension: 'ts',
    inputs: [null, undefined, { value: 0 }, { value: 3 }],
    sugar:
      'export function run(input:{value:number}|null|undefined){if const {value}=input{return value*2;}return 0;}',
    native:
      'export function run(input:{value:number}|null|undefined){if(input!==null&&input!==void 0){const {value}=input;return value*2;}return 0;}',
  },
  {
    name: 'implicit-members',
    extension: 'twill',
    nativeExtension: 'ts',
    inputs: [
      [],
      [
        { active: true, name: 'Ada' },
        { active: false, name: 'Grace' },
      ],
    ],
    sugar:
      'export function run(users: {active:boolean;name:string}[]) { return users.filter { .active }.map { .name }; }',
    native:
      'export function run(users: {active:boolean;name:string}[]) { return users.filter(user => user.active).map(user => user.name); }',
  },
  {
    name: 'validated-pipeline',
    extension: 'twill',
    nativeExtension: 'ts',
    sugar:
      'export function run(input: number[] | undefined) { guard const values = input else { return []; } return values.filter { value in value >= 0 }.map { value in value * 2 }; }',
    native:
      'export function run(input: number[] | undefined) { const values = input; if (values === null || values === void 0) return []; return values.filter(value => value >= 0).map(value => value * 2); }',
  },
  {
    name: 'destructured-guard',
    extension: 'twill',
    nativeExtension: 'ts',
    inputs: [null, undefined, { value: 0 }, { value: 3 }],
    sugar:
      'export function run(input: {value:number}|null|undefined) { guard const {value}=input else{return 0;} return value*2; }',
    native:
      'export function run(input: {value:number}|null|undefined) { const valueOrNull=input; if(valueOrNull===null||valueOrNull===void 0)return 0; const {value}=valueOrNull; return value*2; }',
  },
  {
    name: 'direct-pattern-switch',
    maxExtraBytes: 2,
    extension: 'twill',
    nativeExtension: 'ts',
    inputs: [
      { kind: 'ok', value: 3, extra: true },
      { kind: 'bad', error: 'x' },
    ],
    sugar:
      'export function run(input: {kind:"ok";value:number;extra?:boolean}|{kind:"bad";error:string}) { return switch(input){case {kind:"ok",value,...rest}: [value,rest];case {kind:"bad",error}: error;}; }',
    native:
      'export function run(input: {kind:"ok";value:number;extra?:boolean}|{kind:"bad";error:string}) { const subject=input; switch(subject.kind){case "ok": {const {kind,value,...rest}=subject; return [value,rest];}case "bad": {const {kind,error}=subject;return error;}} throw new TypeError("Non-exhaustive switch expression"); }',
  },
  {
    name: 'direct-enum-pattern',
    maxExtraBytes: 2,
    extension: 'twill',
    nativeExtension: 'ts',
    inputs: [{ kind: 'idle' }, { kind: 'loaded', value: 3 }, { kind: 'loaded', extra: true }],
    sugar:
      'declare const State:{idle():{kind:"idle"};loaded(value:number):{kind:"loaded";value:number}};export function run(input:{kind:"idle"}|{kind:"loaded";value?:number;extra?:boolean}){return match(input){case State.idle():0;case State.loaded({value=4,...rest}):[value,rest];};}',
    native:
      'export function run(input:{kind:"idle"}|{kind:"loaded";value?:number;extra?:boolean}){const subject=input;const kind=subject.kind;switch(kind){case "idle":return 0;case "loaded":{const {value=4,...rest}=subject;return [value,rest];}}throw new TypeError("Non-exhaustive switch expression");}',
  },
  {
    name: 'initializer-enum-pattern',
    maxExtraBytes: 8,
    extension: 'twill',
    nativeExtension: 'ts',
    inputs: [{ kind: 'idle' }, { kind: 'loaded', value: 3 }, { kind: 'loaded', value: 7 }],
    sugar:
      'declare const State:{idle():{kind:"idle"};loaded(value:number):{kind:"loaded";value:number}};export function run(input:{kind:"idle"}|{kind:"loaded";value:number}){const result=match(input){case State.idle():0;case State.loaded({value}):value;};return result*2;}',
    native:
      'export function run(input:{kind:"idle"}|{kind:"loaded";value:number}){let result;switch(input.kind){case "idle":result=0;break;case "loaded":{const {value}=input;result=value;break;}default:throw new TypeError("Non-exhaustive switch expression");}return result*2;}',
  },
  {
    name: 'react-single-child',
    extension: 'twillx',
    nativeExtension: 'tsx',
    sugar: 'export function App({Card}: {Card: any}) { return Card({title:"Hi"}) { "Hello" }; }',
    native: 'export function App({Card}: {Card: any}) { return <Card title="Hi">Hello</Card>; }',
  },
];
const results = [];
try {
  for (const fixture of fixtures) {
    const buildSource = async (source, extension, plugins) => {
      const entry = join(root, 'entry.' + extension);
      writeFileSync(entry, source);
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        minify: true,
        jsx: 'automatic',
        external: ['react/jsx-runtime'],
        plugins,
        metafile: true,
      });
      return { code: result.outputFiles[0].text, inputs: Object.keys(result.metafile.inputs) };
    };
    const native = await buildSource(fixture.native, fixture.nativeExtension, []);
    const dialect = await buildSource(fixture.sugar, fixture.extension, [twill({ root })]);
    if (fixture.name === 'initializer-enum-pattern')
      assert(!dialect.code.includes('=>'), 'Standalone switch initializers must not add an IIFE');
    // Identifier mangling depends on input character frequencies. Compare bytes
    // and execution rather than requiring the same arbitrary short names.
    assert(
      Buffer.byteLength(dialect.code) <=
        Buffer.byteLength(native.code) + (fixture.maxExtraBytes ?? 0),
      `${fixture.name}: application output exceeded its native comparison budget (${Buffer.byteLength(dialect.code)} vs ${Buffer.byteLength(native.code)} bytes)\n${dialect.code}\n${native.code}`,
    );
    assert(
      !dialect.inputs.some((input) => /node_modules/.test(input)),
      'Compiler/runtime libraries must not enter these application fixtures',
    );
    const evaluate = async (code) => {
      const compiled = await transform(code, { format: 'cjs' });
      const module = { exports: {} };
      new Function('module', 'exports', 'require', compiled.code)(
        module,
        module.exports,
        createRequire(import.meta.url),
      );
      return module.exports;
    };
    const nativeModule = await evaluate(native.code);
    const dialectModule = await evaluate(dialect.code);
    if (fixture.extension === 'twill')
      for (const input of fixture.inputs ?? [undefined, null, [], [-2, -0, 0, 1, 2, NaN, Infinity]])
        assert.deepEqual(dialectModule.run(input), nativeModule.run(input));
    else {
      const Card = (props) => props.children;
      assert.deepEqual(dialectModule.App({ Card }), nativeModule.App({ Card }));
    }
    results.push({
      name: fixture.name,
      bytes: Buffer.byteLength(dialect.code),
      gzipBytes: gzipSync(dialect.code).length,
      nativeBytes: Buffer.byteLength(native.code),
      byteParity: Buffer.byteLength(dialect.code) === Buffer.byteLength(native.code),
      extraBytes: Buffer.byteLength(dialect.code) - Buffer.byteLength(native.code),
      behaviorParity: true,
      frameworkRuntimeExternal: fixture.extension === 'twillx',
    });
  }
  const report = {
    node: process.version,
    packageVersion: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version,
    scope:
      'Minified application output for seven representative supported paths; excludes host/framework runtime and does not cover expression IIFEs, dynamic cleanup or child collection.',
    results,
    runtime: runtimeReport,
  };
  const output = process.argv.indexOf('--output');
  if (output >= 0) writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
