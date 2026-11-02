import { afterEach, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import twill, { disposeProjects } from '../src/index.twill';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

afterEach(disposeProjects);
describe('ESLint Twill processor', () => {
  it('discovers nested dialect files with braces/extglobs and respects flat-config ignores', async () => {
    const root = mkdtempSync(join(tmpdir(), 'twill-lint-globs-'));
    try {
      mkdirSync(join(root, 'src/nested'), { recursive: true });
      mkdirSync(join(root, 'src/generated'));
      writeFileSync(join(root, 'src/main.twill'), 'export const value = [1].map { n in n*2 };');
      writeFileSync(join(root, 'src/nested/view.twillx'), 'export const value = 1;');
      writeFileSync(join(root, 'src/generated/bad.twill'), 'invalid {');
      const eslint = new ESLint({
        cwd: root,
        overrideConfigFile: true,
        overrideConfig: [{ ignores: ['**/generated/**'] }, ...twill.configs.recommended!],
      });
      for (const pattern of ['src/**/*.{twill,twillx}', 'src/**/*.@(twill|twillx)']) {
        const results = await eslint.lintFiles([pattern]);
        expect(
          results
            .map((result) => result.filePath.slice(root.length + 1).replaceAll('\\', '/'))
            .sort(),
        ).toEqual(['src/main.twill', 'src/nested/view.twillx']);
        expect(results.flatMap((result) => result.messages)).toEqual([]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const engine = (extra: any = {}, fix = false) =>
    new ESLint({
      overrideConfigFile: true,
      overrideConfig: [...twill.configs.recommended!, { files: ['**/*.ts'], ...extra }],
      fix,
    });
  it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])(
    'maps original ranges across %j',
    async (newline) => {
      const source = `export const result = [1].map { n in n*2 };${newline}const unused = 1;`;
      const [result] = await engine().lintText(source, { filePath: 'fixture.twill' });
      expect(
        result!.messages.find((message) => message.ruleId === '@typescript-eslint/no-unused-vars'),
      ).toMatchObject({ ruleId: '@typescript-eslint/no-unused-vars', line: 2, column: 7 });
    },
  );
  it('applies only source-preserving fixes without lowering the dialect', async () => {
    const source = 'export const result=[1].map { n in let value=n*2; return value; };';
    const [result] = await engine({ rules: { 'prefer-const': 'error' } }, true).lintText(source, {
      filePath: 'fix.twill',
    });
    expect(result!.output).toContain('map { n in const value=');
    expect(result!.messages).toEqual([]);
  });
  it('preserves implicit member syntax through safe fixes and ordinary lint rules', async () => {
    const source =
      'export const users=[{active:true}]; export const selected=users.filter { let enabled=true; return .active && enabled; };';
    const [result] = await engine({ rules: { 'prefer-const': 'error' } }, true).lintText(source, {
      filePath: 'members.twill',
    });
    expect(result!.messages).toEqual([]);
    expect(result!.output).toContain('const enabled=true');
    expect(result!.output).not.toMatch(/__twill|=>/);
    const [unsafe] = await engine({ rules: { 'prefer-const': 'error' } }, true).lintText(
      source.replace(
        'let enabled=true; return .active && enabled;',
        'let enabled=.active; return enabled;',
      ),
      { filePath: 'members-unsafe.twill' },
    );
    expect(unsafe!.messages[0]).toMatchObject({ ruleId: 'prefer-const', fix: undefined });
    expect(unsafe!.output).toBeUndefined();
  });
  it('reports original syntax errors and suppresses generated-helper lint', async () => {
    const [broken] = await engine().lintText('fn {', { filePath: 'broken.twill' });
    expect(broken!.messages[0]).toMatchObject({ fatal: true, severity: 2, line: 1 });
    const [valid] = await engine().lintText('export function run(){defer {};return 1;}', {
      filePath: 'cleanup.twill',
    });
    expect(valid!.messages).toEqual([]);
    const nativeSource = 'export function run(flag){defer {};if(flag){};return 1;}';
    const [nativeEmpty] = await engine().lintText(nativeSource, { filePath: 'native-empty.twill' });
    expect(nativeEmpty!.messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-empty',
        column: nativeSource.indexOf('{}', nativeSource.indexOf('if(flag)')) + 1,
      }),
    ]);
  });
  it('lints associated enum payloads without leaking generated factories or lowering fixes', async () => {
    const source =
      'export enum State<T>{case idle;case loaded(value:T);} export const result=State.loaded(3);';
    const [result] = await engine({}, true).lintText(source, { filePath: 'enums.twill' });
    expect(result!.messages).toEqual([]);
    expect(result!.output).toBeUndefined();
  });
  it('reports moved pattern bindings without reporting generated switch helpers', async () => {
    const source =
      'export function run(input: {kind:"ok";value:number}|null){guard const {kind}=input else{return 0;} return switch(input!){case {kind:"ok",value}: value;};}';
    const [result] = await engine().lintText(source, { filePath: 'branching.twill' });
    expect(result!.messages.map((message) => message.ruleId)).toEqual([
      '@typescript-eslint/no-unused-vars',
    ]);
    expect(result!.messages[0]).toMatchObject({ column: source.indexOf('kind}=') + 1 });
    const [fixed] = await engine({ rules: { 'prefer-const': 'error' } }, true).lintText(
      'export function run(v:number){return switch(v){case 1: (()=>{let total=3;return total;})();default: 0;};}',
      { filePath: 'branch-fix.twill' },
    );
    expect(fixed!.output).toContain('const total=3');
    expect(fixed!.output).toContain('return switch(v)');
    expect(fixed!.messages).toEqual([]);
  });
  it('maps branch binding diagnostics and safe body fixes without generated temporaries', async () => {
    const source =
      'export function run(input:{value:number}|null){if const {value}=input{return 0;}return 1;}';
    const [result] = await engine().lintText(source, { filePath: 'if-binding.twill' });
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0]).toMatchObject({
      ruleId: '@typescript-eslint/no-unused-vars',
      column: source.indexOf('value}=') + 1,
    });
    const fix =
      'export function run(input:number|null){if const value=input{let total=value+1;return total;}return 0;}';
    const [fixed] = await engine({ rules: { 'prefer-const': 'error' } }, true).lintText(fix, {
      filePath: 'if-binding-fix.twill',
    });
    expect(fixed!.messages).toEqual([]);
    expect(fixed!.output).toContain('if const value=input{const total=value+1;');
    expect(fixed!.output).not.toMatch(/__twill|!= null/);
  });
  it('supports type-aware rules against the virtual TypeScript program', async () => {
    const root = mkdtempSync(join(tmpdir(), 'twill-lint-'));
    try {
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            types: [],
          },
          include: ['**/*'],
        }),
      );
      const source = 'export const result=[1].map { n in Promise.resolve(n); n*2 };';
      writeFileSync(join(root, 'main.twill'), source);
      const eslint = new ESLint({
        overrideConfigFile: true,
        cwd: root,
        overrideConfig: twill.configs.recommendedTypeChecked,
      });
      const [result] = await eslint.lintText(source, { filePath: join(root, 'main.twill') });
      expect(
        result!.messages.some(
          (message) =>
            message.ruleId === '@typescript-eslint/no-floating-promises' &&
            message.column === source.indexOf('Promise') + 1,
        ),
      ).toBe(true);
    } finally {
      disposeProjects();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('maps typed exhaustiveness on a generated switch subject to its source keyword', async () => {
    const root = mkdtempSync(join(tmpdir(), 'twill-expression-lint-'));
    try {
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            types: [],
          },
          include: ['**/*'],
        }),
      );
      const source =
        'type Result={kind:"ok";value:number}|{kind:"bad";error:string};export function run(input:Result){return switch(input){case {kind:"ok",value}: value;default: 0;};}';
      const filename = join(root, 'main.twill');
      writeFileSync(filename, source);
      const eslint = new ESLint({
        cwd: root,
        overrideConfigFile: true,
        overrideConfig: twill.configs.recommendedTypeChecked,
      });
      const [result] = await eslint.lintText(source, { filePath: filename });
      expect(
        result!.messages.filter(
          (message) => message.ruleId === '@typescript-eslint/switch-exhaustiveness-check',
        ),
      ).toEqual([
        expect.objectContaining({
          column: source.indexOf('switch') + 1,
          message: expect.stringContaining('"bad"'),
        }),
      ]);
    } finally {
      disposeProjects();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it.each(['twill', 'twillx', 'ts'])(
    'detects omitted union cases even with a default in %s source',
    async (extension) => {
      const root = mkdtempSync(join(tmpdir(), 'twill-exhaustive-'));
      try {
        writeFileSync(
          join(root, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              types: [],
            },
            include: ['**/*'],
          }),
        );
        const filename = join(root, `states.${extension}`);
        const source = [
          'type Outcome = { kind: "ok"; value: number } | { kind: "error"; error: string };',
          'export function display(outcome: Outcome) {',
          extension === 'ts'
            ? 'return [outcome].map(value => {'
            : 'return [outcome].map { value in',
          'switch (value.kind) {',
          'case "ok": return String(value.value);',
          'default: return "fallback";',
          '}',
          extension === 'ts' ? '}); }' : '}; }',
        ].join('\n');
        writeFileSync(filename, source);
        const eslint = new ESLint({
          cwd: root,
          overrideConfigFile: true,
          overrideConfig: twill.configs.recommendedTypeChecked,
        });
        const rule = '@typescript-eslint/switch-exhaustiveness-check';
        const [missing] = await eslint.lintText(source, { filePath: filename });
        expect(missing!.messages.filter((message) => message.ruleId === rule)).toEqual([
          expect.objectContaining({
            severity: 2,
            line: 4,
            column: 9,
            message: expect.stringContaining('"error"'),
          }),
        ]);
        const complete = source.replace('default:', 'case "error": return value.error;\ndefault:');
        writeFileSync(filename, complete);
        const [valid] = await eslint.lintText(complete, { filePath: filename });
        expect(valid!.messages).toEqual([]);
        const extended = complete.replace(
          'error: string };',
          'error: string } | { kind: "canceled" };',
        );
        writeFileSync(filename, extended);
        const [changed] = await eslint.lintText(extended, { filePath: filename });
        expect(changed!.messages.find((message) => message.ruleId === rule)?.message).toContain(
          '"canceled"',
        );
      } finally {
        disposeProjects();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

it('checks typed enum patterns and maps exhaustiveness without lowering source fixes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'twill-enum-lint-'));
  try {
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          types: [],
        },
        include: ['**/*'],
      }),
    );
    const filename = join(root, 'main.twill');
    const source =
      'export enum State{case idle;case loaded(value:number);}\nexport function run(input:State){return match(input){case State.loaded({value}):(()=>{let result=value;return result;})();default:0;};}';
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        ...twill.configs.recommendedTypeChecked!,
        { files: ['**/*.ts'], rules: { 'prefer-const': 'error' } },
      ],
      fix: true,
    });
    writeFileSync(filename, source);
    const [result] = await eslint.lintText(source, { filePath: filename });
    expect(result!.messages).toEqual([
      expect.objectContaining({
        ruleId: '@typescript-eslint/switch-exhaustiveness-check',
        line: 2,
        column: source.split('\n')[1]!.indexOf('match') + 1,
        endColumn: source.split('\n')[1]!.indexOf('match') + 6,
        suggestions: [],
        message: expect.stringContaining('"idle"'),
      }),
    ]);
    expect(result!.output).toContain('case State.loaded({value})');
    expect(result!.output).toContain('const result=value');
    expect(result!.output).not.toContain('__twill');
    const complete = source.replace('default:0;', 'case State.idle():0;');
    writeFileSync(filename, complete);
    const [valid] = await eslint.lintText(complete, { filePath: filename });
    expect(valid!.messages).toEqual([]);
  } finally {
    disposeProjects();
    rmSync(root, { recursive: true, force: true });
  }
});

