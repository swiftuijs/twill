import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readYaml = (path) => parse(readFileSync(join(root, path), 'utf8'), { uniqueKeys: true });
const workflow = readYaml('.github/workflows/ci.yml');
const { jobs } = workflow;
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const uses = (steps, name) => steps.find((step) => step.uses === name);

test('the required verify check includes every validator and rejects cancellation-resistant conditions', () => {
  assert.deepEqual(
    [...jobs.verify.needs].sort(),
    Object.keys(jobs)
      .filter((name) => name !== 'verify')
      .sort(),
  );
  assert.match(jobs.verify.if, /!cancelled\(\)/);
  for (const job of Object.values(jobs)) {
    assert(!job.if?.includes('always()'));
    for (const step of job.steps) assert(!step.if?.includes('always()'));
  }
  const gate = jobs.verify.steps.find((step) => step.run === 'node scripts/ci-result.mjs');
  assert.equal(gate.env.TWILL_CI_NEEDS, '${{ toJSON(needs) }}');
});

test('build and functional validators do not wait for the independent mandatory audit', () => {
  const dependencies = (name) =>
    list(jobs[name].needs).flatMap((need) => [need, ...dependencies(need)]);
  for (const name of ['build', 'unit', 'integration', 'loader-node']) {
    assert(!dependencies(name).includes('dependencies'));
    assert(!dependencies(name).includes('verify'));
  }
  assert.equal(jobs.dependencies.steps.at(-1).run, 'pnpm deps:check');
  assert.equal(
    readYaml('package.json').scripts['deps:check'],
    'pnpm audit --audit-level moderate && pnpm peers check',
  );
});

test('one candidate build feeds all Linux validators and only the successful aggregate promotes it', () => {
  assert.equal(jobs.build.steps.filter((step) => step.run === 'pnpm build').length, 1);
  for (const name of ['unit', 'integration', 'loader-node'])
    assert(uses(jobs[name].steps, './.github/actions/restore-build'));
  const uploads = Object.entries(jobs).flatMap(([job, value]) =>
    value.steps
      .filter((step) => step.with?.name === 'twill-packages')
      .map((step) => ({ job, step })),
  );
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].job, 'verify');
  assert.match(uploads[0].step.if, /success\(\)/);
  assert(
    jobs.verify.steps.some((step) => step.run === 'node scripts/verify-release.mjs --artifacts'),
  );
  assert.equal(readYaml('.github/workflows/release.yml').jobs.publish.needs, 'verify');
});

test('compiler coverage and other original-source coverage run in disjoint partitions', () => {
  assert.deepEqual(jobs.unit.strategy.matrix.suite, ['compiler', 'tooling']);
  assert.equal(jobs.unit.strategy['fail-fast'], false);
  const commands = jobs.unit.steps.filter((step) => step.run).map((step) => step.run);
  assert(commands.includes('pnpm --filter @swiftuijs/twill test:coverage'));
  assert(commands.some((command) => command.includes("--filter '!@swiftuijs/twill'")));
  assert(commands.some((command) => command.includes("--filter '!twill-workspace'")));
  assert(commands.some((command) => command.includes('pnpm --filter twill test:unit')));
});

test('Node 20 consumers run in isolation with no later repository pnpm command', () => {
  const setup = readYaml('.github/actions/setup-workspace/action.yml');
  assert.equal(
    String(uses(setup.runs.steps, 'actions/setup-node@v7.0.0').with['node-version']),
    '22',
  );
  const steps = jobs.integration.steps;
  const switchIndex = steps.findIndex((step) => step.with?.['node-version'] === '20.19.0');
  assert(switchIndex > 0);
  for (const step of steps.slice(switchIndex + 1)) assert(!/\bpnpm\b/.test(step.run ?? ''));
  const consumer = steps.find(
    (step) => step.name === 'Independently installed archives on the minimum runtime',
  );
  for (const name of readdirSync(join(root, 'packages'))) {
    const pkg = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
    if (!pkg.private) assert(consumer.run.includes(`node packages/${name}/tests/consumer.mjs`));
  }
  assert(consumer.run.includes('consumer.mjs --packed'));
});

test('minimum editor, real loader APIs and platform consumers remain required at their existing boundaries', () => {
  assert.deepEqual(jobs['loader-node'].strategy.matrix.node, ['22.12.0', '22.15.0', '26']);
  const benchmark = jobs['loader-node'].steps.find(
    (step) => step.name === 'Compare old and new fresh-process startup',
  );
  assert.match(benchmark.if, /github.event_name != 'pull_request'/);
  const editor = jobs.integration.steps.find((step) => step.name === 'Minimum supported editor');
  assert.match(editor.if, /inputs.minimum-editor == true/);
  assert.equal(editor.env.TWILL_TEST_VSCODE_VERSION, '1.95.3');
  assert.deepEqual(jobs['shell-platforms'].strategy.matrix.include, [
    { os: 'macos-15', arch: 'arm64' },
    { os: 'windows-latest', arch: 'x64' },
  ]);
  for (const step of jobs['shell-platforms'].steps.filter((step) =>
    /\bpack\b/.test(step.run ?? ''),
  ))
    assert.match(step.run, /--config.ignore-scripts=true/);
});

