import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { npmConsumer as npm } from '../../twill/tests/helpers/npm-consumer.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const root = mkdtempSync(join(tmpdir(), 'twill-linter-consumer-'));
const run = (args) =>
  execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const basicConfig = `import twill from '@swiftuijs/twill-linter';export default twill.configs.recommended;`;
function verifyExhaustive() {
  writeFileSync(
    join(root, 'tsconfig.json'),
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
  writeFileSync(
    join(root, 'eslint.config.mjs'),
    `import twill from '@swiftuijs/twill-linter';export default twill.configs.recommendedTypeChecked;`,
  );
  const source = [
    'type State = {kind: "ready"; value: number} | {kind: "failed"; error: string};',
    'export function render(state: State) {',
    'switch (state.kind) {',
    'case "ready": return String(state.value);',
    'default: return "fallback";',
    '}',
    '}',
  ].join('\n');
  writeFileSync(join(root, 'states.twill'), source);
  assert.throws(
    () => run(['node_modules/eslint/bin/eslint.js', 'states.twill', '--format', 'json']),
    (error) => {
      assert.equal(error.status, 1);
      const [result] = JSON.parse(error.stdout);
      const diagnostic = result.messages.find(
        (message) => message.ruleId === '@typescript-eslint/switch-exhaustiveness-check',
      );
      assert.equal(diagnostic.line, 3);
      assert.equal(diagnostic.column, 9);
      assert.match(diagnostic.message, /"failed"/);
      return true;
    },
  );
  writeFileSync(
    join(root, 'states.twill'),
    source.replace('default:', 'case "failed": return state.error;\ndefault:'),
  );
  run(['node_modules/eslint/bin/eslint.js', 'states.twill']);
  writeFileSync(
    join(root, 'states.twill'),
    'export enum State{case loaded(value:number);}export function read(input:State){return match(input){case State.loaded({value}):value;};}',
  );
  run(['node_modules/eslint/bin/eslint.js', 'states.twill']);
  writeFileSync(join(root, 'eslint.config.mjs'), basicConfig);
}
try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      resolve(repository, `swiftuijs-twill-${version}.tgz`),
      resolve(repository, `swiftuijs-twill-linter-${version}.tgz`),
      'eslint@10.12.0',
    ],
    { cwd: root, stdio: 'pipe' },
  );
  writeFileSync(join(root, 'main.twill'), 'export const doubled=[1,2,3].map { n in n*2 };\n');
  writeFileSync(join(root, 'eslint.config.mjs'), basicConfig);
  run(['node_modules/eslint/bin/eslint.js', 'main.twill']);
  writeFileSync(join(root, 'bad.twill'), 'export const value = [1].map { n in n + };');
  assert.throws(
    () => run(['node_modules/eslint/bin/eslint.js', 'bad.twill']),
    (error) => {
      assert.equal(error.status, 1);
      return true;
    },
  );
  writeFileSync(
    join(root, 'consumer.mts'),
    `import linter,{configs} from '@swiftuijs/twill-linter'; void linter; void configs;`,
  );
  run([
    'node_modules/typescript/bin/tsc',
    '--noEmit',
    '--module',
    'nodenext',
    '--target',
    'es2022',
    'consumer.mts',
  ]);
  verifyExhaustive();
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', 'eslint@9.39.5'], {
    cwd: root,
    stdio: 'pipe',
  });
  run(['node_modules/eslint/bin/eslint.js', 'main.twill']);
  assert.throws(
    () => run(['node_modules/eslint/bin/eslint.js', 'bad.twill']),
    (error) => {
      assert.equal(error.status, 1);
      return true;
    },
  );
  verifyExhaustive();
  // Published packages cannot impose root overrides on applications. Exercise
  // the documented npm opt-in using a real independent install, not workspace
  // resolution, under both supported ESLint majors.
  const application = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  application.overrides = { 'minimatch@^10.0.0': '^11.0.3' };
  writeFileSync(join(root, 'package.json'), JSON.stringify(application));
  // npm 10 can retain the old nested resolution when an override is added
  // after installation. Update that dependency explicitly without deleting
  // the application's lockfile or changing unrelated dependency ranges.
  npm(['update', 'minimatch', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: root,
    stdio: 'pipe',
  });
  for (const eslintVersion of ['10.12.0', '9.39.5']) {
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', `eslint@${eslintVersion}`], {
      cwd: root,
      stdio: 'pipe',
    });
    const dependencies = JSON.parse(
      npm(['ls', 'minimatch', '--all', '--json'], {
        cwd: root,
        encoding: 'utf8',
      }),
    );
    let patchedMatchers = 0;
    function inspect(tree) {
      for (const [name, dependency] of Object.entries(tree.dependencies ?? {})) {
        if (name === 'minimatch') {
          assert(
            !dependency.version.startsWith('10.'),
            'An application override must replace every minimatch 10',
          );
          if (dependency.version.startsWith('11.')) patchedMatchers++;
        }
        inspect(dependency);
      }
    }
    inspect(dependencies);
    assert(patchedMatchers > 0, 'The consumer must exercise minimatch 11');
    run(['node_modules/eslint/bin/eslint.js', 'main.twill']);
    verifyExhaustive();
    if (eslintVersion.startsWith('10.')) {
      const audit = JSON.parse(npm(['audit', '--json'], { cwd: root, encoding: 'utf8' }));
      assert.equal(audit.metadata.vulnerabilities.total, 0);
    }
  }
  console.log(
    'Independent npm consumer: ESLint 9/10 syntax, typed exhaustiveness, public types, minimatch 11 overrides and ESLint 10 audit passed.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
