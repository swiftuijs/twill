import { fixtureRoot } from './helpers/fixture.js';
import { describe, expect, it } from 'vitest';
import { createElement, useState, memo, Component, forwardRef, Children } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSSRApp, defineComponent, h, ref } from 'vue';
import { renderToString } from '@vue/server-renderer';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { transform, isTwillFile, originalPosition, type TransformOptions } from '../src/compiler';
import { TwillProject } from '../src/project';
import { loadConfig } from '../src/config';

const require = createRequire(import.meta.url);
function compile(
  body: string,
  bindings: Record<string, unknown>,
  jsxImportSource = 'react',
  options: TransformOptions = {},
) {
  const result = transform(`function example(){${body}}`, {
    ...options,
    filename: 'example.twillx',
    jsxImportSource,
  });
  const emitted = ts.transpileModule(result.code, {
    fileName: 'example.tsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource },
  });
  return Function(
    'require',
    'exports',
    ...Object.keys(bindings),
    emitted.outputText + '; return example();',
  )(require, {}, ...Object.values(bindings));
}

function diagnostics(source: string, jsxImportSource = 'react', options: TransformOptions = {}) {
  // An ancestor node_modules supplies actual framework and declaration types.
  const root = fixtureRoot('.twill-ui-test-');
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        jsxImportSource,
        skipLibCheck: true,
      },
      include: ['*.twillx'],
    }),
  );
  writeFileSync(join(root, 'main.twillx'), source);
  writeFileSync(join(root, 'twill.config.json'), JSON.stringify(options));
  const p = new TwillProject(join(root, 'tsconfig.json'));
  try {
    return p.diagnostics();
  } finally {
    p.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

describe('natural component syntax', () => {
  it('uses real React components without wrappers and preserves hooks and identity', () => {
    let renders = 0;
    function Card({ children }: { children?: React.ReactNode }) {
      const [value] = useState('ok');
      renders++;
      return createElement('article', null, value, children);
    }
    const tree = compile('return Card { "child"; "content"; }', { Card });
    expect(renders).toBe(0);
    expect(tree.type).toBe(Card);
    expect(renderToStaticMarkup(tree)).toBe('<article>okchildcontent</article>');
    expect(renders).toBe(1);
  });
  it('preserves single-element children for slot and asChild APIs, including local declarations', () => {
    const Slot = ({ children }: { children: React.ReactElement }) => Children.only(children);
    const Label = ({ children }: { children: string }) => createElement('span', null, children);
    expect(
      renderToStaticMarkup(compile('return Slot { Label { "hello" }; };', { Slot, Label })),
    ).toBe('<span>hello</span>');
    expect(
      renderToStaticMarkup(
        compile('return Slot { const title="hello"; Label { title }; };', { Slot, Label }),
      ),
    ).toBe('<span>hello</span>');
    expect(
      renderToStaticMarkup(compile('return Slot { if (true) <span>hello</span>; };', { Slot })),
    ).toBe('<span>hello</span>');
    const prefix =
      'import {Children, type ReactElement} from "react"; function Slot(p:{children:ReactElement}) {return Children.only(p.children);} function Label(p:{children:string}) {return <span>{p.children}</span>;}';
    expect(
      diagnostics(prefix + 'export const view = Slot { const title="hello"; Label { title }; };'),
    ).toEqual([]);
    const direct = transform('Label { "hello" }', { filename: 'single.twillx' }).code;
    expect(direct).not.toContain('=>');
    expect(direct).not.toContain('__twillChildren');
  });
  it('supports memo, forwardRef, class and namespace components', () => {
    class Card extends Component<{ children?: React.ReactNode }> {
      render() {
        return createElement('article', null, this.props.children);
      }
    }
    const Label = memo(
      forwardRef<HTMLSpanElement, { children?: React.ReactNode }>((props, ref) =>
        createElement('span', { ref }, props.children),
      ),
    );
    const tree = compile('return UI.Card { Label({key:"label"}) { "hello" }; }', {
      UI: { Card },
      Label,
    });
    expect(tree.type).toBe(Card);
    expect(renderToStaticMarkup(tree)).toBe('<article><span>hello</span></article>');
  });
  it('collects through conditions, loops, switch and try, and composes with defer', () => {
    const events: string[] = [];
    const Card = (props: { children?: React.ReactNode }) =>
      createElement('article', null, props.children);
    const tree = compile(
      `return Card {
      const __twillChildren0 = "first";
      defer { events.push("cleanup"); }
      const f = () => "nested";
      f(); __twillChildren0;
      if (true) "second";
      for (const n of [1, 2]) String(n);
      for (let i=0;i<2;i++) {
        String(i)
      }
      switch (1) { case 1: "switch"; break; }
      try { "try"; } finally { "finally"; }
    };`,
      { Card, events },
    );
    expect(events).toEqual(['cleanup']);
    expect(renderToStaticMarkup(tree)).toBe(
      '<article>nestedfirstsecond1201switchtryfinally</article>',
    );
    expect(() => transform('Card { return "bad"; }', { filename: 'bad.twillx' })).toThrow(
      /Component children collect expressions/,
    );
  });
  it('composes nested components, ordinary callbacks, generics and commented props', () => {
    const Card = (props: { children?: React.ReactNode }) =>
      createElement('article', null, props.children);
    const Label = (props: { children?: React.ReactNode }) =>
      createElement('span', null, props.children);
    const tree = compile(
      'return Card(/* empty */) { [1,2].map { value in Label<number>(/* props */ ({key:value}), /* tail */) { value }; }; };',
      { Card, Label },
    );
    expect(renderToStaticMarkup(tree)).toBe('<article><span>1</span><span>2</span></article>');
    const source =
      'import type {ReactNode} from "react"; function Card<T>(p: {value:T; children?:ReactNode}) {return <article>{p.children}</article>;} export const view = Card<string>({value:123}) { "hello" };';
    expect(diagnostics(source).some((error) => error.code === 2322)).toBe(true);
    const bareGeneric = transform('Card<number> { 42 }', { filename: 'generic.twillx' });
    expect(bareGeneric.code).toContain('<Card<number>>');
    expect(transform('Card(/*empty*/) {}', { filename: 'empty.twillx' }).code).toContain(
      '/*empty*/',
    );
  });
  it('keeps generic callbacks native in UI files and uppercase callbacks native in ordinary files', () => {
    expect(compile('return [1,2,3].map { value in value * 2 };', {})).toEqual([2, 4, 6]);
    expect(compile('return (Run) { 42 };', { Run: (cb: () => number) => cb() })).toBe(42);
    expect(compile('return run { () in 42 };', { run: (cb: () => number) => cb() })).toBe(42);
    const result = transform('Run { 42 }', { filename: 'ordinary.twill' });
    expect(result.code).not.toContain('<Run');
    expect(result.code).toContain('Run(');
  });
  it('keeps Vue slots lazy, reads current reactive values and supports named slots', async () => {
    let calls = 0;
    const count = ref(1);
    const Panel = defineComponent({
      props: { title: String },
      setup(props, { slots }) {
        return () =>
          h('section', null, [
            h('h1', props.title),
            ...(slots.default?.() ?? []),
            ...(slots.footer?.() ?? []),
          ]);
      },
    });
    const tree = compile(
      'return Panel({title:"Vue"}) { child(); "tail"; } footer: { "footer" };',
      {
        Panel,
        child: () => {
          calls++;
          return h('span', String(count.value));
        },
      },
      'vue',
    );
    expect(calls).toBe(0);
    count.value = 2;
    expect(tree.type).toBe(Panel);
    expect(await renderToString(createSSRApp({ render: () => tree }))).toBe(
      '<section><h1>Vue</h1><span>2</span>tailfooter</section>',
    );
    expect(calls).toBe(1);
    expect(() =>
      transform('Panel {} footer: {} footer: {}', {
        filename: 'bad.twillx',
        jsxImportSource: 'vue',
      }),
    ).toThrow(/Duplicate Vue slot/);
  });
  it('supports React render props and Vue scoped default slots naturally', async () => {
    let calls = 0;
    const Data = ({ children }: { children: (value: number) => React.ReactNode }) => {
      calls++;
      return createElement('article', null, children(42));
    };
    const tree = compile('return Data { value in <span>{value}</span> };', { Data });
    expect(calls).toBe(0);
    expect(renderToStaticMarkup(tree)).toBe('<article><span>42</span></article>');
    expect(calls).toBe(1);
    const Panel = defineComponent({
      setup(_, { slots }) {
        return () => h('article', null, slots.default?.({ value: 42 }));
      },
    });
    const vnode = compile(
      'return Panel { ({value}: {value:number}) in h("span", String(value)); };',
      { Panel, h },
      'vue',
    );
    expect(await renderToString(createSSRApp({ render: () => vnode }))).toBe(
      '<article><span>42</span></article>',
    );
    const prefix =
      'import type {ReactNode} from "react"; function Data(p:{children:(value:number)=>ReactNode}) {return <article>{p.children(42)}</article>;}';
    expect(
      diagnostics(prefix + 'export const view = Data { value in <span>{value.toFixed()}</span> };'),
    ).toEqual([]);
    expect(
      diagnostics(prefix + 'export const view = Data { value in value.toUpperCase() };').some(
        (error) => error.code === 2339,
      ),
    ).toBe(true);
  });
  it('checks React props, children and mapped errors through the native JSX type system', () => {
    const prefix =
      'import type {ReactNode} from "react"; function Card(p: {title: string; children: ReactNode}) { return <article>{p.children}</article>; }\n';
    expect(diagnostics(prefix + 'export const view = Card({title:"ok"}) { "hello" };')).toEqual([]);
    const errors = diagnostics(prefix + 'export const view = Card({title:123}) { "hello" };');
    expect(errors.some((error) => error.code === 2322 && error.line === 2)).toBe(true);
    expect(
      diagnostics(prefix + 'export const view = Card { "hello" };').some(
        (error) => error.code === 2741,
      ),
    ).toBe(true);
  });
  it('infers inline callback props from native JSX and maps member errors', () => {
    const prefix =
      'function Button(p:{onClick:(value:number)=>void;children?:import("react").ReactNode}) {return <button/>;}';
    expect(
      diagnostics(
        prefix + 'export const view = Button({onClick:value=>value.toFixed()}) { "save" };',
      ),
    ).toEqual([]);
    expect(
      diagnostics(
        prefix + 'export const view = Button({onClick:value=>value.toUpperCase()}) { "save" };',
      ).some((error) => error.code === 2339),
    ).toBe(true);
  });
  it('checks Vue props using the Vue JSX runtime types', () => {
    const prefix =
      'import {defineComponent} from "vue"; const Panel = defineComponent({props: {title: {type:String, required:true}}});\n';
    expect(
      diagnostics(prefix + 'export const view = Panel({title:"ok"}) { "hello" };', 'vue'),
    ).toEqual([]);
    expect(
      diagnostics(prefix + 'export const view = Panel({title:123}) { "hello" };', 'vue').some(
        (error) => error.code === 2322,
      ),
    ).toBe(true);
  });
  it('uses standard extended tsconfigs and rejects removed component lists', () => {
    const root = fixtureRoot('.twill-ui-test-');
    try {
      writeFileSync(join(root, 'base.json'), '{"compilerOptions":{"jsxImportSource":"vue"}}');
      writeFileSync(join(root, 'tsconfig.json'), '{"extends":"./base.json"}');
      expect(loadConfig(root).jsxImportSource).toBe('vue');
      writeFileSync(join(root, 'base.json'), '{"compilerOptions":{"jsxImportSource":"react"}}');
      expect(loadConfig(root).jsxImportSource).toBe('react');
      writeFileSync(join(root, 'twill.config.json'), '{"builders":["Panel"]}');
      expect(() => loadConfig(root)).toThrow(/unknown option builders/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('infers Vue from imports, honors file pragmas and diagnoses ambiguous framework imports', () => {
    expect(
      transform('import {defineComponent} from "vue"; Panel {}', { filename: 'auto.twillx' }).code,
    ).toContain('@jsxImportSource vue');
    const mixed = 'import "react"; import "vue"; Card {}';
    expect(() => transform(mixed, { filename: 'mixed.twillx' })).toThrow(/Both React and Vue/);
    expect(
      transform('/** @jsxImportSource react */\n' + mixed, {
        filename: 'mixed.twillx',
        jsxImportSource: 'vue',
      }).code,
    ).not.toContain('default:');
  });
  it('matches TypeScript’s leading pragma rules and preserves shebangs', () => {
    const bodyComment = transform('import "react"; /** @jsxImportSource vue */ Card {}', {
      filename: 'pragma.twillx',
    });
    expect(bodyComment.code).not.toContain('default:');
    const multiple = transform(
      '/** @jsxImportSource vue */\n/** @jsxImportSource react */\nCard {}',
      { filename: 'pragma.twillx' },
    );
    expect(multiple.code).not.toContain('default:');
    const shebang = transform('#!/usr/bin/env node\nimport "vue"; Panel {}', {
      filename: 'hashbang.twillx',
    });
    expect(shebang.code).toMatch(/^#!\/usr\/bin\/env node\n\/\*\* @jsxImportSource vue/);
    const unchanged = transform('import "vue"; const view=<div/>;', { filename: 'pragma.twillx' });
    expect(unchanged.changed).toBe(true);
  });
  it('registers only the two unambiguous Twill extensions', () => {
    expect(isTwillFile('app.twill')).toBe(true);
    expect(isTwillFile('app.twillx?raw')).toBe(true);
    expect(isTwillFile('app.twill.js')).toBe(false);
    expect(isTwillFile('app.twill.jsx')).toBe(false);
  });
});

it('preserves literal spread props, commented dynamic props, keys and native child control flow', () => {
  const Card = (props: { title: string; children?: React.ReactNode }) =>
    createElement('article', { title: props.title }, props.children);
  const properties = { title: 'spread' };
  expect(
    renderToStaticMarkup(
      compile('return Card({ ...properties, key: "stable" }) { "child"; };', { Card, properties }),
    ),
  ).toBe('<article title="spread">child</article>');
  expect(
    renderToStaticMarkup(
      compile('return Card((properties), /* trailing */) { "child"; };', { Card, properties }),
    ),
  ).toBe('<article title="spread">child</article>');
  const tree = compile(
    `return Card(properties) {
    if(false) "absent"; else "else";
    outer: for(const n of [1,2]) { guard n === 1 else { continue outer; } String(n); }
    try { throw new Error("caught"); } catch(error) { error.message; }
    let n=0; do { "do"; n++; } while(n<1);
  };`,
    { Card, properties },
  );
  expect(renderToStaticMarkup(tree)).toBe('<article title="spread">else1caughtdo0</article>');
});
it.each([
  ['Card(1, 2) { "child"; };', /accepts one props/],
  ['Card {} done: {};', /one children closure/i],
])('rejects component call shape without silently discarding arguments: %s', (source, message) => {
  expect(() => transform(source as string, { filename: 'view.twillx' })).toThrow(message as RegExp);
});

describe('readable native children and lazy slots', () => {
  const Slot = (props: { children: React.ReactElement }) => Children.only(props.children);

  it.each([
    'Slot { <button>Save</button>; }',
    'Slot{<button>Save</button>}',
    'Slot {\n  <button>Save</button>;\n}',
    'Slot() { <button>Save</button>; }',
    'Slot( ) { <button>Save</button> }',
    'Slot({}) { <button>Save</button>; }',
    'Slot(properties) { <button>Save</button>; }',
    'Slot((properties), /* tail */) { <button>Save</button>; }',
    'Slot({ ...properties }) { <button>Save</button>; }',
    'Slot({ key: "stable" }) { <button>Save</button>; }',
    'UI.Slot { <button>Save</button>; }',
    'Slot<unknown> { <button>Save</button>; }',
  ])('emits one native JSX child without adding text nodes: %s', (source) => {
    const result = transform(source, { filename: 'child.twillx' });
    expect(result.code).toContain('><button>Save</button></');
    const tree = compile('return ' + source + ';', { Slot, UI: { Slot }, properties: {} });
    expect(tree.props.children.type).toBe('button');
    expect(renderToStaticMarkup(tree)).toBe('<button>Save</button>');
  });

  it('retains fragment identity and composes nested closures inside JSX', () => {
    const fragment = compile('return Slot { <><button>Save</button></>; };', { Slot });
    expect(fragment.props.children.type).toBe(Symbol.for('react.fragment'));
    expect(renderToStaticMarkup(fragment)).toBe('<button>Save</button>');
    expect(transform('Slot { <></>; }', { filename: 'child.twillx' }).code).toContain(
      '<Slot><></></Slot>',
    );
    const tree = compile('return Slot { <div>{Slot { <button>Save</button>; }}</div>; };', {
      Slot,
    });
    expect(renderToStaticMarkup(tree)).toBe('<div><button>Save</button></div>');
  });

  it.each([
    'Slot { /* before */ <button>Save</button>; }',
    'Slot { <button>Save</button> /* after */; }',
    'Slot { <button>Save</button>; /* after */ }',
    'Slot /* between */ { <button>Save</button>; }',
    'Slot(/* empty */) { <button>Save</button>; }',
    'Slot { (<button>Save</button>); }',
    'Slot { <button>Save</button> as React.ReactElement; }',
  ])('preserves a container when unwrapping would expose other syntax: %s', (source) => {
    const result = transform(source, { filename: 'child.twillx' });
    expect(result.code).toContain('>{');
    for (const comment of source.match(/\/\*.*?\*\//g) ?? [])
      expect(result.code).toContain(comment);
    expect(renderToStaticMarkup(compile('return ' + source + ';', { Slot }))).toBe(
      '<button>Save</button>',
    );
  });

  it('keeps dynamic child values, local declarations and render callbacks', () => {
    const Label = (props: { children: string }) => createElement('span', null, props.children);
    expect(renderToStaticMarkup(compile('return Label { "<&"; };', { Label }))).toBe(
      '<span>&lt;&amp;</span>',
    );
    expect(
      renderToStaticMarkup(
        compile('return Slot { const text="Save"; <button>{text}</button>; };', { Slot }),
      ),
    ).toBe('<button>Save</button>');
    expect(
      transform('Slot { const text="Save"; <button>{text}</button>; }', {
        filename: 'child.twillx',
      }).code,
    ).toContain('return (');
    const Data = (props: { children: (value: number) => React.ReactElement }) => props.children(42);
    expect(
      renderToStaticMarkup(compile('return Data { value in <button>{value}</button> };', { Data })),
    ).toBe('<button>42</button>');
  });

  it.each(['react', 'vue'])(
    'preserves nested component boundaries inside collectors for %s',
    (runtime) => {
      const Panel =
        runtime === 'react'
          ? (props: { children?: React.ReactNode }) =>
              createElement('section', null, props.children)
          : defineComponent({
              setup(_, { slots }) {
                return () => h('section', null, slots.default?.());
              },
            });
      const Item =
        runtime === 'react'
          ? (props: { children?: React.ReactNode }) => createElement('button', null, props.children)
          : defineComponent({
              setup(_, { slots }) {
                return () => h('button', null, slots.default?.());
              },
            });
      const source = 'return Panel { "before"; Item { <span>Save</span>; }; };';
      const tree = compile(source, { Panel, Item }, runtime);
      if (runtime === 'react') {
        expect(renderToStaticMarkup(tree)).toBe(
          '<section>before<button><span>Save</span></button></section>',
        );
      } else {
        return renderToString(createSSRApp({ render: () => tree })).then((html) =>
          expect(html).toBe('<section>before<button><span>Save</span></button></section>'),
        );
      }
    },
  );

  it('retains comma grouping and evaluates React child expressions once in order', () => {
    const events: number[] = [];
    const Panel = (props: { children: number }) => createElement('span', null, props.children);
    const source = 'Panel { (record(1), record(2)); }';
    expect(transform(source, { filename: 'comma.twillx' }).code).toContain('>{(');
    const record = (value: number) => {
      events.push(value);
      return value;
    };
    expect(renderToStaticMarkup(compile('return ' + source + ';', { Panel, record }))).toBe(
      '<span>2</span>',
    );
    expect(events).toEqual([1, 2]);
  });

  it('emits the same minified JavaScript as handwritten JSX', () => {
    const generated = transform('export const view = Slot { <button>Save</button>; };', {
      filename: 'child.twillx',
    }).code;
    const emit = (source: string) =>
      transformSync(source, { loader: 'tsx', jsx: 'automatic', minify: true }).code;
    expect(emit(generated)).toBe(emit('export const view = <Slot><button>Save</button></Slot>;'));
  });

  it('keeps concise default and named Vue slots lazy and observes current reactive values', async () => {
    const count = ref(1);
    let reads = 0;
    const read = () => {
      reads++;
      return count.value;
    };
    const Panel = defineComponent({
      setup(_, { slots }) {
        return () =>
          h('section', null, [...(slots.default?.() ?? []), ...(slots.footer?.() ?? [])]);
      },
    });
    const source =
      'return Panel { /* body */ <button>{read()}</button>; } footer: { <span>tail</span>; };';
    const result = transform(`function example(){${source}}`, {
      filename: 'slot.twillx',
      jsxImportSource: 'vue',
    });
    expect(result.code).toMatch(/default:\s*\(\)\s*=>/);
    expect(result.code).toMatch(/"footer":\s*\(\)\s*=>/);
    expect(result.code).toContain('/* body */');
    expect(result.code).not.toContain('=> {');
    expect(result.code).not.toContain('__twillChildren');
    const tree = compile(source, { Panel, read }, 'vue');
    expect(reads).toBe(0);
    count.value = 2;
    expect(await renderToString(createSSRApp({ render: () => tree }))).toBe(
      '<section><button>2</button><span>tail</span></section>',
    );
    expect(reads).toBe(1);
  });

  it.each(['value in', '(value: number) in'])(
    'preserves scoped-slot parameters with concise Vue arrows: %s',
    async (header) => {
      const Panel = defineComponent({
        setup(_, { slots }) {
          return () => h('section', null, slots.default?.(42));
        },
      });
      const source = 'return Panel { ' + header + ' <button>{value}</button>; };';
      const result = transform(`function example(){${source}}`, {
        filename: 'slot.twillx',
        jsxImportSource: 'vue',
      });
      expect(result.code).toMatch(/=>\s*<button/);
      expect(result.code).not.toContain('=> {');
      const html = await renderToString(
        createSSRApp({ render: () => compile(source, { Panel }, 'vue') }),
      );
      expect(html).toBe('<section><button>42</button></section>');
    },
  );

  it('preserves dynamic native-tag behavior of the default slot object', async () => {
    let reads = 0;
    const read = () => {
      reads++;
      return 'Save';
    };
    const source = 'return Panel { read(); };';
    const tree = compile(source, { Panel: 'section', read }, 'vue');
    expect(reads).toBe(1);
    expect(await renderToString(createSSRApp({ render: () => tree }))).toBe(
      '<section>Save</section>',
    );
    const shorthand = h('section', null, read);
    expect(await renderToString(createSSRApp({ render: () => shorthand }))).toBe(
      '<section>Save</section>',
    );
    expect(reads).toBe(2);
  });

  it('preserves computed __proto__ slot keys as own properties', () => {
    const source = 'Panel {} __proto__: { "Own slot"; }';
    const result = transform(source, { filename: 'slot.twillx', jsxImportSource: 'vue' });
    const ast = ts.createSourceFile('slot.tsx', result.code, ts.ScriptTarget.Latest, true);
    let record: ts.ObjectLiteralExpression | undefined;
    const find = (node: ts.Node) => {
      if (
        ts.isJsxExpression(node) &&
        node.expression &&
        ts.isObjectLiteralExpression(node.expression)
      )
        record = node.expression;
      ts.forEachChild(node, find);
    };
    find(ast);
    expect(record).toBeDefined();
    const slots = Function('return (' + record!.getText(ast) + ');')();
    expect(Object.hasOwn(slots, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(slots)).toBe(Object.prototype);
    expect(slots.__proto__()).toBe('Own slot');
  });

  it('keeps block-bodied Vue slots when declarations or cleanup need scope', async () => {
    const events: string[] = [];
    const Panel = defineComponent({
      setup(_, { slots }) {
        return () => h('section', null, slots.default?.());
      },
    });
    const source =
      'return Panel { const text="Save"; defer { events.push("cleanup"); }; <button>{text}</button>; };';
    const result = transform(`function example(){${source}}`, {
      filename: 'slot.twillx',
      jsxImportSource: 'vue',
    });
    expect(result.code).toMatch(/default:\s*\(\)\s*=>\s*\{/);
    const tree = compile(source, { Panel, events }, 'vue');
    expect(events).toEqual([]);
    expect(await renderToString(createSSRApp({ render: () => tree }))).toBe(
      '<section><button>Save</button></section>',
    );
    expect(events).toEqual(['cleanup']);
  });

  it.each(['react', 'vue'])('maps JSX tokens and type errors for %s', (runtime) => {
    const source =
      'declare const Slot: any;\nexport const view = Slot {\n  <button>{(1).toUpperCase()}</button>;\n};';
    const result = transform(source, { filename: 'mapped.twillx', jsxImportSource: runtime });
    const generated = result.code.slice(0, result.code.indexOf('toUpperCase')).split('\n');
    expect(originalPosition(result, generated.length, generated.at(-1)!.length)).toMatchObject({
      source: 'mapped.twillx',
      line: 3,
      column: '  <button>{(1).'.length,
    });
    expect(result.map.sourcesContent).toEqual([source]);
    expect(diagnostics(source, runtime)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 2339, line: 3, column: '  <button>{(1).'.length }),
      ]),
    );
  });
});

describe('Vue default-slot representation', () => {
  it.each([
    ['<button>{read()}</button>;', '<section><button>2</button></section>', []],
    ['value in <button>{value + read()}</button>;', '<section><button>42</button></section>', []],
    ['"before"; <button>{read()}</button>;', '<section>before<button>2</button></section>', []],
    ['(read(), <button>Save</button>);', '<section><button>Save</button></section>', []],
    [
      'const text=read(); defer { events.push("cleanup"); }; <button>{text}</button>;',
      '<section><button>2</button></section>',
      ['cleanup'],
    ],
    ['/* empty slot */', '<section></section>', []],
  ] as const)('keeps function slots lazy and scoped: %s', async (body, expected, cleanup) => {
    const current = ref(1);
    let reads = 0;
    const read = () => {
      reads++;
      return current.value;
    };
    const events: string[] = [];
    const Panel = defineComponent({
      setup(_, { slots }) {
        return () => h('section', null, slots.default?.(40));
      },
    });
    const source = 'return Panel { ' + body + ' };';
    const options = { vueDefaultSlot: 'function' } as const;
    const result = transform(`function example(){${source}}`, {
      ...options,
      filename: 'slot.twillx',
      jsxImportSource: 'vue',
    });
    expect(result.code).toContain('<Panel>{');
    expect(result.code).not.toContain('default:');
    expect(result.code).toContain('=>');
    const tree = compile(source, { Panel, read, events }, 'vue', options);
    expect(reads).toBe(0);
    expect(events).toEqual([]);
    current.value = 2;
    expect(await renderToString(createSSRApp({ render: () => tree }))).toBe(expected);
    expect(reads).toBe(body === '/* empty slot */' ? 0 : 1);
    expect(events).toEqual(cleanup);
  });

  it.each(['object', 'function'] as const)(
    'keeps named slots in an object with the %s setting',
    async (vueDefaultSlot) => {
      const Panel = defineComponent({
        setup(_, { slots }) {
          return () => h('section', null, [...slots.default!(), ...slots.footer!()]);
        },
      });
      const source = 'return Panel { <button>Save</button>; } footer: { <span>Tail</span>; };';
      const options = { vueDefaultSlot };
      expect(
        transform(`function example(){${source}}`, {
          ...options,
          filename: 'slots.twillx',
          jsxImportSource: 'vue',
        }).code,
      ).toContain('{{default:');
      expect(
        await renderToString(
          createSSRApp({ render: () => compile(source, { Panel }, 'vue', options) }),
        ),
      ).toBe('<section><button>Save</button><span>Tail</span></section>');
    },
  );

  it('leaves React, authored JSX and ordinary callbacks unchanged', () => {
    for (const source of [
      'const view=Panel { <button/>; };',
      'const view=<Panel>{()=> <button/>}</Panel>;',
      'const value=(Panel) { value in value + 1 };',
    ]) {
      for (const jsxImportSource of ['react', 'vue']) {
        if (jsxImportSource === 'vue' && source.startsWith('const view=Panel')) continue;
        const options = { filename: 'boundary.twillx', jsxImportSource };
        expect(transform(source, { ...options, vueDefaultSlot: 'function' }).code).toBe(
          transform(source, options).code,
        );
      }
    }
  });

  it('preserves parameter and JSX mappings with function slots', () => {
    const source = 'const view=Panel { (value:number) in <button>{value}</button>; };';
    const result = transform(source, {
      filename: 'mapped-slot.twillx',
      jsxImportSource: 'vue',
      vueDefaultSlot: 'function',
    });
    for (const token of ['value:number', '<button>', 'value}</button>']) {
      const generated = result.code.slice(0, result.code.indexOf(token)).split('\n');
      expect(originalPosition(result, generated.length, generated.at(-1)!.length)).toMatchObject({
        source: 'mapped-slot.twillx',
        line: 1,
        column: source.indexOf(token),
      });
    }
  });
});

it('checks function-slot projects and maps original expression errors', () => {
  const source =
    'declare const Panel:any;\nconst view=Panel { (value:number) in <button>{value.toUpperCase()}</button>; };';
  expect(diagnostics(source, 'vue', { vueDefaultSlot: 'function' })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 2339,
        line: 2,
        column: source.split('\n')[1]!.indexOf('toUpperCase'),
      }),
    ]),
  );
});
