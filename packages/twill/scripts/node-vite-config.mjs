import { builtinModules, createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Acorn's JSX plugin uses require(), while its TS plugin imports ESM. Bundle
// one parser instance rather than retaining both conditional package entries.
const require = createRequire(import.meta.url);
export const acornAlias = {
  find: /^acorn$/,
  replacement: join(dirname(require.resolve('acorn')), 'acorn.mjs'),
};

/** Vite library mode for Node tooling, with an explicit external boundary.
 * @param {import('./node-vite-config.d.mts').NodeViteOptions} options
 * @returns {import('vite').UserConfig}
 */
export function nodeViteConfig({
  entry,
  filename,
  outDir = 'dist',
  external = [],
  minify = false,
  emptyOutDir = true,
  footer = '',
  license = 'THIRD_PARTY_LICENSES.txt',
}) {
  return {
    publicDir: false,
    resolve: { conditions: ['node'], alias: [acornAlias] },
    ssr: { noExternal: true },
    build: {
      ssr: true,
      lib: { entry, formats: ['cjs'], fileName: () => filename },
      outDir,
      emptyOutDir,
      target: 'node20',
      minify,
      sourcemap: true,
      license: { fileName: license },
      rolldownOptions: {
        external: [...builtinModules, /^node:/, ...external],
        output: { exports: 'named', entryFileNames: filename, footer },
      },
    },
  };
}
