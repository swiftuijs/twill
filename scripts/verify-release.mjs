import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readSkill } from '../skills/skill.mjs';

const manifest = (path) => JSON.parse(readFileSync(path, 'utf8'));
const version = manifest('package.json').version;
readSkill();
assert.match(version, /^\d+\.\d+\.\d+$/, 'Release versions must use a complete semver');
for (const path of [
  'packages/twill/package.json',
  'packages/formatter/package.json',
  'packages/linter/package.json',
  'packages/export/package.json',
  'packages/highlight/package.json',
  'packages/runtime/package.json',
  'packages/shell/package.json',
  'editors/vscode/package.json',
])
  assert.equal(manifest(path).version, version, `Version mismatch: ${path}`);
assert(
  readFileSync('CHANGELOG.md', 'utf8').includes(`\n## ${version}\n`),
  'Missing changelog entry',
);
if (process.env.RELEASE_TAG)
  assert.equal(process.env.RELEASE_TAG, `v${version}`, 'Tag must match package versions');
for (const path of ['package.json', 'apps/docs/package.json', 'editors/vscode/package.json'])
  assert.equal(manifest(path).private, true, `Internal workspace must be private: ${path}`);
const artifacts = [];
const budgets = {
  twill: 650 * 1024,
  formatter: 24 * 1024,
  linter: 24 * 1024,
  export: 28 * 1024,
  highlight: 24 * 1024,
  runtime: 8 * 1024,
  shell: 16 * 1024,
};
for (const name of ['twill', 'formatter', 'linter', 'export', 'highlight', 'runtime', 'shell']) {
  const pkg = manifest(`packages/${name}/package.json`);
  assert(!pkg.private && pkg.publishConfig.access === 'public', `Publication metadata: ${name}`);
  assert(pkg.repository.url.includes('swiftuijs/twill'), `Repository metadata: ${name}`);
  if (process.argv.includes('--artifacts')) {
    const archive = `swiftuijs-${name === 'twill' ? name : 'twill-' + name}-${version}.tgz`;
    assert(existsSync(archive), `Missing ${name} archive`);
    const bytes = statSync(archive).size;
    assert(
      bytes <= budgets[name],
      `${archive} exceeds its ${budgets[name]} byte compressed budget`,
    );
    artifacts.push({
      filename: archive,
      bytes,
      sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
    });
    for (const entry of Object.values(pkg.exports))
      for (const path of typeof entry === 'string' ? [entry] : Object.values(entry))
        assert(existsSync(`packages/${name}/${path}`), `Missing public export: ${name}/${path}`);
  }
}
if (process.argv.includes('--artifacts')) {
  assert(existsSync('dist/twill.vsix'), 'Missing editor artifact');
  const bytes = statSync('dist/twill.vsix').size;
  assert(bytes <= 3 * 1024 * 1024, 'VSIX exceeds its 3 MiB compressed budget');
  artifacts.push({
    filename: 'twill.vsix',
    bytes,
    sha256: createHash('sha256').update(readFileSync('dist/twill.vsix')).digest('hex'),
  });
}
if (process.argv.includes('--manifest')) {
  assert(process.argv.includes('--artifacts'), '--manifest requires --artifacts');
  writeFileSync(
    'release-manifest.json',
    JSON.stringify({ version, hashAlgorithm: 'sha256', artifacts }, null, 2) + '\n',
  );
}
console.log(
  `Release ${version}: synchronized versions, changelog${process.argv.includes('--artifacts') ? ', artifacts and exports' : ''} verified.`,
);
