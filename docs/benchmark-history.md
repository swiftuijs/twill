---
title: 'Twill benchmark methodology and history'
description: 'Inspect version-specific Twill benchmark results, environments, sampling methods, failed reviews and reproduction commands, including retired shell implementations.'
---

# Benchmark methodology and history

This archive preserves the original version-specific measurements, failed reviews, sampling methods and reproduction commands. Start with the [current performance guide](./performance.md) to evaluate Twill today. Historical absolute timings are not directly comparable across reports, and retired Rust results do not describe the current Node SDK.

## Runtime behavior

Twill is a build-time syntax layer. Ordinary trailing closures become native arrow functions and guards become native branches. Those constructs introduce no runtime library. The benchmark checks that representative callback output matches equivalent handwritten JavaScript, and React/Vue component output matches equivalent native JSX after emission.

Single-expression component children are direct JSX values. General child collection uses a local array and ordered pushes; parameterized render props remain lazy callbacks. These have the costs of their emitted JavaScript and the selected framework.

In published 0.2.0, `defer` uses one callback and native `finally` for a single direct cleanup. Multiple or control-flow registrations use a lazy block-local stack with reverse-order draining. Both paths allocate cleanup closures; the dynamic path additionally allocates an array. Native `try/finally` remains useful for allocation-sensitive code. Explicit asynchronous cleanup adds the cost of awaiting cleanup.

## Refinements in 0.3.0

The current source removes repeated work in three places:

- Eligible direct synchronous `defer` registrations become native nested `try/finally`, with no callback, stack or helper import. Later lexical/type or guard bindings, function hoisting, direct eval/with, `this` or definite-assignment-sensitive declarations, native disposal boundaries and cleanup-local function/var/strict behavior conservatively retain the existing path. Dynamic/async registration also keeps its semantics and costs.
- Compiler tree walks avoid temporary property-pair arrays. Module compilation reuses parsed configuration for up to 64 source directories, still validating every dependency's contents and absent-file probes before reuse.
- Editor diagnostics reuse the recovered transform and its first strict syntax error. VS Code caches text by document version; edits still synchronize complete overlays with native TS-server projects immediately. Transporting full snapshots and checking changed dependents remain real costs.

The [refinement report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/refinement.json) compares an unchanged build at `a8db852` with the source build on the same Linux x64 / Node 24.19 shared host. It retains three alternating pairs of isolated workers, all 15 timing samples per worker, source/output digests, build identities and generated cleanup code. Compiler/tool samples include high-resolution maps; runtime samples assert observable state. Cold uncached loader runs retain nine alternating pairs of fresh processes and execute an actual 100-import graph.

| Workload                                               | Before, median | Source refinement, median | Paired after / before |
| ------------------------------------------------------ | -------------: | ------------------------: | --------------------: |
| Transform 1,000 callbacks                              |      146.33 ms |                 141.97 ms |                 0.97× |
| Repeat unchanged editor diagnostics, 500 callbacks     |       76.23 ms |                  0.055 ms |               0.0007× |
| Edit then diagnose, 500 callbacks                      |      222.20 ms |                 143.14 ms |                 0.64× |
| Compile 100 modules with shared configuration          |      191.65 ms |                 155.46 ms |                 0.82× |
| One direct cleanup, 100,000 invocations                |       0.178 ms |                  0.176 ms |                 1.02× |
| Four direct cleanups, 100,000 invocations              |        6.83 ms |                  0.326 ms |                0.048× |
| 100 dynamic captured-loop cleanups, 10,000 invocations |       21.34 ms |                  20.84 ms |                 0.97× |
| Cold uncached script with 100 imports                  |       1,180 ms |                  1,110 ms |                 0.95× |

Worker medians and paired ratios are aggregated separately; dividing the two displayed medians need not equal the median paired ratio. Small timing differences and the cold-start result vary across runs. Dynamic-loop output is byte-identical before/after: its timing difference does not demonstrate a generated-code regression or improvement. Its natural reverse-loop reference remains about 13× faster in this fixture. Eligible one/four-cleanup minified output drops from 86/283 bytes to 66/144 bytes, matching the native reference exactly.

The static cleanup outputs match natural handwritten native `try/finally` after ordinary minification. A direct registration already approaches native speed; removing its callback mainly reduces output and allocation dependence. Multiple direct registrations benefit much more. Reusing an unchanged file's diagnostics does not represent end-to-end editor typing latency; edited diagnostics are measured separately. Configuration reuse saves repeated parsing, while cold initialization still loads Node/TypeScript/loader machinery.

Dynamic captured-loop cleanup still allocates and dispatches registrations and remains substantially slower than a native reverse loop doing just the same additions. Its retained closure/stack semantics are not interchangeable with that specialized loop for arbitrary programs. This refinement does not establish native parity for every construct, cold script or editor action. Profile real workloads; prebuilt/exported JavaScript remains the shortest startup path.

To reproduce, build the unchanged revision in a separate worktree, build the current compiler, then pass the unchanged distribution directory:

```sh
node packages/twill/benchmarks/refinement.mjs \
  --baseline /absolute/path/to/baseline/packages/twill/dist \
  --output docs/benchmarks/refinement.json
```

Each worktree needs its frozen-lockfile dependencies. Keep other builds/tests idle during timing. The older reports below retain their original fixtures, environments and version boundaries; their absolute timings are not directly comparable to this run.

## Synchronous loader registration in 0.3.1

