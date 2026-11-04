import { expect, it } from 'vitest';
import ts from 'typescript';
import { SourcePositions } from '../src/positions.twill';

it.each([
  '',
  'const value = "📦";',
  '\n\nconst value = 1;\n',
  '\r\n\r\nconst value = 1;\r\n',
  'const a = "📦";\r\n// comment\rconst b = 2;\u2028\u2029\n',
])('matches TypeScript coordinates and LF source maps for %j', (text) => {
  const native = ts.createSourceFile('positions.ts', text, ts.ScriptTarget.Latest);
  const positions = new SourcePositions(text);
  for (let offset = 0; offset <= text.length; offset++) {
    const point = native.getLineAndCharacterOfPosition(offset);
    expect(positions.getLineAndCharacterOfPosition(offset)).toEqual(point);
    expect(positions.getPositionOfLineAndCharacter(point.line, point.character)).toBe(offset);
    const prefix = text.slice(0, offset);
    const mapped = {
      line: prefix.split('\n').length,
      column: offset - prefix.lastIndexOf('\n') - 1,
    };
    expect(positions.mapPosition(offset)).toEqual(mapped);
    expect(positions.mapOffset(mapped.line, mapped.column)).toBe(offset);
  }
});
