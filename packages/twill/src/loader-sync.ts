import { createRequire } from 'node:module';
import type { RegisterHooksOptions } from 'node:module';
import { LoaderState, moduleSource, resolveMissing, type LoaderOptions } from './loader-state.js';

const require = createRequire(import.meta.url);

export function createHooks(data: LoaderOptions = {}): RegisterHooksOptions {
  const state = new LoaderState(data);
  let compileModule: typeof import('./loader-compiler.js').compileModule | undefined;
  return {
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        return resolveMissing(specifier, context.parentURL, error);
      }
    },
    load(url, context, nextLoad) {
      const plan = state.prepare(url);
      if (!plan) return nextLoad(url, context);
      if (plan.cached !== undefined) return moduleSource(plan.cached);
      // require(ESM) is available on every Node version with registerHooks.
      // Never evaluate the compiler on native delegation or a disk-cache hit.
      compileModule ??= (
        require('./loader-compiler.js') as typeof import('./loader-compiler.js')
      ).compileModule;
      return state.complete(plan, compileModule(plan.source, plan.filename, plan.dialect));
    },
  };
}
