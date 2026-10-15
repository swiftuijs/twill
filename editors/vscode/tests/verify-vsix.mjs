import { readVsix } from './read-vsix.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { probeTypeScriptPlugin } from '../../../packages/twill/tests/helpers/probe-typescript-plugin.mjs';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));

const root = mkdtempSync(join(tmpdir(), 'twill-vsix-'));
try {
  const files = await readVsix('dist/twill.vsix', (name) =>
    /^extension\/(?:node_modules\/|dist\/(?:typescript-lib\/|tsserver\.cjs$)|syntaxes\/|package\.json$)/.test(
      name,
    ),
  );
  const manifest = JSON.parse(files.get('extension/package.json').toString());
  assert.equal(
    manifest.version,
    JSON.parse(readFileSync('package.json', 'utf8')).version,
    'Stale VSIX version',
  );
  const editorManifest = JSON.parse(readFileSync('editors/vscode/package.json', 'utf8'));
  assert.equal(manifest.publisher, editorManifest.publisher, 'Stale VSIX publisher');
  assert.equal(manifest.name, editorManifest.name, 'Stale VSIX extension name');
  for (const grammar of manifest.contributes.grammars)
    assert(
      files.has('extension/' + grammar.path.replace(/^\.\//, '')),
      `Missing grammar ${grammar.path}`,
    );
  assert(files.has('extension/node_modules/@swiftuijs/twill-vscode-tsserver/dist/index.cjs'));
  assert(!files.has('extension/dist/tsserver.cjs'), 'Do not ship a duplicate bridge bundle');
  const bridge = JSON.parse(
    files.get('extension/node_modules/@swiftuijs/twill-vscode-tsserver/package.json').toString(),
  );
  assert.equal(bridge.version, manifest.version);
  assert.equal(bridge.private, true);
  assert.equal(manifest.dependencies[bridge.name], manifest.version);
  assert(
    !editorManifest.dependencies?.[bridge.name],
    'The bridge is an internal module, not a source package dependency',
  );

  assert(files.has('extension/dist/typescript-lib/lib.es2022.full.d.ts'));
  assert(files.has('extension/node_modules/typescript/lib/typescript.js'));
  const engine = JSON.parse(files.get('extension/node_modules/typescript/package.json').toString());
  assert.equal(engine.version, '5.9.3', 'The shared engine must match the tested TS contract');
  assert.equal(manifest.dependencies.typescript, engine.version);
  assert(
    statSync('dist/twill.vsix').size <= 3 * 1024 * 1024,
    'VSIX exceeds the 3 MiB compressed budget',
  );
  for (const [name, contents] of files) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  await probeTypeScriptPlugin(join(root, 'extension'), '@swiftuijs/twill-vscode-tsserver');
  console.log('Extracted VSIX passed native TS/JS editor checks with its packaged plugin.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
