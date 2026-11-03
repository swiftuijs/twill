import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
test('guard and branch bindings share strict nullish behavior through Vite', async ({ page }) => {
  const source = resolve('.twill/browser-fixture/if-bindings.twill');
  writeFileSync(
    source,
    `export function read(input:{value:number}|null){const value=7;if const {value}=input{return value;}else{return value;}}
export function present(input:unknown){if const value=input{return Object.is(value,input);}return false;}
export function guarded(input:unknown){guard const value=input else{return false;}return Object.is(value,input);}
export function destructured(input:{length:number}|null|undefined){guard const {length}=input else{return -1;}return length;}
export function condition(input:unknown){guard input else{return false;}return true;}
export function loose(input:unknown){return input == null;}
export function cleanup(input:unknown,events:string[]){defer {events.push('cleanup');}guard const value=input else{events.push('missing');return false;}events.push('value');return Object.is(value,input);}`,
  );
  try {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const path = '/if-bindings.twill';
      const { read, present, guarded, destructured, condition, loose, cleanup } = await import(
        /* @vite-ignore */ path
      );
      const values = [
        null,
        undefined,
        false,
        0,
        -0,
        0n,
        NaN,
        '',
        Symbol(),
        {},
        [],
        () => {},
        document.all,
      ];
      return {
        reads: [read({ value: 0 }), read({ value: 3 }), read(null)],
        bindings: values.map((input) => {
          const expected = input !== null && input !== void 0;
          const events: string[] = [];
          return (
            present(input) === expected &&
            guarded(input) === expected &&
            cleanup(input, events) === expected &&
            events.join(',') === (expected ? 'value,cleanup' : 'missing,cleanup')
          );
        }),
        exotic: [
          present(document.all),
          guarded(document.all),
          destructured(document.all) === document.all.length,
          condition(document.all),
          loose(document.all),
        ],
      };
    });
    expect(result).toEqual({
      reads: [0, 3, 7],
      bindings: Array(13).fill(true),
      exotic: [true, true, true, false, true],
    });
    const output = await (await page.request.get('/if-bindings.twill?import')).text();
    expect(output).not.toContain('if const');
    expect(output).not.toContain('twill-runtime');
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(source, { force: true });
  }
});

test('React retains hook state across Twill and native TS edits without optional config files', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Twill refresh fixture');
  const button = page.getByRole('button');
  await expect(button).toHaveText('Count: 0');
  await button.click();
  await button.click();
  await expect(button).toHaveText('Count: 2');
  const file = resolve('.twill/browser-fixture/App.twillx');
  const original = readFileSync(file, 'utf8');
  const helper = resolve('.twill/browser-fixture/label.ts');
  try {
    writeFileSync(file, original.replace('{label}:', '{label} updated:'));
    await expect(button).toHaveText('Count updated: 2');
    writeFileSync(helper, 'export const label = "Counter";');
    await expect(button).toHaveText('Counter updated: 2');
    const transformed = await (await page.request.get('/App.twillx?import')).text();
    expect(transformed).toContain('$RefreshSig$');
    expect(transformed).toContain('/@react-refresh');
    expect(transformed).toContain('sourceMappingURL');
    expect(errors).toEqual([]);
  } finally {
    writeFileSync(file, original);
    writeFileSync(helper, 'export const label = "Count";');
  }
});

test('creating and deleting optional config reloads the module graph', async ({ page }) => {
  const config = resolve('.twill/browser-fixture/twill.config.json');
  await page.goto('/');
  await expect(page.locator('output')).toHaveText('Value: 42');
  try {
    writeFileSync(config, JSON.stringify({ implicitReturn: false }));
    await expect(page.locator('output')).toHaveText('Value: undefined');
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(config, { force: true });
  }
  await expect(page.locator('output')).toHaveText('Value: 42');
});

test('invalid live configuration reports an overlay and recovers after correction', async ({
  page,
}) => {
  const config = resolve('.twill/browser-fixture/twill.config.json');
  await page.goto('/');
  await expect(page.locator('output')).toHaveText('Value: 42');
  try {
    writeFileSync(config, '{ "implicitReturn": "invalid" }');
    await expect(page.locator('vite-error-overlay')).toBeVisible();
    writeFileSync(config, '{ "implicitReturn": true }');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page.locator('output')).toHaveText('Value: 42');
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(config, { force: true });
  }
});
test('external synchronous cleanup runs in the browser and config reload returns to inline output', async ({
  page,
}) => {
  const config = resolve('.twill/browser-fixture/twill.config.json'),
    source = resolve('.twill/browser-fixture/cleanup.twill');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  writeFileSync(
    source,
    'export function run(events:number[],fail:boolean){if(true)defer {events.push(1);if(fail)throw undefined;}defer {events.push(2);}return 3;}',
  );
  try {
    writeFileSync(config, '{"runtime":"external"}');
    await page.goto('/');
    // Configuration changes can trigger a full reload after initial navigation.
    await page.waitForLoadState('networkidle');
    await expect(page.locator('output')).toHaveText('Value: 42');
    const result = await page.evaluate(async () => {
      const modulePath = '/cleanup.twill';
      const { run } = await import(/* @vite-ignore */ modulePath);
      const events: number[] = [];
      const value = run(events, false);
      let threw = false,
        error;
      try {
        run([], true);
      } catch (problem) {
        threw = true;
        error = problem;
      }
      return { value, events, threw, undefinedFailure: error === undefined };
    });
    expect(result).toEqual({ value: 3, events: [2, 1], threw: true, undefinedFailure: true });
    const external = await (await page.request.get('/cleanup.twill?import')).text();
    expect(external).toContain('runDefers');
    expect(external).toMatch(/runtime.*helpers.*v1/);
    writeFileSync(config, '{"runtime":"inline"}');
    await expect
      .poll(async () => await (await page.request.get('/cleanup.twill?import')).text())
      .not.toContain('twill-runtime');
    expect(errors).toEqual([]);
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(config, { force: true });
    rmSync(source, { force: true });
  }
});

test('match expressions execute through Vite while native switch fallthrough remains intact', async ({
  page,
}) => {
  const source = resolve('.twill/browser-fixture/match.twill');
  writeFileSync(
    source,
    'export enum State<T>{case idle;case loaded(value:T);}export function read(input:State<number>){const result=match(input){case State.idle():0;case State.loaded({value}):value;};return result*2;}export function trace(value:number){const events:number[]=[];switch(value){case 1:events.push(1);case 2:events.push(2);break;default:events.push(0);}return events;}',
  );
  try {
    await page.goto('/');
    // Let the preceding test's config cleanup reload finish before import.
    await page.waitForLoadState('networkidle');
    const result = await page.evaluate(async () => {
      const path = '/match.twill';
      const module = await import(/* @vite-ignore */ path);
      return {
        idle: module.read(module.State.idle()),
        loaded: module.read(module.State.loaded(21)),
        trace: module.trace(1),
      };
    });
    expect(result).toEqual({ idle: 0, loaded: 42, trace: [1, 2] });
    const output = await (await page.request.get('/match.twill?import')).text();
    expect(output).not.toContain('match(input)');
    expect(output).toContain('case "loaded"');
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(source, { force: true });
  }
});
