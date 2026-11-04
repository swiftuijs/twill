# Testing and coverage

Tests live in the workspace that owns the behavior. Build shared packages before running tests that import public package exports.

```sh
pnpm check
pnpm test:coverage
pnpm test:browser
pnpm editor:coverage
pnpm editor:test
```

Install Playwright Chromium before browser tests. On headless Linux, prefix editor commands with `xvfb-run -a`. Use `TWILL_TEST_VSCODE_PATH` for an existing executable or `TWILL_TEST_VSCODE_VERSION` to select a download. Package the editor with `pnpm editor:package` before testing it.

## Coverage gates

Vitest uses V8 coverage remapped to source ASTs, including original `.twill` sources through the public Vite adapter. The packaged-editor collector includes `extension.twill` and rejects missing/incomplete source reports. Source migration must preserve every production module and the existing coverage thresholds. `pnpm verify:dogfood` checks the production-source policy before release validation. Native test harnesses intentionally exercise Twill imports and ordinary JS/TS consumers. Reports include statements, branches, functions and lines. Every public package has a gate; the compiler and parser have additional file gates. Build adapter entry points are included rather than excluded from the compiler report.

| Scope                                    | Statements | Branches | Functions | Lines |
| ---------------------------------------- | ---------: | -------: | --------: | ----: |
| Core package                             |        98% |      95% |       99% |   99% |
| Compiler                                 |       100% |      98% |      100% |  100% |
| Parser                                   |        98% |      97% |      100% |  100% |
| TypeScript server bridge                 |        98% |      93% |      100% |  100% |
| Formatter                                |        98% |      97% |      100% |  100% |
| Linter                                   |       100% |      98% |      100% |  100% |
| Browser highlighter                      |       100% |     100% |      100% |  100% |
| Shell SDK                                |        98% |      95% |      100% |   99% |
| Source export                            |        99% |      96% |      100% |  100% |
| Playground scheduler and compiler worker |       100% |     100% |      100% |  100% |
| Packaged VS Code extension               |        98% |      95% |      100% |   98% |

Editor coverage comes from the real extension host running the extracted VSIX, with c8 collecting V8 ranges. The collector checks that the packaged bundle matches the build before supplying its development source map; the bundle remains unchanged. A separate check rejects empty or incomplete reports. c8's line-based statement/range metrics differ from Vitest's AST metrics, so do not combine their percentages or call an empty function denominator 100% coverage.

Provider boundary tests capture registrations from the same cached, shipped extension module and call them with real VS Code documents, language services, cancellation tokens and workspace edits. Controlled request-version changes exercise stale-result rejection; scoped API interception is restored after activation. Inferred-project fixtures live outside the repository so they cannot inherit a package's tsconfig. Native backend faults, such as skipped declaration emit and missing programs, are injected at the TypeScript API boundary without adding test hooks to production code.

Playground control-flow coverage covers its scheduler and worker, including bounded input, stale responses, retries, failures and cancellation on disposal. Vue rendering, CodeMirror editing, accessibility and responsive behavior are validated by Chromium integration tests rather than included in that unit percentage. Third-party engines, Electron and VS Code's own implementation are outside Twill's source coverage.

JSON summaries and HTML reports are generated under each workspace's `coverage/`. CI builds and packs one candidate under Node 22 after release-metadata, example and generated-code budget checks. Type, lint, formatting and official-skill checks run in the existing tooling validator alongside compiler coverage, keeping those checks mandatory without delaying the shared build. Parallel Linux validators restore the same outputs: compiler coverage; tooling checks, other package coverage and editor grammars; browser integration; packaged VS Code coverage; seven independent package consumers; and real loader API boundaries. Package coverage remains complete within its owning validator, with the existing original-source and per-file thresholds. No compiler coverage sharding or merging is needed.

The package-consumer validator switches to Node 20.19.0 only after installation and artifact restoration; it runs native Node scripts with no later repository pnpm command. The loader validator switches to each required runtime after restoring the build. Other validators retain Node 22. Routing and required-gate tests use native Node without installing workspace dependencies; workflow contracts run before either the core or documentation build. The dependency audit starts independently of routing, so an advisory does not conceal behavioral results. It still fails the required `verify` aggregate and blocks publication. Only that aggregate promotes the unchanged candidate archives/VSIX/manifest to `twill-packages` after every required check succeeds. Candidate artifacts and reports do not authorize release, and neither dependencies nor script caches are transferred as build outputs.

The packages' normal `prepack` hooks rebuild for ordinary developer packaging. CI has already built its candidate, so its pack commands explicitly skip lifecycle scripts; they do not repeat compilation. The workflow contract test requires reviewing this shortcut if a package adds non-build work to `prepack`. Artifact/export/size checks and independent installs remain mandatory.

