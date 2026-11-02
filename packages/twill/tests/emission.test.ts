import { expect, it } from 'vitest';
import ts from 'typescript';
import { transform, originalPosition } from '../src/compiler';

function evaluate(source: string, input?: unknown, options = {}) {
  const result = transform(source, { filename: 'emission.twill', ...options });
  const emitted = ts.transpileModule(result.code, {
    fileName: 'emission.ts',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  return Function(emitted.outputText + ';return run;')()(input);
}
function arrows(code: string) {
  const result: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isArrowFunction(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('emission.ts', code, ts.ScriptTarget.Latest, true));
  return result;
}

it.each([
  ['[1,2].map { value in value + 1 }', [2, 3]],
  ['[{value:1}].map { .value + 1 }', [2]],
  ['[1].map { value in ({value}) }', [{ value: 1 }]],
  ['[1].map { value in (value, value + 1) }', [2]],
  ['[1].map { value in (() => value)() }', [1]],
  ['[1].map { /* before */ value /* header */ in value + 1 /* after */ }', [2]],
])('emits concise callbacks while preserving expression semantics: %s', (expression, expected) => {
  const source = 'function run(){return ' + expression + ';}';
  const result = transform(source);
  expect(arrows(result.code).every((node) => !ts.isBlock(node.body))).toBe(true);
  expect(evaluate(source)).toEqual(expected);
});

it('keeps lexical this/arguments and implicitReturn:false behavior', () => {
  const source =
    'function run(){const owner={value:4,read(){return [1].map { this.value + arguments.length }[0];}};return owner.read(7);}';
  expect(evaluate(source)).toBe(5);
  expect(evaluate('function run(){return [1].map { n in n + 1 };}', undefined, { implicitReturn: false })).toEqual([undefined]);
});

it.each(['switch', 'match'])('reuses a return-only block for %s without deleting arm scopes', (keyword) => {
  const branch =
    keyword === 'switch'
      ? 'case {kind:"loaded",value}:value;default:0;'
      : 'case State.loaded({value}):value;default:0;';
  const source = 'function run(input){return ' + keyword + '(input){' + branch + '};}';
  const result = transform(source);
  const ast = ts.createSourceFile('emission.ts', result.code, ts.ScriptTarget.Latest, true);
  const run = ast.statements[0] as ts.FunctionDeclaration;
  expect(run.body!.statements[0]!.kind).toBe(ts.SyntaxKind.VariableStatement);
  expect(run.body!.statements.some(ts.isEmptyStatement)).toBe(false);
  expect(result.code).toContain(': { const');
  expect(arrows(result.code)).toHaveLength(0);
  expect(evaluate(source, { kind: 'loaded', value: 7 })).toBe(7);
  expect(evaluate(source, { kind: 'absent' })).toBe(0);
});

it.each([
  'match(value){case State.loaded({value:result}):result;default:0;}',
  '(switch(value){case {kind:"loaded",value:result}:result;default:0;})',
])('avoids an IIFE in an implicitly returning callback: %s', (branch) => {
  const source = 'function run(input){return [input].map { value in ' + branch + ' }[0];}';
  const result = transform(source);
  const callbacks = arrows(result.code);
  expect(callbacks).toHaveLength(1);
  expect(ts.isBlock(callbacks[0]!.body)).toBe(true);
  expect(evaluate(source, { kind: 'loaded', value: 7 })).toBe(7);
  expect(evaluate(source, { kind: 'absent' })).toBe(0);
});

it('keeps general expression and direct-eval IIFE boundaries', () => {
  const expression =
    'function run(input){return 1 + match(input){case State.loaded({value}):value;default:0;};}';
  expect(arrows(transform(expression).code)).toHaveLength(1);
  expect(evaluate(expression, { kind: 'loaded', value: 7 })).toBe(8);
  const directEval =
    'function run(input){return [input].map { value in match(value){default:eval("value + 1");} }[0];}';
  expect(arrows(transform(directEval).code)).toHaveLength(2);
  expect(evaluate(directEval, 7)).toBe(8);
});

it('preserves single-statement branch ownership and dangling else', () => {
  const source =
    'function run(input){if(input.flag) return switch(input.value){case 1:4;default:5;}; else return 9;}';
  expect(evaluate(source, { flag: true, value: 1 })).toBe(4);
  expect(evaluate(source, { flag: true, value: 0 })).toBe(5);
  expect(evaluate(source, { flag: false })).toBe(9);
});

it('retains temporary scopes when earlier statements could observe their TDZ', () => {
  const source =
    'function run(input){const before=eval("__twillSubject0");return match(input){default:before;};}';
  const result = transform(source);
  const emitted = ts.transpileModule(result.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  expect(Function('__twillSubject0', emitted.outputText + ';return run(0);')(7)).toBe(7);
});

it('retains the original suspension restriction for implicit match returns', () => {
  expect(() =>
    transform('const result=[1].map { async value in match(value){default:await Promise.resolve(value);} };'),
  ).toThrow('requires a direct return');
});

it('preserves source token mappings after concise callback lowering', () => {
  const source = 'const values = [2].map {\n  value in\n  value * 2;\n};';
  const result = transform(source, { filename: 'mapped.twill' });
  const lines = result.code.slice(0, result.code.indexOf('value * 2')).split('\n');
  expect(originalPosition(result, lines.length, lines.at(-1)!.length)).toMatchObject({
    source: 'mapped.twill',
    line: 3,
    column: 2,
  });
});

it('does not restyle authored native arrows or switch statements', () => {
  const source =
    'const native = (value:number) => {return value;}; function run(input:number){switch(input){case 1:return native(input);default:return 0;}}';
  expect(transform(source).code).toBe(source);
});
