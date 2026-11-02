import { fixtureRoot } from './helpers/fixture.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';
import { rollup } from 'rollup';
import { build as vite, createServer } from 'vite';
import esbuildPlugin from '../src/esbuild';
import rollupPlugin from '../src/rollup';
import vitePlugin from '../src/vite';
import twillReact from '../src/vite-react';
import webpack from 'webpack';
import { rspack } from '@rspack/core';
import webpackPlugin from '../src/webpack';
import rspackPlugin from '../src/rspack';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = fixtureRoot('.twill-build-');
  roots.push(root);
  writeFileSync(join(root, 'numbers.ts'), 'export const values: number[] = [1,2,3];');
  writeFileSync(join(root, 'offset.js'), 'export const offset = 0;');
  writeFileSync(join(root, 'types.ts'), 'export interface Value { amount: number }');
  writeFileSync(
    join(root, 'double.twill'),
    'import {offset} from "./offset.js"; export enum Amount{case value(amount:number);} export function double(x: number) { guard x > 0 else { return 0; } let result = match(Amount.value(x * 2 + offset)){case Amount.value({amount}):amount;}; defer { result = 0; } return result; }',
  );
  writeFileSync(
    join(root, 'main.twill'),
    'import {values} from "./numbers"; import {double} from "./double"; import type {Value} from "./types.ts"; export const result = values.map() { (x: number) in defer {} guard x > 0 else { throw new Error(); } const value: Value = {amount: double(x)}; return value.amount; };',
  );
  writeFileSync(
    join(root, 'ui.twillx'),
    'function Card(props: {children?: import("react").ReactNode}) { return <article>{props.children}</article>; } export const view = Card { [1,2].map { value in <span key={value}>{value}</span> }; };',
  );
  writeFileSync(join(root, 'consumer.js'), 'export {result} from "./main.twill";');
  writeFileSync(
    join(root, 'entry.ts'),
    'import {result as numbers} from "./consumer.js"; export const result: number[] = numbers; export {view} from "./ui.twillx";',
  );
  return root;
}

it('inherits the standard JSX runtime for Twill and native files in the React adapter', async () => {
  const root = fixture();
  writeFileSync(
    join(root, 'tsconfig.json'),
    '{"compilerOptions":{"jsx":"react-jsx","jsxImportSource":"custom"}}',
  );
  writeFileSync(
    join(root, 'runtime.ts'),
    'export const jsx = (type: unknown, props: unknown) => ({ type, props, runtime: "custom" }); export const jsxs = jsx; export const jsxDEV = jsx;',
  );
  // The component value need not execute: both views are plain runtime records.
  writeFileSync(
    join(root, 'custom.tsx'),
    'const Card = "article"; export const native = <Card>child</Card>;',
  );
  writeFileSync(
    join(root, 'custom.twillx'),
    'const Card = "article"; export const dialect = Card { "child"; };',
  );
  const server = await createServer({
    root,
    configFile: false,
    plugins: twillReact({ twill: { root } }),
    resolve: {
      alias: {
        'custom/jsx-runtime': join(root, 'runtime.ts'),
        'custom/jsx-dev-runtime': join(root, 'runtime.ts'),
      },
    },
    server: { middlewareMode: true },
  });
  try {
    const dialect = await server.ssrLoadModule('/custom.twillx');
    const native = await server.ssrLoadModule('/custom.tsx');
    expect(dialect.dialect).toEqual(native.native);
    expect(dialect.dialect.runtime).toBe('custom');
  } finally {
    await server.close();
  }
});

