---
title: 'Why Twill? Clearer TypeScript control flow'
description: 'See how Twill guards, defer and trailing closures clarify validation, resource cleanup and callbacks while keeping TypeScript types and JavaScript libraries.'
---

# Why Twill?

Twill extends TypeScript and TSX with Swift-inspired syntax that makes validation, resource lifetimes and business outcomes visible. It adds a small set of syntax forms, compiles to ordinary JS/TS and keeps your existing types, libraries and framework APIs.

The benefit is a clearer way to express recurring control flow. TypeScript can express the same behavior today; Twill earns its place when its syntax makes that behavior easier for your team to review and maintain.

## Keep the successful path in view

A nullable lookup should have an explicit failure path before the rest of the function uses its result.

::: code-group

```ts [TypeScript]
function label(id: string) {
  const user = findUser(id);
  if (user == null) {
    return 'Missing';
  }
  return user.name;
}
```

```twill [Twill]
function label(id: string) {
  guard const user = findUser(id) else {
    return 'Missing';
  }
  return user.name;
}
```

:::

`guard` requires an exiting failure branch. A reader can see that the successful path continues below it, and TypeScript narrows the value there. The binding evaluates the lookup once and rejects only `null` and `undefined`, preserving zero, false and empty strings.

Native TypeScript also narrows after a returning `if`. Twill makes the early-exit intent a syntax contract; it does not introduce a stronger type system. Destructured guards check the whole result before native destructuring, without validating untrusted shapes.

## Put cleanup next to acquisition

Resource ownership is easier to review when acquisition and release are adjacent.

::: code-group

```ts [TypeScript]
async function readOwned(acquire: () => Promise<TextDocument>) {
  const document = await acquire();
  try {
    return await document.readText();
  } finally {
    await document.close();
  }
}
```

```twill [Twill]
async function readOwned(acquire: () => Promise<TextDocument>) {
  const document = await acquire();
  defer {
    await document.close();
  }
  return await document.readText();
}
```

:::

Once registration is reached, `defer` releases the resource when its block exits, including a return or throw. Multiple registrations run in reverse order. An explicit `await` waits for asynchronous cleanup. Register cleanup only for resources you own; `return await` keeps the resource alive until the work finishes.

This is a readability benefit over native `try/finally`, with an explicit cost: cleanup callbacks allocate, and dynamic registrations use a local stack. Prefer native `using` / `await using` for compatible disposal APIs, or `try/finally` in allocation-sensitive loops. See [cleanup semantics](./syntax.md#defer) and [measurements](./performance.md#cleanup-cost).

## Make business-state changes reviewable

Represent related states with normal TS discriminated unions. Twill lets each selected variant produce a value while binding its payload:

```twill
type Outcome = { kind: 'ok'; totalCents: number } | { kind: 'invalid'; reason: string };

function describe(outcome: Outcome): string {
  return switch (outcome) {
    case { kind: 'ok', totalCents }: `${totalCents} cents`;
    case { kind: 'invalid', reason }: reason;
  };
}
```

Run `twill check` to verify that every union variant is handled. Adding a state exposes missing cases. Native TypeScript can achieve this with a switch and a `never` check; Twill supplies an expression form and generates that check for you.

There is no enum wrapper, built-in `Result` class or alternate runtime. Your union can live in a `.ts` module and be consumed from either language. The check is static: transpile-only bundlers and the playground do not prove exhaustiveness. Unknown external input still needs runtime validation.

## Keep ordinary callbacks and components readable

```twill
const names = users.filter { user in
  user.active;
}.map { user in
  user.name;
};
```

Trailing closures expose the callback body after its arguments; a single expression returns its value. Callback parameter types still come from the ordinary TS signature. Existing callbacks and arrows remain available.

In `.twillx`, uppercase component closures become native JSX. React gets ordinary children and render props; Vue gets lazy slots. Component libraries use their public APIs, with no registration lists or Twill wrappers. Hooks, reactivity, component identity and the framework's JSX runtime retain their existing contracts. See [framework integration](./frameworks.md).

## Keep adoption reversible

- Use `.twill` or `.twillx` for one module. Keep native `.ts`, `.tsx`, `.js` and `.jsx` alongside it, with imports in both directions through the supported toolchain.
- Keep your normal tsconfig and build. A Vite plugin handles emission, `twill check` checks types, and the VSIX supplies mapped editor assistance. No Twill config file is required.
- Format and lint with the independent Prettier and ESLint packages. Publish libraries as ordinary JS and generated `.d.ts` files.
- Export a checked source graph to native TS/TSX with the optional export tool. Its [scope and limits](./adoption.md#export-back-to-native-ts) are explicit.

The cost is a compiler integration and a dialect-aware development loop. Native `tsc` cannot parse Twill source. Choosing Twill is worthwhile when clearer reviews and fewer missed branches or cleanup obligations outweigh that tooling cost.

## Evaluate fit before choosing

| A useful place to start                       | What to evaluate                                                 |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Request validation and nullable lookups       | Is the successful path easier to read? Are early exits explicit? |
| Owned files, connections or transactions      | Is release visibly registered, awaited and exercised on failure? |
| State machines and expected business outcomes | Does adding a variant expose all omitted handlers?               |
| Callback pipelines and JSX composition        | Does the syntax improve reviews while retaining framework types? |

Native TS may be the better choice when your team needs every `tsc` workflow and refactoring, unsupported hosts such as a CommonJS Twill loader, or no additional compiler setup. Keep hot loops native where measured allocations matter. Twill does not automatically make an application faster, validate its inputs or enforce resource ownership.

## What you can rely on today

Twill 0.2 is experimental, with a tested end-to-end workflow: compilation, mixed-file checking, editor assistance, formatting, linting, source debugging and independent package installation. Its runtime is the emitted JavaScript; ordinary callbacks and guards require no Twill runtime library. Cleanup and expression switches disclose their extra allocations or functions.

This supports a scoped pilot, not a broad production-readiness promise. Stable distribution, compatibility/support commitments and real project evidence remain adoption gates. Read [support and limitations](./readiness.md) and the [performance methodology](./performance.md), then [start with one module](./getting-started.md) or [try the playground](./playground.md).
