# RFC 0007: Nullish guard bindings

**Status:** Implemented (retrospective specification).
**Kind:** Language. **Release:** 0.1.2. **Dependencies:** 0006.

## Problem and native baseline

`const user = find(id); if (user == null) return;` is a frequent nullable lookup. `guard const user = find(id) else { return; }` combines the immutable binding and exiting nullish branch.

## Design

Exactly one const declaration is accepted, with optional native TS annotation. The initializer evaluates once. Only null and undefined fail; zero, false, empty strings and NaN survive. An identifier is initialized before the failure block, where it may still be nullish. Success narrows it in the enclosing lexical scope. Binding guards require an explicit surrounding block when used as a conditional/loop body.

Destructuring has a distinct evaluation contract in [RFC 0008](0008-destructured-guard-bindings.md). This binding does not validate JSON, catch exceptions or unwrap an arbitrary result object. Thrown/rejected initializers propagate normally.

## Lowering and interoperability

Lower to `const user = find(id); if (user == null) { return; }`. Retain declaration and member tokens for TS inference, references and diagnostics. Awaited initializers stay in the enclosing async function. No runtime import or closure is introduced.

## Compatibility and alternatives

Native const plus an exiting nullish test remains supported. JS `let` keeps mutable semantics; the syntax does not copy Swift's meaning of let. Branch-local bindings are separately proposed in RFC 0018.

## Validation and completion

[Guard tests](../../packages/twill/tests/guard.test.ts) verify falsy values, one evaluation, narrowing, exceptions, annotations and illegal multiple/unbraced bindings. Preserve TDZ, safe rename, formatting, lint fixes and type errors at original tokens.

## Decision history

Retrospective nullish contract for released guard bindings.

## Strict nullish consistency amendment (unreleased)

Use the same null/undefined contract as RFC 0018 for every binding: lower guard failure to `value === null || value === void 0`, the complement of the branch binding's success test. Share this failure emission between identifier and destructured guards. Evaluate the initializer once and preserve narrowing, original tokens, TDZ, cleanup/exit ownership and existing falsy values. No runtime helper, closure or allocation is added.

Published 0.3.1 uses `value == null` for guard bindings, which also rejects the browser's legacy `document.all`. The source compiler now accepts that non-nullish object consistently with branch bindings. Ordinary guard conditions and authored JS/TS equality operators retain native behavior. Use `guard value != null else { ... }` when that exact loose comparison is intended. This is a compatibility correction for the exotic browser object, not a change to ordinary null/undefined inputs.

Validate identifier/object/array bindings, shadowed undefined, falsy values and coercion traps, original-source diagnostics and real browser document.all behavior, including defer cleanup. Compare emitted JS and bytes against natural strict handwritten checks; host minifiers retain their own exotic-object assumptions as documented in RFC 0018.
