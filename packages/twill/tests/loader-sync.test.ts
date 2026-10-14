import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModule } from '../src/loader-compiler';
import { TwillSyntaxError } from '../src/compiler';
import { fixtureRoot } from './helpers/fixture';

const bridge = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock('node:module', async (original) => {
  const actual = await original<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: (url: string | URL) =>
      String(url).endsWith('/src/loader-sync.ts') ? bridge.require : actual.createRequire(url),
  };
});
import { createHooks } from '../src/loader-sync';

const roots: string[] = [];
beforeEach(() => {
  bridge.require.mockReset();
  bridge.require.mockReturnValue({ compileModule: vi.fn(compileModule) });
});
afterEach(() => {
  vi.unstubAllEnvs();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function fixture() {
  const root = fixtureRoot('loader-sync-');
  roots.push(root);
  return root;
}
const context = { conditions: ['node'], importAttributes: {}, parentURL: undefined };
const host = { ...context, format: 'module' as const };

it('delegates native/dependency/non-file loading without loading the compiler', () => {
  const root = fixture();
  const hooks = createHooks();
  const next = vi.fn(() => ({ format: 'module' as const, source: 'host' }));
  for (const url of [
    'node:fs',
    pathToFileURL(join(root, 'plain.js')).href,
    pathToFileURL(join(root, 'node_modules/pkg/index.ts')).href,
  ])
    expect(hooks.load!(url, host, next)).toEqual({ format: 'module', source: 'host' });
  expect(bridge.require).not.toHaveBeenCalled();
});
it('uses synchronous host resolution and only resolves missing relative sources', () => {
  const root = fixture();
  writeFileSync(join(root, 'value.twill'), 'export const value = 1;');
  mkdirSync(join(root, 'directory'));
  writeFileSync(join(root, 'directory/index.ts'), 'export const value: number = 2;');
  const hooks = createHooks();
  const result = { url: 'node:fs', format: 'builtin' as const };
  expect(hooks.resolve!('node:fs', context, () => result)).toBe(result);
  const parent = { ...context, parentURL: pathToFileURL(join(root, 'main.js')).href };
  const missing = Object.assign(new Error('missing'), { code: 'ERR_MODULE_NOT_FOUND' });
  for (const [specifier, file] of [
    ['./value?mode=test#part', 'value.twill'],
    ['./directory', 'directory/index.ts'],
  ])
    expect(
      hooks.resolve!(specifier!, parent, () => {
        throw missing;
      }),
    ).toMatchObject({
      url:
        pathToFileURL(join(root, file!)).href + (specifier!.includes('?') ? '?mode=test#part' : ''),
      shortCircuit: true,
    });
  for (const specifier of ['package', './absent'])
    expect(() =>
      hooks.resolve!(specifier, parent, () => {
        throw missing;
      }),
    ).toThrow(missing);
  const denied = Object.assign(new Error('denied'), { code: 'ERR_ACCESS_DENIED' });
  expect(() =>
    hooks.resolve!('./value', parent, () => {
      throw denied;
    }),
  ).toThrow(denied);
});
it('loads mixed local sources synchronously with original maps and lazy compiler reuse', () => {
  const root = fixture();
  writeFileSync(join(root, 'base.json'), '{"compilerOptions":{"jsxImportSource":"vue"}}');
  writeFileSync(join(root, 'tsconfig.json'), '{"extends":"./base.json"}');
  const files = {
    'main.twill': 'export const value: number[] = [1].map { n in n + 1 };',
    'view.tsx': 'export const view = <div/>;',
    'view.twillx': 'const Card = "article"; export const view = Card { "child"; };',
    deploy: 'export const value: number = 1;',
  };
  const hooks = createHooks({ entries: [pathToFileURL(join(root, 'deploy')).href] });
  const next = vi.fn(() => ({ format: 'module' as const, source: 'host' }));
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(root, name), source);
    const result = hooks.load!(pathToFileURL(join(root, name)).href, host, next);
    expect(result).toMatchObject({ format: 'module', shortCircuit: true });
    expect(result).not.toBeInstanceOf(Promise);
    const code = String(result.source);
    const map = JSON.parse(Buffer.from(code.split('base64,').at(-1)!, 'base64').toString());
    expect(map.sourcesContent).toEqual([source]);
    if (name.startsWith('view')) expect(code).toContain('vue/jsx-runtime');
  }
  expect(next).not.toHaveBeenCalled();
  expect(bridge.require).toHaveBeenCalledOnce();
});
it('returns identical bytes on cache hits without loading the compiler in a fresh hook', () => {
  const root = fixture();
  const cache = join(root, 'cache');
  vi.stubEnv('TWILL_CACHE_DIR', cache);
  const file = join(root, 'cached.twill');
  const url = pathToFileURL(file).href;
  writeFileSync(file, 'export const value: number = [1].map { n in n + 1 }[0];');
  const next = vi.fn(() => ({ format: 'module' as const, source: 'host' }));
  const first = createHooks({ cache: true }).load!(url, host, next);
  const record = join(cache, readdirSync(cache)[0]!);
  const bytes = readFileSync(record, 'utf8');
  bridge.require.mockClear();
  expect(createHooks({ cache: true }).load!(url, host, next)).toEqual(first);
  expect(readFileSync(record, 'utf8')).toBe(bytes);
  expect(bridge.require).not.toHaveBeenCalled();
  writeFileSync(file, 'export const value: number = ;');
  expect(() => createHooks({ cache: true }).load!(url, host, next)).toThrow(TwillSyntaxError);
});
