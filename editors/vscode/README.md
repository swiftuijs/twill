# <img src="https://twill.evecalm.com/logo.png" alt="Twill hummingbird" align="right" width="40" height="40" /> Twill for VS Code

[![Release version](https://img.shields.io/github/v/release/swiftuijs/twill)](https://github.com/swiftuijs/twill/releases/latest)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-install-007ACC)](https://marketplace.visualstudio.com/items?itemName=forth-ink.twill)
[![CI](https://img.shields.io/github/actions/workflow/status/swiftuijs/twill/ci.yml?branch=main&label=CI)](https://github.com/swiftuijs/twill/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/swiftuijs/twill)](https://github.com/swiftuijs/twill/blob/main/LICENSE)

**Write clearer JavaScript and TypeScript, with the editor tools you already expect.**

Twill is a TypeScript-based language with Swift-inspired syntax extensions. It extends TypeScript and TSX, using TypeScript's type system and adding: readable callbacks, explicit early exits, cleanup beside resource acquisition, and checked handling of business states. You write `.twill` or `.twillx` files; the Twill compiler turns them into ordinary JavaScript, using your existing libraries and framework runtimes.

This extension helps you **write, understand and debug Twill in VS Code**. It provides syntax highlighting, TypeScript completion and error checking, navigation, formatting and Node debugging. Use it for scripts, backend code, data processing, React or Vue applications.

[Try the playground](https://twill.evecalm.com/playground) · [Documentation](https://twill.evecalm.com/) · [Report an issue](https://github.com/swiftuijs/twill/issues)

Twill 0.3.0 reuses document text by version and shares recovered compilation with strict diagnostics, reducing repeated work as you edit. Native TS/JS integration still receives immediate complete unsaved-source snapshots. These are workload-specific improvements; see [performance](https://twill.evecalm.com/performance) for measurements and remaining limits.

## What does Twill look like?

An ordinary TypeScript callback chain:

```typescript
const activeNames = users.filter((user) => user.active).map((user) => user.name);
```

The same operation in `main.twill`:

```typescript
const activeNames = users.filter { .active }.map { .name };
```

Here, `.active` and `.name` refer to the callback's first argument. You can also name parameters explicitly: `[1, 2, 3].map { value in value * 2 }`. These callbacks compile to ordinary arrow functions, with contextual types inferred from the existing API.

Twill also helps with control flow:

```typescript
function greeting(name: string | undefined): string {
  guard const value = name else {
    return 'Hello, guest';
  }
  return `Hello, ${value.toUpperCase()}`;
}
```

`guard` makes the failure path exit immediately. After the guard, TypeScript knows `value` is a string. Twill's other features include block-scoped `defer` for cleanup and switch expressions checked against ordinary TypeScript unions. See [practical patterns](https://twill.evecalm.com/patterns) for examples and [language semantics](https://twill.evecalm.com/syntax) for the exact rules.

## What can I do with this extension?

| While you work                | The extension helps you                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Write a callback or component | Get parameter, member and React prop suggestions, plus signature help                     |
| Read unfamiliar code          | Hover for types, jump to definitions and find references                                  |
| Catch mistakes                | See syntax and TypeScript errors at their original source locations                       |
| Change code                   | Rename symbols across Twill and native TS/JS, organize imports and apply safe quick fixes |
| Keep source consistent        | Format documents or enable format-on-save                                                 |
| Understand compilation        | Open the generated TypeScript beside your source                                          |
| Diagnose Node code            | Set breakpoints in the original Twill file and inspect stack frames                       |

The extension includes its editing tools. To **run or build your application**, install the compiler package, `@swiftuijs/twill`, in that application. The compiler also provides `twill check` for whole-project checking.

## Your first Twill program

This walkthrough creates a small Node application. It requires **Node 20.19+ or 22.12+** and **VS Code 1.95.3+**. You can also explore the syntax without installing anything in the [browser playground](https://twill.evecalm.com/playground).

### 1. Install the extension

In VS Code, open **Extensions**, search for **Twill** by **forth.ink**, and click **Install**. Or use:

```sh
code --install-extension forth-ink.twill
```

### 2. Create a project and install the compiler

Run these commands in your terminal:

```sh
mkdir twill-demo
cd twill-demo
npm init -y
npm pkg set type=module
npm install --save-dev @swiftuijs/twill
mkdir src
```

Open the `twill-demo` folder in VS Code. If you use pnpm, the compiler installation command is `pnpm add -D @swiftuijs/twill`.

### 3. Add your source and TypeScript settings

Create `src/main.twill`:

```typescript
const users = [
  { name: 'Ada', active: true },
  { name: 'Linus', active: false },
  { name: 'Grace', active: true },
];

const activeNames = users.filter { .active }.map { .name };
console.log(activeNames);
```

Create `tsconfig.json` in the project root:

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

Twill uses your normal TypeScript settings. No `twill.config.json` is needed. Existing projects can keep their tsconfig and include Twill files alongside their TS/JS files.

In the editor, hover over `activeNames` to see its inferred `string[]` type. Change `.active` to `.missing` to see a type error, then undo it. Open the command palette and choose **Twill: Show Generated TypeScript** to see how the callbacks compile.

### 4. Check and run it

From the project root:

```sh
npx twill check -p tsconfig.json
node --enable-source-maps --import @swiftuijs/twill/register src/main.twill
```

The program prints:

```text
[ 'Ada', 'Grace' ]
```

For debugging, open `src/main.twill`, set a breakpoint on `console.log`, and choose **Twill: Debug Current File** from the command palette. The command runs the file using your project's dependencies and environment.

## Use it in an existing application

Install `@swiftuijs/twill` locally, add your build tool's adapter, and start with one file. Native `.ts`, `.tsx`, `.js` and `.jsx` files keep their standard syntax and can import Twill modules or be imported by them.

| File      | Write                                                                |
| --------- | -------------------------------------------------------------------- |
| `.twill`  | TypeScript, including ordinary JavaScript syntax with optional types |
| `.twillx` | TSX, native JSX and component closures                               |

For a Vite application, add the plugin to the existing configuration:

```typescript
import { defineConfig } from 'vite';
import twill from '@swiftuijs/twill/vite';

export default defineConfig({ plugins: [twill()] });
```

React applications should use the [React Vite adapter](https://twill.evecalm.com/frameworks#react-with-vite-8) for Fast Refresh. React and Vue component libraries use their normal imports, props, children and slots. Twill requires no component registry or wrapping API.

See [React and Vue](https://twill.evecalm.com/frameworks), [other build tools](https://twill.evecalm.com/build-tools) and [mixed TS/JS projects](https://twill.evecalm.com/interoperability) for application setup. Run `twill check` before building; native `tsc` cannot parse Twill source. Libraries can emit [standard declarations](https://twill.evecalm.com/libraries).

## Enable format-on-save

The extension includes a formatter. Add this to `.vscode/settings.json`:

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

The bundled formatter uses editor indentation and Prettier defaults. For a shared `.prettierrc` and CLI formatting, use the standard Prettier extension with `@swiftuijs/twill-formatter`. Optional ESLint integration uses `@swiftuijs/twill-linter` and Microsoft's ESLint extension. Follow the [formatter and linter guide](https://twill.evecalm.com/tooling).

## Useful commands

Open the command palette with **Ctrl+Shift+P** on Windows/Linux or **Cmd+Shift+P** on macOS.

| Command                              | Use it to                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------- |
| **Twill: Show Generated TypeScript** | Compare your source with readable compiled TS/TSX                          |
| **Twill: Show Project Diagnostics**  | Inspect the project settings, source counts, versions and diagnostics      |
| **Twill: Debug Current File**        | Run the current file in the Node debugger with original-source breakpoints |

Browser applications use their existing browser and framework developer tools. See the [debugging guide](https://twill.evecalm.com/tooling#debug-node-code) for custom launch settings.

## Troubleshooting and support

- **Native TypeScript cannot resolve a Twill import?** Open the application folder containing its tsconfig, then run **TypeScript: Restart TS Server**.
- **Missing component or callback suggestions?** Check your framework types and JSX settings, repair nearby syntax errors, and inspect **Twill: Show Project Diagnostics**.
- **A rename or quick fix is unavailable?** Some edits cross generated syntax and cannot be mapped safely; these edits are withheld. General refactoring and fix-all are outside the supported workflow.
- **Need an offline install?** Download `twill.vsix` from the matching [GitHub release](https://github.com/swiftuijs/twill/releases) and choose **Extensions → … → Install from VSIX**.

Twill's 0.x release line is experimental. The checker and extension use TypeScript 5.9 semantics. Review the [compatibility and support guide](https://twill.evecalm.com/readiness) for tested versions and boundaries.

For a bug report, include a small source example, your extension/compiler versions, VS Code and Node versions, and relevant project settings. Use [GitHub Issues](https://github.com/swiftuijs/twill/issues).

MIT licensed · Built by [forth.ink](https://forth.ink) · [Source code](https://github.com/swiftuijs/twill)

## Added in 0.2.0

Twill 0.2.0 adds `if const value = lookup() { use(value); }` with branch-local nullish bindings and native destructuring. Group trailing calls in initializers, following Swift’s condition boundary. It emits native branches without a helper, closure or optional wrapper. See [syntax](https://twill.evecalm.com/syntax#branch-nullish-bindings) and [RFC 0018](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0018-optional-branch-bindings.md).

Twill 0.2.0 includes associated-value enums and `match` expressions: `match (state) { case State.loaded({ value }): value; default: 0; }`. Named payload bindings and erased factory descriptors compile to native switches without calling factories. Native switch statements retain JS fallthrough; match and switch expressions return one result without fallthrough. Use the coordinated 0.2.0 packages and extension. Compiler, formatter, linter, highlighter, export and editor changes are validated together. See [syntax and compatibility](https://twill.evecalm.com/syntax#match-expressions) and [RFC 0016](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0016-pattern-matching.md).

## Development

This package's implementation uses Twill and emits ordinary JavaScript. Build and check a checkout with the workspace tools; see [developing tooling in Twill](https://github.com/swiftuijs/twill/blob/main/docs/contributing/dogfooding.md) for bootstrap and contribution instructions.
