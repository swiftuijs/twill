import { describe, expect, it } from 'vitest';
import { transform as minify } from 'esbuild';
import { transform, originalPosition, TwillSyntaxError } from '../src/compiler';
import { parse } from '../src/parser.js';

function run(source: string, ...values: unknown[]) {
  const result = transform(`function run(value, record) { ${source} }`, {
    filename: 'test.twill',
    language: 'js',
  });
  parse(result.code, 'js');
  return Function(result.code + '; return run;')()(...values);
}

describe('general-purpose guards', () => {
  it('keeps an outer else attached to its original conditional', () => {
    const source = 'if(value) guard record() else { return 0; } else { return 1; } return 2;';
    expect(run(source, true, () => true)).toBe(2);
    expect(run(source, true, () => false)).toBe(0);
    expect(
      run(source, false, () => {
        throw new Error('Unreachable');
      }),
    ).toBe(1);
  });
  it('evaluates the condition once and exits before executing the remainder', () => {
    let calls = 0;
    const source = 'guard record(value) else { return "missing"; } return value * 2;';
    expect(
      run(source, 4, (v: number) => {
        calls++;
        return v > 0;
      }),
    ).toBe(8);
    expect(calls).toBe(1);
    expect(run(source, 0, () => false)).toBe('missing');
  });
  it('binds a nullish value once while retaining falsy values', () => {
    const source = 'guard const item = record(value) else { return "missing"; } return item;';
    for (const value of [0, false, '', 12]) {
      let calls = 0;
      expect(
        run(source, value, (v: unknown) => {
          calls++;
          return v;
        }),
      ).toBe(value);
      expect(calls).toBe(1);
    }
    for (const value of [null, undefined])
      expect(run(source, value, (v: unknown) => v)).toBe('missing');
  });
  it('supports ternaries, typed bindings, regexes, objects and comments', () => {
    const result = transform(
      'function f(input: number | null) { guard const n: number | null = input else { throw new Error("missing"); } return n * 2; }',
    );
    parse(result.code, 'ts');
    expect(run('guard value ? true : false else { return 0; } return 1;', true)).toBe(1);
    expect(
      run('guard /else[{}]/.test(value) /* else */ else { return 0; } return 1;', 'else{'),
    ).toBe(1);
    expect(run('guard (value != null) else { return null; } return value;', 2)).toBe(2);
  });
  it('composes with nested trailing closures, await, loop exits and finally', async () => {
    expect(
      run('return [1,2,3].map() { x in guard x > 1 else { return 0; } return x * 2; };'),
    ).toEqual([0, 4, 6]);
    expect(
      run(
        'const output=[]; for (const x of [0,1,2,3]) { guard x > 0 else { continue; } guard x < 3 else { break; } output.push(x); } return output;',
      ),
    ).toEqual([1, 2]);
    const events: string[] = [];
    expect(
      run(
        'try { guard value else { return 0; } return 1; } finally { record("cleanup"); }',
        false,
        (x: string) => events.push(x),
      ),
    ).toBe(0);
    expect(events).toEqual(['cleanup']);
    const result = transform(
      'async function f(input) { guard const value = await input else { return 0; } return value; }',
      { filename: 'async.twill' },
    );
    const fn = Function(result.code + ';return f;')();
    expect(await fn(Promise.resolve(2))).toBe(2);
  });
  it('requires all failure paths to exit and rejects ambiguous bindings', () => {
    expect(() => transform('function f(v) { guard v else { if(v) return; } }')).toThrow(
      /Every guard else path/,
    );
    expect(() => transform('function f(v) { guard v else { (()=>{return;})(); } }')).toThrow(
      TwillSyntaxError,
    );
    expect(() => transform('function f(v) { guard const x = v, y = v else { return; } }')).toThrow(
      /one binding declaration/,
    );
    expect(() => transform('function f(v) { if(v) guard const x = v else { return; } }')).toThrow(
      /requires a block/,
    );
    expect(() =>
      transform('function f(v) { guard const x = v else { return; } const x = 1; }'),
    ).toThrow(/already been declared/);
    expect(() => transform('guard false else { return; }')).toThrow(/outside of function/);
    expect(() => transform('guard false else { break; }')).toThrow(/Unsyntactic break/);
    expect(() =>
      transform(
        'function f(v) { guard v else { if(v === null) return 0; else throw new Error(); } }',
      ),
    ).not.toThrow();
  });
  it('keeps guard as an ordinary identifier in existing JS', () => {
    const source =
      'let guard = () => 1; guard(); guard = () => 2\nif (guard()) {} else {}\nguard: { break guard; }\nconst o={guard() {return 1}}; o.guard();';
    expect(transform(source, { filename: 'plain.twill' }).code).toBe(source);
  });
  it('reports mappings and change metadata without introducing runtime helpers', async () => {
    const source =
      'export function run(value) { guard value != null else { return []; } return value.map() { x in x * 2 }; }';
    const equivalent =
      'export function run(value) { if (!(value != null)) { return []; } return value.map(x => x * 2); }';
    const result = transform(source, { filename: 'source.twill' });
    expect(result).toMatchObject({ changed: true, guards: 1, closures: 1 });
    expect(originalPosition(result, 1, result.code.indexOf('value !='))).toMatchObject({
      column: source.indexOf('value !='),
    });
    expect((await minify(result.code, { minify: true })).code).toBe(
      (await minify(equivalent, { minify: true })).code,
    );
    expect(transform('function f(v) { guard v else { return 0; } return 1; }')).toMatchObject({
      changed: true,
      guards: 1,
      closures: 0,
    });
  });
});
