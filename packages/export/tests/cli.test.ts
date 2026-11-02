import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main } from '../src/cli.twill';
const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'twill-export-cli-'));
  roots.push(directory);
  const root = join(directory, 'input');
  mkdirSync(root);
  const config = join(root, 'tsconfig.json'),
    file = join(root, 'main.twill'),
    out = join(directory, 'output');
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
      include: ['*.twill'],
    }),
  );
  writeFileSync(file, 'export const doubled=[1,2].map { n in n*2 };');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {}),
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { directory, root, config, file, out, log, error };
}
it('prints help and rejects missing output or positional arguments', async () => {
  const { log } = fixture();
  expect(await main(['--help'])).toBe(0);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('twill export'));
  await expect(main([])).rejects.toThrow('Specify --out');
  await expect(main(['file', '-o', 'output'])).rejects.toThrow('positional arguments');
  await expect(main(['--unknown'])).rejects.toThrow();
});
it('plans JSON output without writing, then exports checked formatted native code', async () => {
  const { config, out, log, file } = fixture();
  expect(await main(['-p', config, '-o', out, '--dry-run', '--json'])).toBe(0);
  expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ written: false });
  expect(existsSync(out)).toBe(false);
  expect(await main(['-p', config, '-o', out, '--dry-run'])).toBe(0);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('Planned'));
  expect(await main(['-p', config, '-o', out])).toBe(0);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('Exported'));
  expect(readFileSync(join(out, 'main.ts'), 'utf8')).toContain('map((n) => n * 2)');
  expect(readFileSync(file, 'utf8')).toContain('map {');
});
it('returns failure and original diagnostics without creating output', async () => {
  const { config, out, file, log, error } = fixture();
  writeFileSync(file, 'export const value:number="wrong";');
  expect(await main(['-p', config, '-o', out])).toBe(1);
  expect(error.mock.calls.flat().join('\n')).toContain('TS2322');
  expect(existsSync(out)).toBe(false);
  expect(await main(['-p', config, '-o', out, '--json'])).toBe(1);
  expect(JSON.parse(log.mock.calls.at(-1)![0]).diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 2322 })]),
  );
});
it('uses the current project config when no project flag is supplied', async () => {
  const { root, out, log } = fixture();
  const previous = process.cwd();
  try {
    process.chdir(root);
    expect(await main(['--out', out, '--dry-run'])).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Planned'));
    expect(existsSync(out)).toBe(false);
  } finally {
    process.chdir(previous);
  }
});
it('prints config-level diagnostics without inventing a source filename', async () => {
  const { config, out, error } = fixture();
  writeFileSync(config, '{"compilerOptions":{"unknownCompilerOption":true}}');
  expect(await main(['--project', config, '--out', out])).toBe(1);
  expect(error.mock.calls.flat().join('\n')).toContain('tsconfig:');
  expect(error.mock.calls.flat().join('\n')).toContain('TS5023');
  expect(existsSync(out)).toBe(false);
});
