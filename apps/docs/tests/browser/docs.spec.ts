import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('official AI guide serves the canonical skill and verifiable discovery under the site base', async ({
  page,
}) => {
  await page.goto('ai');
  await expect(page.locator('h1')).toHaveText('AI assistance');
  await expect(page.locator('.vp-doc')).toContainText(
    'npx skills add swiftuijs/twill --skill twill',
  );
  await expect(page.locator('.vp-doc')).toContainText('--agent codex');
  await expect(page.locator('.vp-doc')).toContainText('--agent claude-code');
  const base = process.env.TWILL_DOCS_BASE ?? '/';
  const link = page.getByRole('link', { name: 'Download the official SKILL.md', exact: true });
  await expect(link).toHaveAttribute('href', base + 'skills/twill/SKILL.md');
  const canonical = await readFile(
    new URL('../../../../skills/twill/SKILL.md', import.meta.url),
    'utf8',
  );
  const response = await page.request.get(base + 'skills/twill/SKILL.md');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe(canonical);
  const discovery = await page.request.get(base + '.well-known/agent-skills/index.json');
  expect(discovery.ok()).toBe(true);
  const index = await discovery.json();
  expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  expect(index.skills).toHaveLength(1);
  expect(index.skills[0]).toMatchObject({
    name: 'twill',
    type: 'skill-md',
    digest: 'sha256:' + createHash('sha256').update(canonical).digest('hex'),
  });
  expect(new URL(index.skills[0].url, discovery.url()).href).toBe(response.url());
  const download = page.waitForEvent('download');
  await link.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('SKILL.md');
  expect(await readFile((await file.path())!, 'utf8')).toBe(canonical);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('shell scripting guide distinguishes the Node replacement from released Rust and preserves navigation', async ({
  page,
}) => {
  await page.goto('getting-started');
  await page
    .locator('.vp-doc')
    .getByRole('link', { name: 'Shell scripting: local and global installation', exact: true })
    .click();
  await expect(page.locator('h1')).toHaveText('Shell scripting');
  const base = process.env.TWILL_DOCS_BASE ?? '/';
  await expect(page).toHaveURL(new RegExp(base + 'scripting#what-to-install$'));
  await expect(page.locator('.vp-doc')).toContainText('npm install --global @swiftuijs/twill');
  await expect(page.locator('.vp-doc')).toContainText('npm install --save-dev @swiftuijs/twill');
  await expect(page.locator('.vp-doc')).toContainText('npm install @swiftuijs/twill-shell');
  await expect(page.locator('.vp-doc')).toContainText('npm exec -- twill hello.twill');
  await expect(page.locator('.vp-doc')).toContainText('npm exec --call');
  await expect(page.locator('.vp-doc')).toContainText('node command.mjs');
  await expect(page.locator('.vp-doc')).toContainText('Hello from a child process');
  await expect(page.locator('.vp-doc')).toContainText('Use compiler and SDK 0.3.0 or newer');
  const exampleCode = page.locator('.language-twill code').filter({ hasText: 'guard const' });
  await expect(exampleCode).toContainText('Subprocess.run');
  await expect(exampleCode).toContainText('guard const');
  await expect(page.locator('.vp-doc')).toContainText('shell: false');
  await expect(page.locator('.vp-doc')).toContainText('#!/usr/bin/env twill');
  await expect(page.locator('.vp-doc')).toContainText('twill run hello.twill');
  await expect(page.locator('.vp-doc')).toContainText('not implemented');
  await expect(page.locator('.vp-doc')).toContainText('TWILL_CACHE=0');
  await expect(page.locator('.vp-doc')).toContainText('64 MiB');
  await expect(page.locator('.vp-doc')).toContainText('original source');
  await expect(page.locator('.vp-doc')).toContainText('@swiftuijs/twill-shell-native');
  await expect(page.locator('.vp-doc')).toContainText("Node's child_process.spawn");
  await expect(page.locator('.vp-doc')).toContainText('Changed in 0.3.0');
  await expect(page.locator('.vp-doc')).toContainText('process.exitCode');
  await expect(page.locator('.vp-doc')).toContainText('Worker.terminate()');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://twill.evecalm.com/scripting',
  );
  const example = page.getByRole('link', { name: 'complete example', exact: true });
  await expect(example).toHaveAttribute(
    'href',
    'https://github.com/swiftuijs/twill/blob/main/packages/shell/examples/build.twill',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + '.png');
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}
async function editor(page: Page) {
  const source = page.getByRole('textbox', { name: 'Twill source', exact: true });
  await expect(source).toHaveAttribute('contenteditable', 'true');
  return source;
}
const generated = (page: Page) =>
  page.getByRole('textbox', { name: 'Generated TypeScript / TSX', exact: true });

test('Twill operators and TwillX JSX retain their colors in both themes', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const dark of [false, true]) {
    await page.goto('patterns');
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const code = page.locator('.language-twill code').first();
    for (const word of ['guard', '&&', '===', 'typeof']) {
      const token = code
        .locator('span[style]')
        .filter({ hasText: new RegExp('^\\s*' + word + '$') })
        .first();
      await expect(token).toHaveCSS('color', dark ? 'rgb(249, 117, 131)' : 'rgb(215, 58, 73)');
    }
    await screenshot(page, info, 'operators-' + (dark ? 'dark' : 'light'));
    await page.goto('syntax');
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await expect(
      page
        .locator('.language-twill code span[style]')
        .filter({ hasText: /^\s*\?\?$/ })
        .first(),
    ).toHaveCSS('color', dark ? 'rgb(249, 117, 131)' : 'rgb(215, 58, 73)');
    await expect(
      page
        .locator('.language-twill code span[style]')
        .filter({ hasText: /^\s*&&$/ })
        .first(),
    ).toHaveCSS('color', dark ? 'rgb(249, 117, 131)' : 'rgb(215, 58, 73)');
    const pattern = page
      .locator('.language-twill code')
      .filter({ hasText: 'case LoadState.loaded' });
    for (const word of ['match', 'loaded']) {
      const token = pattern
        .locator('span[style]')
        .filter({ hasText: new RegExp('^\\s*' + word + '$') })
        .first();
      await expect(token).toHaveCSS(
        'color',
        word === 'match'
          ? dark
            ? 'rgb(249, 117, 131)'
            : 'rgb(215, 58, 73)'
          : dark
            ? 'rgb(179, 146, 240)'
            : 'rgb(111, 66, 193)',
      );
    }
    await screenshot(page, info, 'implicit-operators-' + (dark ? 'dark' : 'light'));
    await page.goto('frameworks');
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const jsx = page.locator('.language-twillx code');
    await expect(
      jsx
        .locator('span[style]')
        .filter({ hasText: /^button$/ })
        .first(),
    ).toHaveCSS('color', dark ? 'rgb(133, 232, 157)' : 'rgb(34, 134, 58)');
    await expect(jsx.locator('span[style]').filter({ hasText: /^\s*onClick$/ })).toHaveCSS(
      'color',
      dark ? 'rgb(179, 146, 240)' : 'rgb(111, 66, 193)',
    );
    await screenshot(page, info, 'jsx-' + (dark ? 'dark' : 'light'));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('English documentation navigation, search, highlighting and responsive layout', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page).toHaveTitle(/Twill/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://twill.evecalm.com/',
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('TypeScript.Clearer flow.');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.locator('div.language-twill code span[style]')).not.toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await screenshot(page, info, 'home');
  if (info.project.name === 'docs-mobile') {
    await page.getByRole('button', { name: 'mobile navigation' }).click();
    await page.getByRole('link', { name: 'Guide', exact: true }).last().click();
  } else await page.getByRole('link', { name: 'Get started', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Getting started');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('searchbox').fill('defer');
  await expect(page.locator('.VPLocalSearchBox .result')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
  const sitemap = await page.request.get('sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  const sitemapText = await sitemap.text();
  expect(sitemapText).not.toContain('/zh/');
  expect(sitemapText).toContain('https://twill.evecalm.com/');
  expect(sitemapText).not.toContain('swiftuijs.github.io');
  expect(errors).toEqual([]);
});

test('user tooling guides and search exclude repository maintenance', async ({ page }, info) => {
  await page.goto('tooling');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Editor and tooling');
  await expect(page.locator('.vp-doc')).toContainText('your application root');
  await expect(page.locator('.vp-doc')).toContainText('twill check -p tsconfig.json');
  await expect(page.locator('.vp-doc')).not.toContainText('pnpm editor:package');
  await expect(page.locator('.VPSidebar a[href*="/contributing/"]')).toHaveCount(0);
  await expect(page.locator('.VPSidebar a[href*="/rfcs/"]')).toHaveCount(0);
  await page.locator('.vp-doc').getByRole('link', { name: 'build tools', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Build tools');
  await page.locator('.vp-doc').getByRole('link', { name: 'declaration emission' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Libraries and declarations');
  await page.locator('.vp-doc').getByRole('link', { name: 'CLI options' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CLI reference');
  const sitemap = await (await page.request.get('sitemap.xml')).text();
  for (const path of ['tooling', 'build-tools', 'libraries', 'cli'])
    expect(sitemap).toContain('/' + path);
  for (const path of ['/contributing/', '/rfcs/', '/architecture', '/releasing'])
    expect(sitemap).not.toContain(path);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('searchbox').fill('Repository development');
  await expect(page.locator('.VPLocalSearchBox .result')).not.toHaveCount(0);
  await expect(
    page.locator(
      '.VPLocalSearchBox a[href*="/contributing/"], .VPLocalSearchBox a[href*="/rfcs/"]',
    ),
  ).toHaveCount(0);
  await expect(page.locator('.VPLocalSearchBox')).not.toContainText('Repository development');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await screenshot(page, info, 'user-cli');
});

test('product comparisons, adoption links and readiness stay usable', async ({ page }, info) => {
  const errors: string[] = [];
  const requested: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('./');
  await expect(page.getByRole('tab', { name: 'Validation', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toContainText('guard const user');
  await page.getByRole('tab', { name: 'Cleanup', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('defer');
  await expect(page.getByRole('tabpanel')).toContainText('callbacks allocate');
  await page.getByRole('tab', { name: 'Cleanup', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Business states', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('satisfies never');
  await expect(page.getByRole('tabpanel')).toContainText('twill check');
  await page.getByRole('tab', { name: 'Business states', exact: true }).press('End');
  await expect(page.getByRole('tab', { name: 'Callbacks', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toContainText(/\.filter \{ user in\s+user\.active/);
  await page.getByRole('tab', { name: 'Callbacks', exact: true }).press('Home');
  await expect(page.getByRole('tab', { name: 'Validation', exact: true })).toBeFocused();
  expect(
    requested.filter((url) =>
      /(?:compiler\.worker|\/editor[.-][^/]+\.js|\/Playground[.-][^/]+\.js)/.test(url),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await screenshot(page, info, 'comparison');
  await page.getByRole('link', { name: 'Read why Twill', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Why Twill?');
  await expect(
    page.getByRole('heading', { name: /Put cleanup next to acquisition/ }),
  ).toBeVisible();
  await page.goto('readiness');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compatibility and limitations');
  await expect(page.locator('.vp-doc')).toContainText(
    'A broad production-ready claim would go beyond the current evidence.',
  );
  expect(errors).toEqual([]);
});

test('live compilation, highlighted examples, located errors and recovery', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('playground');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Playground');
  const source = await editor(page);
  await expect(page.getByRole('status')).toContainText('Compiled in');
  await expect(generated(page)).toContainText('=>');
  await expect(source.locator('.twill-token-keyword')).not.toHaveCount(0);
  await expect(generated(page).locator('.twill-token-keyword')).not.toHaveCount(0);
  await expect(page.locator('.VPSidebar')).toHaveCount(0);
  await expect(page.locator('.VPFooter')).toHaveCount(0);
  const viewport = page.viewportSize()!;
  const panes = await page.locator('.playground-code-editor').evaluateAll((editors) =>
    editors.map((editor) => {
      const { width, top, bottom } = editor.getBoundingClientRect();
      return { width, top, bottom };
    }),
  );
  for (const pane of panes) {
    expect(pane.width).toBeGreaterThan(viewport.width * (viewport.width > 760 ? 0.45 : 0.85));
    expect(pane.bottom).toBeLessThanOrEqual(viewport.height);
  }
  expect(panes[0]!.top).toBeLessThan(220);
  await page.getByText('Help', { exact: true }).click();
  await expect(page.locator('.playground-help-popover')).toContainText('Parentheses are optional');
  await page.getByText('Help', { exact: true }).click();
  await screenshot(page, info, 'playground');
  await page.getByLabel('Example', { exact: true }).selectOption('members');
  await expect(generated(page)).toContainText('.active');
  await expect(generated(page)).toContainText('=>');
  await expect(generated(page)).not.toContainText('__twillImplicit');
  await expect(source).toContainText('users.filter { .active }');
  await page.getByLabel('Example', { exact: true }).selectOption('cleanup');
  await expect(page.getByRole('status')).toContainText('1 guard · 1 defer');
  await expect(generated(page)).toContainText('finally');
  await expect(generated(page)).not.toContainText('__twillDefers');
  await expect(generated(page)).toContainText('__twillCleanup');
  await expect(source.locator('.twill-contextual-keyword')).toHaveText(['defer', 'guard']);
  await page.getByLabel('Example', { exact: true }).selectOption('branching');
  await expect(page.getByRole('status')).toContainText('1 guard · 1 switch expression');
  await expect(generated(page)).toContainText('satisfies never');
  await expect(generated(page)).toContainText('case \"ok\"');
  await page.getByLabel('Example', { exact: true }).selectOption('if-bindings');
  await expect(page.getByRole('status')).toContainText('1 if binding');
  await expect(source).toContainText('if const { value }');
  await expect(generated(page)).toContainText('!== null');
  await expect(generated(page)).not.toContainText('=>');
  await page.getByLabel('Example', { exact: true }).selectOption('enum-patterns');
  await expect(source).toContainText('case LoadState.loaded');
  await expect(
    source
      .locator('.cm-line')
      .filter({ hasText: 'match (state)' })
      .locator('.twill-token-keyword')
      .filter({ hasText: /^match$/ }),
  ).toHaveCount(1);
  await expect(generated(page)).toContainText('typeof LoadState.loaded');
  await expect(generated(page)).toContainText('satisfies never');
  await expect(generated(page)).not.toContainText('match (');
  await page.getByLabel('Example', { exact: true }).selectOption('react');
  await expect(generated(page)).toContainText('<Panel>');
  await expect(page.getByRole('status')).toContainText('Compiled in');
  if (info.project.name === 'docs-mobile')
    await page.getByRole('button', { name: 'mobile navigation' }).click();
  await page.getByRole('switch', { name: 'Switch to dark theme' }).click();
  if (info.project.name === 'docs-mobile')
    await page.getByRole('button', { name: 'mobile navigation' }).click();
  await screenshot(page, info, 'playground-dark-react');
  await page.getByLabel('Example', { exact: true }).selectOption('vue');
  await expect(generated(page)).toContainText(/default\s*:\s*\(/);
  await source.fill('fn {');
  await expect(page.getByRole('alert')).toContainText('Unable to compile');
  await expect(page.getByRole('button', { name: 'Copy output' })).toBeDisabled();
  await expect(page.getByText('Last valid output')).toBeVisible();
  await page.getByRole('button', { name: /Go to error/ }).click();
  await expect(source).toBeFocused();
  await expect(page.locator('.cm-lintPoint-error, .cm-lintRange-error')).not.toHaveCount(0);
  await screenshot(page, info, 'playground-error');
  await source.fill('export const result = [1].map { n in n + 42 };');
  await source.press('Control+Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(generated(page)).toContainText('n + 42');
  await expect(page.getByRole('button', { name: 'Copy output' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('link', { name: 'Syntax guide ↗' })).toHaveAttribute(
    'href',
    (process.env.TWILL_DOCS_BASE ?? '/') + 'syntax',
  );
  expect(errors).toEqual([]);
});

test('drafts, reset, output export and keyboard editing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('playground');
  const source = await editor(page);
  const draft = 'const greeting: string = "Hello Twill";\nconst result = [1].map { n in n + 7 };';
  await source.fill(draft);
  await expect(generated(page)).toContainText('n + 7');
  await page.reload();
  await editor(page);
  await expect(source).toContainText('Hello Twill');
  await expect(generated(page)).toContainText('n + 7');
  await page.getByRole('button', { name: 'Copy output' }).click();
  await expect(page.getByText('Output copied', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('n + 7');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toBe('example.ts');
  expect(await readFile((await artifact.path())!, 'utf8')).toContain('n + 7');
  await source.press('Control+Home');
  await source.press('Tab');
  await expect(source.locator('.cm-line').first()).toHaveText(/^\s+const greeting/);
  await source.press('Control+z');
  await expect(source.locator('.cm-line')).toHaveText(draft.split('\n'));
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('twill.playground.draft')!).source),
    )
    .toBe(draft);
  await source.press('Escape');
  await source.press('Tab');
  await expect(source).not.toBeFocused();
  await page.getByRole('button', { name: 'Reset example' }).click();
  await expect(source).toContainText('greaterThanFour');
  await expect(generated(page)).toContainText('greaterThanFour');
  await expect(page.getByRole('button', { name: 'Reset example' })).toBeDisabled();
  await source.fill(
    '// defer { and guard const are comments\nconst text = "defer { guard const";\nconst result = [1].map { n in n };',
  );
  await expect(page.getByRole('status')).toContainText('Compiled in');
  await expect(source.locator('.twill-contextual-keyword')).toHaveCount(0);
});

test('obsolete worker results are ignored and normal edits reuse one worker', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let count = 0;
    Object.defineProperty(window, '__twillWorkerCount', { get: () => count });
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        count++;
        let handler: ((event: MessageEvent) => void) | null = null;
        Object.defineProperty(this, 'onmessage', {
          get: () => handler,
          set: (value) => {
            handler = value;
          },
        });
        this.addEventListener('message', (event) => {
          const delay = event.data.result?.code.includes('slowValue') ? 650 : 0;
          setTimeout(() => handler?.call(this, event), delay);
        });
      }
    };
  });
  await page.goto('playground');
  const source = await editor(page);
  await expect(page.getByRole('status')).toContainText('Compiled in');
  await source.fill('const slowValue = [1].map { n in n + 1 };');
  await expect(page.getByRole('status')).toHaveText('Compiling…');
  await source.fill('const latestValue = [1].map { n in n + 99 };');
  const published: string[] = [];
  await page.exposeFunction('captureOutput', (value: string) => published.push(value));
  await page.evaluate(() => {
    const output = document.querySelector('[aria-label="Generated TypeScript / TSX"]')!;
    new MutationObserver(() => {
      (window as unknown as { captureOutput(value: string): void }).captureOutput(
        output.textContent ?? '',
      );
    }).observe(output, { subtree: true, childList: true, characterData: true });
  });
  await expect(generated(page)).toContainText('latestValue');
  expect(published.every((value) => !value.includes('slowValue'))).toBe(true);
  await page.getByLabel('Example', { exact: true }).selectOption('react');
  await expect(generated(page)).toContainText('<Panel>');
  expect(
    await page.evaluate(
      () => (window as unknown as { __twillWorkerCount: number }).__twillWorkerCount,
    ),
  ).toBe(1);
});

test('a failed compiler download can be retried without reloading the page', async ({ page }) => {
  let fail = true;
  await page.route('**/compiler.worker-*.js', (route) =>
    fail ? route.abort('failed') : route.continue(),
  );
  await page.goto('playground');
  await editor(page);
  await expect(page.getByRole('alert')).toContainText('Unable to compile');
  await expect(page.getByRole('button', { name: 'Copy output' })).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: 'Retry compilation' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(generated(page)).toContainText('greaterThanFour');
  await expect(page.getByRole('status')).toContainText('Compiled in');
});

test('input size limits preserve the current draft and generated output stays read-only', async ({
  page,
}) => {
  await page.goto('playground');
  const source = await editor(page);
  await expect(page.getByRole('status')).toContainText('Compiled in');
  const prefix = 'export const accepted = 42; //';
  const valid = prefix + 'x'.repeat(20_000 - prefix.length);
  await source.fill(valid);
  await expect(generated(page)).toContainText('accepted = 42');
  await expect(generated(page)).toHaveAttribute('contenteditable', 'false');
  await expect(generated(page)).toHaveAttribute('aria-readonly', 'true');
  await source.fill('export const rejected = 0; //' + 'x'.repeat(20_001));
  await expect(page.getByText(/20,000/).last()).toBeVisible();
  // CodeMirror virtualizes long lines; validate the complete draft rather than
  // the currently visible fragment at the end of this 20,000-character line.
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('twill.playground.draft')!).source),
    )
    .toBe(valid);
  await expect(generated(page)).toContainText('accepted = 42');
  await source.fill('export const recovered = [1].map { n in n + 1 };');
  await expect(generated(page)).toContainText('recovered');
  await expect(page.getByRole('status')).toContainText('Compiled in');
});

test('SEO metadata is page-specific in static HTML and client navigation', async ({ page }) => {
  const descriptions = new Set<string>();
  for (const route of [
    '',
    'why-twill',
    'getting-started',
    'performance',
    'scripting',
    'benchmark-history',
  ]) {
    const response = await page.request.get(route || './');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    await page.goto(route || './');
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toBeTruthy();
    expect(descriptions.has(description!)).toBe(false);
    descriptions.add(description!);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
      'content',
      description!,
    );
    await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute(
      'content',
      description!,
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      await page.title(),
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      `https://twill.evecalm.com/${route}`,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  }
  await page.goto('performance#node-shell-sdk');
  await expect(page.locator('#node-shell-sdk')).toHaveCount(1);
  const before = await page.locator('meta[property="og:description"]').getAttribute('content');
  await page.locator('.vp-doc a[href$="benchmark-history"]').first().click();
  await expect(page).toHaveURL(/benchmark-history/);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://twill.evecalm.com/benchmark-history',
  );
  await expect(page.locator('meta[property="og:description"]')).not.toHaveAttribute(
    'content',
    before!,
  );
  await expect(page.locator('.vp-doc')).toContainText(
    'The native 1 MiB capture and duplex workloads exceed the historical 1.10 target',
  );
  const legacyAnchors = await page
    .locator('.vp-doc h2[id], .vp-doc h3[id]')
    .evaluateAll((headings) => headings.map((heading) => heading.id));
  await page.goto('performance');
  for (const id of legacyAnchors) {
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
  }
});
