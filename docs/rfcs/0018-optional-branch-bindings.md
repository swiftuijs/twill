# RFC 0018: Nullish bindings in if branches

**Release reference:** 0.2.0 implements the accepted scope; broader/deferred items below remain proposals.
**Status:** Implemented in 0.2.0 for the accepted scope; deferred capabilities remain proposals.

## Problem and native baseline

The Twill addition is an `if const` declaration that binds a non-nullish value only inside the success branch. Native TS/JS uses a temporary plus a nullish test for this task. `if const user = find(id) { use(user); } else { missing(); }` removes the source-level temporary and limits the binding's lifetime without changing JS let's meaning. Optional chaining (`?.`) and nullish coalescing (`??`) remain native operators.

## Design

Use `if const binding = initializer { statements }`, with one required initializer, an optional whole-initializer TS annotation, a required braced success branch and an optional `else { ... }` or `else if ...`. The binding may be an identifier or a native object/array pattern. Native parenthesized `if (...)` is unchanged.

Follow Swift's separation of statement-condition and ordinary expression parsing. At the initializer's outer expression depth, a postfix `{` starts the success branch, rather than a trailing callback. Parentheses and call arguments are ordinary expression contexts and retain trailing closures. Object literals, arrow-function bodies, nested `match`/switch expressions and TS/TSX syntax retain their own delimiters. For example:

```twill
if const user = find(id) {
  use(user);
}
if const user = (find(id) { candidate in
  candidate.active;
}) {
  use(user);
}
if const user = find(id, (candidate) => candidate.active) {
  use(user);
}
```

Swift also performs recovery lookahead and warns about some confusable unparenthesized trailing closures. The initial Twill contract takes the statement body at outer condition depth; it does not infer a callback by scanning subsequent independent blocks. Write callback arguments explicitly or group the call. Formatter output must retain the required grouping. See Swift's [condition parser](https://github.com/swiftlang/swift-syntax/blob/main/Sources/SwiftParser/Statements.swift) and [trailing-closure disambiguation](https://github.com/swiftlang/swift-syntax/blob/main/Sources/SwiftParser/Expressions.swift).

Evaluate the initializer once; only null/undefined select failure, while `0`, `false`, empty strings and NaN survive. The new immutable binding exists only inside the success branch. Initializer, else and following references resolve in the enclosing scope, including an outer variable with the same name. Destructuring checks the whole initializer before native getters/defaults/iterators. Pattern default initializers retain native left-to-right ordering and TDZ. A success-body declaration may not redeclare the binding in the same lexical scope. No binding validates nested fields or catches initializer/destructuring errors.

Await/yield stay in the enclosing async/generator scope, without a generated function or promise. Return, throw, labelled break/continue, finally and branch-local defer retain their native ownership and timing. Multiple comma-separated optional bindings, while bindings and if expressions are outside the initial implementation.

## Lowering and interoperability

Lower to a hygienic temporary and a scoped native nullish conditional, then const binding/destructuring on success. Ordinary TS narrowing supplies types. Avoid returning a bound variable through a generated closure. Allocation is limited to native destructuring/rest operations; there is no optional wrapper type.

```ts
{
  const subject = find(id);
  if (subject !== null && subject !== void 0) {
    const user = subject;
    use(user);
  } else {
    missing();
  }
}
```

The actual temporary is collision-free. Keep original initializer, pattern, annotation and body tokens mapped for inference, diagnostics, references and safe edits. Inline and external-runtime modes emit the same branch lowering without adding a runtime dependency. Native declarations/export expose only the normal inferred public types.

The 0.4.0 emitter can reuse an existing authored block for its hygienic temporary instead of adding another block. It retains isolation when direct eval, including eval inside a capturing function, can observe the temporary's expanded scope/TDZ. Top-level and unbraced statement boundaries retain their own scope. The scope analysis shares identifier collection and visits each parser node once.

`if const { value } = input` checks `input`, then performs ordinary destructuring: `{ value: undefined }` still succeeds. `if const value = input?.value` checks the field value instead; both forms preserve zero and false.

Use strict comparisons and `void 0` so shadowed `undefined` and the browser's legacy `document.all` do not change the null/undefined contract. The 0.4.0 RFC 0007 amendment aligns identifier/destructured guard failure with this contract. Version 0.3.1 guard bindings use loose equality and reject document.all; branch-binding semantics are unchanged.

An initializer written as a `match` expression retains the existing general-expression lowering, including its synchronous IIFE cost and suspension restrictions. This RFC does not optimize those separate expression contexts.

Host minifiers retain their native assumptions: esbuild can fold the same strict pair in handwritten JS and emitted JS into a loose null comparison. The browser test covers the unminified Vite pipeline's `document.all` behavior; this does not claim to override a host's exotic-object optimization policy.

Compare natural handwritten nullish branches with equivalent inputs and side effects. Require zero additional closures, wrappers, arrays or scheduling beyond operations explicitly written in the source; record generated/minified code and bytes. Timing reports retain all trials and source/build identities. A repeatable material slowdown blocks acceptance; representative controlled-host medians target within 10% of equivalent native code. This is an acceptance target, not an unmeasured speed claim.

## Compatibility and alternatives

Native temporary plus if and existing guard bindings remain supported. Success binding differs from guard because it does not survive after the branch. Do not reinterpret valid native if parentheses or JS let mutability.

## Validation and completion

Test falsy/nullish values, identity and one evaluation, getter/default/iterator ordering, errors/rejections, outer-name shadowing and binding TDZ, same-scope redeclarations, nested branches/else-if/dangling else, hygienic temporaries, loop exits and defer. Cover grouped/nested trailing closures, object/regex/template literals, TS annotations/generics, TSX subjects, malformed comments and illegal forms. Require narrowing, mapped diagnostics and rename, incomplete-input completion, formatter/standalone idempotence and grouping, lint fix safety, TS/TSX grammar colors, browser/build adapters, declarations/export and independent packed consumers.

## Open questions and decision history

The maintainer selected `if const` and directed the implementation to follow Swift's condition parsing boundary on 2026-10-07. After implementation review, the maintainer authorized merging [PR #17](https://github.com/swiftuijs/twill/pull/17) on the same date, accepting the statement-form contract. The implementation and coordinated tooling ship in 0.2.0. RFC 0017 composition, multiple bindings and Swift-style recovery warnings remain deferred. Nullish/destructuring behavior reuses RFCs 0007/0008; branch scope deliberately differs from guard's enclosing-scope binding.
