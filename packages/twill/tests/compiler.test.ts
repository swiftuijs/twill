import { describe, expect, it } from 'vitest';
import { transform, TwillSyntaxError, originalPosition } from '../src/compiler';
import { parse } from '../src/parser.js';

function evaluate(source: string, bindings: Record<string, unknown> = {}) {
  const result = transform(`function __test() { ${source} }`, {
    filename: 'test.twill',
    language: 'js',
  });
  parse(result.code, 'js');
  return Function(
    ...Object.keys(bindings),
    result.code + '; return __test();',
  )(...Object.values(bindings));
}

describe('trailing closures', () => {
  it.each([
    ['fn() { 42 }', 'fn( () => 42 )'],
    ['fn { x in x + 1 }', 'fn( ( x ) => x + 1 )'],
  ])('transforms %s', (source, expected) => {
    expect(transform(source, { filename: 'test.twill' }).code.replace(/\s+/g, ' ')).toBe(expected);
  });
  it('executes normal callbacks and lexical this', () => {
    expect(evaluate('const doubled = [1,2,3].map { value in value * 2 }; return doubled;')).toEqual(
      [2, 4, 6],
    );
    expect(evaluate('return [1,2,3].map() { x in x * 2 }')).toEqual([2, 4, 6]);
    expect(
      evaluate('const o = { value: 4, run() { return fn() { this.value } } }; return o.run();', {
        fn: (cb: () => unknown) => cb(),
      }),
    ).toBe(4);
  });
  it('supports optional calls, generics, destructuring, rest and defaults', () => {
    expect(
      evaluate('return fn?.() { ({x}, y=2, ...rest) in x+y+rest.length }', {
        fn: (cb: Function) => cb({ x: 3 }, undefined, 1, 2),
      }),
    ).toBe(7);
    const result = transform('const x = fn<number>(1) { (v: number) in v + 1 }');
    expect(result.code).toContain('fn<number>(1,');
    parse(result.code, 'ts');
    const bare = transform('const x = [1,2,3].map<number> { value in value * 2 };');
    expect(bare.code).toContain('.map<number>(');
    parse(bare.code, 'ts');
  });
  it('supports nested closures and chaining', () => {
    expect(evaluate('return [1,2].map() { x in [x].map() { y in y*3 } }.flat()')).toEqual([3, 6]);
  });
  it('invokes parenthesized callable results and rejects unlabelled extra closures', () => {
    expect(
      evaluate('return (factory()) { x in x+1 }', { factory: () => (cb: Function) => cb(4) }),
    ).toBe(5);
    expect(evaluate('return (fn) { x in x+1 }', { fn: (cb: Function) => cb(4) })).toBe(5);
    expect(() => transform('fn() {} {}')).toThrow(/require labels/);
  });
  it('supports named subsequent closures as positional callbacks', () => {
    expect(
      evaluate('return fn() { 1 } completion: { x in x+2 }', {
        fn: (first: Function, second: Function) => second(first()),
      }),
    ).toBe(3);
  });
  it('supports async headers', async () => {
    expect(
      await evaluate('return fn() { async x in await Promise.resolve(x + 1) }', {
        fn: (cb: Function) => cb(4),
      }),
    ).toBe(5);
  });
  it('keeps comments, regexes and templates', () => {
    expect(
      evaluate(
        'return fn(1, /* keep */) /* gap */ { /* header */ x /* c */ in `value:${/[{}]/.test("{")}:${x}` }',
        { fn: (x: number, cb: Function) => cb(x) },
      ),
    ).toBe('value:true:1');
    expect(
      evaluate('return fn() { `hello ${fn() { "world" }}` }', { fn: (cb: Function) => cb() }),
    ).toBe('hello world');
  });
  it('preserves ordinary control flow and declarations', () => {
    const source =
      'function f() {}\nif (f()) { f(); }\nwhile (f()) { break; }\nclass C { f() {} }\nf(); { let x=1; }\nlabel: { break label; }';
    expect(transform(source).code).toBe(source);
  });
  it('only returns a single expression implicitly', () => {
    expect(evaluate('return fn() { 1; 2; }', { fn: (cb: Function) => cb() })).toBeUndefined();
    expect(evaluate('return fn() { ({ answer: 42 }) }', { fn: (cb: Function) => cb() })).toEqual({
      answer: 42,
    });
    expect(transform('fn() { 1 }', { implicitReturn: false }).code).not.toContain('return');
  });
  it('reports precise syntax errors and binding collisions', () => {
    expect(() => transform('fn() { x in const x=2 }', { filename: 'broken.twill' })).toThrow(
      TwillSyntaxError,
    );
    expect(() => transform('fn() {')).toThrow(/input.twill:1:/);
  });
  it('maps unmodified expression tokens to the original file', () => {
    const source = 'const answer = fn() { value in value + 1 };';
    const result = transform(source, { filename: 'source.twill' });
    const position = originalPosition(result, 1, result.code.indexOf('value +'));
    expect(position).toMatchObject({
      source: 'source.twill',
      line: 1,
      column: source.indexOf('value +'),
    });
    expect(result.map.sourcesContent).toEqual([source]);
  });
});

describe('TypeScript and JSX compatibility', () => {
  it.each([
    'interface Model<T> { value: T }; type ReadonlyModel<T> = { readonly [K in keyof T]: T[K] };',
    'enum Kind { A, B }; namespace Models { export type ID = string | number; }',
    'const x = <Array<number>>value; const y = value as number satisfies number;',
    'const identity = <const T,>(value: T): T => value; identity<number>(1);',
    'export const f = <T extends number>(v:T) => [v].map() { x in x };',
    'class Store { #value=1; readonly name="store"; read(){return this.#value;} }',
    'class Base { read(){return 1;} } class Store extends Base { override read(){return super.read();} }',
    'import data from "./data.json" with { type: "json" }; using resource = open();',
  ])('preserves or lowers common TS syntax: %s', (source) => {
    const result = transform(source, { filename: 'file.twill' });
    parse(result.code, 'ts');
    if (!source.includes(' in x }')) expect(result.code).toBe(source);
  });
  it.each(['file.twillx'])('supports JSX and closures inside JSX expressions in %s', (filename) => {
    const result = transform(
      'export const content = <div>{[1].map() { x in <span>{x}</span> }}</div>',
      { filename },
    );
    parse(result.code, filename.endsWith('twillx') ? 'tsx' : 'jsx');
    expect(result.closures).toBe(1);
  });
});
