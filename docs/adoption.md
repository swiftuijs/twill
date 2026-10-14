# Adopt Twill gradually

Start with a module whose control flow benefits from explicit validation or cleanup. Keep the existing TS/JS project, libraries and framework configuration. Twill files and native files can import each other; `twill.config.json` is optional.

## Choose a useful first task

Good candidates are request validation, nullable lookup results, owned file/transaction workflows and callback-based data processing. [Practical patterns](./patterns.md) show a ledger importer with expected errors, overflow checks, awaited release and cooperative cancellation. The [general example](../examples/general/workflow.twill) has execution tests for those failure paths.

For stateful business logic, native TS discriminated unions and switch expressions expose omitted cases through `twill check` when a state is added. `recommendedTypeChecked` linting additionally checks native switch statements and explicit-default coverage. Configure lint in CI to enforce that policy. Twill's guard statements require explicit exits; nullish bindings preserve zero and false. Neither mechanism replaces runtime validation of untrusted data.

## Keep the development loop complete

1. Install the compiler and VS Code extension following [getting started](./getting-started.md).
2. Add the Twill plugin to the application's ordinary build tool. Rename one module to `.twill` or `.twillx` and update explicit imports.
3. Include the files in the normal tsconfig. Run `twill check`, ESLint and Prettier in CI. Keep native framework types and runtime behavior.
4. Verify the task's success, failure, cancellation and cleanup paths. Use source breakpoints and the generated-source view when diagnosing lowering.
5. Compare editor responsiveness, build time and emitted code with the previous module on the same project and machine.

The packaged editor supports original-source definitions, references, completion, rename and conservative edits across unsaved mixed sources. General refactoring and fix-all remain outside its support contract. See [support and limitations](./readiness.md).

## Export back to native TS

Install the optional `@swiftuijs/twill-export` package at the same version as the compiler. It supplies `twill export`, which exports a checked source graph into a new directory:

```sh
pnpm add -D @swiftuijs/twill-export@0.3.1
pnpm exec twill export -p tsconfig.json -o ../native-project --dry-run --json
pnpm exec twill export -p tsconfig.json -o ../native-project
```

It formats lowered TS/TSX, rewrites relative dialect imports in both native and dialect sources, copies local declarations/direct imported assets and flattens TS configuration. The destination must be outside the input root and must not exist. Errors and collisions prevent writes; originals remain intact.

Install the project's normal dependencies in the destination or merge the sources into an existing native application. Use native `tsc` and normal build tools afterward. Default inline export needs no Twill runtime or compiler plugin. The [external runtime mode](./runtime.md) preserves its helper import and requires the runtime in the destination; export does not install it or alter manifests. React/Vue and any application libraries retain their ordinary requirements.

This is a source export. It does not copy package manifests, bundler configuration, public folders or every indirectly referenced asset. Project references, sources outside the root and computed dynamic module paths need an explicit migration plan. See the [export package](../packages/export/README.md) for exact boundaries. Single-file `twill compile` remains an inspection tool and preserves its input import specifiers.

## Decide whether adoption is worthwhile

Evaluate real maintenance tasks: understand an early-exit path, add a business outcome, change a resource lifetime and diagnose an asynchronous failure. Record setup effort, editor failures, review clarity and whether omissions are caught before execution. Compare the same changes in native TS, including native validation/result libraries.

Fewer lines alone do not establish a benefit. Twill is worthwhile for a team when the clearer flow and error prevention outweigh its tooling costs. The [performance guide](./performance.md) gives reproducible measurements and runtime costs; synthetic results do not substitute for the application's workload.
