import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, configurationFiles } from '../src/config';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
it('tracks inherited and missing tsconfig files, then refreshes when they appear or disappear', () => {
  const root = mkdtempSync(join(tmpdir(), 'twill-config-'));
  roots.push(root);
  const parent = join(root, 'parent.json');
  writeFileSync(join(root, 'tsconfig.json'), '{ "extends": "./parent.json" }');
  expect(loadConfig(root).jsxImportSource).toBeUndefined();
  expect(configurationFiles(root)).toEqual(
    expect.arrayContaining([parent, join(root, 'twill.config.json')]),
  );
  writeFileSync(parent, '{ "compilerOptions": { "jsxImportSource": "vue" } }');
  expect(loadConfig(root).jsxImportSource).toBe('vue');
  rmSync(parent);
  expect(loadConfig(root).jsxImportSource).toBeUndefined();
});

it('uses an explicitly selected tsconfig rather than a neighboring default', () => {
  const root = mkdtempSync(join(tmpdir(), 'twill-config-'));
  roots.push(root);
  writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{"jsxImportSource":"react"}}');
  writeFileSync(join(root, 'base.json'), '{"compilerOptions":{"jsxImportSource":"vue"}}');
  const selected = join(root, 'tsconfig.vue.json');
  writeFileSync(selected, '{"extends":"./base.json"}');
  expect(loadConfig(root).jsxImportSource).toBe('react');
  expect(loadConfig(root, selected).jsxImportSource).toBe('vue');
});

it.each(['null', '[]', 'true', '1', '"config"'])(
  'rejects a non-object configuration %s',
  (source) => {
    const root = mkdtempSync(join(tmpdir(), 'twill-config-'));
    roots.push(root);
    writeFileSync(join(root, 'twill.config.json'), source);
    expect(() => loadConfig(root)).toThrow('expected an object');
  },
);
it.each(['null', '"true"', '1', '[]', '{}'])(
  'rejects a non-boolean implicitReturn %s',
  (source) => {
    const root = mkdtempSync(join(tmpdir(), 'twill-config-'));
    roots.push(root);
    writeFileSync(join(root, 'twill.config.json'), `{"implicitReturn":${source}}`);
    expect(() => loadConfig(root)).toThrow('implicitReturn must be a boolean');
  },
);
it('loads defaults without configuration, accepts schema metadata and diagnoses misspelled options', () => {
  const root = mkdtempSync(join(tmpdir(), 'twill-config-'));
  roots.push(root);
  expect(loadConfig(root)).toEqual({ jsxImportSource: undefined });
  expect(configurationFiles(root)).toEqual([
    join(root, 'twill.config.json'),
    join(root, 'tsconfig.json'),
  ]);
  writeFileSync(join(root, 'twill.config.json'), '{"implicitReturn":true,"$schema":"schema.json"}');
  expect(loadConfig(root).implicitReturn).toBe(true);
  writeFileSync(join(root, 'twill.config.json'), '{"implicitReturns":true}');
  expect(() => loadConfig(root)).toThrow('unknown option implicitReturns');
  writeFileSync(join(root, 'twill.config.json'), '{');
  expect(() => loadConfig(root)).toThrow();
});
it.each(['inline', 'external'])(
  'loads the %s runtime option and tracks its config file',
  (runtime) => {
    const root = mkdtempSync(join(tmpdir(), 'twill-runtime-config-'));
    roots.push(root);
    writeFileSync(join(root, 'twill.config.json'), JSON.stringify({ runtime }));
    expect(loadConfig(root).runtime).toBe(runtime);
    expect(configurationFiles(root)).toContain(join(root, 'twill.config.json'));
  },
);
it.each(['null', '"auto"', 'true', '1', '[]', '{}'])(
  'rejects an invalid runtime configuration %s',
  (source) => {
    const root = mkdtempSync(join(tmpdir(), 'twill-runtime-config-'));
    roots.push(root);
    writeFileSync(join(root, 'twill.config.json'), `{"runtime":${source}}`);
    expect(() => loadConfig(root)).toThrow('runtime must be inline or external');
  },
);

it.each(['object', 'function'])('loads the %s Vue default-slot representation', (vueDefaultSlot) => {
  const root = mkdtempSync(join(tmpdir(), 'twill-vue-config-'));
  roots.push(root);
  writeFileSync(join(root, 'twill.config.json'), JSON.stringify({ vueDefaultSlot }));
  expect(loadConfig(root).vueDefaultSlot).toBe(vueDefaultSlot);
});
it.each(['null', '"auto"', 'true', '1', '[]', '{}'])(
  'rejects an invalid Vue default-slot representation %s',
  (source) => {
    const root = mkdtempSync(join(tmpdir(), 'twill-vue-config-'));
    roots.push(root);
    writeFileSync(join(root, 'twill.config.json'), `{"vueDefaultSlot":${source}}`);
    expect(() => loadConfig(root)).toThrow('vueDefaultSlot must be object or function');
  },
);
it('ships matching compiler/editor schemas for the Vue slot setting', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../schemas/twill.schema.json', import.meta.url), 'utf8'),
  );
  const editor = JSON.parse(
    readFileSync(new URL('../../../editors/vscode/twill.schema.json', import.meta.url), 'utf8'),
  );
  expect(editor).toEqual(schema);
  expect(schema.properties.vueDefaultSlot).toMatchObject({
    type: 'string',
    enum: ['object', 'function'],
    default: 'object',
  });
});
