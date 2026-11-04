import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
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
// The complete editor notice is already retained under licenses/editor.txt.
rmSync(join(stage, 'dist/THIRD_PARTY_LICENSES.txt'));
manifest.dependencies = { [pluginName]: manifest.version };
const require = createRequire(import.meta.url);
writeFileSync(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
mkdirSync(resolve('dist'), { recursive: true });
execFileSync(
  process.execPath,
  [require.resolve('@vscode/vsce/vsce'), 'package', '--out', resolve('dist/twill.vsix')],
  { cwd: stage, stdio: 'inherit' },
);
