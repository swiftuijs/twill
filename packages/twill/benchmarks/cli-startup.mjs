import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const baselineIndex = process.argv.indexOf('--baseline-cli');
assert(
  baselineIndex !== -1,
  'Pass --baseline-cli <extracted v0.4.0 dist/cli.js> with its dependencies installed',
);
const entries = {
  before: resolve(process.argv[baselineIndex + 1]),
  after: resolve(root, 'packages/twill/dist/cli.js'),
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const identity = (file) => ({
  entrySHA256: hash(readFileSync(file)),
  buildSHA256: hash(
    readdirSync(dirname(file))
      .filter((name) => name.endsWith('.js'))
      .sort()
      .map((name) => name + '\0' + readFileSync(resolve(dirname(file), name), 'utf8'))
      .join('\0'),
  ),
});
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fixture = mkdtempSync(join(tmpdir(), 'twill-cli-benchmark-'));
const filename = join(fixture, 'main.twill');
const config = join(fixture, 'tsconfig.json');
const source =
  'export const values=[1,2].map { value in value*2 };export function label(input:string|null){guard const value=input else{return "empty";}return value;}';
writeFileSync(filename, source);
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      types: [],
    },
    include: ['*.twill'],
  }),
);
const results = [];
try {
  for (const args of [
    ['--help'],
    ['compile', '--help'],
    ['--unknown'],
    ['compile', filename, '-p', config],
    ['compile', filename, '-p', config, '--js'],
    ['check', '-p', config, '--json'],
  ]) {
    const run = (file) => {
      const code = `import(${JSON.stringify(pathToFileURL(file).href)}).then(({main})=>main(${JSON.stringify(args)})).then(code=>{process.exitCode=code}).catch(error=>{console.error(error.message);process.exitCode=1})`;
      const start = performance.now();
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.ifError(result.error);
      return {
        ms: performance.now() - start,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    };
    const expected = run(entries.before);
    const check = (result) => {
      assert.equal(result.status, expected.status);
      assert.equal(result.stdout, expected.stdout);
      assert.equal(result.stderr, expected.stderr);
    };
    check(run(entries.after));
    const samples = [];
    for (let i = 0; i < 11; i++) {
      const pair = {};
      for (const key of i % 2 ? ['after', 'before'] : ['before', 'after']) {
        const result = run(entries[key]);
        check(result);
        pair[key] = result.ms;
      }
      samples.push(pair);
    }
    results.push({
      args,
      expectedStatus: expected.status,
      outputSHA256: hash(expected.stdout + '\0' + expected.stderr),
      samples,
      beforeMedianMs: median(samples.map((pair) => pair.before)),
      afterMedianMs: median(samples.map((pair) => pair.after)),
      medianRatio: median(samples.map((pair) => pair.after / pair.before)),
    });
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
const report = {
  scope:
    'Fresh Node process wall time, imports and captured output. One paired warmup, eleven alternating paired samples per command. Compile/check workloads use one small standalone module, not a large project or application/script performance.',
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
  },
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  gitStatus: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  baseline: { ref: 'v0.4.0', ...identity(entries.before) },
  current: identity(entries.after),
  fixture: {
    sourceSHA256: hash(source),
    configSHA256: hash(
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          types: [],
        },
        include: ['*.twill'],
      }),
    ),
  },
  results,
};
const output = process.argv.indexOf('--output');
if (output !== -1) writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    results.map(({ args, beforeMedianMs, afterMedianMs, medianRatio }) => ({
      args,
      beforeMedianMs,
      afterMedianMs,
      medianRatio,
    })),
  ),
);
