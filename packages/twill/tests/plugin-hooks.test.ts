import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { twillPlugin } from '../src/plugin';
import { fixtureRoot } from './helpers/fixture';

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.useRealTimers();
});
function fixture() {
  const root = fixtureRoot('plugin-hooks-');
  roots.push(root);
  return root;
}
const factory = twillPlugin.raw as any;

it('watches inherited and absent configuration, reports invalid saves and recovers with the final contents', () => {
  vi.useFakeTimers();
  const root = fixture();
  writeFileSync(join(root, 'base.json'), '{"compilerOptions":{"jsxImportSource":"react"}}');
  writeFileSync(join(root, 'tsconfig.json'), '{"extends":"./base.json"}');
  const plugin = factory({ root }, { framework: 'vite' });
  plugin.vite.configResolved({ root, command: 'serve' });
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
  const httpServer = new EventEmitter();
  const invalidateAll = vi.fn(),
    send = vi.fn(),
    error = vi.fn();
  plugin.vite.configureServer({
    watcher,
    httpServer,
    config: { logger: { error } },
    environments: { client: { moduleGraph: { invalidateAll } } },
    ws: { send },
  });
  expect(watcher.add.mock.calls[0]![0]).toContain(root);
  watcher.emit('change', join(root, 'unrelated.json'));
  vi.advanceTimersByTime(100);
  expect(send).not.toHaveBeenCalled();
  const config = join(root, 'twill.config.json');
  writeFileSync(config, '{"implicitReturn":"bad"}');
  watcher.emit('add', config);
  vi.advanceTimersByTime(75);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error', err: expect.objectContaining({ plugin: 'twill' }) }),
  );
  expect(error).toHaveBeenCalled();
  writeFileSync(config, '{"implicitReturn":false}');
  watcher.emit('change', config);
  writeFileSync(config, '{"implicitReturn":true}');
  watcher.emit('change', config);
  vi.advanceTimersByTime(75);
  expect(invalidateAll).toHaveBeenCalledOnce();
  expect(send).toHaveBeenLastCalledWith({ type: 'full-reload' });
  const watch = vi.fn();
  expect(
    plugin.transform.call(
      { addWatchFile: watch },
      '[1].map { n in n + 1 };',
      join(root, 'main.twill'),
    ).code,
  ).toContain('=> n + 1');
  expect(watch).not.toHaveBeenCalled();
  watcher.emit('unlink', config);
  httpServer.emit('close');
  vi.advanceTimersByTime(100);
  expect(invalidateAll).toHaveBeenCalledOnce();
});
it('supports the legacy single Vite module graph and a middleware server without HTTP', () => {
  vi.useFakeTimers();
  const root = fixture();
  const plugin = factory({ root }, { framework: 'vite' });
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
  const invalidateAll = vi.fn(),
    send = vi.fn();
  plugin.vite.configureServer({ watcher, moduleGraph: { invalidateAll }, ws: { send } });
  writeFileSync(join(root, 'twill.config.json'), '{}');
  watcher.emit('add', join(root, 'twill.config.json'));
  vi.advanceTimersByTime(75);
  expect(invalidateAll).toHaveBeenCalledOnce();
});
it('keeps host resolution and emission opt-outs, dependencies and query suffixes intact', () => {
  const root = fixture();
  writeFileSync(join(root, 'file.twill'), 'export const value=1;');
  writeFileSync(join(root, 'file.ts'), 'export const native=2;');
  const plugin = factory({ root }, { framework: 'rollup' });
  expect(plugin.resolveId('./file?raw#part', join(root, 'importer.ts?query'))).toBe(
    join(root, 'file.ts') + '?raw#part',
  );
  expect(plugin.resolveId('./file.twill', undefined)).toBeNull();
  expect(plugin.resolveId('package', undefined)).toBeNull();
  expect(
    factory({ root, resolveExtensions: false }, { framework: 'rollup' }).resolveId('./file'),
  ).toBeNull();
  expect(factory({ root }, { framework: 'esbuild' }).resolveId('./file')).toBeNull();
  expect(plugin.transformInclude(join(root, 'node_modules/lib/file.twill'))).toBe(false);
  expect(plugin.transform.call({}, '', join(root, 'node_modules/lib/file.twill'))).toBeNull();
  expect(plugin.transform.call({}, '', join(root, 'file.js'))).toBeNull();
  expect(
    factory({ root, nativeSources: false }, { framework: 'rollup' }).transformInclude(
      join(root, 'file.ts'),
    ),
  ).toBe(false);
  expect(plugin.transformInclude(join(root, 'file.d.ts'))).toBe(false);
});
