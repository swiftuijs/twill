import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TwillProject, virtualFilename, sourceFilename } from '../src/project';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
function project(files: Record<string, string>, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'twill-project-'));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        checkJs: true,
      },
      include: ['**/*'],
    }),
  );
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  const project = new TwillProject(join(root, 'tsconfig.json'), options);
  cleanups.push(() => {
    project.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  return { project, root };
}

it('lowers JSX with the same runtime as an explicitly selected project', () => {
  const { root } = project({
    'tsconfig.vue.json':
      '{"extends":"./tsconfig.json","compilerOptions":{"jsx":"react-jsx","jsxImportSource":"vue"}}',
    'view.twillx': 'declare const Card: any; export const view = Card { "child"; };',
  });
  const selected = new TwillProject(join(root, 'tsconfig.vue.json'));
  cleanups.push(() => selected.dispose());
  expect(selected.compilerOptions.jsxImportSource).toBe('vue');
  expect(selected.transformed(join(root, 'view.twillx'))!.code).toContain('default:');
});

describe('virtual TypeScript projects', () => {
  it.each([false, true])('retains actionable strict guard errors with recovery=%s', (recover) => {
    const source =
      'export function divide(a: number, b: number) {\n  guard b != 0 { return 0; }\n  return a / b;\n}';
    const { root } = project({ 'divide.twill': source });
    const selected = new TwillProject(join(root, 'tsconfig.json'), {}, { recover });
    cleanups.push(() => selected.dispose());
    const file = join(root, 'divide.twill');
    expect(selected.diagnostics(file)).toEqual([
      expect.objectContaining({
        code: 90001,
        line: 2,
        column: 2,
        message: expect.stringContaining("Missing 'else' in guard statement"),
      }),
    ]);
    selected.update(file, source.replace('b != 0 {', 'b != 0 else {'));
    expect(selected.diagnostics(file)).toEqual([]);
  });

  it('infers callback parameters and checks cross-file imports', () => {
    const { project: p } = project({
      'numbers.twill': 'export const values: number[] = [1,2];',
      'main.twill':
        'import { values } from "./numbers.twill"; export const doubled = values.map() { value in value * 2 };',
      'consumer.ts': 'import {doubled} from "./main"; const result: number[] = doubled;',
    });
    expect(p.diagnostics()).toEqual([]);
  });
  it('maps type errors to original tokens', () => {
    const source = 'export const values = [1,2].map() { (value: number) in value.toUpperCase() };';
    const { project: p, root } = project({ 'main.twill': source });
    const diagnostic = p.diagnostics().find((error) => error.code === 2339)!;
    expect(diagnostic).toMatchObject({
      filename: sourceFilename(join(root, 'main.twill')),
      line: 1,
      column: source.indexOf('toUpperCase'),
    });
  });
  it('maps parameter positions in both directions', () => {
    const source = 'export const values = [1,2].map() { (value: number) in value + 1 };';
    const { project: p, root } = project({ 'main.twill': source });
    const file = join(root, 'main.twill');
    const offset = source.indexOf('value:');
    expect(p.toOriginalOffset(file, p.toGeneratedOffset(file, offset))).toBe(offset);
    const info = p.service.getQuickInfoAtPosition(
      virtualFilename(file),
      p.toGeneratedOffset(file, offset),
    );
    expect(info?.displayParts?.map((part) => part.text).join('')).toContain('value: number');
  });
  it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])(
    'maps cached offsets across %j line separators',
    (separator) => {
      const source =
        'export const prefix = 1;' +
        separator +
        'export const values = [1].map() { (value: number) in value + 1 };';
      const { project: p, root } = project({ 'main.twill': source });
      const file = join(root, 'main.twill');
      const offset = source.indexOf('value:');
      expect(p.toOriginalOffset(file, p.toGeneratedOffset(file, offset))).toBe(offset);
    },
  );
  it('checks JS and reports syntax failures without hiding other errors', () => {
    const { project: p } = project({
      'main.twill': 'export const x = [1].map() { value in value.missing() };',
      'broken.twill': 'fn() {',
    });
    expect(p.diagnostics().map((error) => error.code)).toEqual(
      expect.arrayContaining([2339, 90001]),
    );
  });
  it('updates imported overlays and invalidates cached snapshots', () => {
    const { project: p, root } = project({
      'main.twill':
        'export const x: number = fn() { "bad" }; function fn<T>(body:()=>T):T{return body();}',
    });
    expect(p.diagnostics().some((error) => error.code === 2322)).toBe(true);
    p.update(
      join(root, 'main.twill'),
      'export const x: number = fn() { 42 }; function fn<T>(body:()=>T):T{return body();}',
    );
    expect(p.diagnostics()).toEqual([]);
  });
  it('narrows guard conditions and nullish bindings across ordinary TS imports', () => {
    const { project: p } = project({
      'main.twill':
        'export function f(input: string | null) { guard input != null else { return 0; } guard const size = input.length else { throw new Error(); } return size; }',
      'consumer.ts': 'import { f } from "./main.twill"; const result: number = f(null);',
    });
    expect(p.diagnostics()).toEqual([]);
  });
  it('retains transforms and semantic snapshots when an overlay is unchanged', () => {
    const source = 'export const value = [1].map() { x in x * 2 };';
    const { project: p, root } = project({
      'main.twill': source,
      'other.ts': 'export const y = 2;',
    });
    const file = join(root, 'main.twill');
    p.update(file, source);
    const result = p.transformed(file);
    const program = p.service.getProgram();
    p.update(file, source);
    expect(p.transformed(file)).toBe(result);
    expect(p.service.getProgram()).toBe(program);
    p.update(join(root, 'other.ts'), 'export const y = 3;');
    expect(p.service.getProgram()?.getSourceFile(virtualFilename(file))).toBe(
      program?.getSourceFile(virtualFilename(file)),
    );
  });
  it('refreshes disk edits when clearing an overlay or explicitly updating a file', () => {
    const { project: p, root } = project({ 'main.twill': 'export const value = 1;' });
    const file = join(root, 'main.twill');
    expect(p.transformed(file)?.code).toContain('1');
    writeFileSync(file, 'export const value = 2;');
    p.update(file);
    expect(p.transformed(file)?.code).toContain('2');
    p.update(file, 'export const value = 3;');
    expect(p.transformed(file)?.code).toContain('3');
    p.update(file);
    expect(p.transformed(file)?.code).toContain('2');
  });
  it('checks defer scopes, hoisted helper signatures, and ordinary TS consumers', () => {
    const { project: p } = project({
      'main.twill':
        'export function f(input: string | null): number { defer { input?.toUpperCase(); } guard input !== null else { return 0; } let amount = input.length; function helper<T extends number>(value: T): T { return value; } return helper(amount); }',
      'consumer.ts': 'import {f} from "./main.twill"; const result: number = f("hello");',
      'async.twill':
        'export async function f(events: string[]) { defer { await Promise.resolve(); events.push("cleanup"); } return 3; }',
    });
    expect(p.diagnostics()).toEqual([]);
  });
  it('preserves native JS/JSDoc checking alongside Twill files', () => {
    const { project: p } = project({
      'native.js':
        'export function f() { const result = helper(3);\n/** @param {number} value */\nfunction helper(value) { return value * 2; } return result; }',
      'consumer.twill': 'import {f} from "./native.js"; const result: number = f();',
    });
    expect(p.diagnostics()).toEqual([]);
  });
  it('maps cleanup type errors to their original tokens', () => {
    const source =
      'export function f(value: number) { defer { value.toUpperCase(); } return value; }';
    const { project: p } = project({ 'main.twill': source });
    expect(p.diagnostics().find((item) => item.code === 2339)).toMatchObject({
      line: 1,
      column: source.indexOf('toUpperCase'),
    });
  });
});

