import * as nodeModule from 'node:module';
import type { LoaderOptions } from './loader-state.js';

/** Internal registrar shared by the CLI and the public --import entry. */
export async function registerLoader(data: LoaderOptions = {}, inherit = false) {
  let hooks: ReturnType<typeof nodeModule.registerHooks> | undefined;
  if (typeof nodeModule.registerHooks !== 'function') {
    nodeModule.register('./loader.js', import.meta.url, { data });
  } else {
    const { createHooks } = await import('./loader-sync.js');
    hooks = nodeModule.registerHooks(createHooks(data));
  }
  if (inherit) {
    // Synchronous hooks are realm-local. Default Workers inherit this preload;
    // an explicit execArgv still overrides inheritance according to Node rules.
    const code =
      `import { registerLoader } from ${JSON.stringify(import.meta.url)}; ` +
      `process.setSourceMapsEnabled(true); await registerLoader(${JSON.stringify(data)});`;
    const preload = 'data:text/javascript,' + encodeURIComponent(code);
    if (!process.execArgv.includes(preload)) process.execArgv.push('--import', preload);
  }
  return hooks;
}
