import { defineConfig, mergeConfig } from 'vite';
import twill from '@swiftuijs/twill/vite';
import { fileURLToPath } from 'node:url';
import { nodeViteConfig } from '../../packages/twill/scripts/node-vite-config.mjs';

export default defineConfig(
  mergeConfig(
    nodeViteConfig({
      entry: 'src/extension.twill',
      filename: 'extension.cjs',
      external: ['vscode'],
      minify: true,
    }),
    {
      build: {
        rolldownOptions: {
          output: {
            // Keep generated interop helpers on separate lines from source mappings.
            minify: { compress: true, mangle: true, codegen: { removeWhitespace: false } },
          },
        },
      },
      resolve: {
        conditions: ['node'],
        alias: [
          {
            find: /^typescript$/,
            replacement: fileURLToPath(new URL('./src/typescript.twill', import.meta.url)),
          },
        ],
      },
      plugins: [twill()],
    },
  ),
);
