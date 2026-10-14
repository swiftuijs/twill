import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  chmodSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, delimiter, dirname } from 'node:path';
import { npmConsumer as npm } from './helpers/npm-consumer.mjs';
import { verifyLoader } from './loader-consumer.mjs';

const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const archive = resolve(import.meta.dirname, `../../../swiftuijs-twill-${version}.tgz`);
const root = mkdtempSync(join(tmpdir(), 'twill-runner-consumer-'));
try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], {
    cwd: root,
    stdio: 'pipe',
  });
  const cli = join(root, 'node_modules/@swiftuijs/twill/bin/twill.mjs');
  verifyLoader(root, cli, join(root, 'node_modules/@swiftuijs/twill/dist/register.js'));
  const cache = join(root, 'private-cache');
  process.env.TWILL_CACHE_DIR = cache;
  delete process.env.TWILL_CACHE;
  const app = join(root, 'app with spaces');
  mkdirSync(app);
  const file = join(app, 'deploy');
  writeFileSync(
    file,
    `#!/usr/bin/env twill
import {readFileSync} from 'node:fs';
import {values} from './values.ts';
guard const first=process.argv[2] else { throw new Error('missing argument'); }
console.error('stderr');
console.log(JSON.stringify({args:process.argv.slice(2),values,pid:process.pid,cwd:process.cwd(),input:readFileSync(0,'utf8')}));`,
  );
  writeFileSync(join(app, 'values.ts'), 'export const values: number[] = [1,2].map(n=>n*2);');
  const args = ['--help', '-p', '--runtime', '--', '', 'a b', '中文;$(literal)', 'line\nbreak'];
  for (const prefix of [[], ['run']]) {
    const result = spawnSync(process.execPath, [cli, ...prefix, file, ...args], {
      cwd: root,
      encoding: 'utf8',
      input: 'stdin',
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, 'stderr\n');
    assert.deepEqual(JSON.parse(result.stdout), {
      args,
      values: [2, 4],
      pid: result.pid,
      cwd: realpathSync(root),
      input: 'stdin',
    });
  }
  const cacheFiles = () =>
    readdirSync(cache)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(cache, name));
  // A single-module probe guarantees a hit even when the mixed app's fixed slots collide.
  const hitFile = join(app, 'cache-hit');
  writeFileSync(hitFile, 'console.log("cache-hit");');
  const prime = spawnSync(process.execPath, [cli, hitFile], { cwd: root, encoding: 'utf8' });
  assert.equal(prime.status, 0, prime.stderr);
  const before = cacheFiles().map((path) => [path, statSync(path).mtimeMs]);
  const cached = spawnSync(process.execPath, [cli, hitFile], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(cached.status, 0, cached.stderr);
  assert.equal(cached.stdout.trim(), 'cache-hit');
  assert.deepEqual(
    before.map(([path]) => [path, statSync(path).mtimeMs]),
    before,
  );
  assert(cacheFiles().length > 0, 'Installed runner must write a private cache');
  const helper = join(app, 'values.ts');
  const helperTime = statSync(helper);
  writeFileSync(helper, 'export const values: number[] = [3,4].map(n=>n*2);');
  utimesSync(helper, helperTime.atime, helperTime.mtime);
  const changed = spawnSync(process.execPath, [cli, file, ...args], {
    cwd: root,
    encoding: 'utf8',
    input: 'stdin',
  });
  assert.equal(changed.status, 0, changed.stderr);
  assert.deepEqual(JSON.parse(changed.stdout).values, [6, 8]);
  writeFileSync(helper, 'export const values: number[] = [1,2].map(n=>n*2);');
  for (const path of cacheFiles()) writeFileSync(path, '{');
  const recovered = spawnSync(process.execPath, [cli, file, ...args], {
    cwd: root,
    encoding: 'utf8',
    input: 'stdin',
  });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(JSON.parse(recovered.stdout).values, [2, 4]);
  if (process.platform !== 'win32') {
    chmodSync(file, 0o755);
    const result = spawnSync(file, args, {
      cwd: root,
      encoding: 'utf8',
      input: 'stdin',
      timeout: 15000,
      env: {
        ...process.env,
        PATH:
          join(root, 'node_modules/.bin') +
          delimiter +
          dirname(process.execPath) +
          delimiter +
          process.env.PATH,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).args, args);
    const link = join(root, 'linked-deploy');
    symlinkSync(file, link);
    writeFileSync(join(root, 'values.ts'), 'export const values: number[] = [5,6].map(n=>n*2);');
    for (const flags of [[], ['--preserve-symlinks']]) {
      const result = spawnSync(process.execPath, [...flags, cli, link, ...args], {
        cwd: root,
        encoding: 'utf8',
        input: 'stdin',
        timeout: 15000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).args, args);
      assert.deepEqual(JSON.parse(result.stdout).values, flags.length ? [10, 12] : [2, 4]);
    }
  }
  writeFileSync(join(app, 'exit.twill'), 'process.exitCode=23;');
  assert.equal(
    spawnSync(process.execPath, [cli, join(app, 'exit.twill')], { cwd: root }).status,
    23,
  );
  const failed = join(app, 'failure.twill');
  writeFileSync(
    failed,
    '#!/usr/bin/env twill\nconst values=[1].map { .toFixed(); };\nthrow new Error("original failure");',
  );
  const result = spawnSync(process.execPath, [cli, failed], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert(result.stderr.includes('failure.twill:3:'));
  const help = execFileSync(process.execPath, [cli, '--help'], { cwd: root, encoding: 'utf8' });
  assert(help.includes('twill compile') && help.includes('twill run'));
  console.log(
    `Installed runner on ${process.version}/${process.platform}: direct/explicit argv, extensionless entry, mixed TS, native I/O/PID/cwd, exit status, source maps, cache hits/content invalidation/corruption recovery and POSIX shebang verified.`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
