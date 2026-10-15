---
title: 'React source study with Twill'
description: 'Inspect a Twill rewrite of a pinned React source snapshot, its native renderer validation and the scope and limitations of the comparison.'
---

# React framework source study

Can Twill handle code inside a framework, rather than just components written with that framework? This study rewrites the React 19.3.0 **client-core source graph** and compares it with the same source written in native JavaScript.

## What is rewritten

The study pins upstream commit `1d34f91dfde6bba84d08b683aaba164c7194dacb` and includes 32 development/production entry and reachable shared modules. The reviewable Twill sources contain 55 guards and seven trailing callbacks. React's MIT copyright headers and license are retained.

For example, React's child-array helper uses the same callback in these two forms:

```ts
return mapChildren(children, (child) => child) || [];
```

```twill
return mapChildren(children) { child in return child; } || [];
```

Early validation branches become guards. Function expressions relying on dynamic `this` or `arguments` remain ordinary JavaScript. No `defer` registration or new runtime helper is inserted into React hot paths.

Both variants first use identical Flow type erasure. This isolates the runtime/build comparison; it does **not** translate React's Flow types into TypeScript or establish typed editor usability. The Twill build uses the public Vite plugin. The native and Twill versions share feature flags, build target and minifier, using React's separate development and production source entry points. Development contracts use CommonJS so React's Node task scheduling retains `module.require`; production/browser builds use ESM.

## What is checked

- Development and production exports, elements/keys, clone behavior, children traversal/iterables and validation errors.
- Hook dispatcher calls, transitions, lazy resolution/rejection/suspension and development `act` queue handling.
- Real browser rendering through the existing ReactDOM package, with state, reducer, context, memo/ref, effect cleanup, transitions and Suspense. Both core variants must produce the same observed results.
- Exact production/development output and gzip budgets relative to the native version; every vendored upstream source has a pinned SHA-256 checksum.

These are framework-source contracts and a renderer compatibility harness, not a rewrite of the harness application. They supplement the language's compiler/editor tests.

## Measurements

The [recorded report](https://github.com/swiftuijs/twill/blob/main/docs/benchmarks/react-framework.json) contains all samples and the environment. On the recorded Linux/Node 24 host, native production code is 12,486 bytes and Twill code is 12,296 bytes; gzip sizes are 4,060 and 4,050 bytes. This small difference comes from this rewrite and minifier, not a general size-reduction guarantee.

Twill adds syntax parsing and emission to the build. The measured interleaved production-build median is roughly 17 ms native versus 157 ms Twill. That is meaningful overhead for this small core graph; process startup, Flow erasure, source preparation and filesystem writes are excluded. Core-runtime medians are close in the warmed workload, but those results do not prove zero overhead for all constructs or engines. See the report for exact current numbers and sampling limits.

Reproduce from a repository checkout:

```sh
pnpm --filter @swiftuijs/twill-example-react-framework build
pnpm --filter @swiftuijs/twill-example-react-framework test:example
pnpm --filter @swiftuijs/twill-example-react-framework test:browser
pnpm benchmark:react-framework --output ../../react-framework-results.json
```

The [framework example](../examples/react-framework/README.md) documents source regeneration from the pinned upstream commit. Normal CI builds use the checked-in source snapshot.

## What this establishes

The compiler and build integration can handle a real React core graph with ordinary JavaScript semantics and no Twill runtime dependency. The generated core can work with an existing ReactDOM renderer in the tested scenarios. The study also makes the added build cost visible.

ReactDOM, reconciler, Scheduler, server components, native renderers, compiler and DevTools remain upstream code. The complete React test suite and official Rollup release pipeline are not reproduced. A full typed framework port, renderer performance and sustained team use are separate gates. This study strengthens compatibility evidence; it does not by itself make Twill production ready or establish a productivity benefit.
