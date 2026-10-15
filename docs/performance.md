---
title: 'Twill performance: runtime, compilation and startup'
description: 'Understand generated JavaScript costs, compiler and editor work, script startup, optional shell SDK overhead and how to benchmark your own Twill application.'
---

# Performance

Twill compiles to ordinary JavaScript. Its performance depends on the emitted code, compilation workflow and optional libraries you use. This guide explains where costs arise and how to evaluate them in your application.

The behavior described here applies to the 0.3.1 toolchain. Measurements below retain their original version and environment; they are examples of particular workloads, not new measurements of every 0.3.1 application.

| What you use                              | Where costs arise                                                                         | What to inspect                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Trailing closures and guards              | Native arrows, branches and destructuring                                                 | Generated JavaScript and your application's hot paths      |
| `defer`, switch and component expressions | The selected lowering can add callbacks, stacks, arrays or an expression wrapper          | Allocation, output size and equivalent native control flow |
| Compiler and editor                       | Transformation, TypeScript checking, configuration and source mapping                     | Full builds and feedback after real edits                  |
| Direct script execution                   | Node startup, loading and source compilation; validated hits skip compiler initialization | First launch, cache misses and cache hits separately       |
| Optional shell SDK                        | Child-process coordination, bounded capture, decoding and teardown                        | Equivalent subprocess work with the same I/O policy        |

<a id="runtime-behavior"></a>
<a id="cleanup-cost"></a>
<a id="guards-and-switch-expressions"></a>
<a id="optional-branch-bindings"></a>
<a id="explicit-enum-patterns"></a>
<a id="optional-runtime-helpers"></a>

## Generated JavaScript and runtime cost

### Native paths stay native

Ordinary trailing closures become arrow functions. Guards become native branches; nullish bindings use strict null/undefined checks and native destructuring. These constructs introduce no language runtime library. Checked types are erased before execution.

Single-expression component children become direct JSX values. Parameterized render props remain callbacks. Framework rendering, scheduling and state management retain the costs of React, Vue or the framework you choose.

### Some forms do additional work

Eligible direct synchronous `defer` registrations lower to native nested `try/finally`, without cleanup callbacks or a registration stack. Scope, hoisting and disposal boundaries can require the conservative path. Dynamic registrations retain callbacks and reverse-order draining; async cleanup also awaits work. A specialized native loop can be much cheaper than registering a cleanup for each iteration, so measure allocation-sensitive loops in your actual application.

Direct-return switch expressions use native switch statements. Standalone identifier initializers use a result temporary and labelled branches. Other expression positions may need a synchronous lexical arrow IIFE. General component-child collection uses a local array and ordered pushes. Enum patterns add the checks and bindings their emitted code requires.

The optional `@swiftuijs/twill-runtime` package shares selected dynamic synchronous cleanup helpers when you explicitly choose external emission. Inline output is the default. Sharing can reduce uncompressed duplication across many modules while leaving gzip nearly unchanged, and a single module can grow. It does not remove cleanup registration costs. See [runtime helpers](./runtime.md) and inspect production bundles.

<a id="application-output-and-distribution-budgets"></a>

### Tool downloads and application bundles are different

The compiler, formatter, linter and editor are development tools. Their installed sizes are not application runtime overhead. Your application includes its emitted JavaScript, existing libraries and any runtime or shell package it explicitly imports. CI checks representative emitted-output and distribution budgets separately; those budgets are not a size guarantee for arbitrary applications.

<a id="compiler-measurements"></a>
<a id="mixed-projects-and-editing"></a>
<a id="refinements-in-0-3-0"></a>

## Compilation and editor feedback

Source transformation, TypeScript emission, project checking and bundler optimization are separate stages. A syntax-transform timing excludes process startup, filesystem discovery, dependency-heavy type checking and production bundling. Measure the complete command you intend to use.

The compiler reuses validated project configuration, and the editor reuses unchanged snapshots and transforms. Edits still require synchronization and checking of affected code. Fast repeated diagnostics for an unchanged file do not describe typing latency after an edit or VS Code UI responsiveness.

