---
title: 'Optional Twill runtime helpers'
description: 'Learn when to use the dependency-free Twill cleanup helpers, how external emission differs from inline output and how to configure runtime dependencies.'
---

# Optional runtime helpers

**Available in Twill 0.2.0.** Inline emission remains the default; no runtime package is required by ordinary compiled programs.

The optional `@swiftuijs/twill-runtime` package shares dynamic synchronous cleanup algorithms across modules. It contains no compiler, TypeScript engine, framework, Node-only API or global registry. Native guards, arrows, enum factories/matching and component output retain their existing lowering.

## Choose an emission mode

With the compiler installed as described in [getting started](./getting-started.md#install), install the matching runtime as a production dependency in the same project:

```sh
pnpm add @swiftuijs/twill-runtime@0.3.1
# npm install @swiftuijs/twill-runtime@0.3.1
```

`twill.config.json`:

```json
{
  "runtime": "external"
}
```

`inline` generates self-contained code. `external` imports the versioned helper only in modules containing dynamic synchronous `defer` scopes. It shares stack draining and exception handling; callbacks, lazy arrays and native `try/finally` remain at the original scope. This keeps return, throw, loop exits, live captures and generator close behavior.

Single direct cleanup retains its existing fast path. Explicit async and mixed cleanup stays inline in both modes, preserving await order and microtask scheduling. External mode can therefore produce no runtime import for an entire project.

**Changed in 0.3.0:** eligible direct synchronous registrations, including multiple registrations, lower to native nested `try/finally` with no callbacks, stack or helper import. Observable scope/disposal boundaries and dynamic/async cleanup retain their existing paths. The helper example below describes dynamic registration; inspect the installed compiler's generated code. See [performance](./performance).

The project setting is shared by builds, `twill check`, declarations, source export, Node loader and editor projects. Build adapters accept `twill({ runtime: 'external' })`; the React adapter accepts `{ twill: { runtime: 'external' } }`. Prefer the project file when editor and build output must agree. `twill compile --runtime inline|external` overrides it for one emission.

External emission uses static ESM imports and ordinary package resolution. Non-module TypeScript source files using global declarations should use inline emission; explicit script-mode compilation diagnoses a required external import. Adding an import also makes a file a module to TypeScript, so ambient global-script projects should retain inline mode.

## Generated behavior

```twill
export function work(first: { release(): void }, second: { release(): void }) {
  defer {
    first.release();
  }
  defer {
    second.release();
  }
  return 42;
}
```

External output has this shape:

```js
import { runDefers as __twillRunDefers } from '@swiftuijs/twill-runtime/helpers/v1';
export function work(first, second) {
  let __twillDefers;
  try {
    (__twillDefers ??= []).push(() => {
      first.release();
    });
    (__twillDefers ??= []).push(() => {
      second.release();
    });
    return 42;
  } finally {
    __twillRunDefers(__twillDefers);
  }
}
```

Every reached cleanup runs in reverse order. The last cleanup failure replaces a body or earlier cleanup failure, including a thrown `undefined`. Synchronous cleanup ignores return values and never awaits a thenable. Helper names are hygienic, and one named helper import serves every qualifying scope in a module. Shebangs, file pragmas, directives, declaration documentation and source mappings are retained.

## Libraries and native export

Published libraries using external emission declare `@swiftuijs/twill-runtime` as a production dependency; installing only the compiler as a development dependency is insufficient. Choose normal bundler externals. The runtime has side-effect-free ESM exports for tree shaking and deduplication; separate package versions or split chunks can affect sharing.

Public `.d.ts` output stays native and does not expose the cleanup helper. Consumers of types alone need no runtime package. Checked source export preserves the selected mode and imports; install normal dependencies, including this runtime when needed, in the destination. Export does not copy packages or rewrite manifests. Select inline mode before export when you want self-contained native sources.

`helpers/v1` is a compiler/helper ABI, not a user-facing resource SDK. Compatible releases preserve its cleanup contract; an incompatible protocol needs another subpath. User-facing task groups and cancellation remain separate proposals.

## Costs and acceptance

Sharing removes repeated algorithms, not registration work: cleanup callbacks and arrays still allocate. A single scope can be larger after including the helper; gzip already compresses repeated inline code. Compare the [performance measurements](./performance.md) for native code with the same dynamic registrations and failure behavior. A minimal single native finally has fewer responsibilities and is not an equivalent dynamic-stack benchmark.

Representative optimized output should stay within 10% of the equivalent native median in reproducible measurements. The benchmark can enforce that review target with `--verify-performance`; keep all trials and investigate a failure. Structural CI checks enforce semantics, absence of unwanted imports/dependencies, small bundles and unchanged async output. Timing is not a universal application or engine guarantee.

See [RFC 0032](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0032-optional-runtime-helpers.md) for the full prototype contract.
