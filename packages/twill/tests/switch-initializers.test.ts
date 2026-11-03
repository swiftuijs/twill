import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { transform, originalPosition, generatedPosition } from '../src/compiler';
import { parse } from '../src/parser.js';
import { TwillProject } from '../src/project';
import { TwillEditor } from '../src/editor';
const projects: { root: string; project: TwillProject }[] = [];
afterEach(() => {
  for (const { root, project } of projects.splice(0)) {
    project.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
function checked(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'twill-initializers-'));
  const filename = join(root, 'main.twill');
  writeFileSync(filename, source);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        types: [],
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        skipLibCheck: true,
      },
      files: ['main.twill'],
    }),
  );
  const project = new TwillProject(join(root, 'tsconfig.json'));
  projects.push({ root, project });
  return { project, filename };
}
function compile(body: string) {
  const output = transform(`function run(input,record){${body}}`, { language: 'js' });
  parse(output.code, 'js');
  return { output, run: Function(output.code + ';return run;')() };
}
it.each(['const', 'let', 'var'])(
  'lowers a standalone %s initializer without an added function',
  (kind) => {
    const { output, run } = compile(
      `${kind} value=switch(input){case 1:2;default:3;};return value*2;`,
    );
    expect(output.code).not.toContain('=>');
    expect(run(1)).toBe(4);
    expect(run(0)).toBe(6);
  },
);
it('evaluates subjects, case labels and selected values in their original order', () => {
  const events: unknown[] = [];
  const { run } = compile(
    'record("before");const value=switch(record(input)){case record(1):record("one");case record(2):record("two");default:record("other");};record("after");return value;',
  );
  expect(
    run(2, (v: unknown) => {
      events.push(v);
      return v;
    }),
  ).toBe('two');
  expect(events).toEqual(['before', 2, 1, 2, 'two', 'after']);
});
it.each(['const', 'let'])('preserves the %s TDZ in both the subject and selected value', (kind) => {
  expect(() => compile(`${kind} value=switch(value){default:0;};return value;`).run()).toThrow(
    ReferenceError,
  );
  expect(() =>
    compile(`${kind} value=switch(input){case 1:typeof value;default:0;};return value;`).run(1),
  ).toThrow(ReferenceError);
  expect(
    compile(`${kind} value=switch(input){case 1:typeof value;default:0;};return value;`).run(0),
  ).toBe(0);
});
it('preserves const assignment failures and mutable let bindings', () => {
  expect(() =>
    compile('const value=switch(input){default:1;};value=2;return value;').run(),
  ).toThrow(TypeError);
  expect(compile('let value=switch(input){default:1;};value=2;return value;').run()).toBe(2);
  expect(
    checked(
      'export function run(input:number){const value=switch(input){default:1;};value=2;return value;}',
    )
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2588);
});
it('preserves var hoisting and outer binding shadowing', () => {
  expect(
    compile('record(value);var value=switch(input){default:2;};return value;').run(
      0,
      (v: unknown) => expect(v).toBeUndefined(),
    ),
  ).toBe(2);
  expect(
    compile(
      'const value=4;{const value=switch(input){default:2;};record(value);}return value;',
    ).run(0, (v: unknown) => expect(v).toBe(2)),
  ).toBe(4);
});
it('preserves grouping, comments, object literals and comma-valued arms', () => {
  const { output, run } = compile(
    'const value /* declaration */ = /* before */ (((switch((input)){case 1:({value:2});default:(record(3),{value:4});})));return value;',
  );
  expect(output.code).toContain('/* declaration */');
  expect(output.code).toContain('/* before */');
  expect(run(1)).toEqual({ value: 2 });
  expect(run(0, () => {})).toEqual({ value: 4 });
});
it('handles throwing arms and unmatched values without initializing the binding', () => {
  const { run } = compile(
    'const value=switch(input.kind){case "ok":4;case "bad":throw input.error;};return value;',
  );
  const error = Error('cleanup');
  expect(() => run({ kind: 'bad', error })).toThrow(error);
  expect(() => run({ kind: 'missing' })).toThrow('Non-exhaustive switch expression');
  expect(run({ kind: 'ok' })).toBe(4);
});
it('keeps nested patterns, closures, guards and defer exits composable', () => {
  const events: unknown[] = [];
  const { run } = compile(
    'defer {record("cleanup");} guard const {kind}=input else {return 0;} const value=switch(input){case enum Factory.loaded({value:amount=3}):[amount].map { n in n*2 }[0];default:0;};return [kind,value];',
  );
  expect(run({ kind: 'loaded' }, (v: unknown) => events.push(v))).toEqual(['loaded', 6]);
  expect(events).toEqual(['cleanup']);
});
it('supports an initializer inside a native switch case and lexical loop blocks', () => {
  expect(
    compile(
      'switch(input){case 1:const value=switch(2){default:3;};return value;default:return 0;}',
    ).run(1),
  ).toBe(3);
  expect(
    compile(
      'const values=[];for(let i=0;i<3;i++){const value=switch(i){case 1:2;default:4;};values.push(value);}return values;',
    ).run(),
  ).toEqual([4, 2, 4]);
});
it('leaves for headers, multiple declarators, destructuring and larger expressions scoped', () => {
  for (const body of [
    'const before=record(1),value=switch(record(2)){default:3;};return [before,value];',
    'for(let value=switch(input){default:0;};value<1;value++){return value;}return 2;',
    'const {value}=switch(input){default:({value:4});};return value;',
    'const value=record(1)+switch(record(2)){default:3;};return value;',
  ])
    expect(compile(body).output.code).toContain('(() => {');
  const events: number[] = [];
  expect(
    compile(
      'const before=record(1),value=switch(record(2)){default:3;};return [before,value];',
    ).run(0, (v: number) => {
      events.push(v);
      return v;
    }),
  ).toEqual([1, 3]);
  expect(events).toEqual([1, 2]);
});
it('keeps short-circuit and optional-call switches lazy', () => {
  const { run } = compile(
    'const value=input && switch(record(1)){default:record(2);};return value;',
  );
  expect(
    run(false, () => {
      throw Error('unreachable');
    }),
  ).toBe(false);
  expect(
    compile('return input?.(switch(record(1)){default:2;});').run(null, () => {
      throw Error('unreachable');
    }),
  ).toBeUndefined();
});
it('preserves exported initializers and inferred result unions in declarations', () => {
  const source =
    'export const value=switch(1 as 1|2){case 1:2;case 2:"two";};export function read(input:1|2){const result=switch(input){case 1:2;case 2:"two";};return result;}';
  const { project } = checked(source);
  expect(project.diagnostics()).toEqual([]);
  const output = transform(source).code;
  expect(output).not.toContain('=>');
  const js = ts.transpileModule(output, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  Function('exports', js)(exports);
  expect(exports.value).toBe(2);
  expect(exports.read(2)).toBe('two');
  const emitted = project.declarationOutput(join(project.root, 'dist'));
  expect(emitted.diagnostics).toEqual([]);
  expect(emitted.files.map((file) => file.text).join('\n')).toContain('string | number');
});
it('retains explicit annotation tokens and contextual arrow parameter types', () => {
  const source =
    'export function read(input:number){const result: (value: number) => number = ((switch(input){case 1:(value)=>value+1;default:(value)=>value*2;}));return result(3);}';
  const { project } = checked(source);
  expect(project.diagnostics()).toEqual([]);
  expect(transform(source).code).toContain(': (value: number) => number');
});
it('checks exhaustiveness and maps enum binding diagnostics in lifted initializers', () => {
  expect(
    checked('export function read(input:1|2){const result=switch(input){case 1:2;};return result;}')
      .project.diagnostics()
      .map((d) => d.code),
  ).toContain(2344);
  const source =
    'declare const Factory:{loaded():{kind:"loaded";value:number}};export function read(input:{kind:"loaded";value:number}){\nconst result=switch(input){case enum Factory.loaded({missing}):missing;};return result;}';
  const diagnostic = checked(source)
    .project.diagnostics()
    .find((d) => d.code === 2339);
  expect(diagnostic?.line).toBe(2);
  expect(diagnostic?.column).toBe(source.split('\n')[1]!.indexOf('missing'));
});
it('keeps declaration and arm tokens mapped for hover, rename and source maps', () => {
  const source =
    'export function read(input:number){\nconst result=switch(input){case 1:2;default:3;};\nreturn result;}';
  const { project, filename } = checked(source);
  const editor = new TwillEditor(project);
  expect(project.diagnostics()).toEqual([]);
  const edits = editor.rename(filename, source.indexOf('result='), 'answer');
  expect(edits?.map((e) => e.newText)).toEqual(['answer', 'answer']);
  const output = transform(source, { filename });
  for (const token of ['result=', 'input){', 'case 1', 'return result']) {
    const offset = source.indexOf(token);
    const before = source.slice(0, offset).split('\n');
    const position = generatedPosition(output, before.length, before.at(-1)!.length);
    expect(position.line).not.toBeNull();
    const original = originalPosition(output, position.line!, position.column!);
    expect([original.line, original.column]).toEqual([before.length, before.at(-1)!.length]);
  }
});
it('preserves native strict directives and this/new.target in the enclosing function', () => {
  const result = transform(
    'function Run(input){"use strict";const value=switch(input){default:[this,new.target,arguments.length];};return value;}',
    { language: 'js' },
  );
  const Run = Function(result.code + ';return Run;')();
  expect(Run(0)).toEqual([undefined, undefined, 1]);
  expect(new Run(0)).toEqual([expect.anything(), Run, 1]);
});
it('uses fresh names even when users define generated names or labels', () => {
  const { run } = compile(
    'const __twillResult0=2;__twillExit1:{const value=switch(input){default:3;};return [__twillResult0,value];}',
  );
  expect(run(0)).toEqual([2, 3]);
});
it('retains the existing wrapper for direct eval with observable function-scope variables', () => {
  const output = transform(
    'function run(input){const result=switch(input){default:eval("var local=4;local");};return [result,typeof local];}',
    { language: 'js', sourceType: 'script' },
  );
  expect(output.code).toContain('(() => {');
  expect(Function(output.code + ';return run;')()(0)).toEqual([4, 'undefined']);
});
it('keeps JS JSDoc context on its declaration and TS documentation on the original binding', () => {
  const js = transform(
    'function run(input){/** @type {(value:number)=>number} */ const result=switch(input){default:(value)=>value+1;};return result(3);}',
    { language: 'js' },
  );
  expect(js.code).toContain('/** @type {(value:number)=>number} */ const result=');
  expect(js.code).toContain('(() => {');
  const source =
    'export function run(input:number){\n/** User result documentation. */\nconst result:number=switch(input){default:4;};return result;}';
  const { project, filename } = checked(source);
  const editor = new TwillEditor(project);
  expect(project.diagnostics()).toEqual([]);
  const hover = project.service.getQuickInfoAtPosition(
    filename + '.ts',
    project.toGeneratedOffset(filename, source.indexOf('result:number')),
  );
  expect(hover?.documentation?.map((part) => part.text).join('')).toContain(
    'User result documentation.',
  );
  expect(
    editor.rename(filename, source.indexOf('result:number'), 'answer')?.map((edit) => edit.newText),
  ).toEqual(['answer', 'answer']);
});
it('handles empty enum arms and native patterns in the same lifted initializer', () => {
  const { output, run } = compile(
    'const result=switch(input){case enum Factory.idle():0;case enum Factory.loaded({value=4,...rest}):[value,rest.kind];case {kind:"failed",error}:throw error;};return result;',
  );
  expect(output.code).not.toContain('=>');
  expect(run({ kind: 'idle' })).toBe(0);
  expect(run({ kind: 'loaded' })).toEqual([4, 'loaded']);
  expect(() => run({ kind: 'failed', error: Error('failed') })).toThrow('failed');
});
it('keeps source suppression pragmas attached to the established initializer', () => {
  const source =
    'export function run(input:number){\n// @ts-expect-error result intentionally has the wrong type\nconst result:number=switch(input){default:"wrong";};return result;}';
  const { project } = checked(source);
  expect(project.diagnostics()).toEqual([]);
  expect(transform(source).code).toContain('(() => {');
});
