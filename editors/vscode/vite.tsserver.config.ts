import { defineConfig } from 'vite';
import twill from '@swiftuijs/twill/vite';
import { nodeViteConfig } from '../../packages/twill/scripts/node-vite-config.mjs';

export default defineConfig({
  ...nodeViteConfig({
    entry: 'src/tsserver.twill',
    filename: 'tsserver.cjs',
    emptyOutDir: false,
    license: 'tsserver.LICENSE.txt',
    external: ['typescript'],
    minify: true,
    footer: 'module.exports = module.exports.default;',
  }),
  plugins: [twill()],
});
