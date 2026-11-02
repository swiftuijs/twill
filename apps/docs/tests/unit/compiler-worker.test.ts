import { beforeAll, afterAll, afterEach, expect, test, vi } from 'vitest';
import type { CompileRequest, CompileResponse } from '../../.vitepress/theme/playground/protocol';
import { formatGenerated } from '@swiftuijs/twill-formatter/standalone';
import { transform } from '@swiftuijs/twill';
vi.mock('@swiftuijs/twill-formatter/standalone', async (original) => ({
  ...(await original<typeof import('@swiftuijs/twill-formatter/standalone')>()),
  formatGenerated: vi.fn((...args: any[]) =>
    original<typeof import('@swiftuijs/twill-formatter/standalone')>().then((module) =>
      (module.formatGenerated as any)(...args),
    ),
  ),
}));
vi.mock('@swiftuijs/twill', async (original) => {
  const module = await original<typeof import('@swiftuijs/twill')>();
  return { ...module, transform: vi.fn(module.transform) };
});
const worker = {
  onmessage: undefined as unknown as (event: MessageEvent<CompileRequest>) => Promise<void>,
  postMessage: vi.fn(),
};
beforeAll(async () => {
  vi.stubGlobal('self', worker);
  await import('../../.vitepress/theme/compiler.worker');
});
afterEach(() => {
  vi.mocked(formatGenerated).mockClear();
  vi.mocked(transform).mockClear();
  worker.postMessage.mockClear();
});
afterAll(() => vi.unstubAllGlobals());
async function compile(source: string, filename = 'example.twill', jsxImportSource = 'react') {
  await worker.onmessage({
    data: { id: 42, source, filename, jsxImportSource },
  } as MessageEvent<CompileRequest>);
  expect(worker.postMessage).toHaveBeenCalledOnce();
  return worker.postMessage.mock.calls[0]![0] as CompileResponse;
}
test('compiles nullish branch bindings without wrappers or a runtime', async () => {
  const response = await compile(
    'export function f(input:number|null){if const value=input{return value;}return 0;}',
  );
  expect(response.error).toBeUndefined();
  expect(response.result?.ifBindings).toBe(1);
  expect(response.result?.code).toContain('!== null');
  expect(response.result?.code).not.toMatch(/=>|Promise|import /);
});
test('compiles and formats combined dialect features, retaining the request ID and feature counts', async () => {
  const response = await compile(
    'export const result=[{active:true}].map { guard .active else { return false; } defer {} return switch (.active) {case true: 1;default: 0;}; };',
  );
  expect(response).toMatchObject({
    id: 42,
    result: { closures: 1, guards: 1, defers: 1, switches: 1 },
  });
  expect(response.result!.code).toContain('finally');
  expect(response.result!.duration).toBeGreaterThanOrEqual(0);
});
test('compiles UI files using the selected native JSX runtime', async () => {
  const response = await compile('const view = Panel { "child"; };', 'example.twillx', 'vue');
  expect(response.result!.code).toContain('@jsxImportSource vue');
  expect(response.result!.code).toContain('<Panel>');
});

test('compiles enum-case patterns in the browser worker without a matching runtime', async () => {
  const response = await compile(
    'enum State{case idle;case loaded(value:number);}function read(state:State){return match(state){case State.idle():0;case State.loaded({value}):value;};}',
  );
  expect(response.error).toBeUndefined();
  expect(response.result?.code).toContain('typeof State.loaded');
  expect(response.result?.code).not.toContain('match(');
  expect(response.result?.code).not.toContain('State.loaded(');
});
test('reports original-source error positions and can compile the next request', async () => {
  expect(await compile('const value = 1;\nusers.map { . };')).toMatchObject({
    id: 42,
    error: { line: 2, column: expect.any(Number), offset: expect.any(Number) },
  });
  worker.postMessage.mockClear();
  expect((await compile('export const value=1;')).result?.code).toContain('value = 1');
});
test('accepts the exact source limit and rejects oversized input before parsing or formatting', async () => {
  expect((await compile(' '.repeat(20_000))).result).toBeDefined();
  worker.postMessage.mockClear();
  vi.mocked(transform).mockClear();
  vi.mocked(formatGenerated).mockClear();
  expect(await compile(' '.repeat(20_001))).toMatchObject({
    error: { message: expect.stringContaining('20,000') },
  });
  expect(transform).not.toHaveBeenCalled();
  expect(formatGenerated).not.toHaveBeenCalled();
});
test('keeps valid compiled output available when display formatting fails', async () => {
  vi.mocked(formatGenerated).mockRejectedValueOnce(new Error('display failed'));
  const response = await compile('[1].map { n in n + 1 };');
  expect(response.error).toBeUndefined();
  expect(response.result?.code).toMatch(/=>\s*n \+ 1/);
  expect(response.result?.code).not.toContain('return');
});
test('reports unexpected non-Error compiler failures without losing request identity', async () => {
  vi.mocked(transform).mockImplementationOnce(() => {
    throw 'compiler failed';
  });
  expect(await compile('source')).toEqual({ id: 42, error: { message: 'compiler failed' } });
});
