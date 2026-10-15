import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** tsserver discovers named modules through package resolution in each probe root. */
export function stageTypeScriptPlugin(root) {
  const extension = JSON.parse(readFileSync('editors/vscode/package.json', 'utf8'));
  const name = extension.contributes.typescriptServerPlugins[0].name;
  const plugin = join(root, 'node_modules', name);
  mkdirSync(join(plugin, 'dist'), { recursive: true });
  cpSync('editors/vscode/dist/tsserver.cjs', join(plugin, 'dist/index.cjs'));
  cpSync('LICENSE', join(plugin, 'LICENSE'));
  writeFileSync(
    join(plugin, 'package.json'),
    JSON.stringify(
      {
        name,
        version: extension.version,
        private: true,
        main: 'dist/index.cjs',
        license: extension.license,
      },
      null,
      2,
    ) + '\n',
  );
  return name;
}
