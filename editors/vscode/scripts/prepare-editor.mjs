import { copyFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
process.chdir(root);
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
  '# Bundled dependencies\n\nVite generates the bundled dependency licenses. See `licenses/editor.txt`, `licenses/tsserver.txt` and `licenses/compiler-bridge.txt`. TypeScript and its standard libraries are supplied by VS Code; they are not bundled in this extension.\n',
);
copyFileSync('LICENSE', 'editors/vscode/LICENSE');
copyFileSync('CHANGELOG.md', 'editors/vscode/CHANGELOG.md');
copyFileSync('packages/twill/schemas/twill.schema.json', 'editors/vscode/twill.schema.json');
