# RFC 0010: Switch expressions and exhaustiveness

**Status:** Implemented (retrospective specification).
**Kind:** Language. **Release:** 0.1.2. **Dependencies:** None; object arms use 0011.

## Problem and native baseline

A native switch assigning/returning a value repeats assignments or returns and needs an explicit never check for missing variants. `return switch (state) { case 'ready': 1; case 'failed': 0; };` provides a checked expression.

## Design

Switch is an expression only in expression positions. Each arm has one expression or throw expression, with normal semicolons/ASI. The subject evaluates once. Value cases keep native strict comparison and case-evaluation order; duplicate labels select the first match. Only the selected value runs. There is no fallthrough or arm-level break. Native switch statements retain native grammar and semantics, including implicit fallthrough. The 0.2.0 match expression in RFC 0016 also returns one result without fallthrough; no new fallthrough control keyword is introduced.

Without default, TS output includes a post-arm `subject satisfies never`. Twill check and editor checking must prove this; finite unions can be exhaustive and unbounded values need a default. Default accepts a catch-all, so checking alone does not require explicit coverage of every variant. RFC 0030's optional typed lint policy additionally requires that coverage. Transpile-only builds/playground do not prove types. Unchecked unmatched values throw TypeError rather than returning undefined.

## Lowering and interoperability

A direct return lowers to a scoped native switch. From 0.2.0, a standalone single-declarator identifier initializer also lowers to native control flow: a hygienic result temporary and labelled block precede the original const/let/var declaration. This preserves its TDZ, mutability, contextual annotations and inferred result type. Exported declarations are supported; for headers, multiple declarators, destructuring and larger/conditional expressions retain the synchronous lexical arrow IIFE to preserve evaluation order. Direct eval, JS JSDoc contextual typing and TS suppression pragmas also keep the established wrapper. The native initializer optimization is checked against an equivalent local-assignment switch; an avoidable IIFE slowdown is a regression, not an accepted language cost. Await/yield in the switch requires direct return, retaining the enclosing async/generator scope; other positions reject suspension. This avoids hidden promise conversion. IIFEs can allocate; direct returns need no extra function. Native types and imported unions determine narrowing and result inference.

## Compatibility and alternatives

Native switches with explicit never checks remain supported. Multi-statement arms and arbitrary predicates are not this feature; RFC 0016 adds 0.2.0 match expressions and enum-case patterns. An untrusted external value still needs runtime validation.

## Validation and completion

[Branching tests](../../packages/twill/tests/branching.test.ts) exercise evaluation order, suspension, omitted cases (TS1360), return inference and original diagnostic positions. Packaged editor tests remove a union arm and require the mapped diagnostic. Formatter, typed lint and JSX composition must preserve expression/statement distinctions.

## Decision history

Retrospective contract; stronger explicit-default coverage remains a lint policy.

## Shared return emission amendment (0.4.0)

A direct return may reuse its existing authored block for generated subject/tag snapshots and native branches, including after preceding statements, when direct eval (also inside capturing functions) cannot observe the expanded temporary scope/TDZ. Other statement boundaries retain isolation. Preserve per-arm binding scopes, one-time subject/tag evaluation, descriptor witnesses, exhaustiveness checks, unmatched-value errors and suspension ownership. Emit a hygienic local assertion type `type Check<T extends never = typeof subjectOrTag> = T & never` and reference it in the existing failure message (`message as Check`). Its default type argument must satisfy the never constraint, rejecting any/unknown and incomplete unions independently of a shadowed error constructor. The intersection keeps the failure argument never even on invalid programs, avoiding secondary cast/constructor errors. The alias is used under noUnusedLocals and erases completely: no numeric placeholder, independent runtime expression, additional read or minifier liveness cost. Native TS reports the source constraint failure as TS2344; the released satisfies-based proof reports TS1360.

An eligible implicitly returning trailing callback or content function can return the match/switch through native branches in its existing function body, without a second IIFE. Retain the expression boundary for direct eval and keep the existing explicit-return restriction for await/yield. General expression positions still need an expression-producing boundary. Remove only the original return statement's terminating semicolon when replacing it with a block; unbraced if/else ownership must remain valid.

This changes generated structure, not matching grammar or native switch-statement behavior. Compare equivalent native execution, lexical TDZ/eval boundaries, scopes, mappings and output budgets. This amendment is included in 0.4.0.
