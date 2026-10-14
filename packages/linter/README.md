# <img src="https://twill.evecalm.com/logo.png" alt="Twill hummingbird" align="right" width="40" height="40" /> Twill linter

[![npm version](https://img.shields.io/npm/v/%40swiftuijs%2Ftwill-linter)](https://www.npmjs.com/package/@swiftuijs/twill-linter)
[![npm monthly downloads](https://img.shields.io/npm/dm/%40swiftuijs%2Ftwill-linter)](https://www.npmjs.com/package/@swiftuijs/twill-linter)
[![CI](https://img.shields.io/github/actions/workflow/status/swiftuijs/twill/ci.yml?branch=main&label=CI)](https://github.com/swiftuijs/twill/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/%40swiftuijs%2Ftwill-linter)](https://github.com/swiftuijs/twill/blob/main/LICENSE)

An ESLint 9/10 flat-config plugin for Twill, a TypeScript-based language with Swift-inspired syntax extensions. Lint `.twill` and `.twillx` with typescript-eslint rules, original-source diagnostics and conservative fixes.

Install in your application:

```sh
pnpm add -D @swiftuijs/twill-linter eslint
```

`eslint.config.mjs`:

```js
import twill from '@swiftuijs/twill-linter';
export default [
  { ignores: ['**/dist/**'] },
  ...twill.configs.recommended,
  { languageOptions: { globals: { console: 'readonly' } } },
];
```

```sh
pnpm exec eslint src
pnpm exec eslint src --fix
```

`recommended` supplies standard JS and typescript-eslint recommended rules. `recommendedTypeChecked` additionally supplies typed rules; Twill files need a nearby tsconfig and are checked against Twill's virtual TypeScript program. Native TS files use typescript-eslint's project service normally. Add ordinary framework/environment globals as with any ESLint project.

`recommendedTypeChecked` also enables `@typescript-eslint/switch-exhaustiveness-check`. A switch over a discriminated union must explicitly cover each variant, even when it has a `default` branch. Adding a variant then exposes missing handlers in both Twill and native TS files. This check is opt-in linting, not a new compiler guarantee; run ESLint in CI to enforce it. Ordinary `recommended` does not require type information. See [practical patterns](https://twill.evecalm.com/patterns) for an example.

The processor honors the project Twill/JSX settings. Generated-only diagnostics are suppressed. Fixes and suggestions are offered only when their ranges and replaced text map exactly to original source; fixes requiring compiler-generated syntax are withheld. `disposeProjects()` releases the cached typed projects when embedding the plugin in a long-lived process. The typed cache checks existing project/configuration file mtimes; restart linting after adding/deleting files to refresh discovered roots.

For VS Code, use Microsoft's ESLint extension and add `twill-typescript` and `twill-tsx` to `eslint.validate`. The Twill VSIX supplies language IDs and TypeScript diagnostics; ESLint supplies lint rules and fixes.

Custom rule overrides should also match the virtual TS/TSX files, as with other ESLint processors:

```js
{ files: ['**/*.{ts,tsx,twill,twillx}'], rules: { 'prefer-const': 'error' } }
```

Framework ESLint plugins can attach their ordinary TS/TSX rules to these virtual files. Keep ESLint formatting rules disabled and let Prettier handle layout; rewrites spanning generated syntax cannot always be mapped back safely.

[Documentation](https://twill.evecalm.com/tooling) · [Issues](https://github.com/swiftuijs/twill/issues) · MIT licensed · Built by [forth.ink](https://forth.ink).

## Added in 0.2.0

Twill 0.2.0 adds `if const value = lookup() { use(value); }` with branch-local nullish bindings and native destructuring. Group trailing calls in initializers, following Swift’s condition boundary. It emits native branches without a helper, closure or optional wrapper. See [syntax](https://twill.evecalm.com/syntax#branch-nullish-bindings) and [RFC 0018](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0018-optional-branch-bindings.md).

Twill 0.2.0 includes associated-value enums and `match` expressions: `match (state) { case State.loaded({ value }): value; default: 0; }`. Named payload bindings and erased factory descriptors compile to native switches without calling factories. Native switch statements retain JS fallthrough; match and switch expressions return one result without fallthrough. Use the coordinated 0.2.0 packages and extension. Compiler, formatter, linter, highlighter, export and editor changes are validated together. See [syntax and compatibility](https://twill.evecalm.com/syntax#match-expressions) and [RFC 0016](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0016-pattern-matching.md).

## Development

This package's implementation uses Twill and emits ordinary JavaScript. Build and check a checkout with the workspace tools; see [developing tooling in Twill](https://github.com/swiftuijs/twill/blob/main/docs/contributing/dogfooding.md) for bootstrap and contribution instructions.
