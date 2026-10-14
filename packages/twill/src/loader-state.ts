import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isTwillFile } from './extensions.js';
import { isDependency, needsTypeEmission, resolveSourceFile } from './files.js';
import { openCompilationCache, type CompilationCache } from './compilation-cache.js';

export type LoaderOptions = { entries?: string[]; cache?: boolean };
export type PreparedModule = {
  url: string;
  filename: string;
  source: string;
  dialect: boolean;
  cached: string | undefined;
};

export function resolveMissing(specifier: string, parentURL: string | undefined, error: unknown) {
  if (
    ['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(
      (error as NodeJS.ErrnoException | undefined)?.code ?? '',
    ) &&
    specifier.startsWith('.') &&
    parentURL?.startsWith('file:')
  ) {
    const target = new URL(specifier, parentURL);
    const candidate = resolveSourceFile(fileURLToPath(target));
    if (candidate)
      return {
        url: pathToFileURL(candidate).href + target.search + target.hash,
        shortCircuit: true,
      };
  }
  throw error;
}

export function moduleSource(source: string) {
  return { format: 'module' as const, source, shortCircuit: true };
}

/** Shared I/O and cache policy; only the small Node hook adapters differ. */
export class LoaderState {
  private entries: Set<string>;
  private cacheEnabled: boolean;
  private cache: CompilationCache | undefined;
  private cacheInitialized = false;

  constructor(data: LoaderOptions = {}) {
    this.entries = new Set(data.entries);
    this.cacheEnabled = data.cache === true && process.env.TWILL_CACHE !== '0';
  }

  prepare(url: string): PreparedModule | undefined {
    if (!url.startsWith('file:')) return;
    const filename = fileURLToPath(url);
    const dialect = isTwillFile(filename) || this.entries.has(url);
    if (!dialect && (isDependency(filename) || !needsTypeEmission(filename))) return;
    const source = readFileSync(filename, 'utf8');
    if (this.cacheEnabled && !this.cacheInitialized) {
      this.cache = openCompilationCache();
      this.cacheInitialized = true;
    }
    return { url, filename, source, dialect, cached: this.cache?.read(url, source, dialect) };
  }

  complete(
    plan: PreparedModule,
    result: ReturnType<typeof import('./loader-compiler.js').compileModule>,
  ) {
    this.cache?.write(plan.url, plan.source, plan.dialect, result.source, result.observations);
    return moduleSource(result.source);
  }
}
