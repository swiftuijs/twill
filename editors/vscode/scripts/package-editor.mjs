import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageTypeScriptPlugin } from './stage-tsserver.mjs';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));

// Stage the extension independently of workspace symlinks. VSCE must never
// walk the monorepo's hoisted development dependencies into the VSIX.
const stage = resolve('.twill/vsix-stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const name of [
  'dist',
  'assets',
  'syntaxes',
  'licenses',
  'LICENSE',
  'README.md',
  'CHANGELOG.md',
  '.vscodeignore',
  'THIRD_PARTY_NOTICES.md',
  'language-configuration.json',
  'twill.schema.json',
])
  cpSync(join('editors/vscode', name), join(stage, name), { recursive: true });
const manifest = JSON.parse(readFileSync('editors/vscode/package.json', 'utf8'));
delete manifest.scripts;
delete manifest.devDependencies;
const pluginName = stageTypeScriptPlugin(stage);
// The bridge executes only in tsserver; ship its loader copy once.
rmSync(join(stage, 'dist/tsserver.cjs'));
rmSync(join(stage, 'dist/tsserver.LICENSE.txt'));
manifest.dependencies = { [pluginName]: manifest.version };
const require = createRequire(import.meta.url);
// Both editor hosts share one pinned engine, independent of workspace installs.
const typescriptRoot = dirname(require.resolve('typescript/package.json'));
const typescript = join(stage, 'node_modules/typescript');
mkdirSync(join(typescript, 'lib'), { recursive: true });
for (const name of ['LICENSE.txt', 'ThirdPartyNoticeText.txt', 'lib/typescript.js'])
  cpSync(join(typescriptRoot, name), join(typescript, name));
const engineManifest = JSON.parse(readFileSync(join(typescriptRoot, 'package.json')));
writeFileSync(
  join(typescript, 'package.json'),
  JSON.stringify(
    {
      name: engineManifest.name,
      version: engineManifest.version,
      license: engineManifest.license,
      private: true,
      main: './lib/typescript.js',
    },
    null,
    2,
  ) + '\n',
);
manifest.dependencies.typescript = engineManifest.version;
writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
mkdirSync(resolve('dist'), { recursive: true });
execFileSync(
  process.execPath,
  [require.resolve('@vscode/vsce/vsce'), 'package', '--out', resolve('dist/twill.vsix')],
  { cwd: stage, stdio: 'inherit' },
);
