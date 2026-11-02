# RFC 0012: Native JSX component children closures

**Status:** Implemented (retrospective specification).
**Kind:** Language. **Release:** 0.1.2. **Dependencies:** 0002; optional 0009/0010.

## Problem and native baseline

JSX children often need separate array/map expressions for imperative control flow. In .twillx, `Panel { if (ready) { <Content />; } }` supplies ordinary JSX children through familiar statements.

## Design

Only a non-parenthesized uppercase identifier or member with an uppercase final name selects component syntax in .twillx. One props object and generic type arguments are accepted. Multiple props arguments, spreads and optional component calls are rejected. In .twill, trailing closures are ordinary callbacks. Parenthesizing a callable forces ordinary callback behavior.

A single child passes its original value directly. A final expression preceded only by declarations/defer also returns its original value. Other closures collect expression-statement results into a local array, respecting blocks, branches, loops, switches and try/finally. Side-effect expressions also contribute their values. Nested functions/classes retain scope. Own-scope return is rejected; throw and legal loop exits remain available.

## Lowering and interoperability

Lower to native JSX with children as a value or hygienic collector result. Components are never called as ordinary functions. React keys, refs, hooks and identity follow its JSX runtime. General collection allocates an array/content closure; the single-child path avoids a collector. Runtime selection follows standard tsconfig/pragma settings and the documented Vue-import fallback. No component registry or language runtime is introduced.

## Compatibility and alternatives

Ordinary JSX remains available and can mix with closures. Uppercase lexical recognition is independent of imported library names. React render props and Vue slots have separate RFCs.

## Validation and completion

[Framework tests](../../packages/twill/tests/frameworks.test.ts), [branching tests](../../packages/twill/tests/branching.test.ts), actual React/Vue examples and framework browser rendering cover props, laziness, identity, collection and JSX composition. Preserve native framework declarations, formatting and packaged editor props checks. Measure general collection separately from single-child paths.

## Decision history

Retrospective native JSX contract; globally configured result builders are excluded.

## Emission readability amendment (unreleased)

Emit an eligible lone native JSX element or fragment directly inside its React parent, without an extra JSX expression container. Remove only the surrounding closure whitespace and optional semicolon; keep the JSX node's internal text and original token mappings. Retain a container when comments, parenthesized expressions or other syntax would otherwise become JSX text. Dynamic values, render callbacks, declaration/cleanup scopes and general collectors keep their existing ownership.

A Vue slot containing one expression and no other statements becomes a concise arrow. Preserve default/named slot objects, scoped parameter tokens and lazy invocation; reads, allocations and cleanup still occur when the slot is called. Slots requiring declarations, defer or control flow keep block bodies. JSX expression braces enclosing the slot object remain necessary.

Compare real React/Vue rendering and single-child identity with ordinary JSX, including same-line whitespace, fragments, nested closures, props, comments and source-mapped type errors. Validate the actual playground worker/browser output and retain the existing generated-JavaScript byte gates. This is a source emission cleanup, not a new syntax, runtime optimization claim or published 0.3.1 capability.

The same concise-arrow rule applies to React render callbacks. Eligible direct React expressions need a JSX container but no additional generated parentheses; comma expressions keep grouping. Vue slot-object parentheses can be omitted, while its object and JSX expression braces remain necessary. Named slot keys may use literal properties, retaining a computed key for `__proto__` so its own-property semantics are preserved.

Default-slot function shorthand is not a universal replacement for the slot object. The supported Vue 3.3 runtime handles a dynamic native tag's function children differently from its default-slot object. Preserve that compatibility by default and do not add runtime type/version branches just to omit the key. A minimum-version installed-consumer probe compares both forms and verifies component lazy reads.

## Vue default-slot representation option (unreleased)

Add `vueDefaultSlot: "object" | "function"` to the shared compiler/project options. The default is `"object"`, preserving the existing Vue 3.3 native-tag compatibility. With `"function"`, a Vue component closure with only a default slot emits function children, for example `<Panel>{() => <button />}</Panel>`. If any named slot is present, retain the complete slot object regardless of this setting.

This is an explicit representation choice, not runtime component detection. Applications opting in must use actual components, or a Vue runtime that supports function children for every native tag they may resolve. Vue 3.3 native tags do not satisfy that requirement. Preserve callback parameter tokens, lazy reads, cleanup/control-flow scope, evaluation order, errors and source mappings for both representations. React, ordinary callbacks and authored JSX are unchanged.

Accept the option in `twill.config.json` and the public transform/bundler APIs; explicit adapter settings override project settings. Recommend shared project configuration so checking, editor inspection, declarations/export, scripts and builds agree. Validate configuration values and synchronize compiler/editor JSON schemas. Existing runner configuration observations invalidate cached output when this setting changes. No new CLI flag, runtime helper, type/version branch or production dependency is needed.

Validate real Vue rendering/laziness for expression, scoped, collector and cleanup slots; named-slot fallback, non-Vue boundaries and original-source maps; actual adapters and cache invalidation; and independently installed archives with Vue 3.3 component function slots. Published 0.3.1 does not include this option.
