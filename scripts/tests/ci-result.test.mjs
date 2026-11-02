import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificationFailures } from '../ci-result.mjs';

function result(core = true, shell = true) {
  return {
    changes: { result: 'success', outputs: { core: String(core), shell: String(shell) } },
    dependencies: { result: 'success' },
    ...Object.fromEntries(
      ['build', 'unit', 'integration', 'loader-node'].map((name) => [
        name,
        { result: core ? 'success' : 'skipped' },
      ]),
    ),
    docs: { result: core ? 'skipped' : 'success' },
    'shell-platforms': { result: shell ? 'success' : 'skipped' },
  };
}

test('accepts every supported scope without requiring unrelated platform jobs', () => {
  for (const [core, shell] of [
    [true, true],
    [true, false],
    [false, false],
  ])
    assert.deepEqual(verificationFailures(result(core, shell)), []);
});
test('rejects failures, cancellations, missing jobs and unexpected skips in every required job', () => {
  for (const name of Object.keys(result()).filter((name) => name !== 'docs'))
    for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
      const needs = result();
      if (status === undefined) delete needs[name];
      else needs[name].result = status;
      assert(verificationFailures(needs).length > 0, `${name}: ${status}`);
    }
  for (const name of ['docs', 'dependencies']) {
    const needs = result(false, false);
    needs[name].result = 'skipped';
    assert(verificationFailures(needs).length > 0);
  }
});
test('rejects missing or invalid scope outputs instead of treating them as docs-only changes', () => {
  for (const outputs of [
    undefined,
    {},
    { core: 'maybe', shell: 'false' },
    { core: 'false', shell: 'true' },
  ]) {
    const needs = result();
    needs.changes.outputs = outputs;
    assert(verificationFailures(needs).some((message) => message.startsWith('changes:')));
  }
});
test('additional validators are required by default rather than silently ignored', () => {
  for (const status of ['success', 'failure', 'cancelled', 'skipped']) {
    const needs = result();
    needs.additional = { result: status };
    assert.equal(verificationFailures(needs).length === 0, status === 'success');
  }
});
test('the actual gate CLI fails closed and writes a useful job summary', () => {
  const folder = mkdtempSync(join(tmpdir(), 'twill-ci-result-'));
  const script = fileURLToPath(new URL('../ci-result.mjs', import.meta.url));
  try {
    const summary = join(folder, 'summary.md');
    const needs = result();
    const options = {
      encoding: 'utf8',
      env: { ...process.env, TWILL_CI_NEEDS: JSON.stringify(needs), GITHUB_STEP_SUMMARY: summary },
    };
    assert.match(execFileSync(process.execPath, [script], options), /All checks required/);
    assert.match(readFileSync(summary, 'utf8'), /dependencies \| success/);
    needs.dependencies.result = 'failure';
    options.env.TWILL_CI_NEEDS = JSON.stringify(needs);
    const failed = spawnSync(process.execPath, [script], options);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /dependencies: expected success, received failure/);
    options.env.TWILL_CI_NEEDS = '{invalid';
    assert.equal(spawnSync(process.execPath, [script], options).status, 1);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
