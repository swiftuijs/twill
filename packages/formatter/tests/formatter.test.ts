import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { format, formatGenerated } from '../src/index.twill';
import { transform } from '@swiftuijs/twill';
import { parseSyntax } from '@swiftuijs/twill/syntax';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function normalize(value: any): any {
  if (Array.isArray(value))
    return value
      .filter(
        (node) =>
          node?.type !== 'EmptyStatement' &&
          !(
            node?.type === 'JSXText' &&
            /[\r\n]/.test(node.value) &&
            /^[ \t\r\n]*$/.test(node.value)
          ),
      )
      .map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['start', 'end', 'loc', 'range', 'raw', 'extra'].includes(key))
      .map(([key, child]) => [key, normalize(child)]),
  );
}
it.each([
  {
    filename: 'cleanup.twill',
    source: 'function run(events: string[]) { defer { events.push("clean"); } return 1; }',
  },
  {
    filename: 'multiple.twill',
    source:
      'function run(events: string[]) { defer { events.push("old"); } defer { events.push("new"); } return 1; }',
  },
  {
    filename: 'view.twillx',
    source: 'declare const Card: any; export const view = Card { <span>child</span>; };',
  },
])('formats generated code without changing its AST: $filename', async ({ filename, source }) => {
  const result = transform(source, { filename });
  const filepath = filename.replace(/\.twillx$/, '.tsx').replace(/\.twill$/, '.ts');
  const pretty = await formatGenerated(result.code, { filepath });
  expect(await formatGenerated(pretty, { filepath })).toBe(pretty);
  expect(normalize(parseSyntax(pretty, { filename }).ast)).toEqual(
    normalize(parseSyntax(result.code, { filename }).ast),
  );
  expect(result.map.sourcesContent).toEqual([source]);
  expect(pretty).toContain('\n');
});

it.each([
  'const view=<div><span>A</span> <span>B</span></div>;',
  'const view=<div> <span>A</span> </div>;',
])('preserves meaningful JSX spaces in emitted JavaScript: %s', async (source) => {
  const ts = await import('typescript');
  const pretty = await formatGenerated(source, { filepath: 'spaces.tsx' });
  const emitted = (text: string) =>
    ts.transpileModule(text, {
      fileName: 'spaces.tsx',
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
  expect(normalize(parseSyntax(emitted(pretty), { filename: 'spaces.js' }).ast)).toEqual(
    normalize(parseSyntax(emitted(source), { filename: 'spaces.js' }).ast),
  );
});

describe('Prettier Twill plugin', () => {
  it.each([
    'const active=users.filter { .active && .verified };',
    'const value=fn<number> { n in n + 1 };',
    'run { (()=>1)(); };',
    'const value = fn(1, /* argument tail */) { (n: number) in n + 1 };',
    'const __twillImplicit={value:2}; const result=users.map { .value + __twillImplicit.value };',
    'const value=fn { (name="in", {value}={value:1}) in `${name}:${value}` };',
    'const value=run { async value in await Promise.resolve(value) } done: { () in 1 };',
    'function f(input){return switch(input){case {tag:-1,value}: value;case {tag:1,value}: throw new Error(String(value));default: 0;};}',

    'const value=users.map { . /* property */ active ? .name : "missing" };',
    'const names=groups.map { .users.filter { .active }.map { .profile?.name ?? "missing" } };',
    'const values=users.map { defer { .close(); } guard .active else { return 0; } return .value; };',
    'const value=fn() { /*header*/ (a: number /*type*/) in /*body*/ a+1 };',
    'const value=fn { a in // body\na+1 }; // tail',
    'const value=fn { /* no params */ 1 } done: { /* second */ 2 };',
    'async function f(){defer {await cleanup()};return call { async (x:number):Promise<number> in await work(x) };}',
    '// prettier-ignore\nconst value=fn { n in n+  1 };',
    'const value=fn { ({x}: {x:number}, y=2, ...rest:number[]) in x+y+rest.length };',
    'function f(a?:number){guard /* one */ const x=a /* two */ else { // three\nreturn 0;} return x;}',
    '#!/usr/bin/env node\nexport const value=[1].map { n in n+1 };',
  ])('preserves comment/header semantics: %s', async (source) => {
    const output = await format(source, { filepath: 'comment.twill' });
    expect(await format(output, { filepath: 'comment.twill' })).toBe(output);
    expect(normalize(parseSyntax(transform(output).code).ast)).toEqual(
      normalize(parseSyntax(transform(source).code).ast),
    );
    if (source.startsWith('#!')) expect(output).toMatch(/^#!\/usr\/bin\/env node/);
  });
  const examples = new URL('../../../examples/', import.meta.url);
  const examplesPath = fileURLToPath(examples);
  const fixtures = readdirSync(examplesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .flatMap((dir) =>
      readdirSync(join(examplesPath, dir), { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.twillx?$/.test(entry.name))
        .map((entry) => join(examplesPath, dir, entry.name)),
    );
  it.each(fixtures)('preserves the compiled syntax and is idempotent: %s', async (filepath) => {
    const source = readFileSync(filepath, 'utf8');
    const output = await format(source, { filepath });
    expect(await format(output, { filepath })).toBe(output);
    const before = transform(source, { filename: filepath });
    const after = transform(output, { filename: filepath });
    expect(normalize(parseSyntax(after.code, { filename: filepath }).ast)).toEqual(
      normalize(parseSyntax(before.code, { filename: filepath }).ast),
    );
  });
  it('preserves typed generics, cleanup, guards, comments and runtime behavior', async () => {
    const source = `// retained comment\nfunction run<T>(value:T,body:(value:T)=>T):T{return body(value)}
      const calls:string[]=[]; function calculate(value:number|undefined){
      defer {calls.push('cleanup')}; guard const n=value else {throw new Error('missing')}
      return run<number>(n) {(item:number) in ({value:item*2}).value};}
      globalThis.result=[calculate(21),calls];`;
    const output = await format(source, { filepath: 'runtime.twill' });
    expect(output).toContain('// retained comment');
    expect(output).toContain('run<number>');
    const ts = await import('typescript');
    const evaluate = (text: string) => {
      const code = ts.transpileModule(transform(text).code, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const scope = { result: undefined };
      new Function('globalThis', code)(scope);
      return scope.result;
    };
    expect(evaluate(output)).toEqual(evaluate(source));
    expect(evaluate(output)).toEqual([42, ['cleanup']]);
  });
  it('retains the explicit parentheses that opt out of component lowering', async () => {
    const output = await format('const value=(Run) { item in item+1 };', {
      filepath: 'view.twillx',
    });
    expect(output).toContain('(Run)');
    expect(transform(output, { filename: 'view.twillx' }).code).not.toContain('<Run');
  });
  it('protects ASI boundaries with semicolons disabled', async () => {
    const source = 'const value=1; (run) { 42 }; fn {1}; [1].map { n in n+1 };';
    const output = await format(source, { semi: false, filepath: 'asi.twill' });
    expect(await format(output, { semi: false, filepath: 'asi.twill' })).toBe(output);
    expect(normalize(parseSyntax(transform(output).code).ast)).toEqual(
      normalize(parseSyntax(transform(source).code).ast),
    );
  });
});
