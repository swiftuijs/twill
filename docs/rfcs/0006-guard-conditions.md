# RFC 0006: Guard conditions and required exits

**Status:** Implemented (retrospective specification).
**Kind:** Language. **Release:** 0.1.2. **Dependencies:** None.

## Problem and native baseline

`if (!valid(input)) { return failure; }` encodes an early exit without requiring that intent. `guard valid(input) else { return failure; }` makes the failure path an exit contract.

## Design

`guard condition else { failure }` is contextual statement syntax. The failure block must conservatively prove an exit: return, throw, legal break/continue, an exiting nested block, or an if whose two branches exit. Calls, loops, switches and try statements do not prove exits, even when a TS signature says never. Each nested guard is checked independently. Native scope rules decide whether a jump is legal.

The condition currently uses native JS truthiness. [RFC 0023](0023-boolean-conditions.md) proposes a separate checked boolean policy. Unbraced surrounding conditional/loop bodies are supported with lowering braces that preserve dangling-else association. `guard` used as an ordinary identifier or call retains native behavior.

## Lowering and interoperability

Lower to `if (!(condition)) { failure }`. The condition evaluates once; TS performs its ordinary post-exit narrowing. There is no helper, callback or new type system. Component child closures reject their own-scope return; throw and legal loop exits remain available.

## Compatibility and alternatives

Native returning if statements remain equivalent at runtime. A future broader exit proof must not guess whether arbitrary functions terminate. Diagnostic wording can improve without weakening the contract.

## Validation and completion

Malformed guards should report the missing condition, `else` or failure block with the required spelling at original source coordinates, consistently through strict compilation and editor diagnostics. Recognition of an unambiguous malformed statement does not require its `else` token. Preserve ordinary calls, member/index access, templates, labels, TS assertions and newline-separated identifier statements; do not reserve `guard` globally or repair executable output. Diagnostic improvements are source changes until published.

[Guard tests](../../packages/twill/tests/guard.test.ts) cover exits, illegal fallthrough, contextual recognition and dangling else. Check formatter/linter positions, break targets, nested guards and semantic diagnostics mapped to source.

## Decision history

Retrospective record of the conservative exit proof in 0.1.2.
