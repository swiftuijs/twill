import { copyFileSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
process.chdir(root);
const require = createRequire(import.meta.url);
const typescriptLib = dirname(require.resolve('typescript'));
mkdirSync('editors/vscode/dist/typescript-lib', { recursive: true });
for (const filename of readdirSync(typescriptLib))
  if (/^lib(?:\..+)?\.d\.ts$/.test(filename))
    copyFileSync(
      join(typescriptLib, filename),
      join('editors/vscode/dist/typescript-lib', filename),
    );
mkdirSync('editors/vscode/syntaxes', { recursive: true });
for (const extension of ['twill', 'twillx'])
  copyFileSync(
    `packages/highlight/grammars/${extension}.tmLanguage.json`,
    `editors/vscode/syntaxes/${extension}.tmLanguage.json`,
  );

rmSync('editors/vscode/licenses', { recursive: true, force: true });
mkdirSync('editors/vscode/licenses', { recursive: true });
copyFileSync('editors/vscode/dist/THIRD_PARTY_LICENSES.txt', 'editors/vscode/licenses/editor.txt');
copyFileSync('editors/vscode/dist/tsserver.LICENSE.txt', 'editors/vscode/licenses/tsserver.txt');
copyFileSync(
  'packages/twill/dist/typescript-plugin.LICENSE.txt',
  'editors/vscode/licenses/compiler-bridge.txt',
);
writeFileSync(
  'editors/vscode/THIRD_PARTY_NOTICES.md',
  '# Bundled dependencies\n\nVite generates the bundled dependency licenses. See `licenses/editor.txt`, `licenses/tsserver.txt` and `licenses/compiler-bridge.txt`. The shared pinned TypeScript engine includes its license and third-party notices under `node_modules/typescript`.\n',
);
copyFileSync('LICENSE', 'editors/vscode/LICENSE');
copyFileSync('CHANGELOG.md', 'editors/vscode/CHANGELOG.md');
copyFileSync('packages/twill/schemas/twill.schema.json', 'editors/vscode/twill.schema.json');
