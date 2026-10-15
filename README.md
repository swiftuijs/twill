# <img src="https://twill.evecalm.com/logo.png" alt="Twill hummingbird" align="right" width="40" height="40" /> Twill

[![npm version](https://img.shields.io/npm/v/%40swiftuijs%2Ftwill)](https://www.npmjs.com/package/@swiftuijs/twill)
[![npm monthly downloads](https://img.shields.io/npm/dm/%40swiftuijs%2Ftwill)](https://www.npmjs.com/package/@swiftuijs/twill)
[![CI](https://img.shields.io/github/actions/workflow/status/swiftuijs/twill/ci.yml?branch=main&label=CI)](https://github.com/swiftuijs/twill/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/%40swiftuijs%2Ftwill)](https://github.com/swiftuijs/twill/blob/main/LICENSE)

**TypeScript. Clearer flow.**

Twill is a **TypeScript-based language with Swift-inspired syntax extensions**, built by [forth.ink](https://forth.ink). It extends TypeScript and TSX with guards, `defer`, trailing closures and checked switch expressions. Use TypeScript's type system and existing JavaScript libraries; compile to ordinary JavaScript.

[Documentation](https://twill.evecalm.com/) · [Why Twill?](https://twill.evecalm.com/why-twill) · [Playground](https://twill.evecalm.com/playground) · [Getting started](https://twill.evecalm.com/getting-started) · [AI skill](https://twill.evecalm.com/ai) · [VS Code extension](https://marketplace.visualstudio.com/items?itemName=forth-ink.twill) · [Compatibility](https://twill.evecalm.com/readiness)

```twill
async function readOwned(acquire: () => Promise<TextDocument>) {
  const document = await acquire();
  defer {
    await document.close();
  }

  guard const text = await document.readText() else {
    return 'Missing';
  }
  return text.toUpperCase();
}
```

The successful path stays in view; release sits next to acquisition. Registration is block-scoped, cleanup is awaited explicitly, and `return await` keeps an owned resource alive until its work finishes. The output uses ordinary JS control flow.

**Release line:** 0.2. Twill is an experimental language with a tested compiler, editor and build workflow. Start with one module and evaluate it against your application’s requirements. See [support and compatibility](https://twill.evecalm.com/readiness).

## Why use Twill?

- **Make early exits explicit.** `guard … else` requires an exiting failure path. `guard const` evaluates once, preserves zero and false, and keeps native TS narrowing.
- **Keep cleanup beside ownership.** Register `defer` immediately after acquisition; reached registrations run on scope exit in reverse order, including failures.
- **Catch omitted business states.** Match ordinary TS discriminated unions and bind their payloads. `twill check` verifies expression exhaustiveness when a variant is added.
- **Keep callbacks and composition readable.** Trailing closures work with normal callback APIs. In UI files, component closures become native JSX children or lazy Vue slots.
- **Adopt one module at a time.** Two-way TS/JS imports, standard framework APIs, generated declarations and optional native source export keep the integration incremental.

TypeScript already expresses these behaviors with branches, `try/finally`, arrows and unions. Twill supplies a more explicit syntax for recurring tasks; it earns its place when review clarity outweighs an additional compiler integration. Read the [code comparisons and tradeoffs](https://twill.evecalm.com/why-twill).

## Small syntax, existing semantics

```twill
const names = users.filter {
  .active;
}.map {
  .name;
};

type Outcome = { kind: 'ok'; value: number } | { kind: 'error'; message: string };
function describe(outcome: Outcome): string {
  return switch (outcome) {
    case { kind: 'ok', value }: value.toFixed(2);
    case { kind: 'error', message }: message;
  };
}
```

Ordinary closures become arrows; guards become branches. Direct-return switch expressions become native switches. Twill 0.2.0 also removes the IIFE from standalone identifier initializers; other expression contexts retain it. Inline emission introduces no runtime library. Dynamic/async `defer` and scope-sensitive registrations retain callbacks; dynamic registrations use a local stack; general component child collection uses arrays. These costs are [documented and measured](https://twill.evecalm.com/performance).

Twill 0.3.0 emits native `try/finally` for eligible direct synchronous cleanup and reduces repeated editor/configuration work. The older 0.2.0 retains callback-based cleanup. Dynamic registration, general expression lowering and cold initialization still have measured costs; use the [performance guide](https://twill.evecalm.com/performance) to choose and profile hot paths.

| File                         | Use                                                         |
| ---------------------------- | ----------------------------------------------------------- |
| `.twill`                     | TypeScript, including JavaScript syntax with optional types |
| `.twillx`                    | TSX, native JSX and component closures                      |
| `.ts`, `.tsx`, `.js`, `.jsx` | Ordinary source files, retaining their native syntax        |

The current parser targets documented TypeScript 5.9 syntax; it does not claim support for every valid TypeScript program. Trailing closures also introduce [syntax ambiguity rules](https://twill.evecalm.com/syntax#ambiguities-and-semicolons). Native TS/JS files keep their usual parsing.

Twill and native files can import each other through the build adapters, virtual checker and Node ESM loader. Your normal `tsconfig.json` supplies types and JSX settings. No `twill.config.json` is required. Native `tsc` cannot parse dialect source; use `twill check` and [standard declaration output](https://twill.evecalm.com/libraries).

## Try it

The [playground](https://twill.evecalm.com/playground) runs the actual compiler locally, with live highlighting and generated-source inspection. It does not execute your code or type-check project imports.

Install the compiler as a development dependency in your application. Use Node 24 LTS for a new setup; the package supports `^20.19.0 || >=22.12.0`. Run from the directory containing your `package.json` (run `npm init -y` first for a new project). Default inline emission introduces no language runtime dependency into your application bundle. The [optional runtime](https://twill.evecalm.com/runtime) in 0.2.0 shares dynamic synchronous cleanup when explicitly selected.

```sh
pnpm add -D @swiftuijs/twill@0.3.1
# npm install --save-dev @swiftuijs/twill@0.3.1
```

Add the Vite adapter to your existing configuration:

```ts
import { defineConfig } from 'vite';
import twill from '@swiftuijs/twill/vite';

export default defineConfig({ plugins: [twill()] });
```

Rename one module to `.twill`, update its imports, include it in your usual tsconfig and run:

```sh
pnpm exec twill check -p tsconfig.json
```

Follow [getting started](https://twill.evecalm.com/getting-started) to complete the editor, formatter and linter setup. For React, use the [React Vite adapter](https://twill.evecalm.com/frameworks#react-with-vite-8) to keep Fast Refresh working.

## Run a script

For a project-local command, install the compiler above, save this as `hello.twill` and run `npm exec -- twill hello.twill 'hello world'` (or `pnpm exec twill hello.twill 'hello world'`):

```typescript
#!/usr/bin/env twill
console.log(process.argv.slice(2));
```

Expected output is `[ 'hello world' ]`. On Linux/macOS, use `chmod +x hello.twill` then `npm exec --call './hello.twill "hello world"'` or `pnpm exec ./hello.twill 'hello world'` for a local shebang. For direct `./hello.twill` execution, install `@swiftuijs/twill` globally with `npm install --global @swiftuijs/twill@0.3.1` and keep `twill` on PATH. Windows uses the explicit CLI.

Install `@swiftuijs/twill-shell` in the script's project only when using its subprocess API; a global compiler does not install project imports. Follow [shell scripting](https://twill.evecalm.com/scripting) for complete installation, a portable subprocess example, Node type checking and troubleshooting. Native JS/TS consumers need only the SDK.

## A complete working loop

| Tool                 | What it provides                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Compiler and checker | Syntax lowering, original-source diagnostics, native TS types and generated declarations                   |
| VS Code extension    | Completion, signatures, hover, definitions, references, mixed-file rename, safe quick fixes and formatting |
| Formatter and linter | Independent Prettier and ESLint packages, including optional type-aware exhaustive linting                 |
| Build and execution  | Vite, Rollup, esbuild, webpack and Rspack adapters; an opt-in Node ESM loader                              |
| Debugging            | Source maps, generated-source viewer, project diagnostics and original-source Node breakpoints             |
| Web highlighting     | `@swiftuijs/twill-highlight`: browser/SSR Shiki integration and portable TextMate grammars                 |
| Source export        | `twill export`: optional checked source export to formatted native TS/TSX                                  |

React children, render props, Vue slots and component libraries use native framework contracts. There are no component registries or Twill-specific wrapping APIs.

[SwiftUI.js](https://swiftuijs.evecalm.com/) (`@swiftuijs/ui`) is our sibling project: a SwiftUI-inspired React component library. Its components work with Twill's native JSX output. Its website covers installation and styles; see its [source repository](https://github.com/swiftuijs/ui) for the components.

Independent [examples](https://github.com/swiftuijs/twill/blob/main/examples/README.md) cover ordinary workflows, mixed sources, cleanup, React, Vue and library output. The [React framework source study](https://twill.evecalm.com/react-source) also compares a pinned client-core rewrite with native JavaScript.

## Packages

The compiler includes adapters for your existing bundler:

| Host    | Adapter import             | Native TS/JSX owner      |
| ------- | -------------------------- | ------------------------ |
| Vite    | `@swiftuijs/twill/vite`    | Vite                     |
| Rollup  | `@swiftuijs/twill/rollup`  | Twill adapter by default |
| Webpack | `@swiftuijs/twill/webpack` | Twill adapter by default |
| Rspack  | `@swiftuijs/twill/rspack`  | Twill adapter by default |
| esbuild | `@swiftuijs/twill/esbuild` | esbuild                  |

Use `@swiftuijs/twill/vite-react` for React Fast Refresh. The [build guide](https://twill.evecalm.com/build-tools#adapter-support) records tested host versions, watch/incremental workflows and the 0.2.0 configuration-refresh behavior. Builds remain transpile-only; run `twill check` separately.

Install only the tools your project needs. Keep Twill packages on the same release version.

| Package                                                                                  | Purpose                                                          |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`@swiftuijs/twill`](https://www.npmjs.com/package/@swiftuijs/twill)                     | Compiler, `twill` CLI, checker, build adapters and Node loader   |
| [`@swiftuijs/twill-formatter`](https://www.npmjs.com/package/@swiftuijs/twill-formatter) | Prettier plugin and browser-compatible formatting API            |
| [`@swiftuijs/twill-linter`](https://www.npmjs.com/package/@swiftuijs/twill-linter)       | ESLint flat configurations and source-mapped fixes               |
| [`@swiftuijs/twill-export`](https://www.npmjs.com/package/@swiftuijs/twill-export)       | Optional `twill export` command for native TS/TSX output         |
| [`@swiftuijs/twill-highlight`](https://www.npmjs.com/package/@swiftuijs/twill-highlight) | Browser/SSR Shiki integration and TextMate grammars              |
| `@swiftuijs/twill-shell`                                                                 | Native argv execution, bounded output and owned process teardown |
| `@swiftuijs/twill-runtime`                                                               | Optional, versioned synchronous cleanup helpers                  |

The [shell scripting](https://twill.evecalm.com/scripting) toolkit adds `#!/usr/bin/env twill` executable scripts and content-validated startup caching in 0.2.0. Install/import `@swiftuijs/twill-shell` for subprocesses; native JS/TS consumers need no compiler. npm 0.2.0 still uses the retired Rust addon. Twill 0.3.0 simplifies the SDK to Node spawn/streams with zero production dependencies; cancel and await work before worker/process exit. See the [version and ownership boundary](https://twill.evecalm.com/scripting#execution-and-version-boundary).

Install the [Twill VS Code extension](https://marketplace.visualstudio.com/items?itemName=forth-ink.twill) from Marketplace, or run `code --install-extension forth-ink.twill`. The extension bundles its editing tools. Your application installs the compiler for builds and whole-project checks. See the [editor guide](https://twill.evecalm.com/tooling) for configuration.

## Choosing it responsibly

Twill is a useful candidate for nullable workflows, owned resources, typed state handling and callback-heavy code. It is still an experimental dialect. Parser coverage follows a tested TS 5.9 contract; arbitrary workspace TS versions, general editor refactoring, native incremental `tsc --build`, a CommonJS Twill loader and every SSR framework are outside its current guarantees.

Representative native/dialect bundles are compared for behavior and byte size; release artifacts have enforced size budgets. Synthetic benchmarks do not establish whole-application speed or team productivity. Profile your actual workload and exercise failure paths. See [compatibility](https://twill.evecalm.com/readiness), [performance](https://twill.evecalm.com/performance) and [gradual adoption](https://twill.evecalm.com/adoption).

## AI assistance

Install the [official Twill AI skill](https://twill.evecalm.com/ai) with `npx skills add swiftuijs/twill --skill twill`. It guides Codex, Claude Code and other Agent Skills clients through application syntax, resource ownership, integrations and verification while distinguishing released features from source prototypes. The skill does not install the compiler or other project tools.

## Contributing

The repository is a pnpm workspace with Vite builds. Tooling packages and editor integrations are developed in Twill, exercising the same public adapters, checker and declaration emitter as applications. The compiler remains bootstrapped from JS/TS; see [developing tooling in Twill](https://github.com/swiftuijs/twill/blob/main/docs/contributing/dogfooding.md). See the [development guide](https://github.com/swiftuijs/twill/blob/main/docs/contributing/tooling.md) for checkout, dependency and build commands. Compiler, formatter, linter, export, highlight, optional runtime and shell packages, editor packages, examples and the English documentation site own their code and tests.

```sh
pnpm check
pnpm editor:test          # requires a graphical host; use xvfb-run -a on headless Linux
pnpm test:browser        # requires Playwright Chromium
pnpm docs:dev
```

See [contributing](https://github.com/swiftuijs/twill/blob/main/CONTRIBUTING.md), [architecture](https://github.com/swiftuijs/twill/blob/main/docs/contributing/architecture.md), [language design](https://twill.evecalm.com/language) and [release instructions](https://github.com/swiftuijs/twill/blob/main/docs/contributing/releasing.md). MIT licensed.

## Added in 0.2.0

Twill 0.2.0 adds `if const value = lookup() { use(value); }` with branch-local nullish bindings and native destructuring. Group trailing calls in initializers, following Swift’s condition boundary. It emits native branches without a helper, closure or optional wrapper. See [syntax](https://twill.evecalm.com/syntax#branch-nullish-bindings) and [RFC 0018](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0018-optional-branch-bindings.md).

Twill 0.2.0 includes associated-value enums and `match` expressions: `match (state) { case State.loaded({ value }): value; default: 0; }`. Named payload bindings and erased factory descriptors compile to native switches without calling factories. Native switch statements retain JS fallthrough; match and switch expressions return one result without fallthrough. Use the coordinated 0.2.0 packages and extension. Compiler, formatter, linter, highlighter, export and editor changes are validated together. See [syntax and compatibility](https://twill.evecalm.com/syntax#match-expressions) and [RFC 0016](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0016-pattern-matching.md).

For Node scripts, Twill 0.2.0 supports `#!/usr/bin/env twill`, `twill script.twill` and `twill run script.twill`, with Swift-inspired guards, callbacks and cleanup. The Node ESM loader remains available through `node --import @swiftuijs/twill/register`. The [shell SDK](https://twill.evecalm.com/scripting) adds native argv execution, bounded output and process ownership without command compilation. It works independently with ordinary JS/TS; scoped streams, pipelines and shell templates remain deferred.
