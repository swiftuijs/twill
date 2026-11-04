import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const report = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const extension = report[resolve('src/extension.twill')];
const engine = report[resolve('src/typescript.twill')];
assert(engine, 'The host TypeScript loader must be included in source coverage');
assert.equal(engine.lines.pct, 100, 'The host TypeScript loader must execute completely');
assert(extension, 'The packaged extension must be present in the remapped coverage report');
assert(extension.lines.total >= 600, 'Coverage must include the complete extension source');
assert(extension.functions.total >= 20, 'Empty function coverage must not pass the gate');
assert(extension.branches.total >= 100, 'Empty branch coverage must not pass the gate');
console.log('Verified coverage of the shipped VSIX extension source, functions and branches.');
