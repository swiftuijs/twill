import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/cli';
import { fixtureRoot } from './helpers/fixture';

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
function fixture(source = 'export const result = [1, 2].map { value in value * 2 };') {
  const root = fixtureRoot('cli-');
  roots.push(root);
  const config = join(root, 'tsconfig.json');
  const input = join(root, 'main.twill');
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        types: [],
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
      include: ['*.twill', '*.ts'],
    }),
  );
  writeFileSync(input, source);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return { root, config, input, log, error, stdout };
}

it.each(['check', 'doctor', 'declarations'])(
  '%s locates fileless configuration diagnostics',
  async (command) => {
    const { root, log, error } = fixture();
    const config = join(root, 'invalid.json');
    writeFileSync(
      config,
      '{"compilerOptions":{"unknownCompilerOption":true},"files":["main.twill"]}',
    );
    expect(await main([command, '-p', config])).toBe(1);
    expect((command === 'doctor' ? log : error).mock.calls.flat().join('\n')).toContain(
      'tsconfig:',
    );
    expect(await main([command, '-p', config, '--json'])).toBe(1);
    const report = JSON.parse(log.mock.calls.at(-1)![0]);
    expect(command === 'check' ? report : report.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 5023 })]),
    );
  },
);

it.each([[], ['--help'], ['compile', '--help']].map((args) => [args]))(
  'prints usage for %j',
  async (args) => {
    const { log } = fixture();
    expect(await main(args)).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('twill declarations'));
  },
);
it.each(
  [
    ['unknown'],
    ['compile'],
    ['compile', 'a', 'b'],
    ['check', 'file'],
    ['doctor', 'file'],
    ['declarations', 'file'],
    ['--unknown'],
  ].map((args) => [args]),
)('rejects invalid arguments %j', async (args) => {
  fixture();
  await expect(main(args)).rejects.toThrow();
});
it('emits typed and runnable output with original source maps without changing the input', async () => {
  const source = 'export const result: number[] = [1, 2].map { value in value * 2 };';
  const { root, input, config } = fixture(source);
  for (const js of [false, true]) {
    const output = join(root, 'nested', js ? 'main.js' : 'main.ts');
    expect(
      await main(['compile', input, '-p', config, '-o', output, ...(js ? ['--js'] : [])]),
    ).toBe(0);
    const code = readFileSync(output, 'utf8');
    expect(code).toContain('sourceMappingURL=' + (js ? 'main.js.map' : 'main.ts.map'));
    expect(code.includes(': number[]')).toBe(!js);
    const map = JSON.parse(readFileSync(output + '.map', 'utf8'));
    expect(map.file).toBe(js ? 'main.js' : 'main.ts');
    expect(map.sourcesContent).toEqual([source]);
  }
  expect(readFileSync(input, 'utf8')).toBe(source);
  await expect(main(['compile', input, '-o', input])).rejects.toThrow('Output must differ');
});
it('prints code and never writes output for malformed source or missing input', async () => {
  const { root, input, config, stdout } = fixture();
  expect(await main(['compile', input, '-p', config])).toBe(0);
  expect(stdout).toHaveBeenCalledWith(expect.stringContaining('return (value * 2)'));
  writeFileSync(input, 'users.map { .');
  const output = join(root, 'output.js');
  await expect(main(['compile', input, '-p', config, '-o', output])).rejects.toThrow();
  expect(existsSync(output)).toBe(false);
  await expect(main(['compile', join(root, 'missing.twill')])).rejects.toThrow('ENOENT');
});
it.each(['check', 'doctor'])(
  '%s reports success and source diagnostics in text and JSON',
  async (command) => {
    const { input, config, log, error } = fixture();
    expect(await main([command, '-p', config])).toBe(0);
    expect(await main([command, '-p', config, '--json'])).toBe(0);
    const good = JSON.parse(log.mock.calls.at(-1)![0]);
    expect(command === 'check' ? good : good.diagnostics).toEqual([]);
    if (command === 'doctor')
      expect(good).toMatchObject({ files: { twill: 1, native: 0 }, ok: true });
    writeFileSync(input, 'export const result: number = "wrong";');
    expect(await main([command, '-p', config])).toBe(1);
    expect((command === 'check' ? error : log).mock.calls.flat().join('\n')).toContain('TS2322');
    expect(await main([command, '-p', config, '--json'])).toBe(1);
    const bad = JSON.parse(log.mock.calls.at(-1)![0]);
    expect(command === 'check' ? bad : bad.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 2322, filename: input.replaceAll('\\', '/') }),
      ]),
    );
    if (command === 'doctor') expect(bad.ok).toBe(false);
  },
);
it('declarations emits maps and reports invalid projects without partial output', async () => {
  const { root, input, config, log, error } = fixture();
  const output = join(root, 'types');
  expect(await main(['declarations', '-p', config, '-o', output])).toBe(0);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('Emitted'));
  expect(readFileSync(join(output, 'main.d.ts'), 'utf8')).toContain('number[]');
  expect(await main(['declarations', '-p', config, '-o', output, '--json'])).toBe(0);
  expect(JSON.parse(log.mock.calls.at(-1)![0]).diagnostics).toEqual([]);
  writeFileSync(input, 'export const result: number = "wrong";');
  const badOutput = join(root, 'invalid');
  expect(await main(['declarations', '-p', config, '-o', badOutput])).toBe(1);
  expect(error.mock.calls.flat().join('\n')).toContain('TS2322');
  expect(existsSync(badOutput)).toBe(false);
});
it('declarations builds a reference-only solution and compile honors the selected config', async () => {
  const { root, input, config } = fixture();
  writeFileSync(join(root, 'twill.config.json'), '{"implicitReturn":false}');
  const stdout = vi.mocked(process.stdout.write);
  await main(['compile', input, '-p', config]);
  expect(stdout.mock.calls.flat().join('')).not.toContain('return (');
  const child = join(root, 'child');
  mkdirSync(child);
  writeFileSync(
    join(child, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { composite: true, types: [] }, include: ['*.twill'] }),
  );
  writeFileSync(join(child, 'api.twill'), 'export const value = 1;');
  writeFileSync(join(root, 'solution.json'), '{"files":[],"references":[{"path":"./child"}]}');
  expect(
    await main([
      'declarations',
      '-p',
      join(root, 'solution.json'),
      '--build',
      '-o',
      join(root, 'built'),
    ]),
  ).toBe(0);
});
it('uses external config for compile and allows an inline CLI override', async () => {
  const { root, input, config, stdout } = fixture(
    'export function run(events:number[]){if(true)defer {events.push(1);}defer {events.push(2);}return 3;}',
  );
  writeFileSync(join(root, 'twill.config.json'), '{"runtime":"external"}');
  expect(await main(['compile', input, '-p', config])).toBe(0);
  expect(stdout.mock.calls.flat().join('')).toContain('@swiftuijs/twill-runtime/helpers/v1');
  stdout.mockClear();
  expect(await main(['compile', input, '-p', config, '--js', '--runtime', 'inline'])).toBe(0);
  expect(stdout.mock.calls.flat().join('')).not.toContain('twill-runtime');
  stdout.mockClear();
  writeFileSync(join(root, 'twill.config.json'), '{"runtime":"inline"}');
  expect(await main(['compile', input, '-p', config, '--runtime', 'external'])).toBe(0);
  expect(stdout.mock.calls.flat().join('')).toContain('twill-runtime');
});
it.each([
  ['compile', 'file', '--runtime', 'auto'],
  ['check', '--runtime', 'external'],
  ['declarations', '--runtime', 'inline'],
])('rejects invalid or misplaced runtime flags %j', async (...args) => {
  fixture();
  await expect(main(args)).rejects.toThrow(/runtime/);
});