it('retains typed lint and safe source fixes with configured external cleanup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'twill-runtime-lint-'));
  try {
    mkdirSync(join(root, 'node_modules', '@swiftuijs'), { recursive: true });
    symlinkSync(
      join(import.meta.dirname, '../../runtime'),
      join(root, 'node_modules', '@swiftuijs', 'twill-runtime'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    writeFileSync(join(root, 'twill.config.json'), '{"runtime":"external"}');
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          types: [],
        },
        include: ['*.twill'],
      }),
    );
    const source =
      'export function run(input:number,events:number[]){let value=input;defer {events.push(value);}defer {events.push(value+1);}return value;}';
    const filename = join(root, 'main.twill');
    writeFileSync(filename, source);
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        ...twill.configs.recommendedTypeChecked!,
        { files: ['**/*.ts'], rules: { 'prefer-const': 'error' } },
      ],
      fix: true,
    });
    const [result] = await eslint.lintText(source, { filePath: filename });
    expect(result!.messages).toEqual([]);
    expect(result!.output).toContain('const value=input');
    expect(result!.output).toContain('defer {events.push(value);}');
    expect(result!.output).not.toMatch(/__twill|twill-runtime/);
  } finally {
    disposeProjects();
    rmSync(root, { recursive: true, force: true });
  }
});
