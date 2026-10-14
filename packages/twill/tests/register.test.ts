import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  register: vi.fn(),
  hooks: undefined as ReturnType<typeof vi.fn> | undefined,
}));
vi.mock('node:module', async (original) => ({
  ...(await original<typeof import('node:module')>()),
  register: api.register,
  get registerHooks() {
    return api.hooks;
  },
}));
const argv = [...process.execArgv];
beforeEach(() => {
  vi.resetModules();
  api.register.mockReset();
  api.hooks = undefined;
});
afterEach(() => process.execArgv.splice(0, process.execArgv.length, ...argv));

it('keeps the old-Node public preload relative to its own module', async () => {
  await import('../src/register');
  expect(api.register).toHaveBeenCalledOnce();
  expect(api.register).toHaveBeenCalledWith(
    './loader.js',
    expect.stringMatching(/\/src\/loader-registration\.ts$/),
    { data: {} },
  );
});
it('passes explicit entries and cache policy to the compatibility adapter', async () => {
  const { registerLoader } = await import('../src/loader-registration');
  const data = { entries: ['file:///script'], cache: true };
  await registerLoader(data, true);
  expect(api.register).toHaveBeenCalledWith('./loader.js', expect.any(String), { data });
  expect(process.execArgv.slice(0, -2)).toEqual(argv);
  expect(process.execArgv.at(-2)).toBe('--import');
});
it('prefers synchronous hooks and keeps the public preload uncached', async () => {
  const handle = { deregister: vi.fn() };
  api.hooks = vi.fn(() => handle);
  await import('../src/register');
  expect(api.register).not.toHaveBeenCalled();
  expect(api.hooks).toHaveBeenCalledWith({
    resolve: expect.any(Function),
    load: expect.any(Function),
  });
  expect(process.execArgv).toEqual(argv);
});
it('adds one inheritable preload for the runner without changing argv or repeating flags', async () => {
  const handle = { deregister: vi.fn() };
  api.hooks = vi.fn(() => handle);
  const { registerLoader } = await import('../src/loader-registration');
  const data = { entries: ['file:///script%20with%20spaces'], cache: true };
  expect(await registerLoader(data, true)).toBe(handle);
  const inherited = [...process.execArgv];
  expect(inherited.slice(0, -2)).toEqual(argv);
  expect(inherited.at(-2)).toBe('--import');
  const code = decodeURIComponent(inherited.at(-1)!.slice('data:text/javascript,'.length));
  expect(code).toContain('registerLoader(' + JSON.stringify(data) + ')');
  expect(code).toContain('loader-registration.ts');
  await registerLoader(data, true);
  expect(process.execArgv).toEqual(inherited);
});
