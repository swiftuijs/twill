import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as nodeModule from 'node:module';

export function verifyLoader(root, cli, register) {
  const app = join(root, 'loader graph # 中文');
  mkdirSync(app);
  const cache = join(root, 'loader-cache');
  const invoke = (flags, script, env = {}) => {
    const result = spawnSync(process.execPath, ['--throw-deprecation', ...flags, script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, TWILL_CACHE: '1', TWILL_CACHE_DIR: cache, ...env },
    });
    assert.ifError(result.error);
    return result;
  };
  const run = (script, mode = 'cli') =>
    invoke(
      mode === 'cli'
        ? [cli, 'run']
        : ['--enable-source-maps', '--import', pathToFileURL(register).href],
      script,
    );
  const check = (result, expected, label = 'loader') => {
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.equal(result.stderr, '', 'Runner must not emit Node deprecation warnings');
    assert.deepEqual(JSON.parse(result.stdout), expected);
  };

  writeFileSync(join(app, 'native.cjs'), 'exports.value=40;');
  writeFileSync(join(app, 'values.ts'), 'export const value: number = 2;');
  const graph = join(app, 'graph.twill');
  writeFileSync(
    graph,
    `
import {createRequire} from 'node:module';
import {value} from './values';
const native=createRequire(import.meta.url)('./native.cjs');
console.log(JSON.stringify([native.value,value,[1].map { n in n + 1 }]));`,
  );
  for (const mode of ['cli', 'preload']) check(run(graph, mode), [40, 2, [2]]);

  const cached = join(app, 'cached.twill');
  writeFileSync(
    cached,
    `
import {createRequire} from 'node:module';
const value: number = [1].map { n in n + 1 }[0];
console.log(JSON.stringify({value, compilerLoaded:Object.keys(createRequire(import.meta.url).cache).some(path=>/[/\\\\]typescript[/\\\\]/.test(path))}));`,
  );
  const cold = run(cached);
  assert.equal(cold.status, 0, cold.stderr);
  assert.equal(cold.stderr, '');
  assert.equal(JSON.parse(cold.stdout).value, 2);
  const before = readdirSync(cache)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const file = join(cache, name);
      return [file, statSync(file).mtimeMs, readFileSync(file, 'utf8')];
    });
  const hit = run(cached);
  assert.equal(hit.status, 0, hit.stderr);
  assert.equal(hit.stderr, '');
  assert.deepEqual(JSON.parse(hit.stdout), { value: 2, compilerLoaded: false });
  for (const [file, time, bytes] of before) {
    assert.equal(statSync(file).mtimeMs, time);
    assert.equal(readFileSync(file, 'utf8'), bytes);
  }
  if (typeof nodeModule.registerHooks === 'function')
    assert.equal(
      JSON.parse(cold.stdout).compilerLoaded,
      true,
      'A miss must actually load the compiler',
    );
  const nativeEntry = join(app, 'native.mjs');
  writeFileSync(
    nativeEntry,
    `import {createRequire} from 'node:module';console.log(JSON.stringify(Object.keys(createRequire(import.meta.url).cache).some(path=>/[/\\\\]typescript[/\\\\]/.test(path))));`,
  );
  check(run(nativeEntry), false);

  const worker = join(app, 'worker.mjs');
  writeFileSync(worker, 'import "./task.twill";');
  writeFileSync(
    join(app, 'task.twill'),
    `
import {parentPort,workerData,Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {value} from './values.ts';
guard const port = parentPort else { throw new Error('missing parent'); }
if (workerData?.nested) {
  const child = new Worker(new URL('./worker.mjs',import.meta.url));
  const closed=once(child,'exit');
  const [result]=await once(child,'message');
  await closed;
  port.postMessage(result+1);
} else {
  port.postMessage([20].map { n in n*2 }[0]+value);
}`,
  );
  const parent = join(app, 'parent.twill');
  const workerFlags = ['--enable-source-maps', '--import', pathToFileURL(register).href];
  for (const [mode, options, expected] of [
    ['cli', JSON.stringify({ execArgv: workerFlags }), 42],
    ['cli', JSON.stringify({ execArgv: workerFlags, workerData: { nested: true } }), 43],
    ['preload', '{}', 42],
    ['preload', '{workerData:{nested:true}}', 43],
  ]) {
    writeFileSync(
      parent,
      `import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
const worker=new Worker(new URL('./worker.mjs',import.meta.url),${options});
const closed=once(worker,'exit');
const [value]=await once(worker,'message');
await closed; console.log(JSON.stringify(value));`,
    );
    check(run(parent, mode), expected, `${mode} Worker ${options}`);
  }
  writeFileSync(
    parent,
    `import {Worker} from 'node:worker_threads';
const worker=new Worker(new URL('./worker.mjs',import.meta.url));
worker.once('error',error=>{console.error(error.message);process.exitCode=1;});`,
  );
  const unregistered = run(parent);
  assert.equal(unregistered.status, 1);
  assert(unregistered.stderr.includes('task.twill'));

  writeFileSync(
    join(app, 'failure.twill'),
    'const value=[1].map { n in n+1 };\nthrow new Error("original source failure");',
  );
  const failure = run(join(app, 'failure.twill'));
  assert.equal(failure.status, 1);
  assert(failure.stderr.replaceAll('\\', '/').includes('failure.twill:2:'));

  writeFileSync(join(app, 'worker-error.mjs'), 'import "./worker-failure.twill";');
  writeFileSync(
    join(app, 'worker-failure.twill'),
    'const value=[1].map { n in n+1 };\nthrow new Error("worker source failure");',
  );
  for (const mode of ['cli', 'preload']) {
    const options = mode === 'cli' ? JSON.stringify({ execArgv: workerFlags }) : '{}';
    writeFileSync(
      parent,
      `import {Worker} from 'node:worker_threads';
const worker=new Worker(new URL('./worker-error.mjs',import.meta.url),${options});
worker.once('error',error=>console.log(JSON.stringify(error.stack)));`,
    );
    const result = run(parent, mode);
    assert.equal(result.status, 0, result.stderr);
    assert(JSON.parse(result.stdout).replaceAll('\\', '/').includes('worker-failure.twill:2:'));
  }
  console.log(
    `Loader on ${process.version}: deprecation-free CLI/preload, mixed ESM/CJS delegation, lazy cached compiler, default/nested/explicit Workers and original error positions verified.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = mkdtempSync(join(tmpdir(), 'twill-loader-consumer-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    verifyLoader(
      root,
      fileURLToPath(new URL('../bin/twill.mjs', import.meta.url)),
      fileURLToPath(new URL('../dist/register.js', import.meta.url)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
