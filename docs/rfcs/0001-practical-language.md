# RFC 0001: Practical language direction

**Status: Active design guidance.** This document defines product priorities and acceptance criteria. The [RFC index](README.md) assigns an independent RFC to every syntax extension, semantic extension and public tooling capability introduced by Twill, with separate released and proposed statuses. This is not a language specification. The public [language guide](../language.md) and [syntax contract](../syntax.md) describe shipped behavior.

The roadmap may define new Twill semantics, including explicit runtime-backed features. Released behavior is the compatibility baseline, not a permanent restriction on language design. Proposals that change existing spelling, identity, coercion or scheduling must specify native JS/TS boundaries, costs and a versioned migration. Acceptance is recorded through RFC review; implementation PRs link their feature RFCs.

## Problem and product promise

Twill should make ordinary JS/TS work easier to understand and harder to get wrong. Importing Swift's surface syntax is insufficient: TypeScript already provides many of the underlying capabilities, and every dialect feature adds installation, editor and maintenance costs.

The useful promise is: **make validation, resource lifetimes and business-state handling explicit, while keeping TypeScript's type system and the JavaScript ecosystem**. Backend workflows and libraries are as important as components. The first audience is teams already using TypeScript who repeatedly deal with nullable data, owned resources and asynchronous outcomes; a Swift background is optional.

Three tasks anchor the evaluation:

1. Read untrusted input, validate it and continue with narrowed types without deeply nesting the successful path.
2. Acquire a resource and visibly release it on every exit, including awaited failures and cancellation.
3. Add a business-state variant and discover which handlers are now incomplete.