Version 0.3.0 uses asynchronous Node loader hooks. Version 0.3.1 prefers synchronous hooks when available, removing Twill's DEP0205 warning on Node 26 and the separate loader-thread handoff on that path. Older supported engines retain the compatibility adapter. Compilation, source maps and cache validation remain shared; valid hits and native delegation do not initialize the compiler. This changes interpreter startup, not generated application code or external-command execution.

The [loader startup comparison](https://github.com/swiftuijs/twill/blob/main/packages/twill/benchmarks/loader-startup.mjs) builds the unchanged main revision before timing and compares actual old/new CLI launches. Each single-module and 25-import workload retains nine alternating fresh-process pairs for uncached, empty-cache and cache-hit execution, all raw observations, CPU/RSS observations and source/build identities. The Node 26 CI probe uploads `loader-startup.json` as the `loader-startup` artifact. Shared CI hosts introduce timing noise; these observations establish no general speedup or native startup parity. RSS is observed at script completion, not measured as a peak.

Maintainers can reproduce from a built checkout with installed frozen-lockfile dependencies and the baseline commit available locally:

```sh
node packages/twill/benchmarks/loader-startup.mjs \
  5a258030ef3876bfaec3a858134e8535d019dede loader-startup.json
```

Keep other builds/tests idle while measuring. The script creates and removes its own temporary baseline worktree and compares both variants on the same Node version and CPU affinity.

## Compiler measurements

The following synthetic run was recorded on 2026-10-05, Linux x64, Node 24.19.0, an AMD EPYC 9V74 shared execution host. Each stage has five warmups and 15 timed samples. Syntax transformation preserves types; the plugin pipeline also erases types and lowers JSX. Both include high-resolution source maps with embedded source. Values are medians in milliseconds.

| Stage                      | 10 callbacks | 100 callbacks | 1,000 callbacks |
| -------------------------- | ------------ | ------------- | --------------- |
| Syntax → TypeScript        | 2.19 ms      | 15.00 ms      | 146.44 ms       |
| Syntax → implicit members  | 2.03 ms      | 15.50 ms      | 206.07 ms       |
| Syntax → JSX components    | 2.05 ms      | 10.89 ms      | 124.55 ms       |
| TypeScript plugin pipeline | 5.02 ms      | 22.05 ms      | 209.55 ms       |
| Component plugin pipeline  | 6.89 ms      | 30.51 ms      | 307.01 ms       |

Callback source sizes are 599 / 6,089 / 61,889 bytes. Implicit-member fixtures contain twice as many callbacks (20 / 200 / 2,000) and are 839 / 8,489 / 85,889 bytes. Component fixtures contain 10 / 100 / 1,000 nested views and are 679 / 6,889 / 69,889 bytes. These timings exclude process startup, filesystem discovery, project type checking, bundler optimization, rendering and editor UI. They are not whole-application build or runtime measurements. The [compiler report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/compiler.json) includes p95 values, build identity and environment metadata.

## Cleanup cost

Each cleanup workload invokes a function 10,000 times per batch. The single-direct case registers one cleanup; the dynamic loop registers 1 / 10 / 100 cleanups per invocation. Cleanup adds to observable state. The reference performs the same additions in native `finally`, using a direct statement or reverse loop without registration closures or a stack. Each implementation has a separate batch call site, result assertions, 50 warmup batches and 15 timed samples.

| Workload                | Registrations per invocation | Generated defer, median batch | Native finally, median batch | Ratio |
| ----------------------- | ---------------------------- | ----------------------------- | ---------------------------- | ----- |
| Single direct statement | 1                            | 0.010 ms                      | 0.010 ms                     | 1.0×  |
| Dynamic loop            | 1                            | 0.245 ms                      | 0.014 ms                     | 18.0× |
| Dynamic loop            | 10                           | 1.055 ms                      | 0.085 ms                     | 12.5× |
| Dynamic loop            | 100                          | 19.745 ms                     | 0.828 ms                     | 23.8× |

The single-direct output matches a minimal handwritten callback/finally implementation after ordinary host minification. V8 can optimize this small, warmed-up example; its near-equal timing does not mean every cleanup closure is free. Dynamic registration exposes allocation and dispatch overhead in a tight synchronous loop. These measurements do not establish an application slowdown ratio, real I/O cleanup latency, or results on other engines.

## Guards and switch expressions

Destructured guards add a temporary and a nullish branch, followed by native destructuring. They add no wrapper object, callback or library. Direct-return switch expressions add a scoped native switch without a function. The standalone identifier-initializer path uses a result temporary and native labelled branches without a function. Other expression positions use one synchronous lexical arrow IIFE; `this`, `arguments` and scheduling retain native semantics. Selected object cases destructure the discriminator too, so a discriminator getter is read twice. Rest/default costs remain native destructuring costs.

The [branching report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/branching.json) measures 1,000,000 calls per sample, 15 samples after warmup, with each native/dialect case in a separate process on Node 24.19 / AMD EPYC 9V74. Isolated processes avoid shared call-site feedback favoring whichever function runs first.

| Workload                      | Twill median | Native median | Minified function bytes Twill / native |
| ----------------------------- | ------------ | ------------- | -------------------------------------- |
| Destructured guard            | 2.49 ms      | 2.50 ms       | 75 / 75                                |
| Direct-return value switch    | 2.76 ms      | 2.89 ms       | 77 / 77                                |
| Switch in a local initializer | 2.75 ms      | 2.72 ms       | 95 / 90                                |

The initializer comparison uses a natural native switch assigning a local. The standalone identifier-initializer optimization removes the IIFE and preserves the original declaration, TDZ and mutability. Larger expressions, for headers, multiple declarators, destructuring, direct eval, JS JSDoc context and TS suppression pragmas retain the established expression path. Timing differences are not a general speedup claim or evidence that remaining closures never allocate. Other engines, cold execution, larger branches and captured values need application measurements. Await/yield inside a switch requires a direct return, avoiding hidden promise conversion or additional async scheduling.

The [application bundle report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/bundle-size.json) covers five supported paths. Guards, callbacks and a single React child match the native minified byte size. The direct object-pattern switch is 205 bytes versus 203 bytes: its explicit lexical block adds two braces. Tests enforce those exact output budgets and runtime parity. There is no Twill runtime imported into these application fixtures. Dynamic cleanup, general child collection and arbitrary expression switches have separate costs and are outside this parity claim.

## Optional branch bindings

RFC 0018's `if const` emits a single initializer snapshot, a strict null/undefined test and a success-local const binding. Ordinary initializers add no function, runtime import, wrapper or scheduling. Object/array defaults, getters, iterators and rest retain their native costs. A nested `match` initializer retains the existing general-expression lowering and its synchronous IIFE cost.

On 2026-10-07, Node v24.19.0 on an INTEL(R) XEON(R) PLATINUM 8573C shared Linux host, each case ran seven pairs of isolated processes with alternating launch order. Each worker performs five warmups and 15 samples of 1,000,000 calls. Inputs cycle through null, undefined and present values including zero. The reported ratio is the median of the seven paired median-time ratios:

| Workload                      | Twill / natural handwritten JS |
| ----------------------------- | ------------------------------ |
| Identifier binding            | 0.96×                          |
| Single-evaluation lookup call | 0.93×                          |
| Object destructuring          | 1.03×                          |
| Array default and rest        | 1.03×                          |

All four medians pass the controlled-host 1.10× target. Individual trial ratios vary substantially (0.44×–1.26×); these observations support comparable performance in this run, not a stable speedup or a cross-engine/application guarantee. The [complete report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/if-bindings.json) retains every timing, cold call, checksum, generated/minified source, source/build hash and implementation commit. Standalone minified functions add 11–21 bytes over these native baselines; the separately bundled object-binding application adds 10 bytes. Neither byte count is a runtime timing claim.

Reproduce after building with `pnpm benchmark:if-bindings --output ../../docs/benchmarks/if-bindings.json --verify-performance`. Run this separately from CPU-intensive validation to reduce host contention. Timing remains an acceptance measurement; CI checks semantics, output structure and byte budgets deterministically.

## Mixed projects and editing

The project benchmark uses isolated processes, one-third native TypeScript and two-thirds Twill, plus a module importing every file and a member-callback document. Cold checks include TypeScript standard libraries; warm checks, edited-hover requests and partial-member completions use 15 samples. Values below come from the [project report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/project.json) on the same host.

| Source files | Cold check | Warm check p50 / p95 | Edited hover p50 / p95 | Member completion p50 / p95 | Peak process RSS |
| ------------ | ---------- | -------------------- | ---------------------- | --------------------------- | ---------------- |
| 102          | 501 ms     | 1.2 / 1.8 ms         | 17.9 / 30.1 ms         | 0.29 / 21.3 ms              | 412 MiB          |
| 502          | 726 ms     | 6.0 / 12.5 ms        | 39.4 / 69.7 ms         | 0.27 / 23.8 ms              | 485 MiB          |
| 1002         | 1020 ms    | 10.3 / 21.2 ms       | 71.0 / 100.6 ms        | 0.38 / 29.3 ms              | 598 MiB          |

The project stays alive while a 1,000-closure file is formatted. That cold, single-sample operation took 410–434 ms. Peak RSS therefore includes both the formatter and TypeScript; it is not incremental editor overhead. Measurements exclude VS Code rendering, the native TS-server bridge, dependency-heavy applications, HMR and application runtime.

Unchanged editor snapshots, transforms and mapping decoders are cached. The native TS-server bridge applies only changed overlays, retaining unrelated snapshots and script versions. The linter uses line indexes for source mapping rather than parsing additional ASTs. Edits invalidate affected files, while configuration changes rebuild affected projects. Typed ESLint includes program construction and freshness checks; syntactic lint offers lighter feedback. No editor responsiveness SLA follows from these synthetic results.

## Application output and distribution budgets

The RFC 0018 branch binding uses a hygienic initializer snapshot and native success-scope binding. It introduces no runtime allocation, function, promise or helper import; native rest destructuring still allocates its own rest value. The checked object-binding application fixture allows at most 10 extra minified bytes for that snapshot compared with a handwritten branch over an already evaluated parameter. This budget is separate from runtime timing. `benchmark:if-bindings` records isolated native comparisons, all samples and generated/source/build checksums; `--verify-performance` checks the 1.10× controlled-host target.

Equivalent native and dialect application fixtures are built with real esbuild bundling and minification. An implicit-member filter/map pipeline emits 76 bytes in both forms; a guarded numeric pipeline emits 88 bytes in both forms; a React single-child component emits 121 bytes in both forms. The checks compare byte counts and executed behavior, and reject compiler/runtime dependencies in the application graph. Identifier mangling can choose different short names. React's normal JSX runtime is external in this comparison. These small fixtures do not cover every application, dynamic cleanup or general child collection.

The VSIX ships one pinned TypeScript engine shared on disk by its two editor hosts, standard-library declarations, the checker and the lightweight formatter. The engine still runs in each host process; sharing its distribution does not imply shared process memory. The standalone formatter loads TS/ESTree support rather than Node's automatic parser discovery.

Distributed builds enforce these compressed artifact size limits:

| Artifact                   | Maximum compressed size |
| -------------------------- | ----------------------- |
| Compiler tarball           | 650 KiB                 |
| Formatter tarball          | 24 KiB                  |
| Linter tarball             | 24 KiB                  |
| Highlight tarball          | 24 KiB                  |
| Export tarball             | 28 KiB                  |
| Optional runtime tarball   | 8 KiB                   |
| Shell SDK tarball          | 16 KiB                  |
| VSIX, including its engine | 3 MiB                   |

Tarball budgets cover the package's own files, not installed npm dependencies. Development tools remain outside application bundles. These are distribution limits, not application bundle budgets or build-time guarantees.

## React framework source study

The [React source study](./react-source.md) compares the real React 19.3.0 client-core entry graph after identical Flow erasure. It adds an independently reproducible framework workload to the small synthetic fixtures above. The [report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/react-framework.json) includes production bytes, gzip size, interleaved build samples and isolated core-runtime samples. ReactDOM/reconciler are not rewritten; this is not a full rendering-throughput or typed framework-port benchmark.

## Explicit enum patterns

RFC 0016's match expressions and explicit case descriptors are erased by native TS. Direct-return patterns and standalone identifier initializers use native switches and per-arm const destructuring without an IIFE. Other expression positions keep the existing synchronous IIFE. The preferred `match` spelling uses the same lowering; regression tests require emitted JS identical to the earlier explicit-marker spelling. Native rest bindings allocate/copy normally. The checked TS application bundle fixture with defaults/rest is 182 bytes versus 180 bytes for handwritten JS: two outer scope braces, with no matching runtime, factory access/call or additional result record. CI enforces that 2-byte budget and verifies runtime behavior and dependency absence.

On 2026-10-07, Node v24.19.0, Linux x64, INTEL(R) XEON(R) PLATINUM 8573C, three separate warmed processes per variant, pinned to CPU 0, ran 1,000,000 calls per sample, five warmups and 15 samples each. Launch order alternated, and the table aggregates all 45 measured samples. Both variants compiled the dialect once before sampling to balance compiler setup. Inputs cycle through idle and two loaded records; observable checksums agree. These are medians for one batch:

| Workload                 | Generated pattern | Native baseline | Ratio |
| ------------------------ | ----------------- | --------------- | ----- |
| direct-named-payload     | 6.40 ms           | 6.21 ms         | 1.03× |
| expression-named-payload | 6.74 ms           | 6.64 ms         | 1.02× |
| native-object-rest       | 34.62 ms          | 33.15 ms        | 1.04× |

The first prototype used an expression IIFE and measured 3.05× slower than native local assignment. That avoidable function is removed for standalone identifier initializers: the new measured path is comparable to native, rather than accepting the earlier slowdown. The checked application fixture adds 8 bytes and CI rejects an added arrow/IIFE. The direct and rest paths are also comparable in this run; none establishes a general speedup. Remaining expression-wrapper contexts need independent measurement/optimization. Rest costs reflect native allocation in both implementations; no application or cross-engine guarantee follows.

Synthetic typed files contain 10 / 100 / 1,000 functions sharing two variants. Transform timings include high-resolution maps; the native transform parses an unchanged TS file. Cold checks include creating a project and reading standard libraries; they are single observations, not sampled medians:

| Functions | Pattern → TS median | Unchanged TS transform median | Pattern cold check | Native cold check |
| --------- | ------------------- | ----------------------------- | ------------------ | ----------------- |
| 10        | 8.44 ms             | 5.55 ms                       | 1064.14 ms         | 903.29 ms         |
| 100       | 29.50 ms            | 25.95 ms                      | 678.42 ms          | 407.08 ms         |
| 1000      | 357.09 ms           | 327.84 ms                     | 2273.75 ms         | 613.77 ms         |

Unchanged pattern diagnostics have cached medians of 0.02–0.07 ms. The descriptor rename guard indexes each file once and caches symbols by Program. Its first request on the 1,000-function fixture takes 397.29 ms, including mapping/symbol work; cached requests take 0.37 ms median. Edits invalidate the Program cache. These costs concern synthetic compiler/checker requests, not visible editor latency.

The [report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/enum-patterns.json) records inputs, p95, checksums, environment, base commit/tree, dirty-working-tree status and build/script digests. The source was an unreleased implementation checkout. Reproduce with `pnpm build` then `pnpm benchmark:enum-patterns --output enum-patterns-results.json`. Runtime tests use unchecked JS lowering; erased TS descriptors and native imports are additionally covered by checked bundle and package tests. Timing ratios are observations; correctness, absence of runtime dependencies and bytes are deterministic CI gates.

## Optional runtime helpers

[RFC 0032](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0032-optional-runtime-helpers.md) adds opt-in external helpers; inline remains the default. Dynamic synchronous cleanup shares a small `runDefers` function. Single direct cleanup, explicit async and mixed cleanup retain identical output, including scheduling. The helper centralizes draining; registrations still allocate callbacks and a lazy array. It does not remove the allocation costs shown in the minimal-finally comparison above.

The [runtime report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/runtime-helpers.json) compares generated inline/external output with handwritten native code having the **same dynamic registrations and failure contract**. Each sample executes 500,000 function calls. The recorded Linux run pins every worker to CPU 0. Three separate processes per variant, alternating launch order, contribute all 45 samples after 20 warmup batches. Each sample records wall and process CPU time; the gate compares wall medians. All workers perform the same compiler setup before timing; checksums and cleanup order agree. First-call and bundle-build timings are unsampled observations, not startup guarantees.

| Registrations per call | Native median | Inline / native | External / native |
| ---------------------- | ------------- | --------------- | ----------------- |
| 0                      | 1.71 ms       | 1.07×           | 1.01×             |
| 1                      | 21.93 ms      | 0.99×           | 0.99×             |
| 5                      | 56.81 ms      | 1.04×           | 1.02×             |
| 25                     | 259.77 ms     | 1.03×           | 0.97×             |

The [first review report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/runtime-helpers-first-review.json) is retained: its 100,000-call batches, five warmups and unpinned workers failed the same 1.10× target (1.28× inline and 1.17× external at one registration). Trial medians differed substantially, including within the native baseline. The revised run increases batch size/preheating and fixes CPU affinity; it changes no generated algorithm and keeps every trial/sample. Both inline and external pass the wall-median target in the revised run. Individual trials and p95 still vary; these medians do not establish a universal speed guarantee.

Separate synthetic modules are bundled as minified ES2022 ESM, including every byte of the actual helper. Gzip uses level 9:

| Modules with dynamic cleanup | Inline bytes / gzip | External bytes / gzip |
| ---------------------------- | ------------------- | --------------------- |
| 1                            | 237 / 191           | 256 / 195             |
| 10                           | 2,289 / 257         | 1,570 / 264           |
| 100                          | 23,007 / 829        | 14,904 / 836          |

At 100 modules the external helper removes 35% of uncompressed output; gzip is approximately equal. A single module can grow. Split chunks and multiple installed versions can change sharing. CI enforces a 256-byte minified helper budget, one dependency-free helper in the application graph, no runtime import for inline output, and representative bundle/behavior budgets.

Reproduce after `pnpm build` with `pnpm benchmark:runtime --output runtime-results.json --verify-performance`. The optional flag rejects a median over 1.10× native for either mode and retains the full report before failing. The same flag is available for `benchmark:enum-patterns`. On Linux, prefix the command with `taskset -c 0` (or another allowed CPU) to reproduce the recorded affinity; the report records it. This is a performance review target on a controlled host; investigate repeatable failures rather than accepting material regressions or treating noisy CI clocks as a portable gate. These synthetic results establish comparable performance for the measured paths, not a general speedup over optimized native code.

## Evaluate your application

Measure build time, edited-file feedback and representative runtime paths before and after adopting a module. Use the same dependencies, hardware and production build settings. Inspect emitted code and bundle size, and exercise cleanup and error paths; warmed microbenchmarks can hide allocation costs that matter elsewhere.

The reports above include their inputs, sampling methods, environment and build identity. Instructions for reproducing repository benchmarks are in the [contributor development guide](https://github.com/swiftuijs/twill/blob/main/docs/contributing/tooling.md#benchmark-changes). Correctness and output budgets are enforced; wall-clock thresholds are not enforced across different runners.

## Earlier Node shell SDK measurements

The earlier [shell implementation](scripting.md) executed through native Node `spawn` / libuv, without command translation or a runtime compiler dependency. Inherited/discarded descriptors bypass capture. Explicit capture retains bounded chunks and concatenates/decodes once at settlement; the byte limit is not a total heap/RSS cap.

`pnpm benchmark:shell --output ../../shell-results.json --verify-performance` compares equivalent successful direct-child work with handwritten `spawn`: native/Node inherited output, dual binary capture and text stdin/capture. Nine paired samples alternate order, retain parent CPU and wall time separately, and include source/build hashes. The local gate requires a median wall ratio at most 1.10 and a paired bootstrap interval within tolerance; inconclusive samples do not pass. Separate reports cover parent memory observations at 1 MiB/8 MiB per stream, native/SDK/Twill cold startup and an `execFile` capture reference. Memory sampling is not a hard peak bound. No universal speedup, cancellation, concurrency or process-tree claim follows from these workloads.

The [recorded source/build-identified samples](https://github.com/swiftuijs/twill/blob/main/packages/shell/benchmarks/results/README.md) include both an inconclusive whole-batch run and the accepted operation-interleaved run. The latter measured warm wall ratios 1.003–1.013 (all 95% upper bounds below 1.04), with comparable capture RSS observations. Dual capture adds about 10% parent CPU in this environment; child CPU is outside that metric. Native/SDK/Twill-source cold medians were 84.8/91.3/567.5 ms including one child. Native export avoids the source loader's compiler startup; warm SDK parity does not establish cold-source parity.

The [early runner cache measurements](https://github.com/swiftuijs/twill/blob/main/packages/twill/benchmarks/results/README.md#compilation-cache-prototype) retain 21 fresh-interpreter pairs and compiler/dependency validation. On this Linux/Node 24 workload, uncached/empty-cache/cached/native medians were 513.6/544.3/157.3/43.9 ms. The paired cache-hit ratio was 0.2938 (95% interval 0.2826–0.3046); empty-cache paired overhead was about 7%. These are source-startup observations, not native parity, external-command acceleration or Rust measurements. A valid hit skips compiler initialization; prebuilt JavaScript remains the faster first-launch path.

## Rust subprocess experiment (historical)

**Historical prototype, before 0.2.0.** This section compares the experimental addon with the earlier Node SDK. Version 0.2.0 used the production [Rust shell backend](#rust-shell-backend) described below; its independent reactor addressed the prototype's worker-pool contention. Version 0.3.0 uses the [Node SDK](#node-shell-sdk) above. Keep these older measurements separate from production results and compiler startup.

The repository also contains an isolated Linux Rust/N-API experiment. It owns a direct child and nonblocking pipes, drains both output streams in one native loop and transfers captured buffers through N-API. It is outside published SDK files and cannot be selected through `Subprocess.run`; the measurement baseline used the earlier Node SDK. No Rust interpreter or compiler port is involved.

On Linux x64 / Node 24.19.0, eleven paired batches compare the prototype with the then-current Node SDK and handwritten Node `spawn`. All six operation orders rotate; every result is verified, and parent CPU includes native worker threads but excludes child work. Independent C producers expose launch/I/O costs; a Node producer includes its interpreter startup. These are observed paired ratios, not application-wide speed guarantees:

| Successful workload                       | Rust / SDK wall ratio | 95% paired bootstrap interval | Rust / SDK parent CPU ratio |
| ----------------------------------------- | --------------------: | ----------------------------- | --------------------------: |
| Short native executable, inherited output |                 0.581 | 0.563–0.612                   |                       0.467 |
| Native producer, dual 1 MiB capture       |                 0.582 | 0.478–0.608                   |                       0.645 |
| Native producer, dual 8 MiB capture       |                 0.852 | 0.815–0.904                   |                       0.869 |
| Native 1 MiB stdin/text capture           |                 0.601 | 0.551–0.722                   |                       0.677 |
| Node producer, dual 1 MiB capture         |                 0.898 | 0.879–0.976                   |                       0.494 |

Short launches and native dual 1 MiB capture reduce paired wall time by about 42%; dual 8 MiB capture reduces it by about 15%. Node inherited-output launches have an inconclusive Rust/SDK interval (0.940–1.040). External commands do the same work; these gains belong to launch and capture coordination. The [full report](https://github.com/swiftuijs/twill/blob/main/packages/shell/benchmarks/results/rust-native-linux-node24.json) also retains the handwritten Node comparison, full-duplex input, every raw sample and source/build/toolchain identities.

Isolated capture RSS-increase medians were 4.13 MiB for SDK versus 2.31 MiB for Rust at 1 MiB per stream, and 33.21 versus 16.30 MiB at 8 MiB per stream. These 1 ms observations plus settlement are not hard peak bounds. Native allocation accounting differs from V8's `external`/`arrayBuffers`; use RSS to compare the process, and do not infer zero allocation/copying.

Two measured limits prevented adopting that prototype unchanged. Actual Twill runner startup had no demonstrated Rust improvement: cached SDK/Rust medians were 177.4/173.7 ms, with paired ratio 1.013 and interval 0.904–1.047; uncached medians were 514.4/525.8 ms. This addon leaves Node/compiler initialization intact. Also, each experimental native operation occupies a libuv worker: 32 parallel Node children with a 100 ms wait took observed medians of 473 ms for the earlier SDK and 1,185 ms for Rust with the default four-worker pool. Raising the pool to 32 measured 477/456 ms, but does not establish an independent scheduler or eliminate contention with filesystem/DNS work.

The addon is 495,808 bytes uncompressed, excluded from the SDK's existing 16 KiB archive gate. It snapshots input/environment and tests byte bounds, statuses, failures, deadlines and direct-child reaping on Node 20.19/24. It uses generic errors and immediate termination; graceful cancellation, bounded join, environment shutdown, containment, pipelines and Windows/macOS parity remain unimplemented. A production backend needs independent asynchronous scheduling and the full ownership/platform contract before adoption. See the [experiment and reproduction instructions](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell/experiments/rust-native/README.md) and [RFC 0036](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0036-native-subprocess-backend.md).

<a id="optional-rust-backend"></a>

<a id="node-shell-sdk"></a>

## Node shell SDK in 0.3.0

Version 0.3.0 withdraws the Rust addon and experiment in favor of Node spawn/streams with zero production dependencies. It keeps the 16 KiB SDK archive gate and the complete seven-warm/two-concurrency comparison against equivalent handwritten Node. Historical Rust ratios below describe 0.2.0, not this replacement. Abrupt worker/process-exit cleanup and numeric unnamed-signal guarantees are intentionally retired; see [scripting](scripting.md#execution-and-version-boundary).

The [measurement history](https://github.com/swiftuijs/twill/blob/main/packages/shell/benchmarks/results/README.md#node-replacement-validation) retains every failed assessment, individual sample and source/build identity. The final [inherited-state fast-path report](https://github.com/swiftuijs/twill/blob/main/packages/shell/benchmarks/results/node-replacement-inheritance-fastpath-linux-node24.json) at `502be6f`, Linux x64 / Node 24.19.0, records:

| Workload                     | Paired SDK / handwritten Node wall median | Upper 95% bound |
| ---------------------------- | ----------------------------------------: | --------------: |
| Native inherited launch      |                                     0.993 |           1.026 |
| Empty Node child             |                                     1.016 |           1.039 |
| Native dual 1 MiB capture    |                                     1.171 |           1.232 |
| Native dual 8 MiB capture    |                                     1.050 |           1.095 |
| Node dual 1 MiB capture      |                                     1.028 |           1.064 |
| 1 MiB stdin/text capture     |                                     1.028 |           1.062 |
| Native full-duplex 1 MiB     |                                     1.113 |           1.157 |
| 32 concurrent Node children  |                                     1.000 |           1.009 |
| 128 concurrent Node children |                                     1.009 |           1.025 |

The native 1 MiB capture and duplex workloads exceed the historical 1.10 target. The maintainer [accepted these measured costs for 0.3.0](https://github.com/swiftuijs/twill/blob/main/packages/shell/benchmarks/results/node-replacement-0.3.0-acceptance.json) on 2026-10-09; the report still fails the optional strict comparison. This is a documented release tradeoff, with roughly 17%/11% median overhead in those two synthetic workloads, not a claim of universal native parity or a general speedup. Node interpreter launches and concurrency have separate, much smaller observed wall differences. Parent CPU excludes child CPU and is retained independently.

Default cwd/environment capture delegates to synchronous Node spawn, avoiding duplicate environment copies and unnecessary child chdir; explicit policies retain their handling. CPU-profile diagnostics investigated retained chunks and growing buffers; both candidates were withdrawn. Their exact snapshots and profiles remain in the measurement history.

Fresh handwritten Node/SDK medians are 52.4/55.6 ms, cached Twill baseline/SDK 166.7/177.0 ms, and uncached 503.6/515.0 ms. Parent CPU, memory, filesystem availability and cancellation observations remain separate in the raw reports. No universal speedup or native-source startup parity follows.

<a id="rust-shell-backend"></a>

## Rust shell backend (historical 0.2.0)

The `@swiftuijs/twill-shell` SDK in 0.2.0 uses `@swiftuijs/twill-shell-native` as its automatically installed prebuilt Rust engine and implements the complete direct-child SDK contract with one independent asynchronous reactor per Node environment. Native process creation runs synchronously on the calling Node thread, matching Node spawn. Unix readiness notifications and overlapped Windows pipes handle already-started children without a libuv worker per command. It preserves byte bounds, typed errors, cancellation, bounded join and environment cleanup. Byte input is copied at submission; captures and decoding still allocate. The prior optional-backend reports below retain the earlier Node SDK as a historical baseline; 0.2.0 provides one public Rust-backed SDK.

The [complete-contract report](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/production-linux-node24.json) measures the production implementation on 2026-10-08, Linux x64, Node 24.19.0 and Intel Xeon Platinum 8573C, with Rust 1.90.0. Eleven paired warm samples interleave all six handwritten Node / SDK / Rust orders between individual operations. Sequential work uses CPU 0; concurrency uses CPUs 0–3, matching the host's four-CPU quota. Each backend receives the same workload affinity. Output and termination status are checked outside timing. Parent CPU includes the Rust reactor and excludes child CPU.

| Warm operation                 | SDK median | Rust median | Paired Rust / SDK | Paired Rust / native (95% interval) |
| ------------------------------ | ---------- | ----------- | ----------------- | ----------------------------------- |
| `/usr/bin/true`, inherited I/O | 2.99 ms    | 1.95 ms     | 0.648×            | 0.645× (0.620–0.651)                |
| Empty Node child               | 38.01 ms   | 37.77 ms    | 0.963×            | 0.969× (0.954–0.990)                |
| Native dual capture, 1 MiB     | 8.33 ms    | 4.88 ms     | 0.575×            | 0.591× (0.552–0.617)                |
| Native dual capture, 8 MiB     | 30.59 ms   | 22.89 ms    | 0.737×            | 0.731× (0.676–0.744)                |
| Node dual capture, 1 MiB       | 50.45 ms   | 45.54 ms    | 0.918×            | 0.915× (0.886–0.935)                |
| Native stdin/text echo, 1 MiB  | 7.50 ms    | 4.98 ms     | 0.675×            | 0.682× (0.650–0.702)                |
| Native full-duplex I/O, 1 MiB  | 7.95 ms    | 5.05 ms     | 0.629×            | 0.634× (0.623–0.659)                |

Capture sizes are per stream. Wall medians and paired-ratio medians are different statistics; dividing the displayed medians does not reproduce the paired ratios. These native executable launch/capture workloads reduce wall time by about 26–43% against the SDK in this run. Parent CPU ratios are 0.478–0.801 across all seven workloads. The addon accelerates coordination, not the child program's own work.

Default-pool concurrency uses 48 pairs per workload, with each of six orders appearing eight times. Each child runs Node with a 100 ms timer. The earlier experimental 2.5× slowdown is removed without enlarging the shared worker pool:

| Concurrent children | SDK median | Rust median | Paired Rust / native (95% interval) |
| ------------------- | ---------- | ----------- | ----------------------------------- |
| 32                  | 572 ms     | 563 ms      | 0.998× (0.974–1.040)                |
| 128                 | 1850 ms    | 1853 ms     | 1.003× (0.983–1.022)                |

All seven warm workloads and both default-pool concurrency workloads pass the unchanged acceptance target: paired median and upper 95% bootstrap bound at most 1.10× handwritten Node. This is a controlled-host result, not a cross-platform performance guarantee. Five real OS/CPU CI targets separately verify behavior and independently installed Node 20.19 consumers.

Isolated capture RSS-increase medians are SDK/Rust 3.88/2.43 MiB at 1 MiB per stream and 32.38/16.37 MiB at 8 MiB per stream. Sampling at 1 ms plus settlement cannot establish a hard peak bound; native memory is not fully represented by V8 external-memory accounting. With `UV_THREADPOOL_SIZE=1` and 32 live children, unrelated filesystem reads still complete before releasing those children. Forced cancellation with a 20 ms grace period joins the directly owned child; raw latencies are in the report. These lifecycle observations use atomic PID markers and reject nonpositive identifiers before cleanup.

Fresh interpreter/import/one-command medians are handwritten Node 53.9 ms, SDK 56.3 ms and Rust 60.6 ms. Actual Twill runner medians are SDK/Rust 187.3/192.2 ms with cache hits and 543.9/560.9 ms with caching disabled. Their paired ratios are 1.029× and 1.010×; there is no demonstrated source-startup improvement. The compiler and Node interpreter remain on that path.

The measured Linux addon is 781,016 bytes. The separately verified five-target CI archive is 1,814,079 bytes compressed; each binary stays below 2 MiB and the archive below 6 MiB. The public SDK retains its independent 16 KiB budget. Binary hashes, source fingerprints, archive digest and license verification are retained in the [package evidence](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/production-package-validation.json).

The [measurement history and reproduction instructions](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/README.md) retain every failed review, the interrupted checkpoint and continuation source. The checkpoint already contained all warm, memory and concurrency observations; its continuation completed lifecycle and cold measurements on unchanged sources/builds. Review found a PID-marker race in the benchmark tool; atomic-marker lifecycle measurements were then repeated and recorded separately, preserving the original observations. Earlier foreign-thread cleanup crashes were fixed in the backend and are covered by repeated fresh-process, worker and actual Twill-runner tests. No sample was dropped to pass a performance gate. Process-tree containment, pipelines and unsupported prebuild targets remain outside this direct-child contract.

### Expanded platform coverage

The released 0.2.0 eight-target matrix added Linux musl and Windows ARM64, glibc 2.28 builds and Rust-reactor owned-child polling when Linux pidfds are unavailable/denied. The historical measurements above used the earlier readiness implementation and identified five-target archive. The [expanded-platform evidence](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/platform-package-validation.json) identifies eight successful actual OS/CPU/libc jobs, each with real process contracts, 100% JavaScript adapter coverage and independent Node 20.19 archive consumers. The inspected complete archive is 2,891,605 bytes; every binary remains below 2 MiB and the archive below 6 MiB.

The [new complete Linux/Node 24 report](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/platform-linux-node24.json) uses the same controlled-host method and unchanged performance gate. All seven warm and both default-pool concurrency workloads pass: 32/128-child Rust/native median ratios are 1.002/0.999, with upper 95% bounds 1.023/1.022. Warm native launch/capture wall ratios against the SDK are 0.588–0.730. These are readiness-path observations on the identified Linux host, not cross-platform guarantees.

The [actual denied-pidfd diagnostic](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/platform-pidfd-denied.json) runs Node under a verified syscall filter returning ENOSYS. Twelve pairs retain all six operation orders and compare checked short launches and dual 1 MiB capture with handwritten Node. Short-launch Rust/native median ratio is 1.080 (95% interval 1.071–1.106); dual capture is 0.642 (0.624–0.681). Polling adds short-command wait latency; the short-launch interval does not establish the complete run's 1.10 acceptance bound. The separately retained [readiness diagnostic](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/platform-pidfd-readiness.json) and exact diagnostic source keep these observations distinct. Parent CPU includes the Rust reactor; child CPU is excluded.

That historical implementation inspected Node's complete process report on the first native load. Fresh SDK/Rust interpreter/import/one-command medians in that run were 63.5/80.7 ms; cached Twill source medians were 202.3/259.6 ms. Those measurements do not attribute the whole difference to ABI detection.

### 0.2.0 public SDK measurements

The [Rust-only report](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/rust-only-linux-node24.json) measures the public SDK against handwritten Node on the same Linux x64 / Node 24.19 / four-CPU-quota host. Eleven warm pairs alternate both operation orders; both default-pool concurrency workloads retain 48 pairs. All seven warm and both concurrency gates pass unchanged, requiring both paired medians and upper 95% bounds at most 1.10.

| Warm workload                | Rust / handwritten Node | 95% paired interval |
| ---------------------------- | ----------------------: | ------------------- |
| Short native launch          |                   0.631 | 0.610–0.633         |
| Node interpreter launch      |                   0.983 | 0.946–0.999         |
| Native dual 1 MiB capture    |                   0.561 | 0.523–0.578         |
| Native dual 8 MiB capture    |                   0.640 | 0.634–0.685         |
| Node dual 1 MiB capture      |                   0.898 | 0.850–1.033         |
| Native 1 MiB stdin/text      |                   0.654 | 0.630–0.703         |
| Native 1 MiB duplex          |                   0.597 | 0.560–0.612         |
| 32 concurrent Node children  |                   0.996 | 0.960–1.011         |
| 128 concurrent Node children |                   0.997 | 0.981–1.010         |

In that released implementation, ordinary Linux startup reads the current Node ELF interpreter with bounded descriptor reads, retaining the conservative report fallback for unknown/static layouts. Fresh native/SDK medians are 62.9/70.0 ms. Cached Twill source medians are 207.3/223.8 ms; its paired ratio is 1.110 with interval 1.039–1.191. Uncached source medians are 689.8/635.4 ms, with an interval spanning parity. These observations do not establish cold-source parity, isolate the ELF optimization's contribution or demonstrate a general startup speedup. The historical denied-pidfd latency tradeoff above also remains separately scoped.

The report preserves memory, filesystem, cancellation and cold observations alongside every warm/concurrency sample and source/build hash. Cold warmup initially failed on a workspace-only import after the dependency direction changed. A retained completion script verifies every unchanged runtime/build identity before fixing the unexecuted fixture's import and measuring only the eleven cold pairs; no earlier sample is repeated or removed. The [measurement history](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/README.md#rust-only-sdk-release) retains the incomplete checkpoints, failure logs, completion source and exact serialized report.

The [final 0.2.0 shell recheck](https://github.com/swiftuijs/twill/blob/v0.2.0/packages/shell-native/benchmarks/results/release-final-linux-node24.json) retains a complete run after the Mac exit-race and unnamed-signal fixes. All seven warm workloads and both default-pool gates pass without changing sample counts or limits. Native launch/capture/input ratios are 0.555–0.679, Node interpreter launch is 0.948, and 32/128-child concurrency medians are 0.975/0.992 (upper 95% bounds 0.998/0.997). This is Linux readiness-path evidence; the report retains separate cold, memory, cancellation and filesystem observations, and establishes no universal or external-command speedup.