For scale, an older Linux/Node 24.19 synthetic mixed project with 1,002 source files measured about 1,020 ms for a cold check and 71/101 ms for edited-hover p50/p95. These observations exclude VS Code rendering and the native TS-server bridge; they are not a responsiveness target. The [mixed-project measurement](./benchmark-history.md#mixed-projects-and-editing) records the fixture, scope and memory observations. Profile your project's dependencies and editing patterns before drawing a conclusion.

<a id="synchronous-loader-registration-in-0-3-1"></a>

## Script startup and compilation caching

Running `.twill` source starts Node and loads the execution adapter. A compilation miss also initializes the compiler and transforms the source. Successful compilations can be cached across launches after validating source contents, project configuration and compiler/dependency identities. A valid hit skips compiler initialization, but it still starts Node, validates the cache and executes the script and its imports.

Measure these paths separately:

- First execution with an empty cache.
- Repeated execution with valid cached modules.
- Execution after editing an imported module or configuration.
- Prebuilt or exported JavaScript running directly in Node.

Earlier Linux/Node 24 source-cache measurements reported roughly 514 ms uncached, 544 ms with an empty cache, 157 ms with valid hits and 44 ms for the native reference. They illustrate why a cache hit and a cold start are different workloads; they are not current-version startup promises. [Original cache measurements](./benchmark-history.md#earlier-node-shell-sdk-measurements) retain all samples and identities.

The current runner uses synchronous Node hooks where available and retains the compatibility adapter on supported older engines. This avoids Twill's DEP0205 warning on Node 26. The [0.3.1 loader comparison](./benchmark-history.md#synchronous-loader-registration-in-0-3-1) measures this adapter change separately; warning removal does not establish a universal startup speedup.

Exported or prebuilt JavaScript avoids source compilation at launch. See [shell scripting](./scripting.md#repeated-script-startup) for cache configuration and privacy boundaries, and [adoption](./adoption.md) for native export.

<a id="node-shell-sdk"></a>
<a id="node-shell-sdk-in-0-3-0"></a>

## Optional Node shell SDK

`@swiftuijs/twill-shell` is an optional subprocess library, independent of the language runtime. It uses Node spawn/streams with zero production dependencies. Running an external program does not make that program's own work faster.

Literal argv, bounded capture, input/output coordination and awaited cancellation/timeout teardown have costs. Inherited or discarded output avoids retaining returned capture data. Byte limits bound captured streams, not total process heap or RSS. Compare the SDK with handwritten Node that provides equivalent behavior and uses the same I/O policy.

The retained 0.3.0 Linux/Node 24 comparison found the following paired median wall ratios against equivalent handwritten Node:

| Workload                     | SDK / handwritten Node |
| ---------------------------- | ---------------------: |
| Native dual 1 MiB capture    |                 1.171× |
| Native full-duplex 1 MiB     |                 1.113× |
| 32 concurrent Node children  |                 1.000× |
| 128 concurrent Node children |                 1.009× |

The first two workloads exceed the historical 1.10 target. Their measured costs were explicitly accepted for the Node replacement; the failed strict report remains intact. These are host-specific workload results, not native parity or a general application slowdown estimate. [The complete measurement and acceptance](./benchmark-history.md#node-shell-sdk-in-0-3-0) retain confidence intervals, every workload, memory and cold-start observations, source/build identities and the explicit release decision.

The current SDK does not use the retired Rust addon. Its historical speedups and abrupt-disposal guarantees do not apply. Applications cancel and await outstanding operations before worker/process shutdown; forced termination cannot complete asynchronous cleanup. See [execution and version boundaries](./scripting.md#execution-and-version-boundary).

## Evaluate your application

Start with one representative module or script and an equivalent native baseline. Keep dependencies, Node version, hardware, production settings and I/O policies the same.

1. Verify behavior, error paths and cleanup before comparing timings.
2. Inspect emitted JavaScript and production bundle sizes for added work.
3. Measure full builds and feedback after real edits, separately from unchanged-cache requests.
4. Measure cold execution and warm paths independently. Include allocations and memory when they matter.
5. Retain all samples and record the environment, source revision and build identity. Treat noisy results as uncertain rather than selecting a favorable run.

<a id="react-framework-source-study"></a>
<a id="earlier-node-shell-sdk-measurements"></a>
<a id="rust-subprocess-experiment-historical"></a>
<a id="rust-shell-backend"></a>
<a id="rust-shell-backend-historical-0-2-0"></a>
<a id="expanded-platform-coverage"></a>
<a id="_0-2-0-public-sdk-measurements"></a>

## Measurement methodology and history

The [benchmark archive](./benchmark-history.md) preserves the original compiler, cleanup, branching, enum, project/editor, React source, optional-helper and shell reports, including failed reviews and retired implementations. Use it to inspect methods and reproduce a specific result. Different fixtures, versions and environments are not one comparable performance series.

Correctness and generated-output budgets are enforced separately from timing observations. Controlled-host timing targets are not portable guarantees across CI runners. Reproduction instructions are in the archive and the [contributor guide](https://github.com/swiftuijs/twill/blob/main/docs/contributing/tooling.md#benchmark-changes).
