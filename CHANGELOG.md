# Changelog

## Unreleased

- Recognize unambiguous incomplete guard statements and explain missing conditions, `else` and braced failure branches at original source positions. Share the diagnostics between compilation, project checking, formatter/linter parsing and VS Code; preserve native uses of the contextual `guard` identifier.

## 0.3.0

- Provide complete project-local/global script installation, shebang, JavaScript SDK, type-check/build and troubleshooting paths.

- Emit native nested `try/finally` for eligible direct synchronous `defer` registrations, eliminating callbacks, registration arrays and helper imports. Retain existing lowering for dynamic/async cleanup and observable lexical, hoisting, disposal or strict-mode boundaries.
- Reduce temporary allocations during compiler AST traversal.
- Reuse parsed runner configuration in a bounded session cache while validating exact dependency contents and optional-file probes.
- Reuse recovered editor transforms and their original strict syntax errors instead of recompiling unchanged source for diagnostics.
- Reuse open-document text by VS Code document version while preserving immediate full-snapshot synchronization with native TS-server projects.

- Simplify Node shell CI to representative Linux/macOS/Windows contracts, with type checks and coverage once on Linux; remove the native CPU/libc matrix. Retain measured shell capture costs: about 17% median overhead for native dual 1 MiB capture and 11% for full duplex on the reviewed host, explicitly accepted for this release.

- Retire `@swiftuijs/twill-shell-native`, the Rust experiment, addon dependency and native build/assembly chain. The SDK uses Node spawn/streams with zero production dependencies, retaining commands, policies, errors, snapshots, bounded I/O and awaited cancellation/timeout teardown. Applications must cancel and await work before worker/process exit; the native abrupt-disposal barrier and unnamed numeric-signal guarantee are removed. Published 0.2.0 remains unchanged.

- Develop the formatter, linter, export, highlight, shell SDK and editor integrations in Twill through the public adapter, checker and declaration emitter. Keep ordinary JS/types for consumers, native bootstrap boundaries and existing coverage/size gates; enforce the source policy in release verification.
- Preserve TypeScript's separate type/value namespaces for same-name aliases/interfaces and runtime declarations, including checked declarations usable by native TS consumers.

## 0.2.0

- Add associated-value enums, exhaustive `match` expressions and branch-local `if const` nullish bindings, with synchronized checking, source maps, formatter, lint, highlighting, declarations/export and editor support.
- Lower standalone switch/match identifier initializers to native branches without an IIFE. Keep native JS switch statement fallthrough and existing expression-context limits.
- Add optional versioned synchronous cleanup helpers through `@swiftuijs/twill-runtime`; inline output remains the default and native fast paths remain inline.
- Refresh Vite/Rollup/Webpack/Rspack/esbuild build configuration and inherited JSX dependencies during watch/rebuild, including creation/deletion and recovery from invalid configuration.
- Add `twill script.twill`, `twill run script.twill` and POSIX `#!/usr/bin/env twill`, literal script arguments, source maps and bounded content-validated compilation caching.
- Release `@swiftuijs/twill-shell` with one Rust execution backend: literal argv, bounded I/O, isolated cwd/environment, typed errors, cancellation and direct-child ownership. Its prebuilt implementation dependency installs automatically; no Rust toolchain or compiler is required for native JS/TS consumers.
- Avoid complete Node diagnostic-report construction during ordinary Linux native startup by inspecting the running ELF interpreter with bounded reads; unknown/static layouts retain the conservative report fallback.
- Preserve successful immediate Mac exits when notification registration races with process completion, and retain numeric values for unnamed Unix termination signals.
- Include eight validated Linux glibc/musl, macOS and Windows x64/ARM64 prebuilds. Keep independent SDK/binary/archive budgets and installed Node 20.19 consumers. Unsupported platforms reject explicitly.
- Preserve measured limits: warm Linux launch/capture and default-pool concurrency improve or match equivalent handwritten Node on the reviewed host; cold startup and denied-pidfd polling have separate costs. No external-command or universal speedup is claimed.
- Publish the official portable AI skill with current syntax, script/backend ownership, integrations and release guidance; generate website downloads from the canonical source.
- Select affected PR checks conservatively and cache native build inputs. Main, scheduled, manual and release verification retain complete platform checks; release tags package the exact tested artifacts.

## 0.1.2

- Clarify Twill's TypeScript/TSX foundation, Swift-inspired syntax extensions and current parser/ambiguity compatibility boundaries.
- Refresh package and Marketplace READMEs with the TypeScript-based positioning and sibling-project homepage links.
- Load native TypeScript/TSX dependencies before Twill grammars in VitePress, restoring ordinary keyword, operator and JSX colors in documentation examples.
- Retain native logical/nullish operators and optional chains after implicit members such as `.active && .verified` and `.profile?.name ?? 'Anonymous'`.
- Preserve JSX tags and attributes in parameterless TwillX trailing closures; keep JSX text literal while retaining Twill syntax in embedded expressions. Share these fixes between the highlighting package and VS Code grammar.

## 0.1.1

- Introduce Twill's indigo hummingbird identity across the documentation site, VS Code extension and package READMEs.
- Show the logo in the documentation navigation and right-align it within README titles, with coordinated light and dark themes, favicons and Marketplace branding.

## 0.1.0

Initial experimental release of Twill, a JavaScript / TypeScript syntax-sugar language and development toolchain by [forth.ink](https://forth.ink).

### Language

- Trailing closures on ordinary callback APIs, with optional parentheses, typed/async parameters, multiple closures, nesting and single-expression returns.
- First-argument member shorthand such as `users.filter { .active }`, with contextual types and ordinary arrow output.
- Early-exit `guard` statements and nullish `guard const` bindings, including destructuring and native TypeScript narrowing.
- Block-scoped `defer`, with reverse-order cleanup on scope exit and explicit awaited cleanup in async functions.
- Value-producing switch expressions and discriminated-union cases, with exhaustiveness checked by `twill check`.
- `.twill` for TypeScript / JavaScript syntax and `.twillx` for TSX. Component closures use native React children or lazy Vue slots without registration or wrappers.
- Two-way imports with native TS/JS files and optional language configuration through `twill.config.json`.

### Development tools

- Compiler and CLI: `twill compile`, `check`, `doctor`, `declarations` and optional `export`.
- Vite, Rollup, esbuild, webpack and Rspack adapters; a React Vite adapter with Fast Refresh; an opt-in Node ESM loader and source maps.
- VS Code extension with highlighting, TypeScript assistance, original-source diagnostics/navigation, mixed-file rename, safe quick fixes, formatting and Node debugging.
- Independent Prettier and ESLint packages, including optional type-aware linting and source-mapped fixes.
- Optional checked source export to native TS/TSX, and browser/SSR Shiki highlighting with portable TextMate grammars.
- English documentation, a local live compiler playground, ordinary-code and framework examples, and a pinned React client-core source study.

### Compatibility

Compiler consumers require Node 20.19+ or 22.12+. The checker/editor use TypeScript 5.9; the VS Code extension requires 1.95.3 or newer. See the [support matrix](https://twill.evecalm.com/readiness) for integration versions and boundaries. The 0.x language remains experimental; minor releases may change semantics or integration contracts.
