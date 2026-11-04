import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  renameSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { npmConsumer as npm } from '../../twill/tests/helpers/npm-consumer.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const root = mkdtempSync(join(tmpdir(), 'twill-export-consumer-'));
const run = (args) =>
  execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      ...['twill', 'twill-formatter', 'twill-export'].map((name) =>
        resolve(repository, `swiftuijs-${name}-${version}.tgz`),
      ),
    ],
    { cwd: root, stdio: 'pipe' },
  );
  mkdirSync(join(root, 'source'));
  writeFileSync(
    join(root, 'source/tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        types: [],
      },
      include: ['**/*'],
    }),
  );
  const source =
    'export const doubled=[1,2,3].map { n in n*2 };export enum State{case loaded(value:number);}export function read(input:State){return match(input){case State.loaded({value}):value;};}';
  writeFileSync(join(root, 'source/values.twill'), source);
  writeFileSync(
    join(root, 'source/main.ts'),
    'import {doubled} from "./values.twill"; export const result:number[]=doubled;',
  );
  const command = [
    'node_modules/@swiftuijs/twill/bin/twill.mjs',
    'export',
    '-p',
    'source/tsconfig.json',
    '-o',
    'native',
    '--json',
  ];
  const help = run([command[0], 'export', '--help']);
  assert(help.includes('twill export'));
  const hiddenDependencies = ['typescript', 'acorn', 'prettier'].map((name) =>
    join(root, 'node_modules', name),
  );
  for (const path of hiddenDependencies) renameSync(path, path + '.unavailable');
  try {
    assert(run([command[0], 'export', '--help']).includes('twill export'));
  } finally {
    for (const path of hiddenDependencies) renameSync(path + '.unavailable', path);
  }
  const exporterMetadata = JSON.parse(
    readFileSync(join(root, 'node_modules/@swiftuijs/twill-export/package.json'), 'utf8'),
  );
  assert.equal(exporterMetadata.bin, undefined, 'Export must not install a separate command');
  const preview = JSON.parse(run([...command, '--dry-run']));
  assert.equal(preview.written, false);
  assert(!existsSync(join(root, 'native')));
  const exported = JSON.parse(run(command));
  assert.equal(exported.written, true);
  assert(readFileSync(join(root, 'native/main.ts'), 'utf8').includes('./values.ts'));
  run(['node_modules/typescript/bin/tsc', '-p', 'native/tsconfig.json']);
  // Compile the exported module and execute it without Twill hooks or plugins.
  run([
    'node_modules/typescript/bin/tsc',
    '--target',
    'es2022',
    '--module',
    'esnext',
    '--outDir',
    'native-js',
    'native/values.ts',
  ]);
  const values = run([
    '--input-type=module',
    '-e',
    'import {doubled,State,read} from "./native-js/values.js";if(read(State.loaded(42))!==42)throw new Error("pattern export");console.log(JSON.stringify(doubled));',
  ]);
  assert.deepEqual(JSON.parse(values), [2, 4, 6]);
  assert.equal(readFileSync(join(root, 'source/values.twill'), 'utf8'), source);
  assert.throws(
    () => run(command),
    (error) => error.status === 1,
  );
  writeFileSync(
    join(root, 'consumer.mts'),
    'import {exportProject} from "@swiftuijs/twill-export";import type {ExportOptions,ExportResult} from "@swiftuijs/twill-export";void exportProject;const options:ExportOptions={outDir:"native"};void options;type Result=ExportResult;',
  );
  run([
    'node_modules/typescript/bin/tsc',
    '--noEmit',
    '--module',
    'nodenext',
    '--target',
    'es2022',
    'consumer.mts',
  ]);
  console.log(
    'Independent npm consumer: export CLI/API, dry-run, native tsc checking and Node execution without Twill passed.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
