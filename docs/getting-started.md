# Getting started

Twill extends TypeScript and TSX with Swift-inspired syntax, using TypeScript's type system and compiling to ordinary JavaScript. Use `.twill` for TS (including ordinary JS syntax) and `.twillx` for TSX. Native `.ts`, `.tsx`, `.js` and `.jsx` files keep their usual syntax.

## Try it first

The [playground](./playground.md) runs the actual compiler in a browser worker. It shows generated TS/TSX without sending your source to a server. It does not execute code or type-check project imports.

## Choose your setup

| Your goal                                           | Start here                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Run a Node script, including `#!/usr/bin/env twill` | [Shell scripting: local and global installation](./scripting.md#what-to-install)               |
| Add a Twill module to an application                | Follow the installation and first-module steps below                                           |
| Use `Command` / `Subprocess` from ordinary JS/TS    | [Install the shell SDK](./scripting.md#use-the-sdk-in-ordinary-javascript); no compiler needed |
| Build a library for native JS/TS consumers          | Install the compiler below, then follow [libraries and declarations](./libraries.md)           |

Project-local installation is enough for application builds and package scripts. Global installation is optional, for a `twill` command on your terminal's PATH. The VS Code extension and AI skill do not install execution packages.

## Install

Use Node **24 LTS** for a new setup; the package supports `^20.19.0 || >=22.12.0`. Check your version with `node --version`.

Run commands from **your application root**, where `package.json` lives. Keep your existing manifest and configuration. For an empty directory, create a project first:

```sh
mkdir my-twill-app
cd my-twill-app
npm init -y
npm pkg set type=module
```

Install the compiler as a development dependency. These setup commands pin the published 0.2.0 baseline; keep optional Twill packages on that version too. When upgrading, update them together and commit your lockfile:

::: code-group

```sh [pnpm]
pnpm add -D @swiftuijs/twill@0.3.1
```

```sh [npm]
npm install --save-dev @swiftuijs/twill@0.3.1
```

```sh [Yarn]
yarn add --dev @swiftuijs/twill@0.3.1
```

:::

Twill compiles away at build time. Your application keeps its normal JavaScript runtime and framework dependencies. Default inline emission needs no additional language runtime. Install only the optional packages your application uses: the [shell SDK](./scripting.md#add-subprocess-execution) for subprocesses, or the [runtime helpers](./runtime.md) for explicitly selected external cleanup.

For editor completion, diagnostics and formatting, install [Twill from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=forth-ink.twill), or run `code --install-extension forth-ink.twill`. Follow the [VS Code setup](./tooling.md#set-up-vs-code) for configuration. The extension bundles its editing tools; the local compiler supplies builds and whole-project checks.

## Write and run your first module

Using a coding agent? Install the [official Twill skill](./ai.md) with `npx skills add swiftuijs/twill --skill twill` so it follows the supported syntax and project verification workflow.

Create a `src` directory if it does not exist. Save this as `src/numbers.twill`:

```twill
export const doubled = [1, 2, 3].map { value in
  value * 2;
};
```

Save this as `src/main.ts`:

```ts
import { doubled } from './numbers.twill';
console.log(doubled);
```

Run the entry with the local CLI; no bundler or tsconfig is needed for this first execution:

::: code-group

```sh [npm]
npm exec -- twill src/main.ts
```

```sh [pnpm]
pnpm exec twill src/main.ts
```

:::

Expected output is `[ 2, 4, 6 ]`. The runner loads both native TypeScript and Twill modules. See [shell scripting](./scripting.md) for arguments, shebangs and subprocesses.

## Check types

A basic `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"]
}
```

Save this as `tsconfig.json` in the application root, or add `src` to your existing configuration. Run the separate type check:

::: code-group

```sh [npm]
npm exec -- twill check -p tsconfig.json
```

```sh [pnpm]
pnpm exec twill check -p tsconfig.json
```

:::

A successful check exits with status 0. Running or bundling code does not check types. Native `tsc` cannot parse Twill source; native consumers can use [generated declarations](./libraries.md). Node scripts using `process`, `Buffer` or Node imports also need [Node type declarations](./scripting.md#type-check-your-scripts).

## Build with Vite

In your existing Vite application, keep its usual entry point and scripts and add the Twill adapter to `vite.config.ts`. Install Vite alongside the compiler if it is not already present. Other bundler configurations are in [build tools](./build-tools.md).

For a new Vite application, create the usual entry HTML as well. For this example, install Vite (`npm install --save-dev vite` or `pnpm add -D vite`) and save this as `index.html` in the application root:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Twill example</title>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Save the following as `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import twill from '@swiftuijs/twill/vite';

export default defineConfig({ plugins: [twill()] });
```

Add `"dev": "vite"` and `"build": "vite build"` to your package scripts. Run `npm run dev` or `pnpm run dev`, open the URL Vite prints and look in the browser console for `[2, 4, 6]`. Stop the dev server, then use `npm run build` or `pnpm run build` to produce `dist`.

For React state-preserving development, use the [React Vite integration](./frameworks.md). Component libraries use their ordinary APIs; no component registry or Twill wrapper is needed.

`twill.config.json` is optional. The default settings enable trailing closures, single-expression returns, `guard` and `defer`. JSX settings come from the project's normal `tsconfig.json` or a file-level `@jsxImportSource` pragma. Only create a Twill configuration when changing a language option, such as disabling implicit returns with `{ "implicitReturn": false }`. The [optional runtime](./runtime.md) in 0.2.0 also accepts `runtime: "inline" | "external"`; inline remains the default.

## Format and lint

Install the optional plugins alongside Prettier and ESLint. Keep Twill packages on the same version; formatter and linter dependencies include the matching compiler.

```sh
pnpm add -D @swiftuijs/twill-formatter@0.3.1 prettier @swiftuijs/twill-linter@0.3.1 eslint
```

`.prettierrc.json`:

```json
{ "plugins": ["@swiftuijs/twill-formatter"], "singleQuote": true }
```

`eslint.config.mjs`:

```js
import twill from '@swiftuijs/twill-linter';
export default [{ ignores: ['**/dist/**'] }, ...twill.configs.recommended];
```

```sh
pnpm exec prettier --write src
pnpm exec eslint src
pnpm exec twill check -p tsconfig.json
```

Use `recommendedTypeChecked` for type-aware linting; it requires a tsconfig and detects missing union cases in switches, even with a `default` branch. Add normal browser/Node globals for your application. VS Code's ESLint extension can validate `twill-typescript` and `twill-tsx`. See [practical patterns](./patterns.md) for validation, owned resources and explicit outcomes, and [tooling](./tooling.md) for safe fixes, debugging and diagnostics.

## Check before shipping

A build adapter emits JavaScript; it does not replace type checking. Add these scripts to your application's `package.json` alongside its existing build and test commands:

```json
{
  "scripts": {
    "typecheck": "twill check -p tsconfig.json",
    "lint": "eslint src",
    "format:check": "prettier --check src",
    "check": "twill check -p tsconfig.json && eslint src && prettier --check src"
  }
}
```

Run `pnpm run check` and your application tests before building in CI. Source diagnostics point back to the original Twill files.

### npm equivalents

The detailed guides use `pnpm` for project-local commands. If your project uses npm, translate them as follows; install each tool before invoking it:

| pnpm                      | npm                                |
| ------------------------- | ---------------------------------- |
| `pnpm add -D <package>`   | `npm install --save-dev <package>` |
| `pnpm add <package>`      | `npm install <package>`            |
| `pnpm exec <tool> <args>` | `npm exec -- <tool> <args>`        |
| `pnpm run <script>`       | `npm run <script>`                 |

Commands inside `package.json` use bare names such as `twill`, `eslint` and `prettier`; both package managers supply the project's local executables on PATH.

## Run Node code

For normal execution, use `npm exec -- twill src/main.ts` or `pnpm exec twill src/main.ts` as above. To register the loader explicitly in an existing Node ESM workflow, with the compiler installed locally:

```sh
node --enable-source-maps --import @swiftuijs/twill/register src/main.ts
```

The loader handles local mixed TS/JS/Twill imports. It does not transform dependencies or replace Node's CommonJS behavior.

## Adopt one module or export native sources

Keep native TS/JS files alongside Twill and start with a validation or resource-management task. The optional export package can export a checked source graph to a new native TS/TSX directory without modifying originals. See [gradual adoption and source export](./adoption.md) for the commands, dependency setup and export boundaries.

## Building Twill itself

Application users do not need to clone the Twill repository. If you want to build the packages from source or contribute to the language, use the [repository development guide](https://github.com/swiftuijs/twill/blob/main/docs/contributing/tooling.md).
