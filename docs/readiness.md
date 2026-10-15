---
title: 'Twill compatibility and limitations'
description: 'Review supported TypeScript syntax, Node and editor requirements, integration coverage and known Twill language and tooling limitations before adoption.'
---

# Compatibility and limitations

Twill 0.3 is an experimental TypeScript extension language with a tested development workflow. It is ready for a scoped evaluation of the documented compiler, editor and build integrations. A broad production-ready claim would go beyond the current evidence.

Twill 0.3.0 fixes same-name native type/value declarations (for example, `type Command = { ... }; const Command = { ... };`) and interface/value pairs. The parser keeps their namespaces separate while TypeScript checks merging and duplicate types. Older 0.2.0 consumers must upgrade to use this repair.

## Adoption status

| Area                     | Current evidence                                                                                                            | Remaining gate                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| End-to-end workflow      | Executable compiler checks, mixed TS/JS, real packaged VS Code hosts, formatter/linter and independently installed packages | Validate your application syntax, libraries and failure paths                       |
| Runtime and bundle costs | Native/dialect behavior comparisons, deterministic output budgets and reproducible synthetic benchmarks                     | Dependency-heavy applications, renderer workloads and target engines                |
| Distribution             | Versioned npm package metadata, independently tested tarballs, VSIX artifacts and checksum validation                       | Application validation and a production support track record                        |
| Adoption                 | One-file opt-in, native declarations and checked source export                                                              | Real team pilots demonstrating maintained editor responsiveness and review benefits |

Tests make supported behavior reviewable; they do not establish a production track record. Before a production commitment, choose a reviewed version, verify the host workflow, measure your project and agree how updates and regressions will be handled. See [why Twill](why-twill.md) for benefits and tradeoffs and [gradual adoption](adoption.md) for a pilot path.

## Language and ecosystem

Trailing callbacks, destructured `guard`, `defer` and value/pattern switch expressions work in ordinary code. `.twillx` also supports native JSX component children, render props and lazy Vue slots. Component libraries use their normal framework APIs; the compiler does not require component registration or wrappers.