describe('real build tools', () => {
  it('bundles TypeScript and extensionless imports with esbuild', async () => {
    const root = fixture();
    const result = await esbuild({
      entryPoints: [join(root, 'entry.ts')],
      bundle: true,
      format: 'cjs',
      write: false,
      sourcemap: 'inline',
      plugins: [esbuildPlugin({ root })],
    });
    const module = { exports: {} as { result: number[]; view: ReactNode } };
    Function('module', 'exports', result.outputFiles![0]!.text)(module, module.exports);
    expect(module.exports.result).toEqual([2, 4, 6]);
    expect(renderToStaticMarkup(module.exports.view)).toBe(
      '<article><span>1</span><span>2</span></article>',
    );
    expect(result.outputFiles![0]!.text).toContain('sourceMappingURL=data:');
  });
  it('bundles with Rollup and preserves original sources in maps', async () => {
    const root = fixture();
    const bundle = await rollup({
      input: join(root, 'entry.ts'),
      plugins: [rollupPlugin({ root })],
      external: ['react/jsx-runtime'],
    });
    try {
      const { output } = await bundle.generate({ format: 'cjs', sourcemap: true });
      const chunk = output[0]!;
      if (chunk.type !== 'chunk') throw new Error('Expected chunk');
      const exports = {} as { result: number[]; view: ReactNode };
      Function('exports', 'require', chunk.code)(exports, createRequire(import.meta.url));
      expect(exports.result).toEqual([2, 4, 6]);
      expect(renderToStaticMarkup(exports.view)).toBe(
        '<article><span>1</span><span>2</span></article>',
      );
      expect(chunk.map?.sources.map((source) => source.split('/').at(-1))).toEqual(
        expect.arrayContaining(['main.twill', 'numbers.ts', 'ui.twillx']),
      );
    } finally {
      await bundle.close();
    }
  });
  it('builds and loads modules in Vite dev SSR', async () => {
    const root = fixture();
    const server = await createServer({
      root,
      configFile: false,
      plugins: [vitePlugin({ root })],
      server: { middlewareMode: true },
    });
    try {
      const loaded = await server.ssrLoadModule('/entry.ts');
      expect(loaded.result).toEqual([2, 4, 6]);
      expect(renderToStaticMarkup(loaded.view)).toBe(
        '<article><span>1</span><span>2</span></article>',
      );
    } finally {
      await server.close();
    }
    await vite({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [vitePlugin({ root })],
      build: {
        outDir: join(root, 'dist'),
        lib: { entry: join(root, 'entry.ts'), formats: ['es'], fileName: () => 'main.mjs' },
        sourcemap: true,
      },
    });
    const module = await import(pathToFileURL(join(root, 'dist', 'main.mjs')).href);
    expect(module.result).toEqual([2, 4, 6]);
    expect(renderToStaticMarkup(module.view)).toBe(
      '<article><span>1</span><span>2</span></article>',
    );
    expect(
      JSON.parse(readFileSync(join(root, 'dist', 'main.mjs.map'), 'utf8')).sourcesContent.join(''),
    ).toContain('value');
  });
  it.each(['webpack', 'rspack'] as const)('bundles with %s', async (tool) => {
    const root = fixture();
    const config = {
      mode: 'none' as const,
      target: 'node',
      entry: join(root, 'entry.ts'),
      output: { path: join(root, 'dist'), filename: 'main.cjs', library: { type: 'commonjs2' } },
      plugins: [tool === 'webpack' ? webpackPlugin({ root }) : rspackPlugin({ root })],
    };
    const compiler =
      tool === 'webpack'
        ? webpack(config as webpack.Configuration)
        : rspack(config as Parameters<typeof rspack>[0]);
    if (!compiler) throw new Error('Missing compiler');
    try {
      await new Promise<void>((resolve, reject) =>
        compiler.run((error, stats) => {
          if (error) reject(error);
          else if (stats?.hasErrors())
            reject(new Error(stats.toString({ all: false, errors: true })));
          else resolve();
        }),
      );
      const loaded = createRequire(import.meta.url)(join(root, 'dist', 'main.cjs'));
      expect(renderToStaticMarkup(loaded.view)).toBe(
        '<article><span>1</span><span>2</span></article>',
      );
      expect(loaded.result).toEqual([2, 4, 6]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        compiler.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
function runtimeFixture() {
  const root = fixtureRoot('runtime-build-');
  roots.push(root);
  writeFileSync(join(root, 'twill.config.json'), '{"runtime":"external"}');
  writeFileSync(
    join(root, 'cleanup.twill'),
    'export function run(events:string[],early:boolean){if(true)defer {events.push("first");}if(early)return 7;defer {events.push("second");}events.push("body");return 8;}',
  );
  writeFileSync(
    join(root, 'entry.twill'),
    'import {run} from "./cleanup";export const events:string[]=[];export const result=run(events,false);',
  );
  return root;
}
function runtimeResult(loaded: { events: string[]; result: number }) {
  expect(loaded.events).toEqual(['body', 'second', 'first']);
  expect(loaded.result).toBe(8);
}
it('bundles the configured runtime through the esbuild adapter', async () => {
  const root = runtimeFixture();
  const result = await esbuild({
    entryPoints: [join(root, 'entry.twill')],
    bundle: true,
    write: false,
    metafile: true,
    format: 'cjs',
    platform: 'node',
    plugins: [esbuildPlugin({ root })],
  });
  const module = { exports: {} };
  Function('module', 'exports', result.outputFiles![0]!.text)(module, module.exports);
  runtimeResult(module.exports as any);
  expect(
    Object.keys(result.metafile!.inputs).filter((file) =>
      file.includes('/runtime/dist/helpers/v1.js'),
    ),
  ).toHaveLength(1);
});
it('retains the explicit production runtime import through Rollup', async () => {
  const root = runtimeFixture();
  const bundle = await rollup({
    input: join(root, 'entry.twill'),
    plugins: [rollupPlugin({ root })],
    external: ['@swiftuijs/twill-runtime/helpers/v1'],
  });
  try {
    const { output } = await bundle.generate({ format: 'cjs' });
    const chunk = output[0]!;
    if (chunk.type !== 'chunk') throw Error('Expected chunk');
    expect(chunk.code).toContain('@swiftuijs/twill-runtime/helpers/v1');
    const exports = {};
    Function('exports', 'require', chunk.code)(exports, createRequire(import.meta.url));
    runtimeResult(exports as any);
  } finally {
    await bundle.close();
  }
});
it('loads external cleanup in Vite dev SSR and bundles it for production', async () => {
  const root = runtimeFixture();
  const server = await createServer({
    root,
    configFile: false,
    plugins: [vitePlugin({ root })],
    server: { middlewareMode: true },
  });
  try {
    runtimeResult(
      (await server.ssrLoadModule('/entry.twill')) as { events: string[]; result: number },
    );
  } finally {
    await server.close();
  }
  await vite({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [vitePlugin({ root })],
    build: {
      outDir: join(root, 'dist'),
      lib: { entry: join(root, 'entry.twill'), formats: ['es'], fileName: () => 'main.mjs' },
    },
  });
  runtimeResult(await import(pathToFileURL(join(root, 'dist/main.mjs')).href));
});
it.each(['webpack', 'rspack'] as const)('bundles external cleanup with %s', async (tool) => {
  const root = runtimeFixture();
  const config = {
    mode: 'none' as const,
    target: 'node',
    entry: join(root, 'entry.twill'),
    output: { path: join(root, 'dist'), filename: 'main.cjs', library: { type: 'commonjs2' } },
    plugins: [tool === 'webpack' ? webpackPlugin({ root }) : rspackPlugin({ root })],
  };
  const compiler =
    tool === 'webpack'
      ? webpack(config as webpack.Configuration)
      : rspack(config as Parameters<typeof rspack>[0]);
  if (!compiler) throw Error('Missing compiler');
  try {
    await new Promise<void>((resolve, reject) =>
      compiler.run((error, stats) => {
        if (error) reject(error);
        else if (stats?.hasErrors()) reject(Error(stats.toString({ all: false, errors: true })));
        else resolve();
      }),
    );
    runtimeResult(createRequire(import.meta.url)(join(root, 'dist', 'main.cjs')));
  } finally {
    await new Promise<void>((resolve, reject) =>
      compiler.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it.each(['vite', 'rollup', 'esbuild', 'webpack', 'rspack'] as const)(
  '%s reads the Vue slot setting and preserves explicit adapter overrides',
  async (tool) => {
    const root = fixture();
    writeFileSync(join(root, 'twill.config.json'), '{"vueDefaultSlot":"function"}');
    const input = join(root, 'slots.twillx');
    writeFileSync(
      input,
      `import {defineComponent,h} from 'vue';
const Panel=defineComponent({setup(_,{slots}){return()=>h('section',null,slots.default?.());}});
export const view=Panel { <button>Save</button>; };`,
    );
    const external = ['vue', 'vue/jsx-runtime'];
    const outfile = join(root, 'dist', 'slots.cjs');
    for (const vueDefaultSlot of [undefined, 'object'] as const) {
      const options = {
        root,
        jsxImportSource: 'vue',
        ...(vueDefaultSlot ? { vueDefaultSlot } : {}),
      };
      let code: string;
      if (tool === 'esbuild') {
        const built = await esbuild({
          entryPoints: [input],
          bundle: true,
          write: false,
          platform: 'node',
          format: 'cjs',
          external,
          plugins: [esbuildPlugin(options)],
        });
        code = built.outputFiles![0]!.text;
      } else if (tool === 'rollup') {
        const bundle = await rollup({ input, external, plugins: [rollupPlugin(options)] });
        try {
          const { output } = await bundle.generate({ format: 'cjs' });
          const chunk = output[0]!;
          if (chunk.type !== 'chunk') throw Error('Expected chunk');
          code = chunk.code;
        } finally {
          await bundle.close();
        }
      } else if (tool === 'vite') {
        await vite({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [vitePlugin(options)],
          build: {
            outDir: join(root, 'dist'),
            lib: { entry: input, formats: ['cjs'], fileName: () => 'slots.cjs' },
            rollupOptions: { external },
          },
        });
        code = readFileSync(outfile, 'utf8');
      } else {
        const config = {
          mode: 'none' as const,
          target: 'node',
          entry: input,
          externals: external,
          output: {
            path: join(root, 'dist'),
            filename: 'slots.cjs',
            library: { type: 'commonjs2' },
          },
          plugins: [tool === 'webpack' ? webpackPlugin(options) : rspackPlugin(options)],
        };
        const compiler =
          tool === 'webpack'
            ? webpack(config as webpack.Configuration)
            : rspack(config as Parameters<typeof rspack>[0]);
        if (!compiler) throw Error('Missing compiler');
        try {
          await new Promise<void>((resolve, reject) =>
            compiler.run((error, stats) => {
              if (error) reject(error);
              else if (stats?.hasErrors())
                reject(Error(stats.toString({ all: false, errors: true })));
              else resolve();
            }),
          );
          code = readFileSync(outfile, 'utf8');
        } finally {
          await new Promise<void>((resolve, reject) =>
            compiler.close((error) => (error ? reject(error) : resolve())),
          );
        }
      }
      expect(code).toMatch(
        vueDefaultSlot === 'object' ? /children:\s*\{\s*default:/ : /children:\s*\(\)\s*=>/,
      );
      const module = { exports: {} as { view: any } };
      Function(
        'module',
        'exports',
        'require',
        code,
      )(module, module.exports, createRequire(import.meta.url));
      expect(await renderToString(createSSRApp({ render: () => module.exports.view }))).toBe(
        '<section><button>Save</button></section>',
      );
    }
  },
);
