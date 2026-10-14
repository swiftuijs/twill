---
name: twill
description: >-
  Write, review, debug and migrate Twill applications using Swift-inspired TypeScript
  syntax. Use for .twill/.twillx files, trailing closures, guard/defer/switch expressions,
  Twill build adapters, mixed TS/JS projects, and React/Vue integration.
license: MIT
metadata:
  release: 0.3.0
  website: https://twill.evecalm.com
  repository: https://github.com/swiftuijs/twill
---

# Develop applications with Twill

Twill extends TypeScript/TSX with Swift-inspired syntax and emits ordinary JavaScript. Use TypeScript's type system and existing JS libraries. This skill is for applications; contributing to the language repository follows its `AGENTS.md` and RFC process.

## Establish the project's contract

1. Read the application's instructions, manifest, lockfile, tsconfig and existing build/test setup. Check the installed `@swiftuijs/twill` version and keep Twill tooling packages on the same version. Metadata records this skill's released-language baseline, not a compiler installation.
2. Write dialect syntax in `.twill` (TS including JS) or `.twillx` (TSX). Native `.ts`, `.tsx`, `.js`, `.jsx` files retain native syntax. Change relative source imports to the actual `.twill` / `.twillx` path when renaming a module; do not leave a `.js` specifier targeting a renamed source. Declaration emission rewrites those dialect imports for ordinary JS/TS consumers. Adopt an appropriate module, respecting the user's requested scope.
3. The 0.3.0 baseline includes associated-value enums, `match`, branch-local `if const`, external cleanup helpers, executable scripts/caching and the dependency-free Node shell SDK. Use the installed version's actual support; proposals or later source work do not prove npm availability. Keep compiler, tooling and editor versions coordinated.
4. Use [syntax](https://twill.evecalm.com/syntax) and [compatibility](https://twill.evecalm.com/readiness) for detailed contracts. The parser targets documented TS 5.9 syntax; avoid claiming every TS program is compatible inside dialect files.

Twill 0.3.0 fixes native same-name type/value declarations such as `type Command = {...}; const Command = {...};`, including interface/value pairs. Upgrade older 0.2.0 projects before relying on this parser repair.

## Choose syntax that clarifies the task

### Callback pipelines

Use trailing closures when an ordinary API accepts a callback in that argument position. Earlier arguments remain inside parentheses. `in` separates an explicit parameter header; `(value: number) in` is a typed header. Multiple callbacks after the first require labels. Labels are erased and callbacks are appended in written order; they are not Swift argument labels.

```twill
const users = [
  { name: 'Ada', active: true },
  { name: 'Grace', active: false },
];
export const activeNames = users.filter {
  .active;
}.map {
  .name.toUpperCase();
};
export const doubled = [1, 2].map { value in
  value * 2;
};
```

A single expression returns implicitly by default. Multiple statements need an explicit `return`. With `implicitReturn: false`, even a single expression needs `return`. `.name` means member access on the first argument of that ordinary trailing closure; nested callbacks bind independently. Do not combine shorthand with an explicit header or use it outside eligible callbacks. `$0`, contextual enum shorthand and Swift `func`/`struct` syntax are not implemented.

Callbacks lower to arrows with lexical `this`. Keep ordinary `function` callbacks for APIs requiring a dynamic receiver. `fn() { ... }` is a trailing callback even across a newline; use `fn(); { ... }` for a separate block. Bare-name callbacks need the opening brace on the same line. Parenthesize an object return (`({ value: 42 })`) or a first-expression native `in` operator. Optional chaining, `??`, operators and async/await retain native contracts.

### Early exits and nullish bindings

Use `guard condition else { ... }` for a required exit on failure. Always include `else` and braces; `guard condition { ... }` is incomplete. The failure branch runs when the condition is false and must exit the enclosing scope. Use `guard const` to evaluate a nullable result once and preserve valid falsy values such as zero, false and empty strings. Successful bindings remain in the surrounding scope.

```twill
export function label(input: { name?: string } | null): string {
  guard const { name = 'Anonymous' } = input else {
    return 'Missing';
  }
  return name;
}
```

The whole initializer is checked before native object/array destructuring. Defaults, getters, iterator closing, rest and nested pattern errors retain native behavior; this is not JSON or nested-shape validation. Pattern bindings have a temporal dead zone in the initializer/failure block. An identifier guard initializes its identifier before the failure block. Use one binding and brace the enclosing conditional/loop body.

The failure block must provably exit with `return`, `throw`, `break` or `continue`, or a supported block/if whose paths exit. A call typed `never`, a loop, switch or try does not establish this syntactic proof. Prefer ordinary `if (...)` when the branch should continue. Do not invent `if let` from Swift.

**Branch bindings (0.2.0):** `if const value = expression { ... } else { ... }` evaluates once and binds a non-nullish immutable value only in the success block. Initializer, else and following references resolve in the outer scope, including an outer variable with the same name. Object/array destructuring runs only after the whole value passes the strict null/undefined check; defaults, getters, iterators, rest and nested errors keep native behavior. One binding and a braced success body are required; else is optional. Multiple bindings, while bindings and if expressions are not implemented. Use 0.2.0 or newer.

The outer initializer's next brace starts the branch. Group a trailing-call initializer: `if const user = (find(id) { candidate in candidate.active }) { use(user); }`. Await/yield, rejection, return, loop exits and branch-local defer keep their enclosing ownership. Ordinary initializers emit a hygienic temporary and native scoped const/if without adding a helper, closure, promise or runtime import. An initializer using `match` retains that expression's existing lowering costs and suspension restrictions. Use `guard const` when the successful binding must remain after the statement.

### Owned resources

Register `defer` immediately after acquiring ownership. Reached registrations run when that lexical block exits, in reverse order, including return/throw/loop exits. A branch owns its own cleanup; do not return a live resource that its block will close. Captures read live variables at cleanup time. Use explicit `await` for async cleanup and `return await` when pending work must finish before cleanup.

```twill
type Resource = { read(): Promise<string>; close(): Promise<void> };
export async function readOwned(acquire: () => Promise<Resource | null>): Promise<string> {
  guard const resource = await acquire() else {
    return 'Missing';
  }
  defer {
    await resource.close();
  }
  return await resource.read();
}
```

Every reached cleanup runs even if another cleanup fails; the last executed cleanup failure replaces an earlier/body failure. Synchronous cleanup does not await returned promises. Cleanup cannot jump out of its own defer block. For allocation-sensitive hot paths, consider native `try/finally`: defer callbacks and dynamic registration stacks have real costs.

Twill 0.3.0 lowers eligible direct synchronous cleanups to native nested `try/finally` without callbacks or stacks. Published 0.2.0 still uses its existing callback lowering. Dynamic/async registrations and observable scope/disposal boundaries retain their costs; inspect the installed compiler's output before relying on this optimization. Editor/configuration reuse improves specific tool workloads, not the speed of external commands or every cold script. See the measured scope and remaining bottlenecks in [performance](https://twill.evecalm.com/performance).

### Exhaustive outcomes

Prefer ordinary TS discriminated unions for business outcomes. A switch expression produces one arm value and never falls through. Object arms use one common literal discriminator and native destructuring; each arm has its own binding scope. An arm contains one expression or `throw`, not a statement list.

```twill
type Outcome = { kind: 'ok'; value: number } | { kind: 'error'; message: string };
export function describe(outcome: Outcome): string {
  return switch (outcome) {
    case { kind: 'ok', value }: value.toFixed(2);
    case { kind: 'error', message }: message;
  };
}
```

Run `twill check` to prove exhaustiveness: transpile-only builds and the playground cannot prove union types. A default is a catch-all; it can conceal new variants. The optional typed linter can require explicit union cases even with a default. Unexpected unchecked values without a matching arm/default throw. Object discriminators can be read once for selection and again during destructuring; avoid side-effectful discriminator getters.

Native switch statements retain JS fallthrough. Direct `return switch (...)` emits a native scoped switch. Other expression positions in the release baseline use a synchronous lexical IIFE; `await`/`yield` inside a switch require direct return. Evaluate an awaited subject beforehand when necessary. Prefer the direct-return form in hot paths, inspect emitted output, and compare equivalent native work rather than assuming a speedup. See [performance](https://twill.evecalm.com/performance).

### Associated outcomes (0.2.0)

Associated-value enums generate a native tagged union plus precise factory methods. Every case, including an empty one, is constructed with a call. Fields are named and readonly only statically; payload references are retained and each construction allocates a record. Match with qualified case descriptors and named bindings:

```twill
enum LoadState<T> {
  case idle;
  case loaded(value: T);
}
export function describeLoad(state: LoadState<number>): string {
  return match (state) {
    case LoadState.idle(): 'Idle';
    case LoadState.loaded({ value }): value.toFixed(2);
  };
}
```

`match` evaluates its subject once, reads the discriminator once and destructures only the selected arm. Case descriptors are erased; selection does not call factories. Run `twill check` for exhaustiveness. Unknown unchecked values without a default throw; a default can hide future variants. Match/switch expressions have no fallthrough; native switch statements retain JS fallthrough. Contextual `.case` shorthand, positional matching and a `fallthrough` keyword are not implemented. Enum/tag-method renames remain withheld; ordinary local binding and native owner/alias edits are supported.

Standalone identifier initializers and direct-return switch/match lower to native branches without an IIFE; other expression contexts retain a synchronous wrapper. Await/yield inside them requires direct return. Keep the original TDZ, destructuring costs and evaluation order in mind. Inspect generated output in hot paths.

**Optional cleanup helpers:** Default `runtime: "inline"` needs no language runtime. `runtime: "external"` requires `@swiftuijs/twill-runtime` as an application/library production dependency and shares versioned synchronous dynamic-defer helpers. Async and native fast paths remain inline; do not insert runtime imports unless the selected compiler output needs them. See [runtime](https://twill.evecalm.com/runtime).

## Integrate with the existing toolchain

Install the compiler as a dev dependency using the project's package manager. Node requirements come from the installed package. `twill.config.json` is optional; default inline output needs no language runtime. Preserve existing configuration and create a config only to change supported options. The project tsconfig supplies strictness, types and JSX settings.

For ordinary Vite projects:

```ts
import { defineConfig } from 'vite';
import twill from '@swiftuijs/twill/vite';
export default defineConfig({ plugins: [twill()] });
```

For other bundlers use the matching published entry: `@swiftuijs/twill/rollup`, `/webpack`, `/rspack` or `/esbuild`. The checkout tests Vite 8, Rollup 4, Webpack 5, Rspack 2 and esbuild 0.28. Vite/esbuild own native TS/JSX emission; the other adapters emit local native TS/TSX/JSX by default. Set `nativeSources: false` when another plugin/loader already owns it. Keep aliases, dependency handling and framework HMR in the host. Use the host's watch API; esbuild uses `context().watch()` or `.rebuild()`, with `.dispose()` on exit.

**Watch/rebuild in 0.2.0:** Configuration refresh, inherited JSX invalidation and optional config creation/deletion are supported through the tested host adapters. Keep compiler/tooling at 0.2.0 or newer. Incremental output does not guarantee framework state preservation or type checking. For Rollup editors using repeated atomic saves on Linux, use `watch.chokidar.usePolling: true` if the native watcher misses replacements. See the [development matrix](https://twill.evecalm.com/build-tools#adapter-support).

For React with Vite 8 and React plugin 6, use `@swiftuijs/twill/vite-react`: `plugins: twillReact()`. It composes React Fast Refresh. Keep native hook rules and framework runtime dependencies. `.twillx` component closures emit JSX children; a single child is direct, general collection can allocate arrays. Own-scope `return` is forbidden in children collection; parameterized closures are render callbacks.

```twillx
import { useState } from 'react';
function Panel(props: { children?: import('react').ReactNode }) {
  return <section>{props.children}</section>;
}
export default function App() {
  const [count, setCount] = useState(0);
  return Panel {
    <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
  };
}
```

For Vue JSX use the normal Twill adapter and `jsxImportSource: "vue"`. Component closures become lazy slots. Vue SFCs and framework SSR/HMR need their standard host integrations. Import component libraries normally; [SwiftUI.js](https://swiftuijs.evecalm.com/) is a sibling React library with its own setup, not a compiler dependency. See [frameworks](https://twill.evecalm.com/frameworks) and [build tools](https://twill.evecalm.com/build-tools).

Install `@swiftuijs/twill-formatter` with Prettier and configure its plugin. Install `@swiftuijs/twill-linter` with ESLint and use `recommended` or `recommendedTypeChecked` as appropriate; keep application globals and other config. Do not format dialect source as raw TypeScript. Native `tsc` cannot parse Twill: use the virtual checker, generated declarations for consumers, or checked native source export. See [tooling](https://twill.evecalm.com/tooling) and [libraries](https://twill.evecalm.com/libraries).

## Validate and debug the result

Run from the application root, adapting paths and package manager to the project:

```sh
pnpm exec twill check -p tsconfig.json
pnpm exec prettier --check src
pnpm exec eslint src
# Also run the application's relevant tests and production build.
```

Use the local package binaries and install missing tools before invoking them. A successful build does not replace type checking. Test nullish/falsy inputs, errors, cleanup order, async rejection and native boundary behavior relevant to the change. Measure performance-sensitive code against equivalent handwritten JS and include the generated output's allocations/scheduling in the comparison.

For supported Node ESM execution use `node --enable-source-maps --import @swiftuijs/twill/register src/main.twill`. The loader handles local mixed imports, not dependencies or arbitrary CommonJS transforms. Published 0.3.0 still uses asynchronous loader registration and can emit DEP0205 on Node 26. The synchronous registration migration is unreleased; do not promise its warning removal or Worker preload behavior for npm 0.3.0. CLI-created Workers that import Twill need a native bootstrap and explicit `execArgv: ['--enable-source-maps', '--import', '@swiftuijs/twill/register']` with the compiler installed locally. Actual `node --import` startup flags follow Node's normal Worker inheritance. For problems, inspect `twill doctor -p tsconfig.json --json`, original-source diagnostics and generated TS/TSX. The VS Code extension provides mapped completion/navigation/formatting and explicit debugging. The [playground](https://twill.evecalm.com/playground) lowers syntax locally but does not execute or check project types.

## Scripts and subprocess ownership (0.3.0)

Choose the installation scope explicitly. In a script project, install `@swiftuijs/twill` as a dev dependency (`npm install --save-dev @swiftuijs/twill@0.3.0` or `pnpm add -D @swiftuijs/twill@0.3.0`) and run `npm exec -- twill script.twill [args...]` or `pnpm exec twill script.twill [args...]`. Package scripts use bare `twill` and supply local PATH. For direct terminal/shebang usage, `npm install --global @swiftuijs/twill@0.3.0` must put the command on PATH; SDK/application imports still require dependencies in the script's own project. The SDK does not supply the CLI; editor/skill installation does not install either package. Native JS/TS needs only the SDK. A new script typecheck also needs `@types/node` and a tsconfig including Node types and the script files; link users to the [complete setup guide](https://twill.evecalm.com/scripting#what-to-install).

Use `twill script.twill [args...]`, `twill run script.twill [args...]` or POSIX `#!/usr/bin/env twill` with executable permission and the binary on PATH. `npm exec --call './script.twill'` or `pnpm exec ./script.twill` supplies the local binary; Windows uses explicit CLI forms. Arguments after the file remain literal; `run -- <file>` accepts dash-prefixed paths. Dependencies resolve from the script's location. The runner preserves cwd/environment/I/O, argv, exit status/signals and source maps in the same Node process; it neither installs packages nor checks types. Put executable code in a dedicated entry: dynamically imported entries do not satisfy `import.meta.main` / `require.main === module`.

Successful source compilations are cached across fresh launches after validating source/configuration and compiler/dependency contents. `TWILL_CACHE=0` disables caching; `TWILL_CACHE_DIR` selects an absolute private directory (default `~/.twill/script-cache-v1`). Entries contain original source maps: disable caching for sensitive source and trust custom directories. Completed slots are bounded to 64 MiB; corrupt/oversized/colliding entries or unavailable paths compile normally. Windows privacy relies on inherited profile ACLs. Advanced Node registration stays uncached by default; exported JS avoids compiler startup.

Install `@swiftuijs/twill-shell` as a production dependency and import `Command`, `Subprocess`, `Input`, `Output`, `Environment` and errors from it. Commands execute literal argv without shell interpretation or command compilation. Bounded capture and lifecycle coordination have measurable overhead; use inherited/discarded output when returned data is unnecessary, and native Node APIs when their contracts fit. Do not claim SDK/native performance parity; see the [recorded costs](https://twill.evecalm.com/performance#node-shell-sdk). Native JS/TS needs no Twill compiler. Published 0.2.0 still installs the retired `@swiftuijs/twill-shell-native` Rust implementation; its prebuilds and native cleanup guarantees are historical released behavior. Version 0.3.0 replaces it with Node spawn/streams and zero production dependencies. Do not recommend installing the native package directly.

Use `Command.path` for trusted absolute executables or `Command.name` for native PATH search. Executable-specific option parsing still applies; use the tool's `--` separator for user filenames. Stdin defaults to EOF and output/error inherit; text/byte captures require explicit byte bounds. Byte input is copied and cwd/environment snapshotted at submission. Environment replacement preserves Node's required Windows defaults and coverage propagation; explicit empty values override defaults. Parent globals never change. Nonzero exits reject unless `check: false`; launch, I/O, cancellation, timeout and overflow still reject. Use exported error classes, inspect `cleanupErrors`/`unresolvedProcessIdentifier`, and do not automatically log captured secrets.

The 0.3.0 SDK preserves normal awaited direct-child ownership and abort/timeout cleanup. Cancel shared work, await `Promise.allSettled(tasks)`, then shut down a worker; prefer `process.exitCode` after awaited work. Forced `Worker.terminate()` and `process.exit()` cannot perform an asynchronous join. The 0.2.0 native cleanup barrier is removed in 0.3.0. Statuses follow Node's reports, including unnamed Unix signal limitations; the public signal union stays compatible. Unix cancellation uses SIGTERM before SIGKILL, while Windows follows Node termination behavior. OS launch and event-loop scheduling are not hard real-time deadlines. Descendants, scoped streams, pipelines and shell templates remain outside the supported contract. See [scripting](https://twill.evecalm.com/scripting) and [performance](https://twill.evecalm.com/performance); historical Rust speedups are not replacement measurements.

Keep warmed subprocess/concurrency measurements separate from fresh interpreter imports, validated script-cache hits and uncached source startup. Faster coordination does not accelerate the child program or remove compiler startup. Report what changed, validation results, and any relevant unsupported integration or measured cost. Do not present an unrun check as passed or an unreleased feature as available to ordinary npm consumers.