Validate pipeline changes before pushing:

```sh
pnpm install --frozen-lockfile
pnpm test:ci
actionlint
```

Install [actionlint](https://github.com/rhysd/actionlint) for GitHub expression, action and shell validation. The Node tests parse the actual workflow, exercise its archive/restore commands, and reject invalid runtime transitions, missing release gates and unexpected skipped jobs. Run changed build/test commands locally before the first remote verification; a correction should address the failure's related assumptions together.

Ordinary PRs select jobs using the complete base-to-head diff, including deletions and both sides of renames. Documentation/site/skill/report-only changes retain documentation coverage/types/builds, skill/downloads, formatting and root/subpath browsers. Compiler/runner/export/runtime/shell and shared dependency/build changes retain actual shell/runner contracts on Linux x64, macOS ARM64 and Windows x64, including minimum Node 20.19 installed consumers. Types and original-source coverage run once on Linux; other systems execute the same real-process suites without repeated coverage instrumentation. Node supplies OS/CPU/libc execution, so the former eight-target native matrix is removed. Unknown paths or unavailable history select all three systems. Main code/dependency pushes, weekly, manual and release runs select every check. Pure documentation/site/skill/evidence pushes to main use the complete before-to-after range and keep documentation validation without compiler/platform jobs. Missing or invalid history, forced pushes and mismatched checkouts fall back to full verification.

Pages deployment is a separate Linux-only workflow with its own build and deploy jobs; it does not wait for compiler or Windows/macOS validation. A code/dependency merge can trigger both workflows independently.

`pnpm test:ci` also validates routing, real PR/push Git history, deleted/renamed owners, mixed changes, invalid bases, independent Pages deployment and full release events. Scope-analysis failure fails the stable required `verify` check. Dependency caches and same-run build artifacts never replace process tests, coverage, installed consumers or byte gates. Superseded runs can be cancelled, including the aggregate and failure-report uploads.

Loader compatibility still runs for every code PR at Node 22.12.0, 22.15.0 and 26 using the candidate build. One installed loader job switches through all three runtimes sequentially, avoiding three separate checkout/install/restore jobs. The historical old/new startup timing comparison belongs to the optional `Extended validation` benchmarks on Node 26, with full Git history; routine PR, main, scheduled and release verification keep functional checks without rebuilding an old commit for a timing report. Enable manual benchmarks when collecting evidence for a loader performance change.

`Extended validation` is manual: enable `compatibility` for Windows/macOS and Node 24 checks plus the minimum VS Code host, or enable `benchmarks` to collect timing reports. Run compatibility checks before release and after changes to paths, file resolution, CLI processes, Node APIs or editor support. A release reuses the regular verification workflow, also checks the minimum editor host, and publishes its exact tested artifacts. Deterministic size budgets and behavioral comparisons remain required on every change; noisy timing measurements are not a merge gate.

## What the tests exercise

- Parser and compiler: native TypeScript corpus, JS/JSX variants, malformed source, lexical keyword collisions, Unicode identifiers, private members, nested callbacks, contextual member shorthand, hygienic names, source maps and all JS line endings.
- Semantics: native-JavaScript differential execution, guard narrowing and exits, cleanup ordering and failures, hoisted declarations and JSDoc, asynchronous cleanup, switch exhaustiveness, native React/Vue rendering and component identity.
- Hosts: actual Vite, Rollup, esbuild, webpack and Rspack builds; mixed native/dialect imports; Node loader resolution, host error forwarding, inherited JSX settings and original-source debugging.
- Editor: partial and unsaved inputs, source-safe edits, auto-imports, references, cross-file rename, definitions, signatures, formatting, configuration reloads and native TS-server consumers. Highlighting uses real TS/TSX grammars in both unit tests and packaged extension hosts, including strings, comments, regexps, templates and JSX nesting.
- Executable runner: actual direct/explicit invocation and POSIX shebangs, literal arguments including CLI flags, standard argv/I/O/cwd/environment, script-local dependencies/configuration, extensionless entries and native imports, original error positions, native exit codes/signals and independent installed binaries. Persistent runner caches cover miss/hit, same-timestamp content changes, configuration probes/inheritance, source maps, corruption, collisions/bounds, private-directory/file rules, concurrent atomic writes and optional I/O failure fallback.
- Shell SDK: literal argv, NUL/invalid options, immutable values, concurrent cwd/environment isolation, binary and multi-byte input/output, byte overflow, both output pipes, exit/signal/launch/write/read failures, cancellation races, graceful/forced teardown, unresolved PID reporting, descriptor-owning descendants, actual Twill scripts/defer cleanup, declarations and native exported execution. Native backend faults are injected at Node API boundaries only; real children are joined/cleaned.
- Tooling: formatter idempotence and compiled AST preservation, type-aware linting with cache refresh/eviction, withheld unsafe fixes, declarations, export preflight, imported assets and rollback on disk failure.
- Framework pilot: pinned React core source integrity, compilation, formatted AST preservation, dev/prod APIs and lazy/transition/act behavior; native/dialect ReactDOM rendering and output budgets. This is not the full upstream React test suite.
- Web highlighting: shared TextMate JSON, real Shiki scopes, standalone/custom-theme rendering, public types on Shiki 2.5/3/4, engine-free grammar import and actual browser WASM loading.
- Browser: highlighted live compilation, draft storage, keyboard editing, input bounds, read-only output, downloads, retry, stale-result handling and desktop/mobile navigation.

A gate measures executed source, not correctness of every input. Remaining uncovered branches include host fallbacks, conservative edit rejection and some platform-specific paths. Add tests around observable contracts and actual regressions; do not lower gates, exclude production code, add coverage-ignore directives or manufacture assertions to make a report green.

## Performance checks

```sh
pnpm benchmark --output compiler-results.json
pnpm benchmark:project --output project-results.json
pnpm benchmark:branching --output branching-results.json
pnpm benchmark:shell --output ../../shell-results.json --verify-performance
taskset -c 0 node packages/shell/benchmarks/complete.mjs --concurrency-cpus 0-3 --output packages/shell/benchmarks/target/production.json
node packages/twill/benchmarks/runner.mjs > runner-results.json
node packages/twill/benchmarks/script-startup.mjs > script-startup-results.json
node packages/twill/benchmarks/startup-profile.mjs > startup-profile-results.json
pnpm --filter @swiftuijs/twill test:size --output ../../bundle-results.json
```

CLI help/argument-loading and lint line-index diagnostics can be measured separately:

```sh
node packages/twill/benchmarks/cli-startup.mjs --baseline-cli /path/to/extracted-0.4.0/package/dist/cli.js --output cli-startup.json
node packages/linter/benchmarks/positions.mjs --output lint-positions.json
```

Install or link the baseline package's declared dependencies before comparing it. Run without concurrent builds/tests. These diagnostics retain alternating paired samples, source/build identities and environment; they measure cold command dispatch and line-index construction, not whole-project checking/linting or application runtime.

## Shell SDK contracts

The SDK owns validation, Node spawn/stream coordination and all public real-process contracts. Cover literal argv, PATH, simultaneous stdin/stdout/stderr, byte bounds, statuses/errors, input/environment/cwd snapshots, abort/timeout races, bounded failed teardown, descendant-held pipes, descriptor lifetime and host-pool availability. Boundary injection tests still launch real children and preserve primary/secondary errors. Cooperative worker cancellation and `process.exitCode` after awaited work are tested; the native abrupt-disposal barrier and numeric unnamed-signal guarantee are intentionally retired in the RFC amendment. Do not claim they survive or add a supervisor to simulate them.

Keep real Twill script formatting, checking, declarations and exported execution under the existing 15-second per-test timeout. Source coverage includes every original `.twill` module and preserves 98/95/100/99 thresholds. Independently install the SDK without a compiler, addon, Rust or production dependencies on Node 20.19, and enforce the unchanged 16 KiB archive budget.

Run `benchmark:shell:complete` on Linux with a C compiler, committed sources and no concurrent builds/tests. Pin sequential work to one allowed CPU and concurrency to a CPU set matching the host quota. Retain eleven paired samples for all seven warm workloads and 48 pairs for both default-pool 32/128-child workloads; keep both order permutations, every sample and confidence interval. The optional `--verify-performance` flag retains the historical 1.10 paired median/upper 95% diagnostic target; it still rejects the 0.3.0 capture report. The maintainer explicitly accepted that measured overhead for this shell release; retain the [review decision](https://github.com/swiftuijs/twill/blob/main/packages/shell/benchmarks/results/node-replacement-0.3.0-acceptance.json) rather than marking the strict comparison passed. Memory, filesystem, cancellation and cold Node/cached/uncached Twill observations stay separate. PID markers publish atomically and cleanup rejects nonpositive PIDs. Store reports in `packages/shell/benchmarks/results`; historical native evidence remains in the 0.2.0 tag. `benchmark:shell` remains the cross-platform diagnostic. Correctness, timing and publication are separate outcomes.
