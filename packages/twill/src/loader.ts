import type { ResolveHook, LoadHook } from 'node:module';
import { LoaderState, moduleSource, resolveMissing, type LoaderOptions } from './loader-state.js';

let state = new LoaderState();
export function initialize(data: LoaderOptions | undefined) {
  state = new LoaderState(data);
}

export const resolve: ResolveHook = async (specifier, context, nextResolve) => {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    return resolveMissing(specifier, context.parentURL, error);
  }
};

export const load: LoadHook = async (url, context, nextLoad) => {
  const plan = state.prepare(url);
  if (!plan) return nextLoad(url, context);
  if (plan.cached !== undefined) return moduleSource(plan.cached);
  const { compileModule } = await import('./loader-compiler.js');
  return state.complete(plan, compileModule(plan.source, plan.filename, plan.dialect));
};