it.each(['check', 'doctor', 'declarations'])(
  '%s explains malformed guards in text and JSON',
  async (command) => {
    const source =
      'export function divide(a: number, b: number) {\n  guard b != 0 { return 0; }\n  return a / b;\n}';
    const { config, log, error } = fixture(source);
    expect(await main([command, '-p', config])).toBe(1);
    expect((command === 'doctor' ? log : error).mock.calls.flat().join('\n')).toContain(
      "Missing 'else' in guard statement",
    );
    expect(await main([command, '-p', config, '--json'])).toBe(1);
    const report = JSON.parse(log.mock.calls.at(-1)![0]);
    expect(command === 'check' ? report : report.diagnostics).toEqual([
      expect.objectContaining({
        code: 90001,
        line: 2,
        column: 2,
        message: expect.stringContaining("Missing 'else' in guard statement"),
      }),
    ]);
  },
);

it('compile reports a guard correction and does not emit invalid output', async () => {
  const { root, input } = fixture(
    'function divide(a: number, b: number) {\n  guard b != 0 { return 0; }\n  return a / b;\n}',
  );
  const output = join(root, 'divide.js');
  await expect(main(['compile', input, '--js', '-o', output])).rejects.toThrow(
    "Missing 'else' in guard statement",
  );
  expect(existsSync(output)).toBe(false);
});
