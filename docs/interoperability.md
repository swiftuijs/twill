# Mixed Twill, TypeScript and JavaScript projects

All source formats can coexist in one module graph. Twill imports native `.ts`/`.js`; native `.ts`/`.js` imports Twill. A mixed graph compiles to ordinary modules without an interop runtime, proxy functions or value conversion. Exported types and JSDoc participate in TypeScript checking; type-only imports erase normally. Re-exports, dynamic imports and cyclic ESM live bindings retain their ordinary behavior.

## Build and check

Install `@swiftuijs/twill` and use its `/vite`, `/esbuild`, `/rollup`, `/webpack` or `/rspack` plugin. Choose the integration that matches your existing build; the application entry can remain native TS or JS. Standard source stays standard: a native block after a call is not a trailing closure, and native functions named guard/defer keep normal behavior.

Vite/esbuild use their own native TS/JSX pipeline by default, avoiding duplicate compilation. Rollup/webpack/rspack enable Twill's standard TypeScript emitter for local `.ts`, `.mts`, `.tsx` and `.jsx`; it does not run the Twill parser on them. `nativeSources: false` delegates this work to another configured plugin/loader; `true` explicitly selects Twill's native emitter. Declaration files and npm dependencies are excluded from this emission. Existing CommonJS transformations remain the host's responsibility.

Use `twill check -p tsconfig.json`. Recommended settings for a source-only mixed application:

```json
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "checkJs": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022"
  },
  "include": ["src/**/*"]
}
```

Imported local dependencies are checked even when they are outside the include glob. The virtual checker permits explicit TS extensions because it does not emit a project. Native JS remains JS/JSDoc; `checkJs` controls diagnostics. A Twill export is fully typed in TS/JS consumers: no ambient `declare module '*.twill'` escape hatch is needed. Native `tsc` does not parse Twill; use Twill's checker and a supported build integration. `twill check` checks one project; use the [library declaration command](./libraries.md) for declaration emission and referenced declaration builds.

## Resolution

Use actual extensions for clear imports, such as `./helpers.ts`, `./format.js`, `./service.twill`, or `./view.twillx`. Relative extensionless paths search native files before Twill, then directory indexes. Keep distinct native TS/JS filenames: TypeScript's config discovery and `.js`-to-`.ts` substitution can prefer a same-stem TS file over JS. Explicit Twill extensions distinguish a dialect source from a native same-stem file.

Bare packages, package exports and host aliases retain host resolution. The checker delegates to TypeScript first; custom extensionless aliases require a host alias integration, or a full extension when resolution cannot infer it. The Node loader does not interpret tsconfig path aliases. Single-file `twill compile` preserves import specifiers; use a bundler to distribute a mixed graph.

## Node

Install the compiler in this application using [getting started](./getting-started.md#install). For ordinary script execution, run `npm exec -- twill src/main.js` or `pnpm exec twill src/main.js`. To register the loader explicitly in an existing Node ESM workflow:

```sh
node --enable-source-maps --import @swiftuijs/twill/register src/main.js
```

Any local ESM `.js`, `.ts`, `.mts` or Twill entry can start the graph. The loader emits standard JS for local ESM TS/TSX/JSX, including TS constructs such as enums that native type stripping cannot handle. It does not require native Node TS support, so the same graph runs on supported Node 20/22/24 versions. Native JS and CJS loading is delegated to Node; npm dependencies keep their normal loaders. Emitted JSX uses the project’s standard automatic JSX runtime setting, React by default; Vue component closures use its lazy slot runtime.

Loader emission targets ES2022, lowering native TypeScript `using` and `await using` even on Node 20. Native resource disposal composes with Twill's block-scoped `defer`; independent consumer checks verify their execution order. Include `ESNext.Disposable` in your TypeScript libraries when checking disposal APIs. Plain `.js` files retain the Node engine's own syntax support.

This integration supports ESM `import` and `import()`. Use dynamic `import()` to reach Twill from CommonJS. Static CommonJS `require()` of Twill and TypeScript `.cts` emission require separate host handling. Existing exports restrictions and non-resolution errors are preserved; fallback applies only to missing local modules/directory imports. Native TS and Twill frames both retain original filenames and line numbers under source maps.

## Editor

Install [Twill from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=forth-ink.twill), or use the [offline VSIX instructions](./tooling.md#set-up-vs-code). It automatically supplies cross-file types and mapped navigation for native TS/JS documents in projects with a tsconfig. If VS Code already has the project open during installation, restart its TS server. Hover, signatures, completion, diagnostics and definitions read the virtual mixed project, while Twill documents retain their own providers. Unsaved Twill and native TS/JS edits participate in the same mixed project. Definitions and related diagnostics map to original dialect files.

Other TS-server editors can load the installed npm package with this tsconfig setting:

```json
{ "compilerOptions": { "plugins": [{ "name": "@swiftuijs/twill" }] } }
```

The plugin is a CommonJS entry for TS-server loading; the compiler's ESM imports still use the package's normal exports. The bridge uses the Twill TypeScript 5.9 virtual checker and the native host's library paths. It adds a cached language service for configured mixed projects. Unchanged source versions retain snapshots and programs; it does not replace runtime execution. Other editors' unsaved dialect buffers need their own configuration integration. Auto-import edits, organize imports and rename also map across dialect boundaries; native TypeScript import-alias rename semantics are preserved. Unmappable edits are withheld. Formatting and general refactoring are not supplied by this bridge.

See the [mixed-source example](https://github.com/swiftuijs/twill/tree/main/examples/mixed) for a complete module graph. Configure your own application following [getting started](./getting-started.md) and the [editor guide](./tooling.md).

## Loader registration update (unreleased)

Published 0.3.0 uses asynchronous Node hooks and can emit DEP0205 on Node 26. The source migration prefers `module.registerHooks()` where available, retaining the old API only for engines without it. Supported Node versions and ESM-oriented emission remain unchanged. This does not add CommonJS Twill transpilation.

The CLI carries a private preload in `process.execArgv` so default and nested Workers can import Twill. Native worker bootstrap modules can import a `.twill` module normally. If you explicitly replace a Worker's `execArgv`, include `--import @swiftuijs/twill/register` and `--enable-source-maps` when those features are needed. The public preload itself is uncached. See [scripting](scripting.md) for the runner/cache boundary.
