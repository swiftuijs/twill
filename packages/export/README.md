# <img src="https://twill.evecalm.com/logo.png" alt="Twill hummingbird" align="right" width="40" height="40" /> Twill source export

[![npm version](https://img.shields.io/npm/v/%40swiftuijs%2Ftwill-export)](https://www.npmjs.com/package/@swiftuijs/twill-export)
[![npm monthly downloads](https://img.shields.io/npm/dm/%40swiftuijs%2Ftwill-export)](https://www.npmjs.com/package/@swiftuijs/twill-export)
[![CI](https://img.shields.io/github/actions/workflow/status/swiftuijs/twill/ci.yml?branch=main&label=CI)](https://github.com/swiftuijs/twill/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/%40swiftuijs%2Ftwill-export)](https://github.com/swiftuijs/twill/blob/main/LICENSE)

`@swiftuijs/twill-export` exports checked Twill projects to native TS/TSX. Twill is a TypeScript-based language with Swift-inspired syntax extensions. The package supplies the optional `twill export` subcommand and a programmatic API; applications do not ship it. Node 20.19+ or 22.12+ is required.

Install the compiler and optional export package into your application, then run:

```sh
pnpm add -D @swiftuijs/twill @swiftuijs/twill-export
pnpm exec twill export -p tsconfig.json -o ../native-project --dry-run --json
pnpm exec twill export -p tsconfig.json -o ../native-project
pnpm exec tsc -p ../native-project/tsconfig.json
```

The compiler provides the `twill` executable. It loads this package only when you run `twill export`; there is no separate export executable.

Use a **new directory outside the input project**. Original sources and configuration remain intact. The tool rejects an existing destination, overlapping directories, output filename and module-resolution collisions (including case-only collisions), escaping symlinks and type/syntax errors. Preflight completes before output creation; caught write failures remove the newly created incomplete output.

The export contains the checked source graph, local declarations, directly imported local assets and a flattened native checking config. `.twill` becomes `.ts`; `.twillx` becomes `.tsx`. Relative literal imports, re-exports, type imports and dynamic imports are rewritten in both dialect and native files. Extensionless imports retain their spelling. Ordinary strings and comments remain unchanged. Dialect output is formatted with Prettier; native sources retain their layout except for rewritten module literals.

The checking config preserves resolved TS options and project-local path settings, enables native TS extension imports and removes Twill TS-server plugins. It uses explicit files and `noEmit`; choose your own normal bundler/emission configuration afterward. Generated files use native TS coordinates, without maps to the old Twill source.

## Boundaries

- This exports sources, not a complete application installation. Package manifests, dependencies, bundler/plugin configuration, public folders and indirectly referenced assets are not copied. Install normal dependencies in the destination or merge the exported sources into an existing native project.
- One configured source project is supported. Project references and sources outside its root fail before writes; use a shared source configuration covering the desired graph where appropriate.
- Computed dynamic import paths, CommonJS dialect imports and dialect-specific `import.meta.glob` patterns require explicit ES module paths before export. The tool does not guess runtime paths.
- Explicit dialect extensions in aliased imports need relative paths before export. Same-stem native/dialect modules need distinct names so TS/JS extensionless resolution cannot change after renaming.
- Path aliases inherited without an explicit `baseUrl`, or path-valued compiler settings outside the source root, fail with a diagnostic. Native TypeScript/framework runtime settings remain the application's responsibility.
- Formatting is for readable native source. Compiler/build source maps remain the appropriate way to debug the original Twill project.

## API

```ts
import { exportProject } from '@swiftuijs/twill-export';

const result = await exportProject('/app/tsconfig.json', {
  outDir: '/native-app',
  dryRun: true,
});
console.log(result.diagnostics, result.files, result.written);
```

Source errors return diagnostics and `written: false`. Invalid destinations and unsupported export constructs throw. `--json` provides the same structured result; failures return a nonzero CLI status.

[Guide](https://twill.evecalm.com/adoption) · [CLI reference](https://twill.evecalm.com/cli) · [Issues](https://github.com/swiftuijs/twill/issues) · MIT licensed · Built by [forth.ink](https://forth.ink).

## Added in 0.2.0

Twill 0.2.0 adds `if const value = lookup() { use(value); }` with branch-local nullish bindings and native destructuring. Group trailing calls in initializers, following Swift’s condition boundary. It emits native branches without a helper, closure or optional wrapper. See [syntax](https://twill.evecalm.com/syntax#branch-nullish-bindings) and [RFC 0018](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0018-optional-branch-bindings.md).

Twill 0.2.0 includes associated-value enums and `match` expressions: `match (state) { case State.loaded({ value }): value; default: 0; }`. Named payload bindings and erased factory descriptors compile to native switches without calling factories. Native switch statements retain JS fallthrough; match and switch expressions return one result without fallthrough. Use the coordinated 0.2.0 packages and extension. Compiler, formatter, linter, highlighter, export and editor changes are validated together. See [syntax and compatibility](https://twill.evecalm.com/syntax#match-expressions) and [RFC 0016](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0016-pattern-matching.md).

The optional `runtime: "external"` compiler mode in 0.2.0 is preserved during export. Its native sources retain the versioned `@swiftuijs/twill-runtime` helper import; install that production dependency in the destination. Default inline export stays self-contained. Export does not copy dependencies or rewrite package manifests. See [runtime modes](https://twill.evecalm.com/runtime).

## Development

This package's implementation uses Twill and emits ordinary JavaScript. Build and check a checkout with the workspace tools; see [developing tooling in Twill](https://github.com/swiftuijs/twill/blob/main/docs/contributing/dogfooding.md) for bootstrap and contribution instructions.
