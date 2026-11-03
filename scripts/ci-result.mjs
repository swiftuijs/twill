import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A skipped required job is a failure, even when another matrix or scope passed.
export function verificationFailures(needs) {
  const failures = [];
  const expected = { changes: 'success', dependencies: 'success' };
  const requireResult = (name, expected) => {
    const actual = needs[name]?.result ?? 'missing';
    if (actual !== expected) failures.push(`${name}: expected ${expected}, received ${actual}`);
  };
  const scope = needs.changes?.outputs;
  if (!['true', 'false'].includes(scope?.core) || !['true', 'false'].includes(scope?.shell))
    failures.push('changes: missing or invalid scope outputs');
  else {
    if (scope.shell === 'true' && scope.core !== 'true')
      failures.push('changes: platform checks require the core scope');
    for (const name of ['build', 'unit', 'integration'])
      expected[name] = scope.core === 'true' ? 'success' : 'skipped';
    expected.docs = scope.core === 'true' ? 'skipped' : 'success';
    expected['shell-platforms'] = scope.shell === 'true' ? 'success' : 'skipped';
  }
  // New validators are mandatory by default until an explicit scope is added.
  for (const name of new Set([...Object.keys(expected), ...Object.keys(needs)]))
    requireResult(name, expected[name] ?? 'success');
  return failures;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const needs = JSON.parse(process.env.TWILL_CI_NEEDS);
  const failures = verificationFailures(needs);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      '| Required check | Result |\n| --- | --- |\n' +
        Object.entries(needs)
          .map(([name, job]) => `| ${name} | ${job.result} |\n`)
          .join(''),
    );
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log('All checks required by the complete change scope passed.');
}
