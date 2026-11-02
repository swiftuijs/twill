import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve, load, initialize } from '../src/loader';
import { transpile, transpileNative } from '../src/transpile';
import { parseSyntax } from '../src/syntax';
import { inferLanguage, transform } from '../src/compiler';
import { fixtureRoot } from './helpers/fixture';

const roots: string[] = [];
afterEach(() => {
  initialize(undefined);
  vi.unstubAllEnvs();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function fixture() {
  const root = fixtureRoot('runtime-hooks-');
  roots.push(root);
  return root;
}
const context = { conditions: ['node'], importAttributes: {}, parentURL: undefined };

it('marks only the explicit non-native entry as Twill and resets on ordinary registration', async () => {
  const root = fixture();
  const filename = join(root, 'deploy');
  writeFileSync(
    filename,
    '#!/usr/bin/env twill\nexport const value: number[] = [1].map { .toFixed(); };',
  );
  const url = pathToFileURL(filename).href;
  const next = vi.fn(async () => ({ format: 'module', source: 'host' }));
  const host = { format: 'module', importAttributes: {}, conditions: ['node'] };
  initialize({ entries: [url] });
  expect(String((await load(url, host, next)).source)).toMatch(/=>\s*__twillArg\d+\.toFixed\(\)/);
  expect(next).not.toHaveBeenCalled();
  expect(await load(pathToFileURL(join(root, 'other')).href, host, next)).toEqual({
    format: 'module',
    source: 'host',
  });
  initialize({});
  expect(await load(url, host, next)).toEqual({ format: 'module', source: 'host' });
});

it('defers successful, bare, non-file and unrelated failing resolutions to Node', async () => {
  const success = { url: 'node:fs', format: 'builtin' as const };
  const next = vi.fn(async () => success);
  expect(await resolve('node:fs', context, next)).toBe(success);
  const failure = Object.assign(new Error('host failed'), { code: 'ERR_ACCESS_DENIED' });
  const failed = vi.fn(async () => {
    throw failure;
  });
  await expect(
    resolve('./main', { ...context, parentURL: 'file:///main.js' }, failed),
  ).rejects.toBe(failure);
  for (const [specifier, parentURL] of [
    ['package', 'file:///main.js'],
    ['./main', 'https://example.test/main.js'],
    ['./main', undefined],
  ]) {
    const missing = Object.assign(new Error('missing'), { code: 'ERR_MODULE_NOT_FOUND' });
    await expect(
      resolve(specifier!, { ...context, parentURL }, async () => {
        throw missing;
      }),
    ).rejects.toBe(missing);
  }
});
it.each(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'])(
  'resolves mixed extensionless files and directories after %s, retaining query and fragment',
  async (code) => {
    const root = fixture();
    mkdirSync(join(root, 'directory'));
    writeFileSync(join(root, 'value.twill'), 'export const value = 1;');
    writeFileSync(join(root, 'directory/index.ts'), 'export const value = 2;');
    const missing = Object.assign(new Error('missing'), { code });
    const next = async () => {
      throw missing;
    };
    const host = { ...context, parentURL: pathToFileURL(join(root, 'main.js')).href };
    for (const [specifier, target] of [
      ['./value?mode=dev#part', 'value.twill'],
      ['./directory', 'directory/index.ts'],
    ]) {
      expect(await resolve(specifier!, host, next)).toMatchObject({
        url:
          pathToFileURL(join(root, target!)).href +
          (specifier!.includes('?') ? '?mode=dev#part' : ''),
        shortCircuit: true,
      });
    }
    await expect(resolve('./absent', host, next)).rejects.toBe(missing);
  },
);
it('loads Twill and native TS/JSX with inherited JSX configuration and inline original sources', async () => {
  const root = fixture();
  const nested = join(root, 'nested');
  mkdirSync(nested);
  writeFileSync(join(root, 'base.json'), '{"compilerOptions":{"jsxImportSource":"vue"}}');
  writeFileSync(join(root, 'tsconfig.json'), '{"extends":"./base.json"}');
  const files = {
    'main.twill': 'export const result: number[] = [1,2].map { n in n * 2 };',
    'view.tsx': 'export const view = <div>child</div>;',
    'view.twillx': 'const Card = "article"; export const view = Card { "child"; };',
  };
  const next = vi.fn(async () => ({ format: 'module', source: 'unchanged' }));
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(nested, name), source);
    const result = await load(
      pathToFileURL(join(nested, name)).href,
      { format: 'module', importAttributes: {}, conditions: ['node'] },
      next,
    );
    expect(result).toMatchObject({ format: 'module', shortCircuit: true });
    const code = String(result.source);
    if (name.includes('view')) expect(code).toContain('vue/jsx-runtime');
    const map = JSON.parse(Buffer.from(code.split('base64,').at(-1)!, 'base64').toString());
    expect(map.sourcesContent).toEqual([source]);
  }
  expect(next).not.toHaveBeenCalled();
});
it('loads native sources without configuration and preserves host handling for JS, dependencies and non-file URLs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'twill-no-runtime-config-'));
  roots.push(root);
  writeFileSync(join(root, 'plain.ts'), 'export const value: number = 2;');
  const next = vi.fn(async () => ({ format: 'module', source: 'host' }));
  const host = { format: 'module', importAttributes: {}, conditions: ['node'] };
  expect(
    String((await load(pathToFileURL(join(root, 'plain.ts')).href, host, next)).source),
  ).toContain('value = 2');
  for (const url of [
    'node:fs',
    pathToFileURL(join(root, 'plain.js')).href,
    pathToFileURL(join(root, 'node_modules/lib/index.ts')).href,
  ]) {
    expect(await load(url, host, next)).toEqual({ format: 'module', source: 'host' });
  }
  writeFileSync(join(root, 'twill.config.json'), '{"implicitReturn":false}');
  writeFileSync(join(root, 'configured.twill'), 'export const value = [1].map { n in n * 2 };');
  const result = await load(pathToFileURL(join(root, 'configured.twill')).href, host, next);
  expect(String(result.source)).toContain('=> {');
});
it('native JS is byte-preserved and invalid TS is rejected before host emission', () => {
  const source = '/* unchanged */ export const value = 1;';
  expect(transpileNative(source, 'main.mjs').code).toBe(source);
  expect(transpile(source, { language: 'js' }).code).toBe(source);
  expect(() => transpileNative('const = ;', 'broken.ts')).toThrow('error TS');
  expect(() => transpile('users.map { .')).toThrow();
});
it.each([
  ['file.jsx', 'jsx'],
  ['file.js', 'js'],
  ['file.mjs', 'js'],
  ['file.cjs', 'js'],
  ['file.twill', 'ts'],
  ['file.twillx', 'tsx'],
])('infers %s and exposes original syntax metadata', (filename, language) => {
  expect(inferLanguage(filename!)).toBe(language);
  const parsed = parseSyntax('const out = [1].map { value in value + 1 };', { filename });
  expect(parsed.calls).toHaveLength(1);
  expect(parsed.closures).toHaveLength(1);
  expect(parsed.closures[0].header.text).toBe('value');
});
it('supports native JSX and script parsing through the syntax API', () => {
  expect(parseSyntax('const value:number=1;').ast.body).toHaveLength(1);
  expect(parseSyntax('const view = <div/>;', { filename: 'view.jsx' }).ast.body).toHaveLength(1);
  expect(
    parseSyntax('const values = [1].map { n in n + 1 };', { language: 'js', sourceType: 'script' })
      .ast.sourceType,
  ).toBe('script');
  expect(() => transform('interface Value {}', { filename: 'main.js' })).toThrow();
});
it('preserves comment-only source and uncoded resolver errors', async () => {
  const source = '/* standalone comment */';
  expect(transform(source).code).toBe(source);
  const failure = new Error('unexpected resolver failure');
  await expect(
    resolve('./missing', context, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});

it('serves identical cached loader bytes and resets cache opt-in on ordinary registration', async () => {
  const root = fixture();
  const cache = join(root, 'cache');
  vi.stubEnv('TWILL_CACHE_DIR', cache);
  const filename = join(root, 'cached.twill');
  writeFileSync(filename, 'export const values:number[]=[1].map { n in n+1 };');
  const url = pathToFileURL(filename).href;
  const host = { format: 'module', importAttributes: {}, conditions: ['node'] };
  const next = vi.fn(async () => ({ format: 'module', source: 'host' }));
  initialize({ cache: true });
  const first = await load(url, host, next);
  const path = join(cache, readdirSync(cache)[0]!);
  const time = statSync(path).mtimeMs;
  expect(await load(url, host, next)).toEqual(first);
  expect(statSync(path).mtimeMs).toBe(time);
  initialize(undefined);
  expect(await load(url, host, next)).toEqual(first);
  vi.stubEnv('TWILL_CACHE', '0');
  initialize({ cache: true });
  expect(await load(url, host, next)).toEqual(first);
  expect(next).not.toHaveBeenCalled();
});
it('compiles normally when optional cache setup cannot be used', async () => {
  const root = fixture();
  const filename = join(root, 'cached.ts');
  writeFileSync(filename, 'export const value:number=1;');
  vi.stubEnv('TWILL_CACHE_DIR', 'relative');
  initialize({ cache: true });
  const host = { format: 'module', importAttributes: {}, conditions: ['node'] };
  const next = vi.fn(async () => ({ format: 'module', source: 'host' }));
  for (let i = 0; i < 2; i++)
    expect(String((await load(pathToFileURL(filename).href, host, next)).source)).toContain(
      'value = 1',
    );
});
