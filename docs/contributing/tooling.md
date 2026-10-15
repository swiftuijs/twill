# Repository development

Use Node 22.13+ and the pnpm version pinned in the root `packageManager`. `corepack enable` enables pnpm where Corepack is available; otherwise install that pnpm version separately. The distributed compiler also supports Node 20.19+; the repository build/test tools require Node 22+.

## Layout

| Workspace            | Role                                                                                                 | Build                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/twill`     | Public `@swiftuijs/twill`: compiler, CLI, checker, Node loader, shared editor API and build adapters | Vite library mode emits ESM and the CJS TS-server entry; `vite-plugin-dts` emits tool API declarations                                             |
| `packages/formatter` | Public `@swiftuijs/twill-formatter`: Prettier plugin                                                 | Vite library mode and API declarations                                                                                                             |
| `packages/linter`    | Public `@swiftuijs/twill-linter`: ESLint processor and recommended configs                           | Vite library mode and API declarations                                                                                                             |
| `packages/highlight` | Public `@swiftuijs/twill-highlight`: browser/SSR Shiki integration and shared TextMate grammars      | Vite library mode and API declarations                                                                                                             |
| `packages/export`    | Optional public `@swiftuijs/twill-export`: checked source export to native TS/TSX                    | Vite library mode, CLI and API declarations                                                                                                        |
| `examples/*`         | Eight private applications/libraries, each with its own manifest                                     | Local Vite configurations; library adds declaration emission                                                                                       |
| `editors/vscode`     | VS Code extension, internal tsserver bridge and TextMate grammars                                    | Vite builds separate CJS extension/tsserver modules; preparation copies declarations, schemas and licenses; VSIX staging generates the loader shim |
| `apps/docs`          | Private VitePress site, English reference, local search and compiler worker playground               | VitePress static site; shared `docs/` references                                                                                                   |
| Root                 | Workspace coordination, shared configuration and release gates                                       | Private pnpm workspace coordinator; not a published package                                                                                        |

Workspace dependencies order builds and use public compiler exports. Vite 8 uses Rolldown for repository bundles; there is no separate tsup/esbuild build pipeline. esbuild remains a supported consumer adapter and is used in adapter/native-output tests. Examples exercise ordinary functions, cleanup, mixed TS/JS, React and Vue. No compiler special case exists for `@swiftuijs/ui`.

Handwritten tooling and editor sources use `.twill`; their Vite builds use `@swiftuijs/twill/vite`, type checks use `twill check`, and public declarations use `twill declarations`. The compiler's own JS/TS API retains `vite-plugin-dts`. See [developing tooling in Twill](./dogfooding.md) for the complete bootstrap boundary and import rules. Production SDK dependencies remain independent of the compiler.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build                # all workspace bundles and compiler declarations
pnpm check                # build, typecheck, tests, consumer checks, packaged VSIX probes
pnpm format:check
pnpm test:coverage
pnpm editor:coverage     # source coverage from the shipped VSIX in a real host
pnpm package:core         # swiftuijs-twill-0.1.0.tgz at the root
pnpm editor:package       # dist/twill.vsix
pnpm editor:test          # real VS Code extension-host tests against the VSIX
# Headless Linux:
xvfb-run -a pnpm editor:test
```

`pnpm --filter @swiftuijs/twill build` builds only the compiler. `pnpm editor:build` builds the editor and its compiler/bridge dependencies. Fresh workspace imports need a build because they deliberately resolve through package exports. No npm lockfile or hoisted workspace installation is required. An independent npm consumer still installs and validates the public tarball as part of `pnpm test:package`.

Coverage scopes, regression gates and edge-case contracts are described in [testing](./testing.md).

## Example and editor checks

All eight [examples](../../examples/README.md) are private workspace packages with their own dependencies and tests. Run `pnpm test:examples` for execution and real component rendering. `pnpm --filter @swiftuijs/twill-example-react dev` starts the React example.

Real extension-host tests load the extracted VSIX, request providers, apply completion/import/rename/quick-fix edits to unsaved documents and inspect original-source breakpoints. Use `pnpm editor:package` followed by `pnpm editor:test`; Regular CI runs stable with coverage; releases and manual compatibility validation also run VS Code 1.95.3. `TWILL_TEST_VSCODE_VERSION` selects a download; `TWILL_TEST_VSCODE_PATH` uses a local executable.

Application setup belongs in the user [editor guide](../tooling.md), [CLI reference](../cli.md) and [library guide](../libraries.md).

## Build installable artifacts

```sh
pnpm package:core
pnpm package:tooling
pnpm editor:package
pnpm test:packed
pnpm release:manifest
```

The seven tarballs, including the optional runtime and shell prototypes, and `dist/twill.vsix` can be installed into an independent application. Public package consumer tests must pass without workspace symlinks or hoisted development dependencies. See [releasing](./releasing.md) for review and publication.

## Benchmark changes

```sh
pnpm benchmark --output compiler-results.json
pnpm benchmark:project --output project-results.json
pnpm benchmark:branching --output branching-results.json
pnpm benchmark:enum-patterns --output enum-patterns-results.json --verify-performance
pnpm benchmark:runtime --output runtime-results.json --verify-performance
pnpm --filter @swiftuijs/twill test:size --output ../../bundle-results.json
```

Compare equivalent native/dialect behavior on the same project and machine. Published [performance results](../performance.md) describe workload scope and limitations; retain environment and build identity with new reports.

## Documentation workspace

`apps/docs` is an independent private package. Canonical Markdown remains in `docs/`; the site consumes it directly, avoiding duplicated references. VitePress uses a scoped, security-patched Vite 6 dependency for the site. Core, tooling, editor and examples retain their Vite 8 builds.

```sh
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
pnpm test:browser # build first; Chromium must be available
```

User-facing pages live directly under `docs/`. `docs/contributing/` and `docs/rfcs/` remain repository references and are excluded from the site, search and sitemap.

The canonical site is `https://twill.evecalm.com` with a default base of `/`; set `TWILL_DOCS_BASE` for another deployment path. GitHub Pages deploys the built `apps/docs/dist` artifact on main updates. Configure the repository Pages source as GitHub Actions and its custom domain as `twill.evecalm.com`; see [domain configuration](./releasing.md#documentation-domain). Local search stays in the browser; the Playground uses a reusable, time-limited worker with live compilation and highlighted editors and performs syntax lowering only. It does not upload source, execute input or supply project type diagnostics.

## CI workflows

`CI` uses conservative complete-diff change selection. Documentation-only PRs retain site/type/coverage/skill/browser checks. Code PRs retain full Linux verification and minimum-Node installed consumers; shell/compiler/runner/dependency/build changes also run real Linux glibc/musl, Mac and Windows process/runner contracts with x64/ARM64 Node. Unknown paths or missing history select everything. Scope-selection tests fail the stable required `verify` check on failure. Main, weekly, manual and release runs select all checks. Node dependency caches accelerate builds; no Rust toolchain, prebuilt addon or native artifact assembly is required. See [testing](testing.md).

The `Extended validation` workflow is manual: select compatibility checks for Windows, macOS, Node 24 and the minimum supported editor, or benchmarks for timing reports. Use it before a release and when changing platform-sensitive behavior.

Core/release macOS validation pins `macos-15` for actual ARM64 execution and `macos-15-intel` for x64. Floating `macos-latest` can migrate between image generations; pinned labels keep the official build environment reproducible. The ARM64 Node architecture check, real process suite and installed consumers remain required.

Pushing a reviewed `v*.*.*` release tag launches full platform/minimum-editor validation and uploads its exact tested tarballs and VSIX to GitHub Release without another build. The workflow can also be dispatched manually at the tag; npm and Marketplace publication remain separate authorized actions. Documentation deployment builds independently, triggered by site content, compiler/formatter/highlighter dependencies, shared dependency manifests or its own workflow; it can also be run manually.

The shell SDK is a separate Node-only package using Node spawn/streams with zero production dependencies. Build via its Twill adapter and declaration emitter, test real processes/coverage, and pack with `pnpm package:shell`. Keep its 16 KiB archive gate and independent Node 20.19 consumer. Run the complete public comparison in [release validation](releasing.md), retaining seven warm and both default-pool gates. `benchmark:shell` is a smaller cross-platform diagnostic. Published 0.2.0 still uses the retired native addon; historical source/reports remain in that tag.
