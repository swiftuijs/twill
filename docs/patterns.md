---
title: 'Practical Twill patterns'
description: 'Apply Twill to input validation, resource cleanup, callbacks and typed application logic with practical TypeScript-based examples.'
---

# Practical patterns

Twill uses TypeScript's types and ordinary JavaScript control flow. Its useful building blocks are early validation, explicit outcomes, owned cleanup and normal callbacks. They work in backend services, command-line tools and UI applications with the same semantics.

The [general example](../examples/general/workflow.twill) combines these patterns in a ledger import. Its domain interfaces and discriminated union live in an ordinary [TS module](../examples/general/workflow-models.ts). There is no Twill configuration, runtime result wrapper or component adapter.

## Validate at the boundary

Accept untrusted input as `unknown`. A type annotation alone does not validate JSON, HTTP responses or user input.

```twill
function decodeAmount(input: unknown): number | undefined {
  guard typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 else {
    return undefined;
  }
  return input;
}

function displayAmount(input: unknown): string {
  guard const amount = decodeAmount(input) else {
    return 'Invalid amount';
  }
  return `${amount} cents`;
}
```

The guard binding checks only `null` and `undefined`, so zero is retained. It evaluates the initializer once. The exiting failure branch lets TypeScript narrow the binding for the remaining code. Currency represented in integer cents still needs overflow checks when summed; it does not remove JavaScript's numeric limits.

For an optional object result, destructure only after its nullish check succeeds:

```twill
function accountLabel(find: () => { name?: string } | undefined): string {
  guard const { name = 'Anonymous' } = find() else {
    return 'Missing account';
  }
  return name;
}
```

Only the whole result is checked. Defaults and getters keep native behavior; the pattern names are unavailable in the failure branch. Use ordinary validation libraries for complex schemas. Twill does not synthesize validators from TypeScript annotations.

## Optional success branches

For an optional success branch that should not introduce a binding into the rest of the function, the [RFC 0018 binding in 0.2.0](syntax.md#branch-nullish-bindings) provides:

```twill
function displayAmount(input: unknown): string {
  if const amount = decodeAmount(input) {
    return `${amount} cents`;
  } else {
    return 'Invalid amount';
  }
}
```

Zero remains valid, and `amount` exists only in the success branch. Available in 0.2.0; it does not replace native conditionals.

## Separate expected outcomes from exceptions

Use a normal TS discriminated union when callers are expected to handle several business outcomes:

```twill
type Outcome =
  | { readonly kind: 'ok'; readonly totalCents: number }
  | { readonly kind: 'invalid'; readonly reason: string };

function describe(outcome: Outcome): string {
  return switch (outcome) {
    case { kind: 'ok', totalCents }: `${totalCents} cents`;
    case { kind: 'invalid', reason }: reason;
  };
}
```

The union carries the payload appropriate to each state. Avoid independent `success`, `error` and `value` fields that permit contradictory combinations. `readonly` prevents writes through these types; it does not freeze objects at runtime.

Run `twill check` to prove that this expression handles every variant. Adding a union variant exposes a missing case. There is no result wrapper or enum runtime. Native switch statements remain available; enable their exhaustive checking with the type-aware ESLint configuration:

```js
import twill from '@swiftuijs/twill-linter';
export default [{ ignores: ['**/dist/**'] }, ...twill.configs.recommendedTypeChecked];
```

This requires the project's normal `tsconfig.json`. Adding a variant to `Outcome` without handling it produces an `@typescript-eslint/switch-exhaustiveness-check` error, even with the defensive `default` branch. The rule works in native TS and Twill. It requires running ESLint; bundling or `twill check` alone does not enforce this lint policy.

Return expected validation failures explicitly. Unexpected IO errors, programming errors and cancellation should retain their own propagation contract. The ledger example catches malformed JSON specifically; it does not turn every exception into an invalid-input result. Existing result libraries work through their ordinary APIs if they better suit an application.

## Keep resource ownership visible

```twill
interface TextDocument {
  readText(): Promise<string>;
  close(): Promise<void>;
}

async function readOwned(acquire: () => Promise<TextDocument>): Promise<string> {
  const document = await acquire();
  defer {
    await document.close();
  }
  return await document.readText();
}
```

Register cleanup immediately after successful acquisition. A failed acquisition creates no cleanup obligation. Await resource-dependent work before leaving the scope, and await asynchronous release. This also applies to a temporary directory or transaction when the caller has deliberately taken ownership.

Do not close a shared resource that the caller still owns. Prefer standard `using` / `await using` when a resource implements the disposal protocol and the target toolchain supports it. `defer` is useful for arbitrary existing cleanup APIs. Neither syntax changes a library's lifetime rules.

Cleanup errors follow the [defer contract](./syntax.md#defer): all registered cleanups run and the last cleanup error takes precedence over an earlier error. A single direct cleanup uses one closure and `try/finally`; dynamic registrations additionally use a local stack. Native `try/finally` remains appropriate in allocation-sensitive code.

## Make cancellation cooperative and explicit

```twill
async function readCancelable(
  signal: AbortSignal,
  acquire: () => Promise<TextDocument>,
): Promise<string> {
  signal.throwIfAborted();
  const document = await acquire();
  defer {
    await document.close();
  }
  signal.throwIfAborted();
  const text = await document.readText();
  signal.throwIfAborted();
  return text;
}
```

These checks observe cancellation at explicit boundaries. They do not interrupt pending acquisition or IO; use an adapter that accepts `AbortSignal` when interruption is required. A successfully acquired resource is still released if cancellation is observed afterward. Twill introduces no task scheduler, actor runtime or automatic cancellation.

## Run the complete example

Use the [ledger workflow](https://github.com/swiftuijs/twill/tree/main/examples/general) as a reference for your own application. It combines boundary validation, an owned resource and expected outcomes using ordinary TS interfaces.

The example verifies empty and valid ledgers, malformed input, invalid rows, integer overflow, acquisition/read/cleanup failures and cancellation before and after acquisition. It also reads a real temporary file and verifies that its owned handle is closed before the result resolves. The Vite build includes the workflow in the normal SSR bundle.

## Match associated values

Accepted associated-value enums describe tagged records once. RFC 0016 implements explicit case descriptors with named payload bindings:

```twill
enum FetchState<T> {
  case idle;
  case loaded(value: T);
}

function length(state: FetchState<string>) {
  return match (state) {
    case FetchState.idle(): 0;
    case FetchState.loaded({ value: text }): text.length;
  };
}
```

This replaces repeated tag literals with checked factory references. Run `twill check` to catch omitted variants and invalid fields. Selection adds no factory call or matching runtime; direct-return output uses a native switch and destructuring. Structural records still need normal boundary validation. Match expressions are available in 0.2.0; [the syntax guide](syntax.md#match-expressions) describes review status, compatibility and allocation costs.
