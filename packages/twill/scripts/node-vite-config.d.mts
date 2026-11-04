export interface NodeViteOptions {
  entry: string;
  filename: string;
  outDir?: string;
  external?: (string | RegExp)[];
  minify?: boolean;
  emptyOutDir?: boolean;
  footer?: string;
  license?: string;
}

export const acornAlias: { find: RegExp; replacement: string };
export function nodeViteConfig(options: NodeViteOptions): import('vite').UserConfig;
