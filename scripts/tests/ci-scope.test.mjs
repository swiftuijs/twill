import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ciScope, eventScope } from '../ci-scope.mjs';

const all = { core: true, shell: true };
const docs = { core: false, shell: false };

test('prose/site/skill/evidence PRs keep documentation checks without unrelated platform jobs', () => {
  assert.deepEqual(
    ciScope([
      'AGENTS.md',
      'README.md',
      'packages/shell-native/README.md',
      'docs/scripting.md',
      'skills/twill/SKILL.md',
      'apps/docs/.vitepress/theme/Logo.vue',
      'packages/shell-native/benchmarks/results/platform.json',
      'packages/shell/benchmarks/results/diagnostic.cpuprofile',
      'packages/shell-native/benchmarks/results/exact-source.mjs.txt',
    ]),
    docs,
  );
});
test('compiler/runner/export/runtime changes retain core and Windows/macOS runner verification', () => {
  for (const path of [
    'packages/twill/src/compiler.ts',
    'packages/twill/bin/run.mjs',
    'packages/export/tests/export.test.ts',
    'packages/runtime/src/index.ts',
  ])
    assert.deepEqual(ciScope([path]), {
      core: true,
      shell: true,
    });
});
test('shell sources and shared contracts select platform verification', () => {
  for (const path of ['packages/shell/src/index.twill', 'packages/shell/tests/contract.ts']) {
    const scope = ciScope([path]);
    assert.equal(scope.core, true);
    assert.equal(scope.shell, true);
  }
});
test('mixed paths union their affected checks; tooling/editor/example code keeps core verification', () => {
  for (const path of [
    'packages/highlight/src/index.twill',
    'packages/formatter/src/index.twill',
    'editors/vscode/src/extension.twill',
    'examples/react/src/App.twillx',
  ])
    assert.deepEqual(ciScope(['docs/ai.md', path]), {
      core: true,
      shell: false,
    });
  assert.deepEqual(ciScope(['docs/ai.md', 'packages/shell/src/index.twill']), all);
});
test('dependency/build/workflow and unknown paths never fall through to a reduced run', () => {
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    '.npmrc',
    '.github/workflows/ci.yml',
    'scripts/verify-release.mjs',
    'new-package/build.js',
    'LICENSE',
  ])
    assert.deepEqual(ciScope([path]), all);
});
test('manual/scheduled/release and forced events always select the full matrix', () => {
  for (const eventName of ['schedule', 'workflow_dispatch', 'workflow_call', undefined])
    assert.deepEqual(eventScope({ eventName, eventPath: '/not-present' }).scope, all);
  assert.deepEqual(eventScope({ eventName: 'pull_request', forceFull: true }).scope, all);
  assert.deepEqual(eventScope({ eventName: 'push', forceFull: true }).scope, all);
});
test('missing/malformed events or unavailable base history fail conservatively', () => {
  assert.deepEqual(eventScope({ eventName: 'pull_request', eventPath: '/not-present' }).scope, all);
});
test('actual PR CLI writes reduced outputs for docs, and includes every commit in its diff', () => {
  const folder = mkdtempSync(join(tmpdir(), 'twill-ci-docs-'));
  const cwd = join(folder, 'repo');
  mkdirSync(cwd);
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Twill CI',
      '-c',
      'user.email=ci@example.invalid',
      'commit',
      '-m',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  const eventPath = join(folder, 'event.json');
  const output = join(folder, 'outputs');
  try {
    git('init', '--quiet');
    writeFileSync(join(cwd, 'README.md'), '# base\n');
    const base = commit();
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base } } }));
    writeFileSync(join(cwd, 'README.md'), '# changed docs\n');
    commit();
    const result = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../ci-scope.mjs', import.meta.url))],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: join(folder, 'summary'),
          TWILL_CI_FULL: 'false',
        },
      },
    );
    assert.deepEqual(JSON.parse(result).scope, docs);
    assert.equal(readFileSync(output, 'utf8'), 'core=false\nshell=false\n');
    const documentation = git('rev-parse', 'HEAD');
    const push = (before, after, extra = {}) => {
      writeFileSync(eventPath, JSON.stringify({ ref: 'refs/heads/main', before, after, ...extra }));
      return eventScope({ eventName: 'push', eventPath, cwd }).scope;
    };
    assert.deepEqual(push(base, documentation), docs);
    for (const extra of [{ forced: true }, { deleted: true }, { ref: 'refs/tags/v1.0.0' }])
      assert.deepEqual(push(base, documentation, extra), all);
    for (const before of ['0'.repeat(40), 'f'.repeat(40), '--bad'])
      assert.deepEqual(push(before, documentation), all);
    assert.deepEqual(push(base, base), all, 'A stale checkout must not reduce checks');
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base } } }));
    mkdirSync(join(cwd, 'packages/shell/src'), { recursive: true });
    writeFileSync(join(cwd, 'packages/shell/src/index.twill'), 'changed ABI\n');
    commit();
    writeFileSync(join(cwd, 'README.md'), '# latest commit only changes docs\n');
    commit();
    assert.equal(eventScope({ eventName: 'pull_request', eventPath, cwd }).scope.shell, true);
    const mixed = git('rev-parse', 'HEAD');
    assert.deepEqual(push(documentation, mixed), all, 'Every commit in a push must be included');
    mkdirSync(join(cwd, 'editors/vscode'), { recursive: true });
    writeFileSync(join(cwd, 'editors/vscode/example.js'), 'code');
    assert.deepEqual(push(mixed, commit()), all, 'Main code pushes retain the full matrix');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
test('real git diffs preserve deleted/renamed native owners and filenames with newlines', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'twill-ci-scope-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Twill CI',
      '-c',
      'user.email=ci@example.invalid',
      'commit',
      '-m',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  const eventPath = join(cwd, 'event.json');
  const select = (base) => {
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base } } }));
    return eventScope({ eventName: 'pull_request', eventPath, cwd }).scope;
  };
  try {
    git('init', '--quiet');
    mkdirSync(join(cwd, 'packages/shell/src'), { recursive: true });
    writeFileSync(join(cwd, 'packages/shell/src/index.twill'), 'owned native code\n');
    const base = commit();
    mkdirSync(join(cwd, 'docs'));
    renameSync(join(cwd, 'packages/shell/src/index.twill'), join(cwd, 'docs/moved.rs'));
    writeFileSync(join(cwd, 'docs/spaces and\nnewlines.md'), '# docs\n');
    commit();
    assert.equal(select(base).shell, true);
    assert.deepEqual(select('f'.repeat(40)), all);
    writeFileSync(eventPath, '{invalid');
    assert.deepEqual(eventScope({ eventName: 'pull_request', eventPath, cwd }).scope, all);
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: '--not-a-sha' } } }));
    assert.deepEqual(eventScope({ eventName: 'pull_request', eventPath, cwd }).scope, all);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
