import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  chmodSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { probeTypeScriptPlugin } from './helpers/probe-typescript-plugin.mjs';
import { npmConsumer as npm } from './helpers/npm-consumer.mjs';

// Release archives are coordinated at the workspace root. Test dependencies belong to this package.
process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));

const metadata = JSON.parse(readFileSync('packages/twill/package.json', 'utf8'));
const require = createRequire(import.meta.url);
const dependencyVersion = (name) => {
  try {
    return JSON.parse(readFileSync(require.resolve(name + '/package.json'), 'utf8')).version;
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
  }
  // Some tools export their entry point but deliberately hide package.json.
  let directory = dirname(require.resolve(name));
  while (directory !== dirname(directory)) {
    const filename = join(directory, 'package.json');
    if (existsSync(filename)) {
      const pkg = JSON.parse(readFileSync(filename, 'utf8'));
      if (pkg.name === name) return pkg.version;
    }
    directory = dirname(directory);
  }
  throw new Error('Missing installed package metadata: ' + name);
};
const packageRoot = resolve('packages/twill');
for (const entry of Object.values(metadata.exports)) {
  const paths = typeof entry === 'string' ? [entry] : Object.values(entry);
  for (const path of paths)
    assert(existsSync(resolve(packageRoot, path)), `Missing export ${path}`);
}
const root = mkdtempSync(join(tmpdir(), 'twill-package-'));
try {
  let archive = process.argv.includes('--packed')
    ? resolve(`swiftuijs-twill-${metadata.version}.tgz`)
    : process.env.TWILL_TEST_TARBALL && resolve(process.env.TWILL_TEST_TARBALL);
  if (!archive) {
    const packed = JSON.parse(
      execFileSync(
        'pnpm',
        ['--config.ignore-scripts=true', 'pack', '--json', '--pack-destination', root],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          shell: process.platform === 'win32',
        },
      ),
    );
    assert(
      !packed.files.some((file) => /\.vsix$|examples\/|tests\//.test(file.path)),
      'Unexpected files in npm tarball',
    );
    archive = resolve(root, packed.filename);
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      archive,
      `react@${dependencyVersion('react')}`,
      `@types/react@${dependencyVersion('@types/react')}`,
      `vue@${dependencyVersion('vue')}`,
      `vite@${dependencyVersion('vite')}`,
      `@vitejs/plugin-react@${dependencyVersion('@vitejs/plugin-react')}`,
    ],
    {
      cwd: root,
      stdio: 'pipe',
    },
  );
  const base = join(root, 'node_modules/@swiftuijs/twill/dist');
  const installed = JSON.parse(readFileSync(join(base, '../package.json'), 'utf8'));
  assert.equal(installed.name, metadata.name);
  assert.equal(installed.version, metadata.version);
  const cli = join(root, 'node_modules/@swiftuijs/twill', installed.bin.twill);
  process.env.TWILL_CACHE_DIR = join(root, 'private-runner-cache');
  delete process.env.TWILL_CACHE;
  const help = execFileSync(process.execPath, [cli, '--help'], { cwd: root, encoding: 'utf8' });
  assert(help.includes('twill export'), 'Unified CLI help must list source export');
  assert(help.includes('twill run'), 'Unified CLI help must list script execution');
  const script = join(root, 'runner-script');
  writeFileSync(
    script,
    `#!/usr/bin/env twill
guard const first = process.argv[2] else { throw new Error('Pass an argument'); }
const values: number[] = [1,2].map { n in n * 2 };
console.log(JSON.stringify({args:process.argv.slice(2),values,pid:process.pid}));`,
  );
  const scriptArgs = ['--help', '-p', '--', '', 'a b', '中文;$(literal)'];
  for (const prefix of [[], ['run']]) {
    const result = spawnSync(process.execPath, [cli, ...prefix, script, ...scriptArgs], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: scriptArgs,
      values: [2, 4],
      pid: result.pid,
    });
  }
  if (process.platform !== 'win32') {
    chmodSync(script, 0o755);
    const result = spawnSync(script, scriptArgs, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: join(root, 'node_modules/.bin') + delimiter + process.env.PATH },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).args, scriptArgs);
    const linked = join(root, 'runner-linked');
    symlinkSync(script, linked);
    for (const flags of [[], ['--preserve-symlinks']]) {
      const preserved = spawnSync(process.execPath, [...flags, cli, linked, ...scriptArgs], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(preserved.status, 0, preserved.stderr);
      assert.deepEqual(JSON.parse(preserved.stdout).args, scriptArgs);
    }
  }
  const runnerDirectory = join(root, 'runner-smoke');
  mkdirSync(runnerDirectory);
  const exitScript = join(runnerDirectory, 'exit.twill');
  writeFileSync(exitScript, 'process.exitCode=23;');
  assert.equal(spawnSync(process.execPath, [cli, exitScript], { cwd: root }).status, 23);
  assert.equal(installed.dependencies['@swiftuijs/twill-export'], undefined);
  assert.throws(
    () =>
      execFileSync(process.execPath, [cli, 'export', '-o', '../native'], {
        cwd: root,
        stdio: 'pipe',
      }),
    (error) =>
      error.status === 1 && /pnpm add -D @swiftuijs\/twill-export/.test(String(error.stderr)),
    'An independently installed compiler must explain optional export tooling',
  );
  for (const entry of Object.values(installed.exports))
    for (const path of typeof entry === 'string' ? [entry] : Object.values(entry))
      assert(existsSync(resolve(base, '..', path)), `Missing installed export ${path}`);
  await probeTypeScriptPlugin(root, '@swiftuijs/twill');
  const esm = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import {transform} from "@swiftuijs/twill"; console.log(transform("fn() { 42 }").closures)',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(esm.trim(), '1', 'The TS-server main entry must preserve compiler ESM exports');
  const { transform } = await import(pathToFileURL(join(base, 'index.js')).href);
  // Vite loads native Rolldown bindings. Run this consumer in a child process
  // so Windows releases its DLL before the temporary installation is removed.
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
    import twillReact from '@swiftuijs/twill/vite-react';
    assert(twillReact().length >= 2, 'Installed optional React integration must load its peer');
    assert.throws(() => twillReact({react:{jsxRuntime:'classic'}}), /automatic JSX/);
  `,
    ],
    { cwd: root, stdio: 'pipe' },
  );
  assert.equal(transform('fn() { 42 }').closures, 1);
  assert.equal(transform('function f(v) { guard v else { return 0; } return 1; }').guards, 1);
  assert.equal(transform('function f() { defer { console.log("done"); } }').defers, 1);
  const branching = transform(
    'function run(input){guard const {result}=input else{return 0;}return switch(result){case {kind:"ok",value}: value*2;default: 0;};}',
    { language: 'js' },
  );
  const runBranch = Function(branching.code + ';return run;')();
  assert.match(branching.code, /=== null \|\| .*=== void 0/);
  assert.equal(runBranch(null), 0);
  assert.equal(runBranch({ result: { kind: 'ok', value: 3 } }), 6);
  assert.equal(branching.switches, 1);
  for (const name of [
    'vite',
    'rollup',
    'esbuild',
    'webpack',
    'rspack',
    'project',
    'editor',
    'doctor',
  ])
    await import(pathToFileURL(join(base, name + '.js')).href);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        skipLibCheck: true,
      },
      include: ['*.twill'],
    }),
  );
  writeFileSync(
    join(root, 'main.twill'),
    'import {twice} from "./twice.twill"; export const values = [1,2].map() { x in defer {} guard x > 1 else { return 0; } return twice(x); };',
  );
  writeFileSync(
    join(root, 'twice.twill'),
    'export function twice(value: number) { defer {} return value*2; }',
  );
  writeFileSync(
    join(root, 'branching.twill'),
    'type Result={kind:"ok";value:number}|{kind:"bad";error:string};export function describe(input:{result:Result}|null){guard const {result}=input else{return "empty";}return switch(result){case {kind:"ok",value}: value.toFixed();case {kind:"bad",error}: error;};}',
  );
  writeFileSync(
    join(root, 'enums.twill'),
    'export enum State<T>{case idle;case loaded(value:T);} export const state:State<number>=State.loaded(42);export function read(state:State<number>){return match(state){case State.idle(): 0;case State.loaded({value}): value;};}',
  );
  writeFileSync(
    join(root, 'if-bindings.twill'),
    'export function read(input:{value:number}|null){const value=7;if const {value}=input{return value.toFixed();}else{return value.toFixed();}}',
  );
  const optional = execFileSync(
    process.execPath,
    [
      '--import',
      '@swiftuijs/twill/register',
      '--input-type=module',
      '-e',
      'import {read} from "./if-bindings.twill";console.log(read({value:0}),read(null));',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(optional.trim(), '0 7');
  execFileSync(
    process.execPath,
    [resolve(base, '..', installed.bin.twill), 'check', '-p', 'tsconfig.json'],
    {
      cwd: root,
      stdio: 'pipe',
    },
  );
  const enumResult = execFileSync(
    process.execPath,
    [
      '--import',
      '@swiftuijs/twill/register',
      '--input-type=module',
      '-e',
      'import {State,state,read} from "./enums.twill";console.log(read(state),read(State.idle()))',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(enumResult.trim(), '42 0');
  const report = JSON.parse(
    execFileSync(
      process.execPath,
      [resolve(base, '..', installed.bin.twill), 'doctor', '-p', 'tsconfig.json', '--json'],
      { cwd: root, encoding: 'utf8' },
    ),
  );
  assert.equal(report.ok, true);
  assert.equal(report.twillVersion, metadata.version);
  const output = execFileSync(
    process.execPath,
    [
      '--enable-source-maps',
      '--import',
      '@swiftuijs/twill/register',
      '--input-type=module',
      '-e',
      'import {values} from "./main.twill"; console.log(JSON.stringify(values))',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(output.trim(), '[0,4]');
  const branchOutput = execFileSync(
    process.execPath,
    [
      '--import',
      '@swiftuijs/twill/register',
      '--input-type=module',
      '-e',
      'import {describe} from "./branching.twill";console.log(describe({result:{kind:"ok",value:3}}),describe(null))',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(branchOutput.trim(), '3 empty');
  writeFileSync(
    join(root, 'react-view.twillx'),
    `
    import {createElement, useState} from 'react';
    export let calls = 0;
    function Card(props: {children?: import('react').ReactNode}) {
      calls++; const [value] = useState(1);
      return createElement('article', null, value, props.children);
    }
    export const view = Card { 'hello'; };
  `,
  );
  writeFileSync(
    join(root, 'vue-view.twillx'),
    `
    import {defineComponent} from 'vue';
    export let calls = 0;
    const Panel = defineComponent({props:{title:String}});
    function child() { calls++; return 'hello'; }
    export const view = Panel({title:'Vue'}) { child(); } footer: { 'footer'; };
  `,
  );
  writeFileSync(
    join(root, 'ui-entry.js'),
    `
    import {view as react, calls as reactCalls} from './react-view.twillx';
    import {view as vue, calls as vueCalls} from './vue-view.twillx';
    console.log(JSON.stringify({reactCalls, vueCalls, children:react.props.children,
      slot:vue.children.default(), footer:vue.children.footer(), after:vueCalls}));
  `,
  );
  const ui = execFileSync(
    process.execPath,
    ['--import', '@swiftuijs/twill/register', 'ui-entry.js'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(ui), {
    reactCalls: 0,
    vueCalls: 0,
    children: 'hello',
    slot: 'hello',
    footer: 'footer',
    after: 1,
  });
  writeFileSync(
    join(root, 'ui-consumer.twill'),
    'import {view} from "./react-view.twillx"; import {view as panel} from "./vue-view.twillx"; export const views = [view, panel];',
  );
  execFileSync(
    process.execPath,
    [resolve(base, '..', installed.bin.twill), 'check', '-p', 'tsconfig.json'],
    {
      cwd: root,
      stdio: 'pipe',
    },
  );
  writeFileSync(
    join(root, 'state.ts'),
    'import {read} from "./cycle.twill"; export let count: number = 1; export function increment() { count++; } export const get = () => read();',
  );
  writeFileSync(
    join(root, 'cycle.twill'),
    'import {count} from "./state.ts"; export function read(): number { const run=(body:()=>number)=>body(); return run() { count }; }',
  );
  writeFileSync(join(root, 'bridge.js'), 'export {get, increment} from "./state.ts";');
  writeFileSync(
    join(root, 'entry.ts'),
    'import {get, increment} from "./bridge.js"; export const values: number[] = [get()]; increment(); values.push(get()); export const dynamic = (await import("./main.twill")).values;',
  );
  const interop = execFileSync(
    process.execPath,
    [
      '--enable-source-maps',
      '--import',
      pathToFileURL(join(base, 'register.js')).href,
      '--input-type=module',
      '-e',
      'import {values, dynamic} from "./entry.ts"; console.log(JSON.stringify({values, dynamic}))',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(interop), { values: [1, 2], dynamic: [0, 4] });
  mkdirSync(join(root, 'resources'));
  writeFileSync(
    join(root, 'resources/helper.ts'),
    `export async function work(events: string[]) {
    await using handle = { async [Symbol.asyncDispose]() { events.push('async'); } };
    events.push('body');
  }`,
  );
  writeFileSync(
    join(root, 'resources/main.twill'),
    `import {work} from './helper.ts';
    async function run() {
      const events: string[] = [];
      defer { events.push('defer'); }
      using handle = { [Symbol.dispose]() { events.push('sync'); } };
      await work(events); events.push('returned'); return events;
    }
    console.log(JSON.stringify(await run()));`,
  );
  const resources = execFileSync(
    process.execPath,
    ['--import', '@swiftuijs/twill/register', 'resources/main.twill'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.deepEqual(
    JSON.parse(resources),
    ['body', 'async', 'returned', 'sync', 'defer'],
    'Native TS resources and dialect cleanup must work on every supported Node consumer',
  );
  writeFileSync(
    join(root, 'thrower.ts'),
    'export function fail(): never {\n  const value: number = 1;\n  throw new Error("mapped native failure " + value);\n}\n',
  );
  writeFileSync(
    join(root, 'thrower.twill'),
    'import {fail} from "./thrower.ts"; const run=(body:()=>never)=>body(); run() { fail() };',
  );
  try {
    execFileSync(
      process.execPath,
      [
        '--enable-source-maps',
        '--import',
        pathToFileURL(join(base, 'register.js')).href,
        'thrower.twill',
      ],
      { cwd: root, stdio: 'pipe' },
    );
    assert.fail('Expected mapped native error');
  } catch (error) {
    assert.match(String(error.stderr), /thrower\.ts:3:/);
    assert.match(String(error.stderr), /thrower\.twill:1:/);
  }
  // Emit a library and consume it with ordinary TypeScript, outside the workspace.
  mkdirSync(join(root, 'library'));
  writeFileSync(join(root, 'library/main.twill'), 'export const doubled=[1,2,3].map { n in n*2 };');
  writeFileSync(
    join(root, 'library/tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        types: [],
      },
      include: ['main.twill'],
      exclude: ['dist'],
    }),
  );
  execFileSync(
    process.execPath,
    [resolve(base, '..', installed.bin.twill), 'declarations', '-p', 'library/tsconfig.json'],
    { cwd: root, stdio: 'pipe' },
  );
  writeFileSync(
    join(root, 'library/consumer.mts'),
    'import {doubled} from "./dist/main.js"; const result:number[]=doubled;',
  );
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--module',
      'nodenext',
      '--target',
      'es2022',
      'library/consumer.mts',
    ],
    { cwd: root, stdio: 'pipe' },
  );
  writeFileSync(join(root, 'bad.twill'), 'export const x: string = [1].map() { n in n*2 };');
  let status = 0;
  try {
    execFileSync(
      process.execPath,
      [resolve(base, '..', installed.bin.twill), 'check', '-p', 'tsconfig.json'],
      {
        cwd: root,
        stdio: 'pipe',
      },
    );
  } catch (error) {
    status = error.status;
  }
  assert.equal(status, 1, 'Type errors must cause a failing exit status');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [resolve(base, '..', installed.bin.twill), 'doctor', '-p', 'tsconfig.json', '--json'],
        { cwd: root, stdio: 'pipe' },
      ),
    (error) => {
      assert.equal(error.status, 1, 'doctor must fail for an invalid project');
      const report = JSON.parse(String(error.stdout));
      assert.equal(report.ok, false);
      assert(report.diagnostics.some((diagnostic) => diagnostic.filename.endsWith('bad.twill')));
      return true;
    },
  );
  // Inline compilation remains usable with no runtime installed. External
  // applications then install the independent production package explicitly.
  const consumerRequire = createRequire(join(root, 'package.json'));
  assert.throws(() => consumerRequire.resolve('@swiftuijs/twill-runtime/helpers/v1'), {
    code: 'MODULE_NOT_FOUND',
  });
  let runtimeArchive = resolve(`swiftuijs-twill-runtime-${metadata.version}.tgz`);
  if (!process.argv.includes('--packed')) {
    const packed = JSON.parse(
      execFileSync(
        'pnpm',
        ['--config.ignore-scripts=true', 'pack', '--json', '--pack-destination', root],
        { cwd: resolve('packages/runtime'), encoding: 'utf8', shell: process.platform === 'win32' },
      ),
    );
    runtimeArchive = resolve(root, packed.filename);
  }
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', runtimeArchive], {
    cwd: root,
    stdio: 'pipe',
  });
  writeFileSync(
    join(root, 'runtime.twill'),
    'export function run(events:number[]){if(true)defer {events.push(1);}defer {events.push(2);}return 3;}const events:number[]=[];console.log(JSON.stringify([run(events),events]));',
  );
  writeFileSync(join(root, 'twill.config.json'), '{"runtime":"external"}');
  const runtimeResult = execFileSync(
    process.execPath,
    ['--import', '@swiftuijs/twill/register', 'runtime.twill'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(runtimeResult), [3, [2, 1]]);
  const runtimeOutput = execFileSync(
    process.execPath,
    [resolve(base, '..', installed.bin.twill), 'compile', 'runtime.twill', '--js'],
    { cwd: root, encoding: 'utf8' },
  );
  assert(runtimeOutput.includes('@swiftuijs/twill-runtime/helpers/v1'));
  writeFileSync(join(root, 'runtime-output.mjs'), runtimeOutput);
  assert.deepEqual(
    JSON.parse(
      execFileSync(process.execPath, ['runtime-output.mjs'], { cwd: root, encoding: 'utf8' }),
    ),
    [3, [2, 1]],
  );
  // Keep the declared Vue 3.3 floor: a plain native tag does not normalize a
  // function child like a default-slot object in that runtime.
  npm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      'vue@3.3.0',
      '@vue/server-renderer@3.3.0',
    ],
    { cwd: root, stdio: 'pipe' },
  );
  writeFileSync(
    join(root, 'vue-minimum.twillx'),
    `/** @jsxImportSource vue */
