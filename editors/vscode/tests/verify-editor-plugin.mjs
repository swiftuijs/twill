import { resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { probeTypeScriptPlugin } from '../../../packages/twill/tests/helpers/probe-typescript-plugin.mjs';
import { fileURLToPath } from 'node:url';
import { stageTypeScriptPlugin } from '../scripts/stage-tsserver.mjs';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
// Resolve the external pinned TypeScript engine from the owning extension.
mkdirSync('editors/vscode/.twill', { recursive: true });
const root = mkdtempSync(resolve('editors/vscode/.twill/tsserver-probe-'));
try {
  await probeTypeScriptPlugin(root, stageTypeScriptPlugin(root));
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(
  'Bundled editor plugin passed native TS/JS diagnostics, hover, definitions and unsaved-source checks.',
);
