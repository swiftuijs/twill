import { expect, it } from 'vitest';
import ts from 'typescript';
import { transform } from '@swiftuijs/twill';
import { formatGenerated } from '@swiftuijs/twill-formatter/standalone';
import { snippets } from '../../.vitepress/theme/playground/examples';

it.each(Object.entries(snippets))(
  'keeps the canonical %s playground output valid and lean',
  async (name, example) => {
    const result = transform(example.source, example);
    const filename = example.filename.replace(/\.twill(x?)$/, '.ts$1');
    const code = await formatGenerated(result.code, { filepath: filename });
    const emitted = ts.transpileModule(code, {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: example.jsxImportSource,
      },
    });
    expect(
      emitted.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error),
    ).toEqual([]);
    const ast = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true);
    const redundantReturns: ts.Node[] = [];
    const inspect = (node: ts.Node) => {
      if (
        ts.isArrowFunction(node) &&
        ts.isBlock(node.body) &&
        node.body.statements.length === 1 &&
        ts.isReturnStatement(node.body.statements[0]!)
      )
        redundantReturns.push(node);
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
    expect(redundantReturns).toEqual([]);
    if (name === 'enum-patterns') {
      const describe = ast.statements.find(
        (node): node is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(node) && node.name?.text === 'describe',
      )!;
      expect(describe.body!.statements[0]!.kind).toBe(ts.SyntaxKind.VariableStatement);
      expect(code).toContain('satisfies');
      expect(code).toContain('Non-exhaustive switch expression');
    }
    if (name === 'react') expect(code).toMatch(/<Panel>\s*<button/);
    if (name === 'vue') {
      expect(code).toMatch(/default:\s*\(\)\s*=>\s*(?:\(\s*)?<button/);
      expect(code).not.toMatch(/default:\s*\(\)\s*=>\s*\{\s*return/);
    }
  },
);
