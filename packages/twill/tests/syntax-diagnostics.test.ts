import { describe, expect, it } from 'vitest';
import { transform, TwillSyntaxError } from '../src/compiler';
import { parseSyntax } from '../src/syntax';

describe('actionable guard syntax diagnostics', () => {
  it.each(['js', 'jsx', 'ts', 'tsx'] as const)(
    'identifies missing else in %s without changing the source position',
    (language) => {
      const source = 'function divide(a, b) {\n  guard b != 0 { return 0; }\n  return a / b;\n}';
      let failure: TwillSyntaxError | undefined;
      try {
        transform(source, { filename: 'divide.twill', language });
      } catch (error) {
        failure = error as TwillSyntaxError;
      }
      expect(failure).toBeInstanceOf(TwillSyntaxError);
      expect(failure).toMatchObject({
        filename: 'divide.twill',
        line: 2,
        column: 2,
        offset: source.indexOf('guard'),
        frame: '  guard b != 0 { return 0; }\n  ^',
      });
      expect(failure!.message).toContain("Missing 'else' in guard statement");
      expect(failure!.message).toContain('guard condition else { return ...; }');
      expect(() => parseSyntax(source, { language })).toThrow("Missing 'else' in guard statement");
      expect(() =>
        transform(source.replace('b != 0 {', 'b != 0 else {'), { language }),
      ).not.toThrow();
    },
  );

  it.each([
    'guard const value = input { return 0; }',
    'guard const { value } = input { return 0; }',
    'guard const [value] = input { return 0; }',
    'guard /* else is missing */ input { return 0; }',
    'guard input != "else" { return 0; }',
    'guard input != `else` { return 0; }',
    'guard input > 0;',
    'guard input',
    'guard true {}',
    'guard 1 {}',
    'guard "ready" {}',
    'guard this.ready {}',
    'guard new Boolean(input) {}',
    'guard typeof input === "number" {}',
    'guard void input {}',
    'guard delete input.value {}',
    'guard !input {}',
    'guard ~input {}',
    'guard !!input {}',
  ])('recognizes a malformed condition or binding: %s', (statement) => {
    expect(() => transform('function f(input) { ' + statement + ' }')).toThrow(
      "Missing 'else' in guard statement",
    );
  });

  it.each([
    ['guard else { return; }', "Guard needs a condition or 'const' binding before 'else'."],
    ['guard true else return;', "Guard 'else' must be followed by a block"],
    ['guard true else', "Guard 'else' must be followed by a block"],
    ['guard true else {}', 'Every guard else path must exit'],
  ])('explains the required guard structure: %s', (statement, message) => {
    const source = statement.endsWith('else')
      ? 'function f() { ' + statement
      : 'function f() { ' + statement + ' }';
    expect(() => transform(source)).toThrow(message);
  });

  it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])(
    'keeps malformed-guard coordinates across %j line separators',
    (separator) => {
      const source = 'function f(input) {' + separator + '  guard input {}' + separator + '}';
      expect(() => transform(source)).toThrow('input.twill:2:3: Missing');
    },
  );

  it.each([
    'guard',
    'guard();',
    'guard = value;',
    'guard += value;',
    'guard == value;',
    'guard + value;',
    'guard / value;',
    'guard < value;',
    'guard instanceof Object;',
    'guard in object;',
    'guard.value;',
    'guard?.value;',
    'guard[value];',
    'guard`value`;',
    'guard: { break guard; }',
    'guard as number;',
    'guard satisfies number;',
    'guard!;',
    'guard!!;',
    'guard!.value;',
    'guard!();',
    'guard![value];',
    'guard!`value`;',
    'guard! as number;',
    'guard! satisfies number;',
    'guard!\nvalue;',
    'guard\nvalue;',
    'guard\nconst value = 1;',
    'object.guard(value);',
  ])('preserves native identifier syntax: %s', (source) => {
    expect(transform(source).code).toBe(source);
  });

  it.each(['guard(1) { value in value };', 'guard { return 1; };'])(
    'preserves ordinary trailing-closure calls named guard: %s',
    (source) => {
      expect(transform(source)).toMatchObject({ guards: 0, closures: 1 });
    },
  );

  it.each(['guard const {', 'guard value(', 'guard (', 'guard [', 'guard {'])(
    'terminates lookahead for an unfinished group: %s',
    (source) => {
      expect(() => transform(source)).toThrow(TwillSyntaxError);
    },
  );

  it('does not replace lexical failures with a missing-else guess', () => {
    expect(() => transform('function f() { guard "unterminated')).toThrow(/Unterminated string/);
    expect(() => transform('guard(')).toThrow(/Unexpected token/);
  });
});
