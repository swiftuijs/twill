# Contributing

Coding agents should read [AGENTS.md](AGENTS.md) for repository conventions. Public language, tooling, compatibility and release changes must review and update the [official AI skill](skills/twill/SKILL.md) in the same PR; explain in the PR when its guidance is unaffected. Run `pnpm verify:skills` after building its dependencies. Website downloads are generated from that canonical file.

These guides describe development of Twill itself. Application users should start with the [user documentation](https://twill.evecalm.com/). Repository references: [development and workspace commands](docs/contributing/tooling.md), [compiler architecture](docs/contributing/architecture.md), [release process](docs/contributing/releasing.md), [GitHub language registration](docs/contributing/github.md) and [language proposals and RFC process](docs/rfcs/README.md).

Use Node 22.13+ or Node 24+ and the pnpm version pinned in `packageManager`. The optional native shell workspace also requires pinned Rust 1.90.0 with rustfmt/clippy for source builds; installed archives use prebuilt binaries. Install with `pnpm install --frozen-lockfile`. Run `pnpm check` before submitting changes; it includes formatting checks. `pnpm test:watch` supports compiler development; `pnpm dev:react` and `pnpm dev:vue` run the examples after a build.

For a syntax change, add execution or negative-diagnostic tests covering the new behavior, nearby ordinary JS/TS syntax, and nesting. For mapping changes, check real diagnostic/editor positions. Build integrations must be exercised with their actual tool. Avoid replacing parser behavior with broad string rewrites.

Every syntax extension, semantic extension and public tooling capability introduced by Twill has an independent [RFC](docs/rfcs/README.md). Write or amend it before the implementation PR, using [the template](docs/rfcs/TEMPLATE.md). Link the RFC from the PR and record dependencies, supported scope and validation. New proposals stay proposed until a maintainer records acceptance; implementation and release are separate statuses. Retrospective RFCs document shipped behavior without inventing earlier approval.

Native JS/TS features such as optional chaining (`?.`) and nullish coalescing (`??`) need no standalone RFC while their native behavior is retained. Describe their compatibility with Twill additions in the relevant feature RFC.

Start with a concrete JS/TS problem and an equivalent handwritten baseline. A proposal needs explicit semantics, costs, ecosystem boundaries and compiler, checker, formatter, linter, highlighting and editor support. Twill can define new semantics; changes to existing spelling or runtime behavior need an explicit native boundary and versioned migration. [RFC 0001](docs/rfcs/0001-practical-language.md) provides direction; the individual feature RFCs specify the contracts.

Keep the compiler independent of frameworks and libraries. Put runtime adaptation in an optional entry point, and use example applications for library-specific usage. Update the syntax contract when behavior or compatibility changes.

The editor can be debugged by opening `editors/vscode` in VS Code, running `pnpm editor:build` at the repository root, and launching its extension host. Install the built VSIX for packaged validation.

The private root coordinates pnpm workspaces: compiler/toolchain in `packages/twill`, extension in `editors/vscode`, including its internal `src/tsserver.twill` bridge module. Build with `pnpm build` before typechecking editor imports. Production sources outside the compiler use Twill, including the formatter, linter, export, highlighter, shell wrappers and editor packages. Vite uses the public Twill adapter, `twill check` checks source and `twill declarations` emits native consumer types. The compiler still bootstraps from JS/TS with `vite-plugin-dts`; the canonical runtime helper, Rust engine and host-owned scripts remain native. See [developing tooling in Twill](docs/contributing/dogfooding.md) for source imports, bootstrap boundaries and validation. See [the tooling guide](docs/contributing/tooling.md) for commands and artifact paths.

For editor changes, run `pnpm editor:package` then `pnpm editor:test` (headless Linux: `xvfb-run -a pnpm editor:test`). Tests load the extracted VSIX and apply real completion/import/rename/fix edits and inspect Node source breakpoints. `TWILL_TEST_VSCODE_VERSION` selects another test version; `TWILL_TEST_VSCODE_PATH` uses an already downloaded executable. No application code runs during language assistance; starting the explicit debugger does execute the selected application file.

## Package-owned tests

Keep test sources, fixtures, configuration and test dependencies with the package they exercise. The root provides aggregate commands; it does not own a test suite. Build workspace dependencies before running an individual package's tests.

| Package                 | Test command                                                               | Coverage                                                                          |
| ----------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/twill`        | `pnpm --filter @swiftuijs/twill test:unit`                                 | Compiler, type checker, declarations, language-service API and five bundlers      |
| `packages/formatter`    | `pnpm --filter @swiftuijs/twill-formatter test:unit`                       | Formatting, syntax preservation and idempotence                                   |
| `packages/linter`       | `pnpm --filter @swiftuijs/twill-linter test:unit`                          | ESLint processor, rules and typed checks                                          |
| `packages/highlight`    | `pnpm --filter @swiftuijs/twill-highlight test:unit`                       | Browser/SSR highlighting and portable TextMate registrations                      |
| `packages/export`       | `pnpm --filter @swiftuijs/twill-export test:unit`                          | Checked native export, imports, configuration, collisions and input preservation  |
| `editors/vscode`        | `pnpm --filter twill test:unit`, `pnpm editor:test`                        | TextMate grammar and real packaged extension host                                 |
| `packages/shell`        | `pnpm --filter @swiftuijs/twill-shell test:coverage`                       | Real Node subprocess contracts, Twill/export integration and shared backend tests |
| `packages/shell-native` | `pnpm --filter @swiftuijs/twill-shell-native test:coverage`, `test:native` | Compiled Rust subprocess/lifecycle/platform contracts and JS adapter coverage     |
| `apps/docs`             | `pnpm --filter @swiftuijs/twill-docs test:browser`                         | Desktop/mobile documentation and playground                                       |
| `examples/*`            | `pnpm test:examples`                                                       | Example execution, production bundles and SSR rendering                           |

`pnpm test` aggregates unit suites; `pnpm test:coverage` writes reports under each public package's `coverage/`. `pnpm test:browser` runs browser highlighting, compiler React refresh, documentation and the React framework renderer suites sequentially. Install Chromium with `pnpm --filter @swiftuijs/twill-docs exec playwright install --with-deps chromium` first. To use an existing browser, set `TWILL_CHROMIUM_PATH`. Browser artifacts stay outside the checkout, or under `TWILL_BROWSER_OUTPUT`, with separate directories for each package.

Each public package owns `test:package` and its independent npm consumer. After `pnpm package:core && pnpm package:tooling`, `pnpm test:packed` verifies the seven standard archives; native assembly independently validates the eighth archive. These checks run outside the workspace and must not depend on hoisted development dependencies. The compiler owns shared TS-server protocol helpers and the TypeScript syntax corpus, reused by the editor and formatter without a cyclic workspace dependency. The highlight package owns browser/Shiki integration tests and the shared TextMate grammar source. The React framework example owns its pinned source snapshot, rewrite, runtime/renderer contracts and comparison benchmark. Compiler benchmarks live in `packages/twill/benchmarks`; the combined checker/formatter benchmark lives in `packages/formatter/benchmarks`.

## Dependency updates

Shared versions live in the `catalog` in `pnpm-workspace.yaml`; owning packages reference them with `catalog:`. pnpm converts catalog and workspace references into ordinary versions when packing. Commit manifest changes and the regenerated lockfile together, then run `pnpm install --frozen-lockfile`, `pnpm deps:check` and the relevant package tests. CI audits moderate-and-higher advisories and validates peer dependencies. Dependency update PR automation is disabled for this experimental project; maintainers review upgrades together.

Newer major versions alone are not dependency defects. TypeScript 5.9.3 defines the current parser, checker and language-service contract; a TypeScript major migration needs conformance, compiler API, editor and independent consumer validation. The linter uses the ESLint 9 recommended rules to support both ESLint 9 and 10, tested with independently installed versions. VitePress 1.6.4 requires React 18 peers for its bundled DocSearch 3 integration; these exact versions are scoped to the docs package, while compiler and React example tests use React 19. Its Vite dependency is upgraded separately to patched Vite 6 through a scoped override. The declaration builder's optional Rspack peer exception applies only to `unplugin-dts`; Twill's Rspack 2 adapter is exercised directly. Revisit these constraints with upstream releases rather than replacing them with blanket peer or audit ignores.

The published `@swiftuijs/ui@0.1.1` example dependency imports React types without declaring their optional peer. A version-scoped `packageExtensions` entry repairs its installation metadata; it can be removed when the library declares the peer upstream. This does not change compiler behavior or add component-specific handling.
