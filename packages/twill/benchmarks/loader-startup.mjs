import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const baselineRef = process.argv[2] ?? '5a258030ef3876bfaec3a858134e8535d019dede';
const output = resolve(process.argv[3] ?? 'loader-startup.json');
const temporary = mkdtempSync(join(tmpdir(), 'twill-loader-startup-'));
const baseline = join(temporary, 'baseline');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const identities = (directory) =>
  Object.fromEntries(
    readdirSync(directory)
      .sort()
      .filter((name) => name.endsWith('.js'))
      .map((name) => [name, hash(readFileSync(join(directory, name)))]),
  );
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
let affinity;
try {
  if (process.platform === 'linux') {
    const allowed = readFileSync('/proc/self/status', 'utf8').match(
      /^Cpus_allowed_list:\s*(.*)$/m,
    )[1];
    affinity = allowed.split(/[,-]/)[0];
    execFileSync('taskset', ['-pc', affinity, String(process.pid)], { stdio: 'ignore' });
  }
  execFileSync('git', ['worktree', 'add', '--detach', baseline, baselineRef], {
    cwd: repository,
    stdio: 'ignore',
  });
  symlinkSync(join(repository, 'node_modules'), join(baseline, 'node_modules'), 'dir');
  symlinkSync(
    join(repository, 'packages/twill/node_modules'),
    join(baseline, 'packages/twill/node_modules'),
    'dir',
  );
  const vite = join(repository, 'packages/twill/node_modules/vite/bin/vite.js');
  execFileSync(process.execPath, [vite, 'build'], {
    cwd: join(baseline, 'packages/twill'),
    stdio: 'ignore',
  });
  const fixture = join(temporary, 'fixture');
  mkdirSync(fixture);
  writeFileSync(join(fixture, 'package.json'), '{"type":"module"}');
  const telemetry = `console.log(JSON.stringify({value,cpu:process.cpuUsage(),rss:process.memoryUsage().rss}));`;
  const single = join(fixture, 'single.twill');
  writeFileSync(single, 'const value: number = [1].map { n in n + 1 }[0];' + telemetry);
  const graph = join(fixture, 'graph.twill');
  let imports = '';
  for (let i = 0; i < 25; i++) {
    writeFileSync(
      join(fixture, `value-${i}.twill`),
      `export const value${i}: number = [${i}].map { n in n + 1 }[0];`,
    );
    imports += `import {value${i}} from './value-${i}.twill';\n`;
  }
  writeFileSync(
    graph,
    imports +
      'const value: number = ' +
      Array.from({ length: 25 }, (_, i) => 'value' + i).join('+') +
      ';' +
      telemetry,
  );
  const native = join(fixture, 'native.mjs');
  writeFileSync(native, 'const value=2;' + telemetry);
  const cli = {
    baseline: join(baseline, 'packages/twill/bin/twill.mjs'),
    candidate: join(repository, 'packages/twill/bin/twill.mjs'),
  };
  const measured = (file, variant, cache, enabled) => {
    const start = performance.now();
    const result = spawnSync(process.execPath, variant ? [cli[variant], file] : [file], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, TWILL_CACHE_DIR: cache, TWILL_CACHE: enabled ? '1' : '0' },
    });
    const wallMs = performance.now() - start;
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const observation = JSON.parse(result.stdout);
    assert.equal(observation.value, file === graph ? 325 : 2);
    return { wallMs, ...observation, stderr: result.stderr };
  };
  const cases = [];
  const nativeSamples = Array.from({ length: 9 }, () =>
    measured(native, undefined, join(temporary, 'native-cache'), false),
  );
  for (const [name, file] of [
    ['single', single],
    ['graph-25', graph],
  ]) {
    for (const mode of ['uncached', 'empty-cache', 'cache-hit']) {
      const warm = Object.fromEntries(
        ['baseline', 'candidate'].map((v) => [v, join(temporary, name + '-' + v + '-warm')]),
      );
      if (mode === 'cache-hit')
        for (const v of ['baseline', 'candidate']) measured(file, v, warm[v], true);
      const pairs = [];
      for (let pair = 0; pair < 9; pair++) {
        const record = {};
        const order = pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
        for (const v of order)
          record[v] = measured(
            file,
            v,
            mode === 'cache-hit'
              ? warm[v]
              : join(temporary, name + '-' + mode + '-' + v + '-' + pair),
            mode !== 'uncached',
          );
        pairs.push({ order, ...record, ratio: record.candidate.wallMs / record.baseline.wallMs });
      }
      cases.push({
        name,
        mode,
        sourceSha256: hash(readFileSync(file)),
        pairs,
        baselineMedianMs: median(pairs.map((p) => p.baseline.wallMs)),
        candidateMedianMs: median(pairs.map((p) => p.candidate.wallMs)),
        pairedMedianRatio: median(pairs.map((p) => p.ratio)),
      });
    }
  }
  const report = {
    baselineRef,
    head: git(['rev-parse', 'HEAD']),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    affinity,
    method:
      'Nine alternating pairs of fresh processes per workload; compiler builds precede timing; all samples retained. RSS is an end-of-script observation, not a peak.',
    baselineBuild: identities(join(baseline, 'packages/twill/dist')),
    candidateBuild: identities(join(repository, 'packages/twill/dist')),
    benchmarkSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    nativeSamples,
    cases,
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        output,
        node: process.version,
        affinity,
        results: cases.map(
          ({ name, mode, baselineMedianMs, candidateMedianMs, pairedMedianRatio }) => ({
            name,
            mode,
            baselineMedianMs,
            candidateMedianMs,
            pairedMedianRatio,
          }),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', baseline], {
    cwd: repository,
    stdio: 'ignore',
  });
  rmSync(temporary, { recursive: true, force: true });
}