Twill 0.2.0 implements associated-value enums as native tagged records and precise factories. See [its syntax and boundaries](syntax.md#associated-value-enums). Enum declaration/case/payload rename is withheld. RFC 0016 accepts [match expressions](syntax.md#match-expressions) with type-only descriptors and native named bindings. Available in 0.2.0. Match and switch expressions do not fall through; native switch statements retain JS fallthrough. Descriptor case-method rename is withheld, while native owner/alias and local binding edits work. Contextual case shorthand and broader matching remain deferred.

Native TS/JS and Twill can import each other through the build adapters, virtual project checker and Node ESM loader. Source maps support original-source diagnostics and debugging. Libraries can emit standard declarations with `twill declarations`; native `tsc` cannot parse Twill source directly.

The [syntax reference](syntax.md) defines supported syntax and ambiguity rules. Twill extends TypeScript/TSX and uses TypeScript's type system, but the current release is not a complete TypeScript superset: parser coverage is not identical to every TypeScript release, and trailing closures can change how a call followed by a block is parsed. Unsupported constructs report diagnostics. A CommonJS Twill loader, Vue SFC compilation and arbitrary SSR framework integration are outside the supported host workflows.

## Editor assistance

The VS Code extension supplies diagnostics, completion, hover, signatures, definitions, references, automatic imports, cross-file rename, import organization, formatting and safe quick fixes. Its TS-server bridge supports native TS/JS consumers of Twill files and synchronizes unsaved dialect documents.

React props and callback parameters use project types. Vue slot inference has the limits of Vue's JSX declarations and can require annotations. Incomplete source receives assistance where it can be repaired safely; arbitrarily malformed input can suspend semantic suggestions. Edits that cannot map exactly to original source tokens are withheld. General refactoring and fix-all are unavailable.

The virtual checker uses TypeScript 5.9. Compatibility with arbitrary workspace TypeScript versions is not guaranteed.

## Runtime and tooling performance

The [RFC 0018 branch binding](syntax.md#branch-nullish-bindings) evaluates once, destructures only on success and keeps bindings local to that branch. Grouped trailing calls follow Swift's condition boundary. Native lowering adds no closure, wrapper or runtime dependency; declarations, export and mapped tools use normal TS narrowing. Available in 0.2.0.

Ordinary trailing closures and guards lower to arrows and branches without a runtime library. Direct-return switch expressions lower to scoped native switches. Twill 0.2.0 also lowers standalone identifier initializers to native branches without an IIFE; other expression positions retain a synchronous IIFE. Await/yield inside a switch requires a direct return. Expression exhaustiveness requires the checker, not transpile-only builds. Eligible direct synchronous `defer` uses native `try/finally` in 0.3.0; dynamic/async or scope-sensitive cleanup and general child collection retain closures or arrays. Use native `try/finally` when those allocations matter in a hot path.

The checker caches unchanged snapshots and transforms. Disk edits refresh affected files; configuration changes rebuild affected projects. [Performance measurements](performance.md) describe synthetic compiler, checker and formatter workloads, including their limits. They do not establish whole-application latency or a universal performance guarantee.

A [pinned React core source study](react-source.md) additionally exercises real framework modules, dev/prod contracts and ReactDOM compatibility. It does not cover a complete framework rewrite, upstream test suite or typed team pilot.

Representative native/dialect application bundles are checked for behavior parity and documented byte budgets. Release tarballs and the VSIX have enforced compressed size budgets. Each VSIX includes one pinned engine shared on disk by both editor hosts and is verified after extraction, without workspace symlinks.

## Adoption and source export

Use one module at a time with the existing project. The optional export package exports a checked single-project source graph to formatted native TS/TSX in a new directory, rewriting relative dialect imports in both native and dialect files. Source errors, collisions and unsupported paths stop the export; originals remain intact.

This is source export rather than a complete application installer. Dependencies, host build configuration, public assets, project references and computed dynamic module paths have separate boundaries. See [gradual adoption and source export](adoption.md) for the exact workflow. Real project pilots are needed to establish team productivity and dependency-heavy project performance.

## Tested tool versions

| Tool                         | Tested contract                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Compiler consumers           | Node 20.19+ or 22.12+                                                                                          |
| Checker and editor semantics | TypeScript 5.9                                                                                                 |
| Build adapters               | Vite 8, Rollup 4, Webpack 5, Rspack 2 and esbuild 0.28; [development matrix](./build-tools.md#adapter-support) |
| React development adapter    | Vite 8, React plugin 6, automatic JSX runtime; React 18/19 peers                                               |
| Formatter                    | Prettier 3.9                                                                                                   |
| Linter                       | ESLint 9/10 flat configuration                                                                                 |
| VS Code                      | Minimum 1.95.3 and current stable                                                                              |

Validation covers execution, type checking, source mappings, actual bundler builds, independently installed tarballs and real VS Code extension hosts. CI enforces statement, branch, function and line coverage gates, including 100% line/function coverage for the compiler and parser. Highlighting checks use real TS/TSX grammars, and the packaged editor is tested for completion, navigation, source-safe edits and debugging. Coverage does not prove correctness for every input. Every change is validated on Linux, including packaged editor and browser tests. Shell/runner and shared dependency/build changes also validate real Windows/macOS contracts and independent minimum-Node package consumers. Types and coverage run once on Linux; Node supplies the CPU/libc implementation without a native prebuild matrix. Broader Node 24 compatibility checks are available through a manual validation workflow; the minimum supported VS Code host is also checked for releases. The grammar corpus exercises TypeScript constructs with closures, while seeded differential tests compare combined callbacks, guards and cleanup against handwritten JavaScript. These checks cover the documented workflows; they do not prove every application or language construct works.

## Distribution

Install compiler and optional tooling packages by name using your normal package manager; keep Twill packages on the same version and commit your lockfile. See [getting started](getting-started.md) and the [editor setup](tooling.md#set-up-vs-code).

The 0.x release line is experimental. Language semantics and integration contracts may change between minor versions; patch versions are intended for compatible fixes. Read the [changelog](https://github.com/swiftuijs/twill/blob/main/CHANGELOG.md) and rerun your checks before upgrading. There is no LTS or commercial support commitment.

Report reproducible compiler or tooling problems through [GitHub Issues](https://github.com/swiftuijs/twill/issues). Include the package versions, host versions, relevant configuration and a minimal source example. `twill doctor --json` can help identify the project configuration; review its filenames and diagnostic text before sharing.

Install the editor extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=forth-ink.twill). See [GitHub Releases](https://github.com/swiftuijs/twill/releases) for version announcements and offline VSIX downloads.

The [optional runtime](./runtime.md) in 0.2.0 shares dynamic synchronous cleanup through a versioned, zero-dependency package. Inline remains the default; async/single cleanup and native syntax fast paths retain their existing output. External mode uses module imports and needs a production dependency in applications/libraries.

The [shell SDK](scripting.md) uses Node spawn/streams independently of the compiler, with explicit argv, bounded collection, stdin, child-local cwd/environment and owned abort/timeout teardown. Scoped streaming, pipelines and shell templates remain deferred; 0.2.0 supplies the SDK and a separate compiler script runner.

Twill 0.3.0 replaces the retired Rust addon with dependency-free Node spawn/streams. Older npm 0.2.0 retains its native package. The replacement preserves awaited cancellation/timeout teardown, but requires cooperative worker shutdown and awaiting work before process exit; it follows Node's signal-reporting limits. See [scripting](scripting.md#execution-and-version-boundary).
