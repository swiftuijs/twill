import { build } from 'vite';
import { nodeViteConfig } from '../../../packages/twill/scripts/node-vite-config.mjs';
import { readVsix } from './read-vsix.mjs';
import { runTests } from '@vscode/test-electron';
import { mkdirSync, writeFileSync, rmSync, readFileSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));

const root = resolve('editors/vscode/.twill/editor-integration');
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
// Test the distributable extension, not a different development bundle.
const files = await readVsix('dist/twill.vsix', (name) => name.startsWith('extension/'));
for (const [name, contents] of files) {
  const target = join(root, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}
if (process.env.NODE_V8_COVERAGE) {
  // The VSIX omits development source maps. Supply its matching build map to
  // the coverage collector, without changing a byte of the shipped bundle.
  const bundle = resolve('editors/vscode/dist/extension.cjs');
  assert.deepEqual(files.get('extension/dist/extension.cjs'), readFileSync(bundle));
  const map = JSON.parse(readFileSync(bundle + '.map', 'utf8'));
  map.sources = map.sources.map((source) => resolve(dirname(bundle), source));
  writeFileSync(join(root, 'extension/dist/extension.cjs.map'), JSON.stringify(map));
}
const workspace = join(root, 'workspace');
mkdirSync(workspace, { recursive: true });
// Outside the repository, so findConfigFile cannot silently inherit our own
// editor package's tsconfig and make an inferred-project check falsely pass.
const inferredRoot = mkdtempSync(join(tmpdir(), 'twill-editor-inferred-'));
const inferredFile = join(inferredRoot, 'main.twill');
writeFileSync(inferredFile, 'export const values = [1].map { n in n * 2 };\n');
writeFileSync(join(workspace, 'host-fixtures.json'), JSON.stringify({ inferredFile }));
const runtimePackage = join(workspace, 'node_modules/@swiftuijs/twill-runtime');
mkdirSync(runtimePackage, { recursive: true });
cpSync('packages/runtime/dist', join(runtimePackage, 'dist'), { recursive: true });
cpSync('packages/runtime/package.json', join(runtimePackage, 'package.json'));
const fixture = {
  // A workspace package must never supply executable editor-assistance code.
  'node_modules/typescript/package.json': JSON.stringify({ name: 'typescript', main: 'index.js' }),
  'node_modules/typescript/index.js': 'throw new Error("Workspace TypeScript must not be loaded");',
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      checkJs: true,
      types: [],
      skipLibCheck: true,
    },
    include: ['**/*'],
  }),
  'api.twill':
    'import {scale} from "./scale.ts";\nexport function twice(value: number): number { return [value].map { item in scale(item) }[0]!; }\nexport const unused = 0;\n',
  'scale.ts': 'export function scale(value: number): number { return value * 2; }\n',
  'auto.twill': 'export const answer = twice(21);\n',
  'consumer.ts': 'import { twice } from "./api.twill"; export const result: number = twice(21);\n',
  'settings.twill': 'export const values = [1].map { n in n + 1 };\n',
  'runtime.twill':
    'export function run(input:number,events:number[]){\nlet value=input;\nif(true)defer {events.push(value);}\ndefer {events.push(value+1);}\nreturn value;}\n',
  'settings-consumer.ts':
    'import { values } from "./settings.twill"; export const checked: number[] = values;\n',
  'imports.twill':
    'import { unused, twice } from "./api.twill";\nexport const values = [1].map { n in twice(n) };\n',
  'fix.twill': 'export const values = [1].map { value in value.toFixd(2) };\n',
  'members.twill':
    'export const users = [{ active: true, name: "Ada" }];\nexport const selected = users.filter { .active };\nexport const partial = users.map { .act };\n',
  'branching.twill':
    'type Result={kind:"ok";value:number}|{kind:"bad";error:string};\nexport function describe(input:{result:Result}|null){guard const {result: item}=input else{return "empty";}return switch(item){case {kind:"ok",value: amount}: amount.toFixed();case {kind:"bad",error}: error;};}\n',
  'if-bindings.twill':
    'export function describe(input:{value:number}|null){const value=7;if const {value}=input{return value.toFixed();}else{return value.toFixed();}}\n',
  'pattern-factory.ts':
    'export const Factory={loaded(value:number){return{kind:"loaded",value} as const;}};\n',
  'native-patterns.twill':
    'import {Factory as Cases} from "./pattern-factory.ts";\nexport function render(input:{kind:"loaded";value:number}){return match(input){case Cases.loaded({value}):value.toFixed();};}\n',
  'enums.twill':
    'export enum State<T>{case idle;case loaded(value:T);}\nexport const result=State.loaded(42);\nexport function read(state:State<number>){return match(state){case State.idle(): 0;case State.loaded({value:amount}): amount.toFixed();};}\n',
  'enums-consumer.ts':
    'import {State,result} from "./enums.twill";export const value:State<number>=result;export const idle:"idle"=State.idle().kind;export const payload=result.value;\n',
  'view.twillx': `import type { ReactNode } from 'react';\ndeclare function Card(props: { title: string; onClick?: (event: { x: number }) => void; children?: ReactNode }): ReactNode;\nexport const view = Card({ tit }) { 'Hello' };\n`,
  'debug.twill':
    'const run = (body: () => void) => body();\nrun {\n  const value = 21;\n  debugger;\n  console.log(value * 2);\n};\n',
  'broken.twill': 'export const values = [1].map { value in value + };\n',
  'temporary.twill': 'export const value = 42;\n',
};
for (const [name, text] of Object.entries(fixture)) {
  const target = join(workspace, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
await build({
  ...nodeViteConfig({
    entry: resolve('editors/vscode/tests/host.ts'),
    outDir: root,
    filename: 'tests.cjs',
    external: ['vscode'],
    emptyOutDir: false,
  }),
  configFile: false,
});
try {
  await runTests({
    version: process.env.TWILL_TEST_VSCODE_VERSION ?? 'stable',
    vscodeExecutablePath: process.env.TWILL_TEST_VSCODE_PATH,
    extensionDevelopmentPath: join(root, 'extension'),
    extensionTestsPath: join(root, 'tests.cjs'),
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--no-sandbox',
      '--disable-gpu',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  });
} finally {
  rmSync(inferredRoot, { recursive: true, force: true });
}
