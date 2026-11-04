import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import { transform } from '@swiftuijs/twill';

const root = new URL('../../../', import.meta.url);
const baseline = execFileSync('git', ['show', 'v0.4.0:packages/linter/src/positions.twill'], {
  cwd: root,
  encoding: 'utf8',
});
const current = readFileSync(new URL('../src/positions.twill', import.meta.url), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
function compile(source) {
  const generated = transform(source, { filename: 'positions.twill' }).code;
  const code = ts.transpileModule(generated, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  Function('exports', code)(exports);
  return { Class: exports.SourcePositions, sourceSHA256: hash(source), buildSHA256: hash(code) };
}
const before = compile(baseline),
  after = compile(current);
const workloads = {
  'no-newlines': 'x'.repeat(128 * 1024),
  'sparse-lf': ('const value = "' + 'x'.repeat(200) + '";\n').repeat(500),
  'dense-lf': 'x\n'.repeat(20000),
  'mixed-newlines': 'a\r\nb\rc\u2028d\u2029😀\n'.repeat(4000),
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const [name, text] of Object.entries(workloads)) {
  const run = (Class) => {
    const start = performance.now();
    let checksum = 0;
    for (let i = 0; i < 32; i++) {
      const positions = new Class(text);
      checksum += positions.mapPosition(text.length).line;
      checksum += positions.getLineAndCharacterOfPosition(text.length).line;
    }
    return { ms: performance.now() - start, checksum };
  };
  for (let i = 0; i < 3; i++) assert.equal(run(before.Class).checksum, run(after.Class).checksum);
  const samples = [];
  for (let i = 0; i < 11; i++) {
    const pair = {};
    for (const [key, implementation] of i % 2
      ? [
          ['after', after],
          ['before', before],
        ]
      : [
          ['before', before],
          ['after', after],
        ])
      pair[key] = run(implementation.Class);
    assert.equal(pair.before.checksum, pair.after.checksum);
    samples.push(pair);
  }
  results.push({
    name,
    bytes: Buffer.byteLength(text),
    samples,
    medianRatio: median(samples.map((pair) => pair.after.ms / pair.before.ms)),
  });
}
const report = {
  scope:
    'Line-index construction only; 32 objects/batch, three paired warmups, eleven alternating paired samples. Includes allocations and spontaneous GC. Not complete ESLint latency.',
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
  },
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  gitStatus: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  baseline: { ref: 'v0.4.0', sourceSHA256: before.sourceSHA256, buildSHA256: before.buildSHA256 },
  current: { sourceSHA256: after.sourceSHA256, buildSHA256: after.buildSHA256 },
  results,
};
const output = process.argv.indexOf('--output');
if (output !== -1) writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ name, medianRatio }) => ({ name, medianRatio }))));
