import { defineConfig, mergeConfig } from 'vite';
import twill from '@swiftuijs/twill/vite';
import { nodeViteConfig } from '../../packages/twill/scripts/node-vite-config.mjs';

export default defineConfig(
  mergeConfig(
    nodeViteConfig({
      entry: 'src/tsserver.twill',
      filename: 'tsserver.cjs',
      emptyOutDir: false,
      license: 'tsserver.LICENSE.txt',
      external: ['typescript'],
      minify: true,
      footer: 'return module.exports.default(modules); };',
    }),
    {
      build: {
        rolldownOptions: {
          output: {
            // Evaluate compiler imports with the TS instance supplied by tsserver.
            // Each initializer owns its bundle state without resolver/global patches.
            banner: `const hostRequire = require;
module.exports = function init(modules) {
  const module = { exports: {} };
  const exports = module.exports;
  const require = (id) => id === 'typescript' ? modules.typescript : hostRequire(id);`,
          },
        },
      },
      plugins: [twill()],
    },
  ),
);
