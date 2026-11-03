import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { transform } from '../src/compiler';
import { parse } from '../src/parser.js';
import { TwillProject } from '../src/project';

function run(body: string, ...args: unknown[]) {
  const result = transform(`function run(input, record) { ${body} }`, { language: 'js' });
  parse(result.code, 'js');
  return Function(result.code + '; return run;')()(...args);
}

describe('destructured guards', () => {
  it('checks the whole initializer once before defaults, getters and rest', () => {
    const body =
      'guard const { nested: { value = record() }, ...rest } = input else { return null; } return [value,rest];';
    let reads = 0;
    expect(
      run(body, undefined, () => {
        reads++;
      }),
    ).toBe(null);
    expect(reads).toBe(0);
    expect(
      run(
        body,
        {
          get nested() {
            reads++;
            return {};
          },
          extra: true,
        },
        () => {
          reads++;
          return 4;
        },
      ),
    ).toEqual([4, { extra: true }]);
    expect(reads).toBe(2);
    expect(
      run(
        'guard const [first=2,...rest]=record(input) else {return null;} return [first,rest];',
        [undefined, 3],
        (v: unknown) => {
          reads++;
          return v;
        },
      ),
    ).toEqual([2, [3]]);
    expect(reads).toBe(3);
  });
  it('retains native falsy coercion, TDZ and nested destructuring errors', () => {
    expect(run('guard const {length}=input else {return null;} return length;', '')).toBe(0);
  });
  it('does not expose pattern bindings before the successful check', () => {
    expect(() => run('guard const {value}=input else {return value;} return value;', null)).toThrow(
      ReferenceError,
    );
    expect(() => run('guard const {value}=value else {return null;} return value;', {})).toThrow(
      ReferenceError,
    );
    expect(() =>
      run('guard const {nested:{value}}=input else {return null;} return value;', {}),
    ).toThrow(TypeError);
  });
  it('keeps awaited initialization in the enclosing async function', async () => {
    const result = transform(
      'async function run(input){guard const [value=2]=await input else{return 0;}return value;}',
      { language: 'js' },
    );
    const fn = Function(result.code + ';return run;')();
    expect(await fn(Promise.resolve([3]))).toBe(3);
    expect(await fn(Promise.resolve(null))).toBe(0);
    expect(result.code).not.toContain('=>');
  });
  it('avoids source identifiers and preserves defer cleanup on failure', () => {
    expect(
      run(
        'const __twillGuard0=9; defer {record();} guard const {value}=input else {return __twillGuard0;} return value;',
        null,
        () => {},
      ),
    ).toBe(9);
    expect(
      run(
        'guard const {value= switch(1){case 1: 3;default: 4;}}=input else {return 0;} return value;',
        {},
      ),
    ).toBe(3);
  });
});

