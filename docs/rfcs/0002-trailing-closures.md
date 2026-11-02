# RFC 0002: Trailing closures

**Status:** Implemented (retrospective specification).
**Kind:** Language. **Release:** 0.1.2. **Dependencies:** None.

## Problem and native baseline

Callback-heavy APIs bury the operation inside parentheses. `values.map(value => value * 2)` becomes `values.map { value in value * 2 }`. Callbacks still use the original API's types and invocation policy.

## Design

Identifiers, members and calls accept a final closure. Bare calls can omit parentheses; `{ parameters in body }` supports bare names or parenthesized typed/destructured/default/rest parameters and a return annotation. Explicit `async` headers create async arrows. Parenthesized callable results are supported. Constructors and tagged-template trailing calls are excluded.

The first top-level `in` separates parameters from the body. Parenthesize a first-expression JS `in` operator or object literal. A call followed by a block, including across a newline, opts into the extension; `call(); { ... }` retains a separate native block. Bare identifiers followed by a block on a new line remain separate statements. These ambiguity rules prevent a strict TS-superset claim.

## Lowering and interoperability

`values.map { value in value * 2 }` lowers to `values.map(value => value * 2)`. The callee/receiver and arguments keep native order; the callback is allocated when an ordinary arrow would be. Lexical `this`, `arguments`, `super` and `new.target` follow arrow rules. No callback executes until the API invokes it. There is no runtime module. [RFC 0003](0003-implicit-returns.md) defines implicit returns; [RFC 0004](0004-labelled-trailing-closures.md) defines additional closures. Native source files keep native parsers.

## Compatibility and alternatives

Ordinary arrows remain available and avoid the call/block ambiguity. Reflection on a callback parameter's name or library-specific call recognition is excluded. Changing arrow capture or invocation semantics needs a new amendment.

## Validation and completion

Evidence: [compiler tests](../../packages/twill/tests/compiler.test.ts), [edge cases](../../packages/twill/tests/edge-cases.test.ts), [TS corpus](../../packages/twill/tests/conformance.test.ts), and [formatter corpus](../../packages/formatter/tests/conformance.test.ts). Preserve generic calls, chained callbacks, nested scopes, ASI, comments, callback inference and mapped edits. Build, Node and packaged editor consumers must continue using original API types.

## Decision history

Records the released behavior from [the syntax contract](../syntax.md). No retrospective approval is implied.

## Concise callback emission amendment (unreleased)

An implicitly returning single-expression trailing callback can use a concise arrow body. Keep lexical this/arguments, comments, original parameter/expression mappings, object/comma grouping and implicitReturn:false behavior. Preserve authored native arrows and block bodies needed for statements or cleanup. Eligible match/switch returns reuse native branches as specified by RFC 0010; direct eval and suspension retain their established boundaries.

This is source-emission cleanup, not a new callback syntax or a change to published 0.3.1.
