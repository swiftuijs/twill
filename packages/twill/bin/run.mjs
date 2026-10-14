import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerLoader } from '../dist/loader-registration.js';
import { realpathSync } from 'node:fs';

export async function run(filename, args) {
  const script = resolve(filename);
  const url = pathToFileURL(script).href;
  const native = /^(?:\.[cm]?js|\.[cm]?ts|\.jsx|\.tsx)$/.test(extname(script));
  const entries = native ? [] : [url, pathToFileURL(realpathSync(script)).href];
  process.argv = [process.execPath, script, ...args];
  process.setSourceMapsEnabled(true);
  await registerLoader({ entries, cache: true }, true);
  await import(url);
}