it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])(
  'reports semantic and syntax diagnostics in native line coordinates for %j',
  (separator) => {
    const source =
      'export const prefix = "📦";' +
      separator +
      'export const result = [1].map { n in n.missing() };';
    const { project: p, root } = project({ 'main.twill': source });
    expect(p.diagnostics().find((item) => item.code === 2339)).toMatchObject({
      line: 2,
      column: source.split(separator)[1]!.indexOf('missing'),
    });
    p.update(join(root, 'main.twill'), 'export const prefix = 1;' + separator + 'users.map { . };');
    expect(p.diagnostics().find((item) => item.code === 90001)).toMatchObject({ line: 2 });
  },
);
it('explicit invalidation clears compiler caches while retaining unsaved source overlays', () => {
  const { project: p, root } = project({ 'main.twill': 'export const value=[1].map { n in n };' });
  const file = join(root, 'main.twill');
  p.update(file, 'export const value=[2].map { n in n };');
  const previous = p.transformed(file);
  p.invalidate();
  expect(p.transformed(file)).not.toBe(previous);
  expect(p.text(file)).toContain('[2]');
  expect(p.diagnostics()).toEqual([]);
});
it('retains strict editor errors alongside recovered snapshots and clears them on updates', () => {
  const { root } = project({ 'main.twill': 'export const values=[1].map { . };' });
  const p = new TwillProject(join(root, 'tsconfig.json'), {}, { recover: true });
  cleanups.push(() => p.dispose());
  const file = join(root, 'main.twill');
  const snapshot = p.transformed(file);
  const errors = p.diagnostics(file);
  expect(errors).toEqual([expect.objectContaining({ code: 90001 })]);
  expect(p.diagnostics(file)).toEqual(errors);
  expect(p.transformed(file)).toBe(snapshot);
  p.update(file, 'export const values=[1].map { n in n+1 };');
  expect(p.diagnostics(file)).toEqual([]);
  p.update(file, 'export const values=[1].map { . };');
  expect(p.diagnostics(file)).toEqual(errors);
  p.invalidate();
  expect(p.diagnostics(file)).toEqual(errors);
});
it('retains deferred definite-assignment checking for local bindings and instance initialization', () => {
  const source = `export function run(){let value:number;defer{void value;}value=1;return value;}
export function later(){defer{void value;}var value=1;return 1;}
export function conditional(flag:boolean){if(flag){var value=1;}defer{void value;}return 1;}
export class Resource{value:number;constructor(){defer{void this.value;}this.value=1;}}`;
  const { project: p, root } = project({ 'main.twill': source });
  expect(p.diagnostics()).toEqual([]);
  expect(p.transformed(join(root, 'main.twill'))!.code.match(/let __twillCleanup/g)).toHaveLength(
    4,
  );
  const declarations = p.declarationOutput(join(root, 'out'));
  expect(declarations.diagnostics).toEqual([]);
  expect(declarations.files.map((file) => file.text).join('')).toContain('run(): number');
});
it('reports unsupported project references and compiler options as configuration diagnostics', () => {
  const { root } = project({ 'main.twill': 'export const value=1;' });
  writeFileSync(
    join(root, 'tsconfig.json'),
    '{"compilerOptions":{"target":"ES2022","module":"CommonJS","moduleResolution":"Bundler"},"references":[{"path":"./reference"}],"include":["*.twill"]}',
  );
  const p = new TwillProject(join(root, 'tsconfig.json'));
  cleanups.push(() => p.dispose());
  expect(p.diagnostics().map((item) => item.code)).toEqual(expect.arrayContaining([90002, 5095]));
});
