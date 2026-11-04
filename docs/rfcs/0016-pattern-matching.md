# RFC 0016: Match expressions and enum-case patterns

**Release reference:** 0.2.0 implements the accepted scope; broader/deferred items below remain proposals.
**Status:** Implemented in 0.2.0 for the accepted scope; deferred capabilities remain proposals.
**Dependencies:** 0010, 0011, 0015. **Review:** The maintainer approved the `match` expression direction on 2026-10-07; the accepted implementation shipped in 0.2.0, while deferred capabilities remain proposals.
**Implementation:** The earlier explicit-marker prototype merged in [#14](https://github.com/swiftuijs/twill/pull/14). This amendment introduces the preferred `match` spelling.

## Problem and native baseline

Associated-value enums define variants once, but matching repeats literal tags and payload bindings. An explicit case reference should check that the factory exists and returns the named variant; payload bindings should be checked against the narrowed subject. The native baseline is a discriminator switch plus per-arm const destructuring. This improves readability and checking; it does not promise to execute faster than equivalent JavaScript.

## Phase-one design

Preferred syntax:

```text
return match (state) {
  case LoadState.idle(): 'Idle';
  case LoadState.loaded({ value: result }): String(result);
  case LoadState.failed({ error }): throw error;
};
```

`match` selects pattern semantics for the whole expression, avoiding a repeated `enum` marker in each arm. A match arm is a qualified enum-case descriptor, an existing tagged-object pattern, or `default`. Arbitrary value/call cases remain available in switch expressions. Ordinary `case Factory.loaded(input)` in a switch keeps its original call, strict-equality comparison and evaluation order.

`match` is contextual: an unescaped, unqualified `match(subject)` followed by a brace whose first non-comment token is `case` or `default` introduces the expression. The subject is one argument expression; parenthesize comma expressions. Native identifiers, calls, methods, optional/generic calls and trailing closures named `match` keep their contracts. In particular `match(subject) { return subject; }` and `match(subject) {}` remain ordinary trailing-closure calls. Recognition inspects only the brace's first token after the normal subject parser, preserving native TS/TSX subject syntax without module resolution or a second subject parse.

The compatibility `switch (...) { case enum ... }` prototype stays supported as a compatibility spelling. New examples use `match`; existing value/object switch expressions and native switch statements do not change.

A case reference is a qualified identifier chain, including imported aliases and namespaces. Parentheses are mandatory; they contain either nothing or one native object binding pattern. An empty pattern selects the variant without binding its fields, including variants that have payloads. The object pattern destructures the selected variant record: aliases, defaults, nested bindings and rest retain native semantics. It is not a nested shape predicate. Rest includes kind unless the binding explicitly mentions it. Bindings are immutable, independently scoped to each arm and do not escape. Destructuring is evaluated only in the selected arm; exceptions propagate normally.

The reference is a compile-time descriptor. Checked TypeScript verifies a callable factory whose return type has a literal kind equal to the referenced case name. Structurally compatible native TypeScript factories and their declarations work without Twill metadata. The descriptor is not read or invoked at runtime, and enum object identity is not inspected. Native type-only imports may name descriptors. Matching is structural, with no nominal enum brand; compatible records retain the native boundary contract.

The subject is evaluated once. Its kind is read once for selection. Explicit bindings of kind or object rest perform their normal additional reads. Existing object arms preserve RFC 0011's discriminator re-read, exclusion from rest and getter/default timing. Enum patterns may mix with object arms using the kind discriminator and a default; they cannot mix with value arms or object arms using another discriminator. Default and duplicate-label ordering keep native switch behavior. Without default, every tag must be covered. Unknown tags throw the existing non-exhaustive-switch error in unchecked transpile-only execution.

Each arm produces one expression result or throws. Match and switch expressions do not fall through; their generated returns or result assignments terminate the selected arm. Native switch statements retain JS's implicit fallthrough, including grouped labels and explicit break/return/throw. No new `fallthrough` control keyword is introduced: entering a different pattern arm could require payload bindings absent from the selected variant, and an expression still needs one result. An explicit-fallthrough statement construct would require a separate RFC defining entry bindings, scope, result/control flow and native compatibility. Ordinary variables/functions named `fallthrough` remain valid.

Await/yield retain RFC 0010's direct-return restrictions. Positional payload inference, contextual `.loaded`, where predicates, alternatives, ranges and nested literal predicates are deferred. A later amendment must define their evaluation and completeness rules.

## Lowering and interoperability

A checked branch contains an erased native TS factory witness:

```ts
case ('loaded' satisfies (
  typeof LoadState.loaded extends (...args: never[]) => { readonly kind: 'loaded' }
    ? 'loaded'
    : never
)): {
  const { value: result } = subject;
  return String(result);
}
```

This avoids global utility-type name collisions and does not cast the subject or suppress payload errors. A hygienic const kind binding supports native discriminant narrowing and exhaustive tag checking, including single-variant records. The final check uses an erased `typeof kind` witness on an inert numeric literal; it never casts the subject and introduces no runtime use of kind after the switch. Direct-return and standalone identifier-initializer lowering add no function; other expression positions retain the existing synchronous switch wrapper. Initializers preserve the original binding and its TDZ using a hygienic result temporary, labelled branch exit and original const/let/var declaration. Typed identifier annotations contextualize the temporary through an erased typeof query; user tokens remain source-backed. Output contains no matching runtime module, factory calls, reflection, serialization or extra result allocation. Native object-rest bindings retain their ordinary allocation cost.

Descriptor/property and binding tokens retain source maps for diagnostics, navigation, completion and local-variable edits. Enum symbol renames remain withheld under RFC 0015. Native descriptor method renames are also withheld across declarations and references: renaming the method without its literal tag changes the pattern. Native owner/import-alias and binding renames remain source-safe. Emit ordinary native declarations and checked source exports. Builds, Node loader, formatter, linter, highlighter, documentation playground and packaged editor must consume the same syntax.

## Compatibility and alternatives

Removing `enum` from an existing switch expression's call cases would silently replace native evaluation and identity comparison with tag selection. A dedicated contextual `match` expression makes that distinction explicit once. Positional `case LoadState.loaded(value)` remains unsupported: field inference would require imported declaration resolution during isolated transpilation. Named native bindings remove that dependency and are available to browser/offline compilation. A runtime case registry or extractor would add property reads/calls and initialization costs; none is introduced.

## Validation and performance acceptance

Test local/imported/aliased/namespace/native/declaration-only factories; nullary/ignored payloads; unknown cases and nonliteral tags; single-variant and added-variant completeness; structural inputs; binding scope, defaults, rest, getters, exceptions, subject evaluation and owner side effects. Preserve native function-call value cases, switch-statement fallthrough, identifiers/calls/trailing closures named match or fallthrough, the explicit-marker compatibility spelling and existing object-pattern behavior. Cover direct/general expressions, throw, await/yield, defer, nested matches/switches, TSX subjects, malformed patterns and contextual keyword comments/newlines.

Require source-safe diagnostics/definitions/completion/rename, formatter comment preservation and idempotence, mapped lint positions and safe fixes, shared TS/TSX scopes, native declaration/source-export consumers, build adapters, Node loader, independent packages, browser worker and extracted VSIX host checks.

Compare generated application bytes and gzip with equivalent handwritten discriminator switches. Enforce deterministic bundle budgets and absence of imported runtime modules. Measure compile/check costs and isolated warmed runtime median/p95, recording environment, inputs, checksums and commit/tree identity. Report IIFE/rest costs separately; do not infer runtime speedups from source brevity or enforce noisy cross-machine timing ratios in CI.

## Decision history

The phase-one scope was narrowed on 2026-10-07 for native compatibility, isolated cross-module compilation and runtime efficiency. The prototype does not imply design acceptance or release. Later matching features require their own amendments and validation.

On 2026-10-07, after #14 merged, the maintainer approved replacing repeated `case enum` with a dedicated `match` expression as the preferred syntax. The amendment preserves the prototype spelling for compatibility and retains native switch fallthrough. Explicit fallthrough is deferred from expression matching for the binding/control-flow reasons above. Acceptance does not publish the feature.
