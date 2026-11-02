import { afterEach, expect, it } from 'vitest';
import { fixtureRoot } from './helpers/fixture.js';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cli = fileURLToPath(new URL('../bin/twill.mjs', import.meta.url));
const register = fileURLToPath(new URL('../dist/register.js', import.meta.url));
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture(source: string, name = 'main.twill') {
  const root = mkdtempSync(join(tmpdir(), 'twill-runner-cache-'));
  roots.push(root);
  const file = join(root, name);
  const cache = join(root, 'cache');
  writeFileSync(file, source);
  return { root, file, cache };
}
function execute(file: string, cache: string, enabled = '1', flags: string[] = []) {
  return spawnSync(process.execPath, [...flags, cli, file, '--help', 'a b'], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, TWILL_CACHE_DIR: cache, TWILL_CACHE: enabled },
  });
}
function records(cache: string) {
  return readdirSync(cache)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const path = join(cache, f);
      return { path, ...JSON.parse(readFileSync(path, 'utf8')) };
    });
}
it.each(['main.twill', 'deploy'])(
  'preserves arguments and emitted bytes on a fresh-interpreter cache hit: %s',
  (name) => {
    const { file, cache } = fixture(
      '#!/usr/bin/env twill\nconsole.log(JSON.stringify({args:process.argv.slice(2),value:[1].map { .toFixed(); }}));',
      name,
    );
    const first = execute(file, cache);
    expect(first.status, first.stderr).toBe(0);
    const before = records(cache);
    expect(before).toHaveLength(1);
    const times = before.map((r) => statSync(r.path).mtimeMs);
    const second = execute(file, cache);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(records(cache).map((r) => r.source)).toEqual(before.map((r) => r.source));
    expect(before.map((r) => statSync(r.path).mtimeMs)).toEqual(times);
    expect(JSON.parse(second.stdout)).toEqual({ args: ['--help', 'a b'], value: ['1'] });
  },
);
it('invalidates the changed imported module even when its timestamp and size are preserved', () => {
  const { root, file, cache } = fixture('import {value} from "./helper.ts";console.log(value);');
  const helper = join(root, 'helper.ts');
  writeFileSync(helper, 'export const value: number = 1;');
  expect(execute(file, cache).stdout.trim()).toBe('1');
  expect(execute(file, cache).stdout.trim()).toBe('1');
  const time = statSync(helper);
  writeFileSync(helper, 'export const value: number = 2;');
  utimesSync(helper, time.atime, time.mtime);
  expect(execute(file, cache).stdout.trim()).toBe('2');
  writeFileSync(helper, 'export const value: number = ;');
  const invalid = execute(file, cache);
  expect(invalid.status).toBe(1);
  expect(invalid.stdout).toBe('');
});
it('invalidates nearest config creation, content, deletion and malformed configuration', () => {
  const { root, file, cache } = fixture('console.log(JSON.stringify([1].map { 7; }));');
  expect(execute(file, cache).stdout.trim()).toBe('[7]');
  const config = join(root, 'twill.config.json');
  writeFileSync(config, '{"implicitReturn":false}');
  expect(execute(file, cache).stdout.trim()).toBe('[null]');
  expect(execute(file, cache).stdout.trim()).toBe('[null]');
  const time = statSync(config);
  writeFileSync(config, '{"implicitReturn":true }');
  utimesSync(config, time.atime, time.mtime);
  expect(execute(file, cache).stdout.trim()).toBe('[7]');
  writeFileSync(config, '{"unknown":true}');
  expect(execute(file, cache).stderr).toContain('unknown option unknown');
  rmSync(config);
  expect(execute(file, cache).stdout.trim()).toBe('[7]');
});
it('invalidates inherited JSX configuration through package-based extends', () => {
  const { root, file, cache } = fixture('import {view} from "./view.tsx"; console.log(view);');
  writeFileSync(join(root, 'view.tsx'), 'export const view = <div/>;');
  const pkg = join(root, 'node_modules', 'config-base');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), '{"name":"config-base","tsconfig":"base.json"}');
  const config = join(pkg, 'base.json');
  writeFileSync(join(root, 'tsconfig.json'), '{"extends":"config-base"}');
  for (const name of ['jsx-one', 'jsx-two']) {
    const runtime = join(root, 'node_modules', name);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(
      join(runtime, 'package.json'),
      '{"type":"module","exports":{"./jsx-runtime":"./runtime.js"}}',
    );
    writeFileSync(join(runtime, 'runtime.js'), `export const jsx=()=>${JSON.stringify(name)};`);
  }
  writeFileSync(config, '{"compilerOptions":{"jsxImportSource":"jsx-one"}}');
  expect(execute(file, cache).stdout.trim()).toBe('jsx-one');
  expect(execute(file, cache).stdout.trim()).toBe('jsx-one');
  const time = statSync(config);
  writeFileSync(config, '{"compilerOptions":{"jsxImportSource":"jsx-two"}}');
  utimesSync(config, time.atime, time.mtime);
  expect(execute(file, cache).stdout.trim()).toBe('jsx-two');
});
it('keeps original exception positions and exit status identical on hits', () => {
  const { file, cache } = fixture(
    '#!/usr/bin/env twill\nconst value = [1].map { .toFixed(); };\nthrow new Error("original failure");',
  );
  for (let i = 0; i < 2; i++) {
    const result = execute(file, cache);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('original failure');
    expect(result.stderr.replaceAll('\\', '/')).toContain(file.replaceAll('\\', '/') + ':3:');
  }
  writeFileSync(file, 'process.exitCode=23;');
  expect(execute(file, cache).status).toBe(23);
  expect(execute(file, cache).status).toBe(23);
});
it('recovers from corrupt entries and leaves source/program output unchanged', () => {
  const { file, cache } = fixture('console.log([1].map { n in n+1 });');
  expect(execute(file, cache).status).toBe(0);
  for (const { path } of records(cache)) writeFileSync(path, '{"source":"corrupt"');
  expect(execute(file, cache).stdout.trim()).toBe('[ 2 ]');
  expect(records(cache)).toHaveLength(1);
});
it('executes without caching when disabled or inaccessible and keeps advanced registration uncached', () => {
  const { root, file, cache } = fixture('console.log("value");');
  expect(execute(file, cache, '0').stdout.trim()).toBe('value');
  expect(() => readdirSync(cache)).toThrow();
  const blocked = join(root, 'blocked');
  writeFileSync(blocked, 'file');
  expect(execute(file, join(blocked, 'cache')).stdout.trim()).toBe('value');
  const advanced = spawnSync(process.execPath, ['--import', pathToFileURL(register).href, file], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, TWILL_CACHE_DIR: cache },
  });
  expect(advanced.status, advanced.stderr).toBe(0);
  expect(() => readdirSync(cache)).toThrow();
});
it.skipIf(process.platform === 'win32')(
  'falls back from a public cache directory without changing its permissions',
  () => {
    const { file, cache } = fixture('console.log("value");');
    mkdirSync(cache, { mode: 0o755 });
    chmodSync(cache, 0o755);
    expect(execute(file, cache).stdout.trim()).toBe('value');
    expect(readdirSync(cache)).toEqual([]);
    expect(statSync(cache).mode & 0o777).toBe(0o755);
    chmodSync(cache, 0o700);
  },
);
it('settles concurrent fresh launches with complete atomic cache records', async () => {
  const { file, cache } = fixture('console.log([1,2].map { n in n*2 });');
  await Promise.all(
    Array.from(
      { length: 4 },
      () =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [cli, file], {
            env: { ...process.env, TWILL_CACHE_DIR: cache },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let output = '';
          let error = '';
          child.stdout.on('data', (data) => {
            output += data;
          });
          child.stderr.on('data', (data) => {
            error += data;
          });
          child.once('error', reject);
          child.once('close', (status) => {
            try {
              expect(status, error).toBe(0);
              expect(output.trim()).toBe('[ 2, 4 ]');
              resolve();
            } catch (failure) {
              reject(failure);
            }
          });
        }),
    ),
  );
  expect(records(cache)).toHaveLength(1);
  expect(readdirSync(cache).every((f) => f.endsWith('.json'))).toBe(true);
  expect(execute(file, cache).stdout.trim()).toBe('[ 2, 4 ]');
});