import assert from 'node:assert/strict';
import {version,ref,h,defineComponent,createSSRApp} from 'vue';
import {renderToString} from '@vue/server-renderer';
assert.equal(version,'3.3.0');
const current=ref('first');
let reads=0;
function read(){reads++;return current.value;}
const Native='section';
const generated=Native { read(); };
assert.equal(reads,1);
const shorthand=<Native>{()=>read()}</Native>;
assert.equal(reads,1);
current.value='second';
assert.equal(await renderToString(createSSRApp({render:()=>generated})),'<section>first</section>');
assert.equal(await renderToString(createSSRApp({render:()=>shorthand})),'<section></section>');
assert.equal(reads,1);
const Panel=defineComponent({setup(_,{slots}){return()=>h('section',null,slots.default?.());}});
const lazy=Panel { read(); };
assert.equal(reads,1);
current.value='third';
assert.equal(await renderToString(createSSRApp({render:()=>lazy})),'<section>third</section>');
assert.equal(reads,2);
console.log('Vue 3.3 minimum: default-slot object preserves native tags and component lazy reads.');`,
  );
  const minimumVue = execFileSync(
    process.execPath,
    ['--import', '@swiftuijs/twill/register', 'vue-minimum.twillx'],
    { cwd: root, encoding: 'utf8' },
  );
  assert(minimumVue.includes('Vue 3.3 minimum'));
  console.log(minimumVue.trim());

  writeFileSync(join(root, 'twill.config.json'), '{"vueDefaultSlot":"function"}');
  writeFileSync(
    join(root, 'vue-function-slot.twillx'),
    `/** @jsxImportSource vue */
