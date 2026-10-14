import * as nodeModule from 'node:module';
import type { LoaderOptions } from './loader-state.js';

/** Internal registrar shared by the CLI and the public --import entry. */
export async function registerLoader(data: LoaderOptions = {}) {
  if (typeof nodeModule.registerHooks !== 'function') {
    nodeModule.register('./loader.js', import.meta.url, { data });
    return;
  }
  const { createHooks } = await import('./loader-sync.js');
  return nodeModule.registerHooks(createHooks(data));
}