it('keeps query/fragment module identities and executes imports anew on every cached launch', () => {
  const { root, file, cache } = fixture(
    'import {value as one} from "./query.twill?one#part"; import {value as two} from "./query.twill?two#part"; console.log(JSON.stringify([one,two]));',
  );
  writeFileSync(
    join(root, 'query.twill'),
    'globalThis.count=(globalThis.count ?? 0)+1;export const value={count:globalThis.count,url:import.meta.url};',
  );
  for (let i = 0; i < 2; i++) {
    const result = execute(file, cache);
    expect(result.status, result.stderr).toBe(0);
    const values = JSON.parse(result.stdout);
    expect(values.map((v: { count: number }) => v.count)).toEqual([1, 2]);
    expect(values[0].url).toContain('query.twill?one#part');
    expect(values[1].url).toContain('query.twill?two#part');
  }
});
it('executes modules larger than a cache slot without storing their emitted source', () => {
  const { file, cache } = fixture(
    'console.log("large module");\n/*' + 'x'.repeat(256 * 1024) + '*/',
  );
  for (let i = 0; i < 2; i++) {
    const result = execute(file, cache);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('large module');
    expect(records(cache)).toEqual([]);
  }
});

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'reports new unreadable Twill configuration instead of reusing an absent-config hit',
  () => {
    const { root, file, cache } = fixture('console.log(JSON.stringify([1].map { 7; }));');
    expect(execute(file, cache).stdout.trim()).toBe('[7]');
    const config = join(root, 'twill.config.json');
    writeFileSync(config, '{"implicitReturn":false}');
    chmodSync(config, 0o000);
    try {
      for (const enabled of ['1', '0']) {
        const result = execute(file, cache, enabled);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('EACCES');
        expect(result.stdout).toBe('');
      }
    } finally {
      chmodSync(config, 0o600);
    }
    expect(execute(file, cache).stdout.trim()).toBe('[null]');
  },
);

