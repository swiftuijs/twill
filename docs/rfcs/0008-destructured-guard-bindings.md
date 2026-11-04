# RFC 0008: Destructured guard bindings

**Status:** Implemented (retrospective specification).
**Kind:** Language. **Release:** 0.1.2. **Dependencies:** 0007.

## Problem and native baseline

Nullable records must be checked before destructuring. `guard const { name = 'Anonymous' } = lookup() else { return; }` expresses that sequence without manually introducing a temporary.

## Design

Object and array binding patterns support native nested patterns, defaults, renaming and rest. The whole initializer is checked for nullishness before any destructuring. A whole-initializer annotation is permitted. Individual fields and nested objects are not validated or separately tested for nullishness.

Pattern bindings remain in their native temporal dead zone during the initializer and failure block. They become initialized only on success. Getters, defaults, iterators and nested destructuring failures retain JS behavior; zero or false initializers may undergo normal native coercion.

## Lowering and interoperability

Use a collision-free const temporary, an exiting nullish test, and then the original native binding pattern. The initializer runs once. No defaults/getters/iterators run on nullish failure; successful native destructuring can read several properties. Await remains in its original async scope. Source mappings preserve actual binding/member tokens for inference and rename.

The 0.4.0 RFC 0007 consistency amendment uses `temporary === null || temporary === void 0`, shared with identifier guards and complementary to branch-binding success. Published 0.3.1 uses loose equality and rejects document.all; 0.4.0 accepts it and then performs native destructuring. No nested-field validation is added.

## Compatibility and alternatives

The handwritten equivalent is a temporary plus a nullish test and native destructuring. Optional property matching, deep validation and exception-to-null conversion are excluded.

## Validation and completion

[Branching tests](../../packages/twill/tests/branching.test.ts) cover getter/default counts, TDZ, rest, arrays, strict unused checks and defer composition. [Formatter tests](../../packages/formatter/tests/branching.test.ts) and real packaged editor tests verify preservation, payload completion and binding rename.

## Decision history

Retrospective specification; changing default/getter timing is a semantic change.
