export interface CompileRequest {
  id: number;
  source: string;
  filename: string;
  jsxImportSource: string;
  vueDefaultSlot?: 'object' | 'function';
}
export interface CompileError {
  message: string;
  offset?: number;
  line?: number;
  column?: number;
}
export type CompileResponse = { id: number } & (
  | {
      result: {
        code: string;
        closures: number;
        guards: number;
        ifBindings: number;
        defers: number;
        switches: number;
        duration: number;
      };
      error?: never;
    }
  | { error: CompileError; result?: never }
);