it('invalidates cached Vue slot emission after same-timestamp configuration changes', () => {
  const root = fixtureRoot('twill-vue-slot-cache-');
  roots.push(root);
  const file = join(root, 'main.twillx');
  const cache = join(root, 'cache');
  const config = join(root, 'twill.config.json');
  writeFileSync(
    file,
    `/** @jsxImportSource vue */
import {defineComponent,h,createSSRApp} from 'vue';
import {renderToString} from '@vue/server-renderer';
const Panel=defineComponent({setup(_,{slots}){return()=>h('section',null,slots.default?.());}});
const view=Panel { <button>Save</button>; };
console.log(await renderToString(createSSRApp({render:()=>view})));`,
  );
  writeFileSync(config, '{"vueDefaultSlot":"object"}');
  for (const vueDefaultSlot of ['object', 'function', 'object']) {
    const time = statSync(config);
    writeFileSync(config, JSON.stringify({ vueDefaultSlot }));
    utimesSync(config, time.atime, time.mtime);
    for (let run = 0; run < 2; run++) {
      const result = execute(file, cache);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('<section><button>Save</button></section>');
      const [record] = records(cache);
      expect(records(cache)).toHaveLength(1);
      expect(/default:\s*\(\)\s*=>/.test(record.source)).toBe(vueDefaultSlot === 'object');
    }
  }
});
