# Build tools

Install `@swiftuijs/twill` as a development dependency in your application. Select the adapter for your existing bundler. Native TS/JS and Twill can share the graph; no component lists, wrapping APIs or Twill config file are needed.

Run `npm install --save-dev @swiftuijs/twill@0.3.1` or `pnpm add -D @swiftuijs/twill@0.3.1` from the application's directory containing `package.json`. Keep the host bundler and its existing scripts installed. For a new project, [getting started](./getting-started.md#build-with-vite) includes a complete Vite entry, configuration and run/build commands. The examples below show how to add Twill to an existing host setup.

The [optional runtime](./runtime.md) in 0.2.0 reads `runtime` from the common project configuration, or from the adapter options. External cleanup requires the runtime as a production dependency; inline remains the default.

For Node automation, see [shell scripting](scripting.md): the published loader executes Twill sources; 0.2.0 adds the optional Rust-backed subprocess SDK and executable-script runner.

Run `twill check` separately before production builds. Adapters emit code and source maps; they do not perform project type checking.

## Adapter support

All five adapters are exported by `@swiftuijs/twill` 0.2.0. Use the adapter for your host; installing another bundler is unnecessary.

| Host         | Import                     | Native TS/JSX emission   | Development validation in this checkout                    |
| ------------ | -------------------------- | ------------------------ | ---------------------------------------------------------- |
| Vite 8       | `@swiftuijs/twill/vite`    | Vite                     | Dev module reload; React Fast Refresh through `vite-react` |
| Rollup 4     | `@swiftuijs/twill/rollup`  | Twill adapter by default | Real watch builds, errors and recovery                     |
| Webpack 5    | `@swiftuijs/twill/webpack` | Twill adapter by default | Real watch builds, errors and recovery                     |
| Rspack 2     | `@swiftuijs/twill/rspack`  | Twill adapter by default | Real watch builds, errors and recovery                     |
| esbuild 0.28 | `@swiftuijs/twill/esbuild` | esbuild                  | Context watch and explicit incremental rebuilds            |

These are the tested host lines, not a guarantee for every host version or framework plugin combination. All adapters produce original-source maps and have real production-build coverage. See [tested versions](./readiness.md#tested-tool-versions).

**Configuration refresh in 0.2.0:** Twill refreshes configuration at each build and invalidates transformed modules when project or inherited JSX settings change, including optional config creation/deletion and recovery from invalid language config. Keep compiler and tooling on 0.2.0 or newer for this behavior. Explicit adapter options override project settings.

Watch rebuilds produce updated code. React/Vue state preservation requires the framework's own HMR integration; only the Vite React adapter's Fast Refresh is tested here. Run a separate `twill check` for type errors: source watch builds remain transpile-only.

## Vite

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import twill from '@swiftuijs/twill/vite';

export default defineConfig({ plugins: [twill()] });
```

Keep normal Vite development/build scripts. Vite handles native TS/JSX emission; Twill handles `.twill` and `.twillx`. Use your ordinary tsconfig JSX settings.

For React Fast Refresh, use the [React adapter](./frameworks.md#react-with-vite-8) instead of independently adding the base Twill and React plugins. Vue JSX and SFC behavior are described in [React and Vue](./frameworks.md#vue).

## Rollup

```ts
import twill from '@swiftuijs/twill/rollup';

export default {
  input: 'src/main.twill',
  plugins: [twill()],
  output: { dir: 'dist', format: 'es', sourcemap: true },
};
```

Keep your standard dependency resolution, CommonJS conversion and other Rollup plugins. The adapter emits local native TS/TSX/JSX by default, as well as Twill. Use the host's normal `rollup --watch` command when the Rollup CLI is installed, or its `watch()` API; keep the same adapter configuration.

Rollup 4.64's native Linux watcher can miss consecutive atomic replacements of a transform dependency, also reproducible without Twill. For editors that save by atomic replacement or filesystems with unreliable native events, configure `watch: { chokidar: { usePolling: true } }` in Rollup. Tests cover ordinary saves with its default watcher and atomic saves with polling. Twill does not enable polling globally.

## esbuild

```ts
import { build } from 'esbuild';
import twill from '@swiftuijs/twill/esbuild';

await build({
  entryPoints: ['src/main.twill'],
  bundle: true,
  outfile: 'dist/main.js',
  format: 'esm',
  sourcemap: true,
  plugins: [twill()],
});
```

esbuild keeps its native TS/JSX pipeline. Set normal platform, target and dependency externalization options for your application. For development, reuse the same options with a context:

```ts
import { context } from 'esbuild';
import twill from '@swiftuijs/twill/esbuild';

const build = await context({
  entryPoints: ['src/main.twill'],
  bundle: true,
  outfile: 'dist/main.js',
  sourcemap: true,
  plugins: [twill()],
});
await build.watch();
// Alternatively: await build.rebuild() for explicit incremental builds.
// Call await build.dispose() when your development task stops.
```

## webpack and Rspack

In an ESM configuration, add the matching adapter to the host's existing plugins:

```ts
// webpack.config.mjs
import twill from '@swiftuijs/twill/webpack';

export default {
  entry: './src/main.twill',
  plugins: [twill()],
  devtool: 'source-map',
};
```

```ts
// rspack.config.mjs
import twill from '@swiftuijs/twill/rspack';

export default {
  entry: './src/main.twill',
  plugins: [twill()],
  devtool: 'source-map',
};
```

Both adapters emit local native TS/TSX/JSX by default. Keep framework, CSS, assets and CommonJS handling in the host's standard configuration. Enable the host's normal `watch: true`, CLI watch command or `compiler.watch()` API. Close the watcher and compiler when an embedded build task stops.

## Avoid duplicate native emission

Vite and esbuild delegate native TS/JSX to the host by default. Rollup, webpack and Rspack enable the adapter's native emitter by default. If another plugin or loader already owns that work, use:

```ts
plugins: [twill({ nativeSources: false })];
```

`nativeSources: true` explicitly enables Twill's native emitter. Standard files retain their native syntax; they never acquire trailing-closure or implicit-return behavior.

Relative extensionless imports are resolved by default. `resolveExtensions: false` delegates that work to your existing resolver. Prefer explicit local extensions where host aliases cannot infer a Twill file. Package exports, aliases, dependency transforms and deployment behavior remain the host's responsibility.

Use normal tsconfig or file-level `@jsxImportSource` settings to choose the JSX runtime. Keep language settings consistent between the build and checker; ad hoc build-only overrides can otherwise make editor types differ from emitted code.

## Node ESM

For source execution without a bundler:

```sh
node --enable-source-maps --import @swiftuijs/twill/register src/main.twill
```

Use ESM for native entry modules (`"type": "module"` in package.json or an `.mjs` entry). The loader supports local ESM native TS/JS/Twill graphs and delegates dependencies to Node. It does not add tsconfig path-alias resolution or a CommonJS Twill loader. See [mixed-project Node behavior](./interoperability.md#node) and [debugging](./tooling.md#debug-node-code).

For libraries, pair a normal JS bundle with [declaration emission](./libraries.md). For application quality gates, use the [editor and tooling guide](./tooling.md#check-before-building).