import assert from 'node:assert/strict';
import {version,ref,h,defineComponent,createSSRApp} from 'vue';
import {renderToString} from '@vue/server-renderer';
import {transform} from '@swiftuijs/twill';
assert.equal(version,'3.3.0');
assert(!transform('Panel { "child"; }',{
  filename:'slot.twillx',jsxImportSource:'vue',vueDefaultSlot:'function'
}).code.includes('default:'));
const current=ref('first');
let reads=0;
function read(){reads++;return current.value;}
const Panel=defineComponent({setup(_,{slots}){
  return()=>h('section',null,[...slots.default(),...(slots.footer?.()??[])]);
}});
const lazy=Panel { read(); };
const named=Panel { read(); } footer: { "footer"; };
assert.equal(reads,0);
current.value='second';
assert.equal(await renderToString(createSSRApp({render:()=>lazy})),'<section>second</section>');
assert.equal(await renderToString(createSSRApp({render:()=>named})),'<section>secondfooter</section>');
assert.equal(reads,2);
console.log('Vue 3.3 minimum: configured function slots and named-slot fallback passed.');`,
  );
  const functionVue = execFileSync(
    process.execPath,
    ['--import', '@swiftuijs/twill/register', 'vue-function-slot.twillx'],
    { cwd: root, encoding: 'utf8' },
  );
  assert(functionVue.includes('configured function slots'));
  console.log(functionVue.trim());

  console.log(
    'Independent package install, exports, CLI, optional runtime and Node loader passed.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