describe('switch expressions', () => {
  it('evaluates the subject once and only the selected value case', () => {
    const calls: unknown[] = [];
    expect(
      run(
        'return switch(record(input)){case 1: record("one");case 2: record("two");default: record("other");};',
        2,
        (v: unknown) => {
          calls.push(v);
          return v;
        },
      ),
    ).toBe('two');
    expect(calls).toEqual([2, 'two']);
  });
  it('binds nested patterns and excludes the tag from object rest', () => {
    expect(
      run(
        'return switch(input){case {kind:"ok", nested:{value=3},...rest}: [value,rest];case {kind:"bad",error}: throw error;};',
        { kind: 'ok', nested: {}, extra: 4 },
      ),
    ).toEqual([3, { extra: 4 }]);
    const error = new Error('bad');
    expect(() =>
      run(
        'return switch(input){case {kind:"ok", value}: value;case {kind:"bad",error}: throw error;};',
        { kind: 'bad', error },
      ),
    ).toThrow(error);
  });
  it('preserves native discriminator selection and selected-arm getter behavior', () => {
    let reads = 0;
    expect(
      run('return switch(input){case {kind:"ok",value}: value;default: 0;};', {
        get kind() {
          reads++;
          return 'ok';
        },
        value: 3,
      }),
    ).toBe(3);
    expect(reads).toBe(2);
  });
  it('uses separate arm scopes, supports aliases/defaults and leaves non-selected defaults lazy', () => {
    expect(
      run(
        'const value=9; return switch(input){case {kind:"ok",value: answer=record()}: [answer,value];case {kind:"bad",value}: value;};',
        { kind: 'ok' },
        () => 3,
      ),
    ).toEqual([3, 9]);
    expect(
      run(
        'return switch(input){case {kind:"ok",value=record()}: value;default: 7;};',
        { kind: 'bad' },
        () => {
          throw Error('unreachable');
        },
      ),
    ).toBe(7);
  });
  it('composes with closures, nested switches, guards, defer and expression precedence', () => {
    expect(
      run(
        'const result = 2 + switch(input){case 1: switch(2){case 2: 3;default: 0;};default: 4;}; return [result].map { n in return switch(n){case 5: n*2;default: 0;}; };',
        1,
      ),
    ).toEqual([10]);
    const calls: unknown[] = [];
    expect(
      run(
        'defer {record("cleanup");} guard const {value}=input else {return 0;} return switch(value){case 2: 4;default: 1;};',
        { value: 2 },
        (v: unknown) => calls.push(v),
      ),
    ).toBe(4);
    expect(calls).toEqual(['cleanup']);
  });
  it('keeps lexical this, arguments and super in expression wrappers', () => {
    const result = transform(
      'class Base { value(){return 3;} } class Derived extends Base { value(input){const output=switch(input){case 1: super.value()+arguments[0]+this.extra;default: 0;};return output;} } const d=new Derived();d.extra=2;',
      { language: 'js' },
    );
    expect(Function(result.code + ';return d.value(1);')()).toBe(6);
  });
  it('keeps direct return await/yield in the original function', async () => {
    const result = transform(
      'async function f(v){return switch(await v){case 1: await Promise.resolve(2);default: 3;};} function* g(v){return switch(v){case 1: yield 2;default: 3;};}',
      { language: 'js' },
    );
    const [f, g] = Function(result.code + ';return [f,g];')();
    expect(await f(1)).toBe(2);
    const iterator = g(1);
    expect(iterator.next()).toEqual({ done: false, value: 2 });
    expect(iterator.next(9)).toEqual({ done: true, value: 9 });
    expect(result.code).not.toContain('=>');
  });
  it('rejects hidden suspension in other expression contexts', () => {
    expect(() =>
      transform('async function f(v){const x=switch(v){case 1: await v;default: 0;};}'),
    ).toThrow(/requires a direct return/);
    expect(() =>
      transform('function* f(v){const x=switch(v){case 1: yield v;default: 0;};}'),
    ).toThrow(/requires a direct return/);
  });
  it('fails visibly for unexpected JS values instead of returning undefined', () => {
    expect(() => run('return switch(input){case 1: 2;};', 3)).toThrow(/Non-exhaustive/);
    expect(run('return switch(input){default: 4;};', 3)).toBe(4);
  });
  it.each([
    ['return switch(v){};', /at least one/],
    ['return switch(v){case {kind:"a",value:1}: 1;};', /exactly one/],
    ['return switch(v){case {kind:"a"}: 1;case {tag:"b"}: 2;};', /same discriminator/],
    ['return switch(v){case {kind:"a"}: 1;case 2: 2;};', /Cannot mix/],
    ['return switch(v){case 2: 2;case {kind:"a"}: 1;};', /Cannot mix/],
    ['return switch(v){case {kind:/a/}: 1;};', /exactly one/],
    ['return switch(v){case {kind:!true}: 1;};', /exactly one/],
    ['return switch(v){case {kind:-value}: 1;};', /exactly one/],
    ['return switch(v){case {kind:-"value"}: 1;};', /exactly one/],
    ['return switch(v){default: 1;default: 2;};', /Multiple default/],
    ['return switch(v){case {kind:"a",value,value}: 1;};', /already been declared/],
  ])('rejects ambiguous patterns: %s', (body, error) => {
    expect(() => transform(`function f(v){${body}}`)).toThrow(error);
  });
  it('leaves native switch statements and keyword properties unchanged', () => {
    const source =
      'function f(v){switch(v){case 1: v++; break;default: v=0;} return {switch:v}.switch;}';
    expect(transform(source).code).toBe(source);
    expect(
      run('return switch(input){case {"kind":"ok",value}: value;default: 0;};', {
        kind: 'ok',
        value: 7,
      }),
    ).toBe(7);
  });
  it('preserves grouping parentheses in subjects, values and direct returns', () => {
    expect(
      run(
        'return /* return */ (((switch((input)){case {kind:"a",value}: (value+1);default: (0);})));',
        { kind: 'a', value: 2 },
      ),
    ).toBe(3);
    expect(() =>
      run('return (switch(input){case {kind:"a",error}: throw (error);default: 0;});', {
        kind: 'a',
        error: Error('grouped'),
      }),
    ).toThrow('grouped');
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
function checked(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'twill-branching-'));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
      include: ['**/*'],
    }),
  );
  writeFileSync(join(root, 'main.twill'), source);
  const project = new TwillProject(join(root, 'tsconfig.json'));
  cleanups.push(() => {
    project.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  return project;
}
const union = 'type Result={kind:"ok";value:number}|{kind:"bad";error:string};';
it.each(['any', 'unknown', 'number', 'string'])(
  'requires a default for unbounded %s even with the erased exhaustiveness proof',
  (type) => {
    expect(
      checked(`export function f(input:${type}){return switch(input){case 1:1;};}`)
        .diagnostics()
        .map((error) => error.code),
    ).toContain(2344);
  },
);
it('does not let a shadowed never-returning error constructor bypass exhaustiveness', () => {
  expect(
    checked(
      'declare const TypeError:new(message:string)=>never;export function f(input:1|2){return switch(input){case 1:1;};}',
    )
      .diagnostics()
      .map((error) => error.code),
  ).toContain(2344);
});
it('narrows destructured guards and pattern payloads with strict unused checks', () => {
  const p = checked(
    union +
      'export function f(input: {result:Result} | undefined){guard const {result}: {result:Result}|undefined=input else{return "empty";} return switch(result){case {kind:"ok",value}: value.toFixed();case {kind:"bad",error}: error;};}',
  );
  expect(p.diagnostics()).toEqual([]);
});
it('infers return unions for native TS consumers', () => {
  expect(
    checked(
      union +
        'export function f(input:Result){return switch(input){case {kind:"ok",value}: value;case {kind:"bad",error}: error;};} const numberOnly:number=f({kind:"bad",error:"x"}); export {numberOnly};',
    )
      .diagnostics()
      .map((d) => d.code),
  ).toContain(2322);
});
it('requires a default or a proven exhausted TS union', () => {
  const diagnostics = checked(
    union +
      'export function f(input:Result){return switch(input){case {kind:"ok",value}: value;};}',
  ).diagnostics();
  expect(diagnostics.map((d) => d.code)).toEqual([2344]);
  expect(
    checked(
      union +
        'export function f(input:Result){return switch(input){case {kind:"ok",value}: value;default: 0;};}',
    ).diagnostics(),
  ).toEqual([]);
});
it('reports branch type errors at original member tokens', () => {
  const source =
    union +
    'export function f(input:Result){return switch(input){case {kind:"ok",value}: value.toUpperCase();case {kind:"bad",error}: error;};}';
  expect(
    checked(source)
      .diagnostics()
      .find((d) => d.code === 2339),
  ).toMatchObject({ column: source.indexOf('toUpperCase') });
});
it('composes switch values with native JSX and component children', () => {
  const source =
    'declare namespace JSX { interface IntrinsicElements { span:any; } } declare function Panel(props:{children?:unknown}):any; type Result={kind:"ok";value:number}|{kind:"bad";error:string}; export function view(input:Result){return Panel { (switch(input){case {kind:"ok",value}: <span>{value}</span>;case {kind:"bad",error}: <span>{error}</span>;}); };}';
  const output = transform(source, { filename: 'view.twillx' });
  expect(output.switches).toBe(1);
  expect(() => parse(output.code, 'tsx')).not.toThrow();
});

it('preserves outer bindings in UI collectors even with query-suffixed filenames', () => {
  const source = 'const __twillChildren0="outer";const view=Panel {"one";"two";__twillChildren0;};';
  const result = transform(source, { filename: 'view.twillx?import', language: 'tsx' });
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'element',
    },
  }).outputText;
  expect(
    ts.transpileModule(result.code, {
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'element' },
    }).diagnostics,
  ).toEqual([]);
  const value = Function(
    'Panel',
    'element',
    javascript + ';return view;',
  )(
    () => {},
    (_tag: unknown, _props: unknown, children: unknown) => children,
  );
  expect(value).toEqual(['one', 'two', 'outer']);
});