The [ledger workflow](https://github.com/swiftuijs/twill/blob/main/examples/general/workflow.twill) exercises all three using current syntax and ordinary TS domain types. Its executable tests are in the owning example package. These examples demonstrate behavior; they do not establish adoption or universal performance claims.

## Borrow the benefit, choose the native mechanism

| Swift idea                                            | Twill direction                                                                                                         | Priority / status                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Early exit and optional binding                       | `guard` / `guard const` with destructured optional bindings and explicit nullish semantics                              | Implemented foundation                                                 |
| Enums with associated values                          | Ordinary unions are usable now; RFC 0015 proposes native record constructors and union declarations                     | Proposed first implementation milestone                                |
| Exhaustive branching                                  | Checker-proven expressions over native TS unions; typed ESLint also checks native switches, including explicit defaults | Implemented; broader matching remains a candidate                      |
| Branch-scoped optional binding (`if let`)             | Consider an explicit immutable branch binding, without changing JS `let`                                                | Lower-priority candidate; spelling undecided                           |
| Immutable data discipline                             | Native `const`, `readonly`, readonly collections and application-specific validation                                    | Usable now; no hidden freezing or copying                              |
| Typed failures                                        | Local TS unions or normal libraries for expected failures; exceptions retain JS propagation                             | Usable now; no blanket exception-to-null conversion                    |
| Structured concurrency                                | Explicit `AbortSignal`, ownership and normal library APIs                                                               | Patterns now; task groups require separate evidence and runtime design |
| Property wrappers, observation, macros and decorators | Prefer explicit calls and framework APIs; hidden effects must justify their own semantics and tooling                   | No automatic port; high scrutiny                                       |
| Struct copying, actors and ownership enforcement      | Require explicit identity, scheduling, lifetime and native-boundary contracts                                           | Immutable values and task scopes are proposed; actors remain unscoped  |

This is a prioritization proposal, not a commitment to implement every row. New syntax should beat equivalent native TS in a specific task. Reducing punctuation alone does not justify weakening inference, source positions or interoperability.

## Early exit and typed outcome matching

Destructured `guard const` checks the whole initializer once and destructures only after the exiting failure branch. Native field defaults, getters, annotations and temporal dead zones remain explicit. It does not validate untrusted shapes or test individual fields for truthiness.

Switch expressions use native TS unions. Object cases bind the selected variant's payload; the checker proves exhaustiveness without an enum wrapper or separate type system. Native switch statements retain their grammar and semantics. Direct returns and the 0.2.0 standalone identifier-initializer optimization lower to native branches; other expression positions retain a synchronous IIFE and disclose that cost. Await/yield inside the switch requires a direct return; no implicit async scheduling is added.

The [syntax contract](../syntax.md) defines evaluation order, scopes, discriminator reads, source positions and limitations. The optional `recommendedTypeChecked` linter additionally checks native switches, including omitted union variants when a default exists. Transpile-only builds cannot prove arbitrary external types.

If expressions, optional-success bindings and broader matching predicates remain candidates. They need evidence beyond reducing punctuation, and must preserve inference, exact edits and the runtime model.

## Error handling and concurrency stay honest

Expected failures and unexpected exceptions serve different purposes. A validation result can be a local TS union; third-party IO failures and cancellation need an explicit propagation policy. A Swift-like `try?` port that catches everything and returns undefined would hide programming faults and cancellation. Typed `throws` cannot silently promise that arbitrary JS dependencies never throw another value.

The workflow uses integer cents with explicit validation and overflow checks, owns its acquired document, awaits its cleanup and checks cancellation boundaries. Its checks do not interrupt pending IO. Actual interruption needs cooperation from the IO adapter. Standard `using` and `await using` should remain available through the existing TS pipeline when supported; Twill should not create a competing disposal protocol.

Task groups, actors or resource ownership enforcement would require new runtime and lifetime rules. Evaluate an ordinary library first. Any future language feature must specify cancellation propagation, child completion, error aggregation, concurrency limits and cleanup before it is advertised as safer.

## Decorators and hidden effects

Do not reproduce SwiftUI wrappers as compiler-controlled state. React hooks, Vue tracking and ordinary JS property identity already have lifecycle contracts. Implicit observation, dependency injection, retry, disposal or concurrency can obscure when work happens and which component owns it.

This is not a blanket prohibition on standard decorators or user libraries. Native APIs keep their own semantics. A Twill-specific decorator, property wrapper or macro needs an independently justified use case, discoverable generated behavior, explicit cost and complete editor support. It should not become the default mechanism for validation, ownership or business flow.

## Adoption is part of language design

A readable feature is not useful if the editor loses inference or the project cannot gradually adopt it. Keep two-way TS/JS imports, normal framework types, optional configuration and one-file opt-in. Do not add component registries, mandatory runtime wrappers or a duplicate standard library.

Before expanding the grammar substantially, prioritize reliable incomplete-input assistance, safe mapped edits, references/refactoring coverage and realistic project performance. Current support and remaining boundaries stay in [readiness](../readiness.md); this proposal does not claim those gaps are already closed.

The optional `@swiftuijs/twill-export` package supplies `twill export`, exporting a checked single-project source graph to formatted native TS, rewriting relative dialect imports and preserving originals. Its boundaries are documented in the export package: application installation, project references and computed runtime paths need separate handling. The single-file `twill compile` command still preserves import specifiers. Broader project export and refactoring coverage remain adoption priorities.

## Feature acceptance gate

Each new language feature needs:

- A recurring real task, before/after examples and a native TS or library alternative. Explain which error or maintenance burden it removes.
- A complete lowering and scope/error/evaluation-order contract. Define existing-syntax boundaries. Any proposed reinterpretation needs an explicit version and migration; native .ts/.js modules keep their own parser semantics.
- Compiler execution and negative tests, nesting and adjacent native syntax tests; a failure must be a diagnostic rather than silent guessing.
- Type inference, diagnostic mapping, formatter idempotence, lint positions/fix safety, highlighting and packaged editor behavior, including incomplete input and mixed native files.
- Actual build/Node/framework validation as relevant, with no application-library special cases.
- Build/editor measurements and runtime comparisons against equivalent natural handwritten code. Count extra closures, arrays, copies and scheduling; do not manufacture an inflated baseline to claim zero overhead.
- Updated public syntax documentation that distinguishes supported behavior from proposals.

No feature is complete when only the parser accepts it. There is no target number of Swift features.

## Validation and sequence

1. Establish practical patterns, an executable non-UI workflow and opt-in exhaustive linting using current types and syntax.
2. Apply the full acceptance gate to every extension of guards or expression matching.
3. Implement associated-value enums against existing union patterns, then evaluate broader patterns and error propagation through their independent RFCs. Address adoption, incomplete-input assistance and refactoring gaps alongside each feature.
4. Pilot in a few real backend and component projects. Compare equivalent TS/Twill tasks: understanding control flow, extending a state union, diagnosing failures and managing resources. Track setup effort, editor failures, build/editor latency and generated runtime behavior on the same hardware and project.

Fewer lines are insufficient evidence. Look for clearer reviews, omissions discovered before execution, correct failure/cleanup behavior and an easy route back to native TS. Small pilots supply feedback rather than proof of universal productivity. A stable production claim also needs the existing release and support criteria, not just a successful demo.

## Primary references

- Swift [Control Flow](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/controlflow/): optional binding, early exit, switch and pattern matching.
- Swift [Enumerations](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/enumerations/): associated values and exhaustive switches.
- Swift [Error Handling](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/errorhandling/): propagation, cleanup and optional error handling.
- Swift [Concurrency](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/): task lifetimes and cooperative cancellation.
- Swift [Properties](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/properties/) and [Macros](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/macros/): wrappers and generated behavior.

These motivate questions; JS/TS semantics and the acceptance gate determine Twill's answers.
