# RFC 0025: Mixed-project checking and editor bridge

**Status:** Implemented (retrospective specification).
**Kind:** Tooling. **Release:** 0.1.2. **Dependencies:** Implemented language RFCs.

## Problem and native baseline

Native tsc cannot parse dialect files, and a transpile-only build loses semantic checks. Twill must support ordinary TS/JS consumers and editor navigation across the same project rather than maintaining separate types.

## Design

TwillProject loads normal tsconfig options and presents generated TS/TSX snapshots with composed original-source diagnostics. Twill check checks the mixed project, including generated never checks. Native files retain TS/JS/JSDoc checking. The VS Code language host and bundled TS-server bridge synchronize unsaved dialect files and supply cross-file types, definitions, references, rename, imports and safe fixes. TypeScript 5.9 defines the current semantic baseline.

No application code executes during language assistance. Strict syntax diagnostics remain visible when limited incomplete-input recovery cannot produce semantic assistance. Unsafe/unmappable edits are withheld; general refactoring and fix-all are unavailable. Avoid real files using the reserved virtual suffix, such as helper.twill.ts beside helper.twill.

## Lowering and interoperability

Cache unchanged transforms/snapshots, refresh affected disk files and rebuild on configuration changes. Token mappings must distinguish source-backed text from generated-only code. The private bridge ships in the VSIX and is not a public npm language runtime. Emitted native declarations expose types outside dialect-aware tooling.

## Compatibility and alternatives

Checking generated files with native tsc is an alternative but loses original source coordinates. Build success alone is not checking. Arbitrary workspace TS versions and native incremental tsc --build are not guaranteed.

## Validation and completion

[Project](../../packages/twill/tests/project.test.ts), [editor](../../packages/twill/tests/editor.test.ts), [TS plugin](../../packages/twill/tests/typescript-plugin.test.ts) and [real VSIX host](../../editors/vscode/tests/host.ts) tests cover mixed files, unsaved edits, mapped fixes and diagnostics. Validate invalid source, cache refresh, configuration changes and minimum/current editor hosts.

## Decision history

Retrospective specification; broader refactors require a separate amendment.

## Host TypeScript amendment (source implementation, unreleased)

The VS Code extension reuses the TypeScript engine and standard-library declarations installed with the built-in `vscode.typescript-language-features` extension. Resolve that engine relative to the built-in extension's installation, including remote extension hosts; do not load executable code from a project's `typescript.tsdk` setting. The existing extension dependency guarantees the built-in extension is available. The CLI and npm compiler retain their independently installed TypeScript dependency and 5.9 baseline; the dialect parser's supported syntax does not expand when the editor ships a newer engine.

The native TS-server bridge uses the `typescript` instance passed to its plugin initializer, including when VS Code selects a workspace TS server. Its bundled project/editor imports must use that same instance. Initialize the bridge bundle inside the plugin factory so top-level TypeScript enum references are evaluated only after the host engine exists. Keep each initializer's module state isolated; do not patch Node's resolver or store an engine in process-global state.

Remove the engine and declaration copies from the VSIX. This reduces installation/download bytes, but does not by itself eliminate either host's language-service instance or establish lower runtime memory. Preserve mixed-file diagnostics, mappings, completion, navigation, formatting, debugging and unsaved overlays. Validate the actual extracted VSIX in the minimum supported VS Code 1.95.3 (TypeScript 5.6) and current stable hosts, and exercise the bridge with real TS-server protocol probes. Arbitrary workspace engine versions remain outside the guaranteed compatibility range. Packaging rejects accidentally reintroduced engine/declaration copies and keeps its compressed size budget.
