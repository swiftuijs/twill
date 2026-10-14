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
  await registerLoader(data);
  expect(api.register).toHaveBeenCalledWith('./loader.js', expect.any(String), { data });
  expect(process.execArgv).toEqual(argv);
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
it('returns the synchronous registration handle without changing Node arguments', async () => {
  const handle = { deregister: vi.fn() };
  api.hooks = vi.fn(() => handle);
  const { registerLoader } = await import('../src/loader-registration');
  expect(await registerLoader({ entries: ['file:///script'], cache: true })).toBe(handle);
  expect(api.register).not.toHaveBeenCalled();
  expect(process.execArgv).toEqual(argv);
});