test('the actual build archive restores distributions and maps without dependency directories or script caches', () => {
  const directory = mkdtempSync(join(tmpdir(), 'twill-ci-artifact-'));
  const source = join(directory, 'source');
  const destination = join(directory, 'restored');
  const temporary = join(directory, 'temp');
  const contents = [
    'packages/twill/dist/index.js',
    'packages/twill/dist/index.js.map',
    'examples/basic/dist/index.js',
    'apps/docs/dist/index.html',
    'examples/react-framework/src/packages/react/index.twill',
    'editors/vscode/dist/extension.cjs',
    'editors/vscode/licenses/editor.txt',
    'packages/twill/README.md',
    'packages/twill/LICENSE',
    'swiftuijs-twill-0.3.1.tgz',
    'dist/twill.vsix',
    'release-manifest.json',
    'bundle-results.json',
  ];
  const put = (path, text) => {
    const target = join(source, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, text);
  };
  try {
    mkdirSync(temporary, { recursive: true });
    mkdirSync(destination);
    contents.forEach((path) => put(path, path));
    put('node_modules/private', 'must not ship');
    put('packages/twill/node_modules/private', 'must not ship');
    put('.twill/private-cache', 'must not ship');
    const archive = jobs.build.steps.find(
      (step) => step.name === "Archive this run's build outputs",
    );
    execFileSync('bash', ['-e', '-c', archive.run], {
      cwd: source,
      env: { ...process.env, RUNNER_TEMP: temporary },
    });
    const restore = readYaml('.github/actions/restore-build/action.yml');
    mkdirSync(join(temporary, 'candidate-build'));
    renameSync(join(temporary, 'build.tar'), join(temporary, 'candidate-build/build.tar'));
    execFileSync('bash', ['-e', '-c', restore.runs.steps.at(-1).run], {
      env: { ...process.env, RUNNER_TEMP: temporary, GITHUB_WORKSPACE: destination },
    });
    for (const path of contents) assert.equal(readFileSync(join(destination, path), 'utf8'), path);
    const members = execFileSync('tar', ['-tf', join(temporary, 'candidate-build/build.tar')], {
      encoding: 'utf8',
    });
    assert(!/node_modules|\.twill\/private-cache/.test(members));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CI packs existing builds without invoking prepack, while ordinary packing keeps its lifecycle', () => {
  const directory = mkdtempSync(join(tmpdir(), 'twill-ci-prepack-'));
  const packageDirectory = join(directory, 'packages', 'example');
  try {
    mkdirSync(join(packageDirectory, 'dist'), { recursive: true });
    const manager = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager;
    for (const name of readdirSync(join(root, 'packages'))) {
      const pkg = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
      if (!pkg.private)
        assert.equal(
          pkg.scripts.prepack,
          'pnpm run build',
          `${name}: review extra prepack work before skipping it in CI`,
        );
      for (const hook of ['prepare', 'postpack'])
        if (!pkg.private)
          assert.equal(
            pkg.scripts[hook],
            undefined,
            `${name}: review ${hook} before skipping it in CI`,
          );
    }
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ private: true, packageManager: manager }),
    );
    writeFileSync(join(directory, 'pnpm-workspace.yaml'), 'packages: [packages/*]\n');
    writeFileSync(join(packageDirectory, 'dist/index.js'), 'export const value = 42;\n');
    writeFileSync(
      join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: '@ci/example',
        version: '1.0.0',
        files: ['dist'],
        scripts: { prepack: 'node -e "process.exit(17)"' },
      }),
    );
    const assemble = jobs.build.steps.find(
      (step) => step.name === 'Assemble candidate distributions without rebuilding',
    );
    execFileSync('bash', ['-e', '-c', assemble.run.split('\n')[0]], {
      cwd: directory,
      stdio: 'pipe',
      env: { ...process.env, GITHUB_WORKSPACE: directory },
    });
    assert.match(
      execFileSync('tar', ['-tzf', join(directory, 'ci-example-1.0.0.tgz')], { encoding: 'utf8' }),
      /dist\/index.js/,
    );
    const ordinary = spawnSync('pnpm', ['--filter', '@ci/example', 'pack'], {
      cwd: directory,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    assert.notEqual(ordinary.status, 0, 'The fixture must detect ordinary prepack execution');
    assert.match(ordinary.stdout + ordinary.stderr, /prepack|process.exit\(17\)/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
