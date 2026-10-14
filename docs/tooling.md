# Editor and tooling

For AI-assisted application development, install the [official Twill skill](./ai.md). It covers syntax choices, integrations, performance boundaries and checks for the project's installed toolchain.

Use Twill in your application's normal development loop: edit source, check types, format, lint and debug. The compiler and editor use your existing `tsconfig.json`; no `twill.config.json` is required.

Install the compiler, formatter/linter packages and VS Code extension following [getting started](./getting-started.md). The examples below run from **your application root**, with Twill installed locally.

For npm commands, replace `pnpm add -D` with `npm install --save-dev`, `pnpm exec <tool>` with `npm exec -- <tool>`, and `pnpm run` with `npm run`. Install each named tool locally before invoking it. The extension does not install the CLI or application dependencies. See [shell scripting](./scripting.md) for standalone scripts and global commands.

## Set up VS Code

Install [Twill from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=forth-ink.twill), published by **forth.ink** with extension ID `forth-ink.twill`. You can also install it from the command line:

```sh
code --install-extension forth-ink.twill
```

For offline installation, download `twill.vsix` from the matching [GitHub release](https://github.com/swiftuijs/twill/releases) and use **Extensions → Install from VSIX**. Open the application folder containing your tsconfig. `.twill` and `.twillx` are recognized automatically.

The extension provides completion, callback and React prop types, hover, signatures, definitions, references, diagnostics, automatic imports, mixed-file rename, import organization and safe quick fixes. Native TS/JS files can import Twill and participate in the same project. If the project was already open during installation, run **TypeScript: Restart TS Server**.

Include dialect files in your normal tsconfig, for example `"include": ["src/**/*"]`. Keep your usual framework types and JSX settings. You do not need ambient `declare module '*.twill'` declarations or component registration.

The editor supports common incomplete input, but arbitrary malformed syntax can interrupt semantic assistance. General refactoring and fix-all are unavailable; unmappable edits are withheld. Use `twill check` for whole-project checks.

### Format on save

The VSIX includes a formatter. Add this to `.vscode/settings.json` to select it explicitly:

```json
{
  "[twill-typescript]": {
    "editor.defaultFormatter": "forth-ink.twill",
    "editor.formatOnSave": true
  },
  "[twill-tsx]": {
    "editor.defaultFormatter": "forth-ink.twill",
    "editor.formatOnSave": true
  }
}
```

The bundled provider uses editor indentation and Prettier defaults. To apply a project's `.prettierrc`, use the standard Prettier extension with the installed Twill formatter plugin. Use that extension as the default formatter instead when choosing this workflow.

## Format your source

Install `@swiftuijs/twill-formatter` alongside Prettier 3.9:

```sh
pnpm add -D @swiftuijs/twill-formatter@0.3.1 prettier
```

Configure `.prettierrc.json`:

```json
{ "plugins": ["@swiftuijs/twill-formatter"], "singleQuote": true }
```

```sh
pnpm exec prettier --write src
pnpm exec prettier --check src
```

The plugin recognizes both dialect extensions and preserves their syntax. Native TS/JS keeps its normal parser. Invalid source produces a syntax diagnostic rather than being formatted into generated compiler code.

## Add ESLint

Install `@swiftuijs/twill-linter` alongside ESLint 9 or 10:

```sh
pnpm add -D @swiftuijs/twill-linter@0.3.1 eslint
```

Use a flat `eslint.config.mjs`:

```js
import twill from '@swiftuijs/twill-linter';

export default [{ ignores: ['**/dist/**'] }, ...twill.configs.recommended];
```

```sh
pnpm exec eslint src
pnpm exec eslint src --fix
```

Add your ordinary Node/browser globals and framework rules as in a native TS project. Diagnostics refer to original Twill source. Fixes are applied only where they can map safely; rewrites involving generated syntax may be unavailable.

For type-aware rules, replace `recommended` with `recommendedTypeChecked`. It requires a nearby tsconfig and checks native TS and Twill. Its switch-exhaustiveness rule requires every known union case even when a default exists. Run ESLint in CI to enforce this policy; it is separate from the compiler's expression-exhaustiveness check.

Custom rule overrides should match both dialect and virtual TS/TSX files:

```js
{
  files: ['**/*.{ts,tsx,twill,twillx}'],
  rules: { 'prefer-const': 'error' },
}
```

Use Microsoft's ESLint extension for editor lint feedback. In `.vscode/settings.json`, retain your existing languages and add the Twill IDs:

```json
{
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
    "twill-typescript",
    "twill-tsx"
  ]
}
```

## Check before building

A bundler emits code; it does not prove types or exhaustive union handling. Add application scripts to `package.json`:

```json
{
  "scripts": {
    "typecheck": "twill check -p tsconfig.json",
    "lint": "eslint src",
    "format": "prettier --write src",
    "format:check": "prettier --check src",
    "check": "twill check -p tsconfig.json && eslint src && prettier --check src"
  }
}
```

Run `pnpm run check` locally and in your CI before the application's build command. Keep your own application tests alongside it. The commands also work through equivalent npm or Yarn scripts.

See [build tools](./build-tools.md) for bundler setup and the [CLI reference](./cli.md) for command options.

## Inspect generated code and project diagnostics

From the command palette:

- **Twill: Show Generated TypeScript** opens readable lowered TS/TSX beside your source. It is an inspection view; builds retain the compiler's original source maps.
- **Twill: Show Project Diagnostics** displays the project's configuration, source counts, versions and diagnostics.

A scriptable report is available from your application root:

```sh
pnpm exec twill doctor -p tsconfig.json --json
```

The report contains filenames, compiler settings and diagnostic text. A project with errors returns a nonzero status. Review the report before sharing it outside your team.

## Debug Node code

Install `@swiftuijs/twill` in the application and use the supported Node ESM loader:

```sh
node --enable-source-maps --import @swiftuijs/twill/register src/main.twill
```

**Twill: Debug Current File** runs the selected file with this loader in VS Code's built-in Node debugger. Set normal breakpoints in your Twill source. The command executes the application; resource access and environment variables follow your application settings.

For a fixed entry point or custom environment, use `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Twill application",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/src/main.twill",
      "cwd": "${workspaceFolder}",
      "runtimeArgs": ["--enable-source-maps", "--import", "@swiftuijs/twill/register"],
      "sourceMaps": true
    }
  ]
}
```

Original-source breakpoints and stack frames use compiler maps. The loader supports local ESM mixed imports; it does not install a CommonJS Twill loader or transform npm dependencies. See [mixed projects](./interoperability.md#node).

## Debug browser and framework applications

Use your normal browser, React or Vue developer tools. Enable source maps in the host build as needed. Twill emits ordinary framework code, so there is no separate runtime inspector to install.

Use the [React Vite adapter](./frameworks.md) for state-preserving development. Vue SFCs and host-specific SSR behavior use the framework's standard integrations.

## Troubleshooting

| Symptom                                          | Check                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `tsc` rejects a Twill file                       | Use `twill check`; native `tsc` cannot parse the dialect                                           |
| Native TS imports have missing Twill types       | Open the application folder with its tsconfig, install the extension, then restart TS Server       |
| Component or callback suggestions are incomplete | Confirm framework types and JSX settings; fix nearby syntax errors and inspect project diagnostics |
| Formatting ignores `.prettierrc`                 | Use the project Prettier plugin/extension; the bundled provider uses its own defaults              |
| ESLint skips Twill files                         | Load the Twill flat config and add both Twill language IDs to `eslint.validate`                    |
| A rename or fix is unavailable                   | The edit may cross generated syntax and cannot be applied safely                                   |

See [support and limitations](./readiness.md) for tested versions and [libraries](./libraries.md) to distribute ordinary JS and declarations.

## Highlight code on the web

Use the [web highlighting package](./highlighting.md) for static or browser-rendered code blocks. It integrates with Shiki and VitePress independently of the VS Code extension.

## Branch bindings and match tooling (0.2.0)

Twill 0.2.0 also supports `if const` branch bindings across the checker, formatter/standalone, ESLint, shared grammar, declarations/export and packaged editor. Original binding tokens move into the native success scope, preserving narrowing, completion, diagnostics and safe local rename; outer names in the initializer and else keep their own references. Required grouping around initializer trailing calls survives formatting. See [syntax and status](syntax.md#branch-nullish-bindings).

Twill 0.2.0 supports formatting and highlighting `match (state) { case State.loaded({ value }): value; default: 0; }`, checked descriptors and bindings, mapped navigation/completion, native export and declarations. Descriptor method rename is withheld because its name determines the literal tag; owner/import aliases and local bindings can be edited safely. Typed ESLint still reports omitted variants but withholds native statement-case suggestions inside match/switch expressions. Safe source edits remain available. See [syntax and status](syntax.md#match-expressions); use 0.2.0 or newer.
