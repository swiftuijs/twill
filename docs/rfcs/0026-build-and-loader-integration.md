# RFC 0026: Build adapters and Node ESM loader

**Status:** Implemented (retrospective specification).
**Kind:** Tooling. **Release:** 0.1.2. **Dependencies:** Language lowering, 0025 for checking.

## Problem and native baseline

A language extension must join existing bundlers and Node module graphs without forcing an application rewrite. The baseline is a custom transform plugin plus standard TS/JS/JSX lowering.

## Design

Public adapters support Vite, esbuild, Rollup, Webpack and Rspack. Only opted-in dialect files use extension syntax. Build transforms produce ordinary JavaScript and original-source maps; they do not replace a separate twill check. Native framework transformations remain the host's responsibility. The optional Vite React adapter supplies Fast Refresh.

The opt-in Node ESM loader supports mixed local ESM native JS/TS/TSX/JSX and Twill graphs. Native/CJS/dependency loading is delegated appropriately; a CommonJS Twill loader is not supplied. Local TS emission targets ES2022, including enum and disposal lowering. Imports/resolution use host rules; unsupported extensionless aliases need explicit dialect extensions.

## Lowering and interoperability

Host adapters pass module/runtime options into the same compiler and TS lowering. Automatic JSX uses the project's runtime selection. No component registry or application language runtime is injected. Node emission has normal TS/JSX costs; module specifiers and maps must preserve host resolution/debugging.

## Compatibility and alternatives

Precompile to native sources or use RFC 0028's export when a host lacks an adapter. Vue SFC and arbitrary SSR-framework integration are outside the compiler contract. Standard native files must retain their parser meaning.

## Development-mode amendment (unreleased)

The adapters already exist in 0.1.2. This amendment specifies configuration freshness and real-host development validation; it does not add another language feature or claim the fixes are published.

Rollup watch, Webpack/Rspack watch and esbuild contexts must rebuild changed dialect and native dependencies, report a failed compilation, and recover after correction without recreating the plugin. Each build reads the current project configuration once, before module transforms. Explicit adapter options retain precedence. Configuration dependencies include inherited tsconfigs and optional project configs; creating, editing or deleting them must invalidate affected transforms. Track dependencies before compilation so failed source edits can recover.

Vite development retains its server watcher and full reload for language/JSX configuration changes. The React adapter separately verifies Fast Refresh with retained hook state. Incremental output from other adapters does not imply React/Vue state preservation or replace their framework HMR integrations. Source maps must continue to name the original mixed-project sources after rebuilds.

Configuration refresh belongs to a build boundary, not each module or generated application code. The change adds no emitted helper, closure, copy or scheduling. Native compilation, dependency caches, filesystem watching and framework reload policies remain owned by the host. Real watch tests must close all watchers/compilers, including on failure. Rollup's Linux native watcher can lose repeated atomic replacements even with a plain native transform; validate ordinary default-watcher saves and atomic saves with host-configured polling rather than imposing polling on every user.

## Synchronous registration amendment (unreleased)

Use `module.registerHooks()` when that API exists (introduced in Node 22.15 and 23.5). Retain `module.register()` only on supported engines without synchronous hooks, including Node 20 and early Node 22. The latter API is deprecated in Node 26; modern execution must pass with `--throw-deprecation`. This amendment is not published in 0.3.0.

Share source selection, Node-first resolution fallback, compilation, configuration observations, inline original maps and persistent cache policy. The synchronous adapter returns plain objects, not promises. Load the compiler lazily with synchronous require(ESM) only on a miss; every engine providing synchronous hooks supports require(ESM). Advanced public registration stays uncached. Keep native JS/CJS, dependencies and non-file delegation; do not advertise a new CommonJS Twill transpiler.

The CLI remains in the current Node process with unchanged script argv, cwd, environment, I/O and exits. Modern hooks are realm-local. Add a small private `--import` preload to `process.execArgv` for default Worker inheritance, carrying only explicit entry/cache options and enabling source maps. This extra internal argument is observable. Nested Workers inherit it through Node. An explicit Worker `execArgv` overrides the default and must include the public preload when Twill imports are needed. Do not patch Worker constructors or install a process supervisor. The advanced `node --import @swiftuijs/twill/register` entry inherits its existing preload normally.

Validate the minimum old API boundary, the first synchronous API version and Node 26 using actual processes, including cache-hit lazy loading, native CJS delegation, default/nested/explicit Worker bootstraps and errors. Reuse the exact artifact validated by normal CI; this needs focused Linux Node-version probes, not an additional OS/CPU matrix. Compare actual old/new builds using alternating fresh-process samples for uncached, empty-cache and cache-hit startup. Retain all samples and artifact identities; no universal speedup or native startup parity follows.

## Validation and completion

[Real build tests](../../packages/twill/tests/build.test.ts), [interop](../../packages/twill/tests/interop.test.ts), [runtime hooks](../../packages/twill/tests/runtime-hooks.test.ts), independent Node consumers and React/Vue examples exercise actual hosts. Verify sourcemaps, JSX runtime settings, errors, disposal, dependency delegation and Fast Refresh behavior.

## Decision history

Retrospective supported-host contract; new hosts require actual integration evidence.
