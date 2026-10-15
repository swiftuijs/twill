# <img src="https://twill.evecalm.com/logo.png" alt="Twill hummingbird" align="right" width="40" height="40" /> Twill formatter

[![npm version](https://img.shields.io/npm/v/%40swiftuijs%2Ftwill-formatter)](https://www.npmjs.com/package/@swiftuijs/twill-formatter)
[![npm monthly downloads](https://img.shields.io/npm/dm/%40swiftuijs%2Ftwill-formatter)](https://www.npmjs.com/package/@swiftuijs/twill-formatter)
[![CI](https://img.shields.io/github/actions/workflow/status/swiftuijs/twill/ci.yml?branch=main&label=CI)](https://github.com/swiftuijs/twill/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/%40swiftuijs%2Ftwill-formatter)](https://github.com/swiftuijs/twill/blob/main/LICENSE)

Prettier 3.9 plugin for Twill, a TypeScript-based language with Swift-inspired syntax extensions. Formats `.twill`, `.twillx` and native TS/TSX while preserving trailing closures, guards and defer. It uses Prettier's own TypeScript parser/printer; compilation helpers never enter formatted source.

Install in your application:

```sh
pnpm add -D @swiftuijs/twill-formatter prettier
```

`.prettierrc.json`:

```json
{ "plugins": ["@swiftuijs/twill-formatter"], "singleQuote": true }
```

```sh
pnpm exec prettier --write 'src/**/*.{twill,twillx,ts,tsx,js}'
pnpm exec prettier --check .
```

The API `format(source, { filepath: 'view.twillx' })` returns a promise. The default export is a standard Prettier plugin. Ordinary TS/JS keeps its normal Prettier parser. Explicit parentheses around component-like callees are retained because they affect Twill semantics. Invalid source fails formatting with a syntax diagnostic.

The VSIX bundles this formatter and supports Format Document and format-on-save without a separate Prettier extension. Its built-in provider uses editor indentation and Prettier defaults. Use the standard Prettier extension with this workspace plugin when you need project-wide Prettier configuration.

For generated-source viewers, `formatGenerated(code, { filepath: 'output.ts' })` formats native TS/TSX directly. Use `output.tsx` for JSX. It returns display text without a source map; retain the original compiler result for builds, diagnostics and debugger mappings. `format()` remains the dialect-source formatter.

Browser workers and the VSIX use `@swiftuijs/twill-formatter/standalone`. It exposes the same formatting helpers and loads only Prettier's core, the TS/ESTree support and the Twill plugin. Additional plugins must be loaded objects; this entry does not resolve plugin filenames or load configuration from disk. The main entry retains ordinary Node Prettier integration. Both entries are tested for matching formatting and idempotence.

[Documentation](https://twill.evecalm.com/tooling) · [Issues](https://github.com/swiftuijs/twill/issues) · MIT licensed · Built by [forth.ink](https://forth.ink).

## Added in 0.2.0

Twill 0.2.0 adds `if const value = lookup() { use(value); }` with branch-local nullish bindings and native destructuring. Group trailing calls in initializers, following Swift’s condition boundary. It emits native branches without a helper, closure or optional wrapper. See [syntax](https://twill.evecalm.com/syntax#branch-nullish-bindings) and [RFC 0018](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0018-optional-branch-bindings.md).

Twill 0.2.0 includes associated-value enums and `match` expressions: `match (state) { case State.loaded({ value }): value; default: 0; }`. Named payload bindings and erased factory descriptors compile to native switches without calling factories. Native switch statements retain JS fallthrough; match and switch expressions return one result without fallthrough. Use the coordinated 0.2.0 packages and extension. Compiler, formatter, linter, highlighter, export and editor changes are validated together. See [syntax and compatibility](https://twill.evecalm.com/syntax#match-expressions) and [RFC 0016](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0016-pattern-matching.md).

## Development

This package's implementation uses Twill and emits ordinary JavaScript. Build and check a checkout with the workspace tools; see [developing tooling in Twill](https://github.com/swiftuijs/twill/blob/main/docs/contributing/dogfooding.md) for bootstrap and contribution instructions.
