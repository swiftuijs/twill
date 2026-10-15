---
title: 'Build libraries and declarations with Twill'
description: 'Publish Twill-authored libraries as ordinary JavaScript and TypeScript declarations, with native consumer imports and explicit runtime dependencies.'
---

# Libraries and declarations

Build a Twill library as ordinary JavaScript with standard TypeScript declarations. Consumers can import it from native TS/JS without a Twill compiler or editor extension.

Install the reviewed compiler in your library project following [getting started](./getting-started.md), alongside Vite. The examples below describe **your library's configuration**, not Twill's repository build.

From your library's root (create `package.json` with `npm init -y` if needed), run `npm install --save-dev @swiftuijs/twill@0.3.1 vite` or `pnpm add -D @swiftuijs/twill@0.3.1 vite`. Set `"type": "module"` in the manifest for the ESM configuration below. Then create the listed files before running the package scripts.

Twill's own tooling packages use this workflow: their repository sources are `.twill`, while consumers load ordinary JavaScript and `.d.ts` declarations. Writing a library in Twill does not require its consumers to install the compiler. The shell SDK similarly keeps Twill as a development dependency; the SDK uses Node directly with zero production dependencies.

## Write the public API

`src/index.twill`:

```twill
export function doubled(values: readonly number[]): number[] {
  return values.map { value in
    value * 2;
  };
}
```

Your sources can import local native TS/JS and normal npm packages. Follow [mixed-project resolution](./interoperability.md) when choosing extensions and aliases.

## Build JavaScript

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import twill from '@swiftuijs/twill/vite';

export default defineConfig({
  plugins: [twill()],
  build: {
    lib: { entry: 'src/index.twill', formats: ['es'], fileName: 'index' },
    target: 'es2022',
    sourcemap: true,
  },
});
```

The [external runtime mode](./runtime.md) requires `@swiftuijs/twill-runtime` in a compiled library's production dependencies. Native public declarations do not expose the cleanup helper; type-only consumers need no runtime. Inline emission remains self-contained.

Choose your normal externals and peer dependencies for framework or application libraries. Twill does not introduce a framework dependency into an ordinary callback library.

## Emit declarations after the JS build

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"]
}
```

`package.json` scripts:

```json
{
  "scripts": {
    "typecheck": "twill check -p tsconfig.json",
    "build": "vite build && twill declarations -p tsconfig.json -o dist"
  }
}
```

Run `npm run typecheck`, then `npm run build` (or `pnpm run typecheck`, then `pnpm run build`). Vite may clear its output directory at the start of a build, so emit declarations afterward.

The declaration command checks the project and emits `.d.ts` plus composed `.d.ts.map` files. Module specifiers use ordinary `.js` / `.mjs` / `.cjs` names. Maps point to original Twill/native sources; include those sources in the package if consumers need navigation into them.

Do not emit same-basename native and Twill modules to the same destination; collisions are rejected. Type errors prevent writes for the failing declaration project.

## Export native entry points

Configure the published package:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"]
}
```

A native TS/JS consumer can now use the normal package API:

```ts
import { doubled } from 'your-library';
const values: number[] = doubled([1, 2, 3]);
```

This example publishes ESM. Other output formats need their own host build and matching package exports; a CommonJS source loader is not supplied by Twill. Verify the packed library in an independent consumer before publishing.

## Referenced declaration projects

```sh
pnpm exec twill declarations -p tsconfig.json --build --json
```

`--build` traverses tsconfig references in dependency order and consumes their declarations. Referenced projects use their configured `declarationDir` / `outDir`, otherwise `dist`. `-o` overrides only the root project's declaration directory, relative to the current directory.

Circular references fail. Dependencies successfully emitted before a later failure remain on disk. This emits declarations only: there is no incremental cache, `.tsbuildinfo` or JS project build. Native `tsc --build` cannot parse Twill, and `twill check` checks a single project rather than building references.

See [CLI options](./cli.md#emit-library-declarations) and the [example library](https://github.com/swiftuijs/twill/tree/main/examples/library) for a complete reference.
