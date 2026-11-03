import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { transform } from '../dist/index.js';
import { transform as minify } from 'esbuild';

const cases = [
  {
    name: 'destructured-guard',
    input: [null, { value: 3 }, { value: 0 }],
    sugar: 'function run(input){guard const {value}=input else{return 0;} return value*2;}',
    native:
      'function run(input){const subject=input;if(subject===null||subject===void 0)return 0;const {value}=subject;return value*2;}',
  },
  {
    name: 'direct-value-switch',
    input: [0, 1, 2],
    sugar: 'function run(input){return switch(input){case 0: 3;case 1: 5;default: 7;};}',
    native:
      'function run(input){const subject=input;switch(subject){case 0:return 3;case 1:return 5;default:return 7;}}',
  },
  {
    name: 'expression-value-switch',
    input: [0, 1, 2],
    sugar:
      'function run(input){const value=switch(input){case 0: 3;case 1: 5;default: 7;};return value*2;}',
    native:
      'function run(input){let value;switch(input){case 0:value=3;break;case 1:value=5;break;default:value=7;}return value*2;}',
  },
];
const iterations = 1_000_000,
  samples = 15;
function execute(fn, inputs) {
  let checksum = 0;
  for (let i = 0; i < iterations; i++) checksum += fn(inputs[i % inputs.length]);
  return checksum;
}
function measure(fn, inputs) {
  for (let i = 0; i < 5; i++) execute(fn, inputs);
  const timings = [];
  let checksum;
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    checksum = execute(fn, inputs);
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return { medianMs: timings[7], p95Ms: timings[14], checksum };
}
const worker = process.argv.indexOf('--worker');
if (worker >= 0) {
  const item = cases[Number(process.argv[worker + 1])];
  const code =
    process.argv[worker + 2] === 'dialect'
      ? transform(item.sugar, { language: 'js' }).code
      : item.native;
  console.log(JSON.stringify(measure(Function(code + ';return run;')(), item.input)));
  process.exit(0);
}
const results = [];
for (const [index, item] of cases.entries()) {
  const generated = transform(item.sugar, { language: 'js' }).code;
  const compiled = await minify(generated, { minify: true });
  const nativeCompiled = await minify(item.native, { minify: true });
  const fn = Function(generated + ';return run;')(),
    nativeFn = Function(item.native + ';return run;')();
  for (const input of item.input) assert.deepEqual(fn(input), nativeFn(input));
  // Separate processes prevent the first function's monomorphic call site
  // from biasing the next function's baseline through shared V8 feedback.
  const isolated = (variant) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), '--worker', String(index), variant],
        { encoding: 'utf8' },
      ),
    );
  const dialect = isolated('dialect'),
    native = isolated('native');
  assert.equal(dialect.checksum, native.checksum);
  results.push({
    name: item.name,
    bytes: Buffer.byteLength(compiled.code),
    nativeBytes: Buffer.byteLength(nativeCompiled.code),
    dialect,
    native,
    ratio: dialect.medianMs / native.medianMs,
    extraIIFE: item.name === 'expression-value-switch',
  });
}
const report = {
  node: process.version,
  cpu: cpus()[0]?.model,
  packageVersion: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version,
  iterations,
  samples,
  scope:
    'Warmed isolated-process V8 microbenchmarks; expression switch compares native local assignment. JIT inlining can hide the extra IIFE. These are not application or cross-engine guarantees.',
  results,
};
const output = process.argv.indexOf('--output');
if (output >= 0) writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
