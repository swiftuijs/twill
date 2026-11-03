import { transform, TwillSyntaxError } from '@swiftuijs/twill';
import { formatGenerated } from '@swiftuijs/twill-formatter/standalone';
import type { CompileRequest, CompileResponse } from './playground/protocol';
self.onmessage = async ({ data }: MessageEvent<CompileRequest>) => {
  let response: CompileResponse;
  try {
    if (data.source.length > 20_000)
      throw new Error('The playground accepts up to 20,000 characters.');
    const start = performance.now();
    const result = transform(data.source, {
      filename: data.filename,
      jsxImportSource: data.jsxImportSource,
      vueDefaultSlot: data.vueDefaultSlot,
    });
    let code = result.code;
    try {
      code = await formatGenerated(code, {
        filepath: data.filename.replace(/\.twillx$/, '.tsx').replace(/\.twill$/, '.ts'),
      });
    } catch {
      // Keep valid output available if the display formatter cannot handle it.
    }
    response = {
      id: data.id,
      result: {
        code,
        closures: result.closures,
        guards: result.guards,
        ifBindings: result.ifBindings,
        defers: result.defers,
        switches: result.switches,
        duration: performance.now() - start,
      },
    };
  } catch (error) {
    response = {
      id: data.id,
      error: {
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof TwillSyntaxError
          ? { offset: error.offset, line: error.line, column: error.column + 1 }
          : {}),
      },
    };
  }
  self.postMessage(response);
};
