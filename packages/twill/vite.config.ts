import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import metadata from './package.json' with { type: 'json' };

const entries = [
  'index',
  'syntax',
  'config',
  'editor',
  'doctor',
  'declarations',
  'project',
  'cli',
  'register',
  'loader',
  'loader-compiler',
  'loader-registration',
  'loader-sync',
  'vite',
  'vite-react',
  'rollup',
  'esbuild',
  'webpack',
  'rspack',
];
export default defineConfig({
  publicDir: false,
  resolve: { conditions: ['node'] },
  ssr: { noExternal: true },
  plugins: [
    dts({
      tsconfigPath: 'tsconfig.build.json',
      entryRoot: 'src',
      outDirs: ['dist'],
      include: ['src'],
    }),
  ],
  build: {
    ssr: true,
    lib: {
      entry: Object.fromEntries(entries.map((name) => [name, resolve('src', name + '.ts')])),
      formats: ['es'],
      fileName: (_format, name) => name + '.js',
    },
    target: 'node20',
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      external: [
        ...builtinModules,
        /^node:/,
        ...Object.keys(metadata.dependencies),
        ...Object.keys(metadata.peerDependencies),
      ],
      output: { banner: (chunk) => (chunk.name === 'cli' ? '#!/usr/bin/env node' : '') },
    },
  },
});
