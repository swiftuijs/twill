# Syntax and semantics

The extension adds a trailing closure to an identifier, a member expression, or a call expression. The closure becomes the call's final argument. Parenthesized callable results, such as `(factory()) { ... }`, invoke the result. Empty parentheses can be omitted, including tightly written TS type arguments: `items.map<number> { x in x * 2 }`. Spaced comparisons retain the ordinary JS operator grammar. Calls can chain after the closure: `items.map { x in x * 2 }.filter(Boolean)`.

```text
call { statements }
call { parameters in statements }
call { async parameters in statements }
call { statements } label: { statements } another: { statements }
```

Use parentheses for typed parameters, destructuring, defaults, rest parameters, or a return annotation: `{ (value: number): string in String(value) }`. Bare names also work: `{ value, index in value + index }`. `async` is a modifier when followed by parameters; `{ async in async }` has a parameter named `async`.

One expression statement implicitly returns its value. Multiple statements have ordinary arrow-body semantics and require an explicit return. Set `implicitReturn: false` to disable the extension's implicit return. `$0`, Swift parameter labels at the call site, capture lists, `throws`, Swift types, and if expressions are not part of this language.

Subsequent closures require labels. Labels lower to positional callbacks, without reflection on TypeScript signatures or parameter names. Labels need not match a function's parameter names. `new Constructor { ... }` and trailing closures on tagged template expressions are not supported; write an ordinary callback or explicitly call the returned function.

## Implicit member callbacks

A trailing closure without a parameter header may use `.property` to access its first callback argument:

```twill
const activeUsers = users.filter {
  .active;
};
const names = users.filter {
  .active && .verified;
}.map {
  .profile?.name ?? 'Anonymous';
};
```

This lowers to ordinary arrows such as `users.filter(user => user.active)`. Callback types come from the normal API; unknown members produce TypeScript diagnostics. Member chains, method calls, optional chains and operators keep native JS semantics. A method such as `.matches(query)` retains its receiver. Each `.property` is an ordinary property read, not a cached value or a property-name string.

Nested trailing closures bind independently: `groups.map { .users.filter { .active } }` reads `users` from the group and `active` from each user. Within one closure, all leading member accesses refer to its first argument. Use a named header for additional arguments or references to an outer callback's parameter.

Explicit `return`, guards and lexical blocks can use the same shorthand. A `defer` body captures the enclosing callback's receiver. Ordinary nested functions, arrows, class fields and methods do not inherit the shorthand; give the outer parameter a name when capturing it there. A headerless closure that never uses a leading member retains its existing zero-parameter behavior.

Do not mix shorthand with an explicit parameter header, including `() in`. Component children/render-prop/slot closures require their normal content or explicit parameter syntax; ordinary callbacks inside them may use shorthand. `implicitReturn: false` still disables single-expression returns, so write an explicit return with that option.

This is Twill's first-argument member shorthand. It does not implement Swift's contextual enum/static-member lookup, `$0`/`$1` parameters or general point-free function composition. Use native expressions outside trailing closures. No helper, proxy or language runtime is introduced.

## Ambiguities and semicolons

`fn() { ... }` is extension syntax, even across a newline. Write `fn(); { ... }` for a separate block. Bare names or member expressions followed by a brace on another line remain separate statements; keep `run { ... }` on one line or write `run()\n{ ... }`.

Inside a header, the first top-level `in` separates parameters from the body. To evaluate JavaScript's `in` operator as the first expression, parenthesize it: `run() { ('key' in object) }`. Single object expressions also need parentheses, as in an ordinary arrow: `run() { ({ value: 42 }) }`.

Standard `if (check()) { ... }`, loop bodies, functions, classes, methods, object literals, and labeled blocks are unchanged. `.ts` / `.js` files are never opted into this dialect by the default build plugin.

## Guards

```text
guard expression else { exiting statements }
guard const identifier = expression else { exiting statements }
guard const { property, nested: { value = fallback }, ...rest } = expression else { exiting statements }
guard const [first, ...rest] = expression else { exiting statements }
```

`else` is required, even for a one-line guard. Write `guard b != 0 else { return 0; }`; `guard b != 0 { return 0; }` is incomplete. The braced block is the failure branch, so it executes when the condition is false and must exit the enclosing scope.

A condition becomes `if (!(expression))`. An identifier binding becomes `const identifier = expression; if (identifier == null)`. Bindings use the surrounding JS lexical scope, evaluate their initializer once, retain falsy values, and support ordinary TS type annotations. Only one declaration is allowed. A binding used as an unbraced conditional/loop body is rejected; add braces. No callback, exception wrapper or runtime dependency is introduced.

A destructured binding checks the **whole initializer** in a hygienic temporary, then destructures after the failure block. Getters, nested patterns, defaults, array iteration and rest follow native JS behavior and run only on success. It does not validate individual fields, non-null nested values or untrusted JSON. An annotation applies to the whole initializer. Pattern names retain their native temporal dead zone in the initializer and failure block; using them there is an error. In an identifier guard, the identifier is initialized before the failure block and can contain null/undefined there.

```twill
function label(input: { name?: string } | null) {
  guard const { name = 'Anonymous' } = input else {
    return 'Missing';
  }
  return name;
}
```

The failure block must provably exit: a direct `return`, `throw`, `break`, or `continue`; a nested block with an exit; or an `if` with exits in both branches. Exit inference is deliberately conservative: calls (even TS `never` functions), loops, switch statements and try statements do not prove an exit. Existing JS rules still determine whether a return or labeled break/continue is legal. Each guard inside a failure branch is checked independently. In a component children closure, own-scope `return` remains forbidden; `throw` and loop exits are available. A condition guard used as a single unbraced body lowers inside braces so an outer `else` retains its original association.

`guard` is contextual at a statement boundary when its condition/binding is followed by a top-level `else`. Existing `guard()`, `guard = value`, `object.guard` and `guard:` labels retain their meaning. Like other JS statements, use semicolons where adjacent expressions could otherwise join across lines. Parameter and expression tokens retain their original source positions, so TS narrowing and diagnostics operate on the lowered code.

<a id="branch-nullish-bindings-unreleased"></a>

## Branch nullish bindings

Twill 0.2.0 adds immutable success-branch bindings from [RFC 0018](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0018-optional-branch-bindings.md).

```twill
export function label(input: { name?: string } | null) {
  if const { name = 'Anonymous' } = input {
    return name;
  } else {
    return 'Missing';
  }
}
```

The initializer runs once. Strict native null/undefined checks select success, preserving zero, false, empty strings and NaN. The binding exists only in the success block. Initializer, else and following references resolve in the outer scope, even when an outer binding has the same name. Unlike `guard const`, a successful binding does not continue after the statement. Object/array patterns, defaults, rest and an optional whole-initializer TS annotation retain their native behavior; destructuring runs only after the nullish check. This does not validate nested fields or catch exceptions/rejections.

As in Swift's condition parsing, a brace after the outer initializer expression begins the branch. Group a trailing-call initializer: `if const user = (find(id) { candidate in candidate.active }) { use(user); }`. Calls and grouped expressions inside arguments retain trailing closures. Formatting keeps the required grouping. Native `if (...)` remains unchanged.

One binding and a braced success body are required. Else is optional and may be a block or another native/binding if. Multiple bindings, while bindings and if expressions are not implemented. Await/yield remain in their enclosing scope; return, break/continue, finally and branch-local defer retain their ownership. Lowering adds a hygienic temporary and a scoped native const/nullish branch, with no closure, optional wrapper or runtime import in either runtime mode. Type inference, source mappings and native declarations/export use ordinary TS.

<a id="associated-value-enums-unreleased"></a>

## Associated-value enums

This implements [accepted RFC 0015](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0015-associated-value-enums.md) in Twill 0.2.0. [Implementation PR #13](https://github.com/swiftuijs/twill/pull/13) records its review and validation.

```twill
export enum LoadState<T, E = Error> {
  case idle;
  case loaded(value: T);
  case failed(error: E);
}

const state: LoadState<number> = LoadState.loaded(42);
const idle: LoadState<number> = LoadState.idle();
```

The declaration creates a normal TS union type and a same-named object of factory methods. Every case, including a case without payloads, is constructed with a call. A case has a readonly `kind` equal to its name and readonly named payload fields. Construction evaluates arguments once, allocates one result object and retains payload references. Readonly is shallow static checking; values are not frozen, copied deeply or compared by value. Structurally compatible native records are valid inputs.

Payload fields require names and native TS types. Generic factories infer the parameters used by their payloads, including constraint/default dependencies, and return precise variant types. Match them using the existing `case { kind: 'loaded', value }` syntax below; new variants expose missing arms through `twill check`. Defaults keep their existing catch-all semantics. Native TS numeric/string enums retain their original behavior.

Duplicate cases/fields, a payload named `kind`, optional/default/rest payload fields, const/ambient associated enums, const/variance type parameter modifiers and mixed native members are rejected. Like native lexical declarations, associated enums require braces in control-flow bodies. Custom tags and contextual case shorthand are separate proposals; the match expression is described below. Constructor completion, diagnostics, formatting, shared highlighting, declarations and source export are supported in this implementation; enum declaration/case/payload/type-parameter rename is conservatively withheld until its linked type/tag edits can be proven complete.

## Switch expressions and union patterns

In an expression position, `switch (subject) { ... }` produces the selected arm's value. A native switch **statement** retains native fallthrough, break and statement-body semantics. To return a switch from a closure, write `items.map { item in return switch (item) { ... }; }` or parenthesize it as a single expression.

```twill
type Outcome = { kind: 'ok'; value: number } | { kind: 'error'; message: string };
function describe(outcome: Outcome): string {
  return switch (outcome) {
    case { kind: 'ok', value }: value.toFixed(2);
    case { kind: 'error', message }: message;
  };
}
const size = switch (count) {
  case 0: 'empty';
  default: 'nonempty';
};
```

Each arm contains one expression or `throw expression`, terminated by a semicolon or ordinary ASI. There is no fallthrough. Multi-statement arms, fallthrough labels and jumps are not expression syntax; use a native switch statement or call an ordinary helper. The subject is evaluated once, value-case tests follow native strict-equality and evaluation order, and only the selected arm's value/defaults execute. Duplicate value labels follow native first-match behavior.

Native switch statements retain JS implicit fallthrough. TypeScript's `noFallthroughCasesInSwitch` option can diagnose fallthrough from nonempty statement cases without changing execution; empty grouped labels remain valid. Match and switch expressions terminate the selected arm automatically.

An object case has exactly one noncomputed literal discriminator, with the same key in every object arm. The other properties bind values with native nested/default/rest patterns. Literal discriminators can be strings, numbers, booleans, bigint or null; regular expressions are not discriminator literals. Object cases and value cases cannot mix; either form allows one `default`. Bindings have a separate lexical scope per arm. Matching selects by the discriminator, then performs native destructuring including that key; a discriminator getter is therefore read for selection and again in the selected object arm. Object rest excludes every mentioned key, including the discriminator. Patterns match a typed union, not arbitrary shapes or deep predicates.

Without `default`, generated TS checks `subject satisfies never` after the returning arms. Run **`twill check`** or the editor checker to prove exhaustiveness, including unions imported from ordinary TS. Adding a variant exposes omitted cases. Transpile-only Vite/bundler builds and the playground do not prove types. Unknown/unbounded subjects need a default. Unexpected unchecked JS values throw `TypeError('Non-exhaustive switch expression')`, rather than returning undefined. The optional typed linter also checks native switches and can require every known union case even with a default.

A direct `return switch (...)` lowers to a scoped native switch without an additional function. Other expression positions use a synchronous lexical arrow IIFE, retaining `this`, `arguments`, `super` and `new.target`. This can allocate a closure; there is no runtime library, promise conversion or implicit async scheduling. `await` and `yield` inside the switch require a direct return, where they remain in the enclosing function. Elsewhere, bind an awaited subject before switching or write `await switch (...) { ... }` with promise-producing arms. Nested functions can use their own await/yield normally. See [performance](performance.md) for scoped measurements.

<a id="explicit-enum-case-patterns-unreleased"></a>

<a id="match-expressions-unreleased"></a>

## Match expressions

**Available in Twill 0.2.0.** Use the installed compiler and editor from that release or newer. See [the proposal](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0016-pattern-matching.md).

```twill
enum LoadState<T> {
  case idle;
  case loaded(value: T);
  case failed(error: Error);
}

export function describe(state: LoadState<number>) {
  return match (state) {
    case LoadState.idle(): 'Idle';
    case LoadState.loaded({ value: result }): result.toFixed(2);
    case LoadState.failed({ error }): throw error;
  };
}
```

`match` selects enum variants by their `kind`, with no repeated marker in each `case`. The qualified factory reference is checked as a callable descriptor returning the named literal tag; it is never read or called at runtime. Imported aliases, namespaces and native TS/declaration factories work, including type-only imports. Matching uses structural tagged records. A factory descriptor does not add nominal identity or runtime input validation.

Parentheses contain no binding or one native object binding. An empty pattern ignores payload fields. Bindings are `const`, scoped to one arm, and checked against the narrowed subject. Aliases, defaults, nested destructuring and rest retain native behavior and exceptions. Rest includes `kind` unless explicitly bound; it retains native copying/allocation cost. The subject and its selection tag are read once; explicit tag bindings/rest perform their normal extra reads.

Enum patterns may mix with existing object arms using `kind` and a default. Existing object arms retain their discriminator re-read and rest exclusion. Match accepts qualified enum descriptors, tagged-object patterns and a default. Arbitrary value/call cases remain switch-expression syntax: ordinary `case Factory.loaded(value)` there calls the factory and compares strict identity. Native switch statements keep their existing syntax and implicit fallthrough. Match and switch expressions produce one result and never fall through; there is no `fallthrough` control keyword.

`match` is contextual: `match(subject)` followed by a block beginning with `case` or `default` introduces the expression. Its subject is one argument expression; parenthesize comma expressions. Ordinary calls, methods, optional/generic calls and trailing closures named `match` keep their native behavior. Empty or ordinary callback bodies remain trailing closures. The compatibility `switch (...) { case enum State.loaded({ value }): value; }` spelling stays supported for compatibility.

Without a default, `twill check` verifies tag exhaustiveness, including single-variant records. Direct returns add no function; general expression positions retain the existing synchronous IIFE and await/yield restrictions. Descriptor case-method rename is withheld until linked tag edits can be proven complete; native owner/import aliases and local binding renames work. Positional patterns, `.loaded`, `where`, alternatives and deep predicates are deferred. All tools consume this syntax together; keep compiler and tooling versions aligned when it is released.

## Defer

```twill
function example(events: string[]) {
  defer {
    events.push('first');
  }
  defer {
    events.push('second');
  }
  return 42;
} // events gains 'second', then 'first'
```

At a statement boundary, an unescaped `defer` identifier followed by a same-line `{` introduces a cleanup. Horizontal whitespace and same-line block comments are permitted. `defer()` is a normal call, `defer() { ... }` a normal trailing-closure call; assignments, property access and `defer:` labels are unchanged. A newline before `{` keeps the identifier and block as ordinary separate statements. This contextual rule avoids reserving a new identifier throughout JS/TS.

Registration occurs only when execution reaches the statement. The nearest explicit block or function body owns it. Cleanup runs once, in reverse registration order, on fallthrough, return, throw, or a break/continue leaving that scope. A braced loop body owns a stack per iteration; an unbraced `for (...) defer { ... }` registers each callback in the surrounding block. Generator cleanup runs when its scope actually exits, including `.return()`; abandoning a suspended generator does not trigger cleanup.

Top-level module/script cleanup and unbraced switch-case cleanup are rejected. Wrap them in an explicit block. No process-exit hooks are installed. Cleanup arrows capture live lexical bindings, `this`, `arguments`, `super` and `new.target`; this is not value capture. Referencing a later binding works if it has initialized when cleanup executes; leaving before initialization retains the ordinary temporal-dead-zone error.

Cleanup may use local loops, local break/continue, nested functions and nested `defer`. Own-scope `return`, jumps to an outer label/loop and `yield` are rejected. Nested functions can return normally. An explicit `await` requires an enclosing async function and makes that cleanup async. Async cleanups finish serially in reverse order; synchronous cleanups in async functions add no await turn. Returning a promise from a nested helper does not implicitly await it: write `await helper()`. Similarly, `return await task()` keeps a resource alive until task completion; `return task()` exits the scope first, as with native finally.

All registered cleanups run even if the body or an earlier cleanup fails. A cleanup failure replaces the pending return/body error; a subsequent cleanup failure replaces that error, including `throw undefined`. If no cleanup fails, the original completion survives. This matches nested `try/finally`, rather than aggregating errors or using `SuppressedError`.

A single direct cleanup lowers to one optional callback and native `try/finally`, without an array, loop or error accumulator. Multiple or control-flow registrations use a lazy local array and reverse-order drain. Mixed sync/async registrations additionally store a small descriptor per cleanup. No runtime module is imported. Blocks without defer are untouched. Direct function-body function declarations retain hoisting, captures, directives and var/parameter bindings via generated initializers; JS JSDoc remains attached. Function overloads/ambient function declarations directly in a function body containing defer are currently rejected with a diagnostic; place the helper in a separate scope. This restriction is preferable to silently changing type semantics.

## Component closures in `.twillx`

A non-parenthesized uppercase identifier or dotted name with an uppercase final member, followed by a trailing closure, is UI syntax: `Card { ... }`, `Card(props) { ... }`, `UI.Card { ... }`. It becomes a native JSX element. Explicit generic type arguments are preserved. One props object is accepted; multiple props arguments, argument spreads and optional component calls are rejected with diagnostics. For a component without child content, use ordinary JSX, such as `<Icon />`; calls without a closure retain JS semantics.

In `.twill`, all trailing closures are ordinary callbacks. In UI files, lowercase names and parenthesized callable expressions retain ordinary callback behavior: `run { () in 42 }`, `(Run) { 42 }`. This is a lexical rule, like JSX component naming; it does not inspect export lists, special-case libraries or reflect on inferred function types. Alias lowercase component exports to uppercase names, as for JSX.

A single child expression is passed directly. A single final expression preceded only by declarations or `defer` returns its original value from the content closure. Other component closures collect expression statements into a hygienic local array through blocks, conditions, loops, switches and try/catch/finally. Declarations and nested functions/classes retain their scope. Own-scope `return` is rejected; `throw`, `break` and `continue` retain normal rules. Side-effect expressions also contribute their result, so use declarations or a helper when unwanted. `defer` executes when the children closure exits.

React receives a single collected value directly, or an array for multiple values; components are never invoked as ordinary functions. Keys, refs, hooks, memo and class identity follow JSX semantics. React supports one children closure. A parameter header such as `Data { value in <span>{value}</span> }` produces a function child (render prop), with parameter types inferred from native JSX props. It retains ordinary arrow-body semantics: one expression returns implicitly; multiple statements need an explicit return. Other render-prop callbacks belong in the props object.

Vue JSX receives a slot object containing a lazy default closure. Subsequent labelled closures become named slots, with duplicate names rejected. Default and named slot headers can declare scoped-slot parameters. Vue’s native JSX declarations may require explicit slot parameter annotations under `noImplicitAny`. The closure runs when the child invokes the slot, preserving reactive reads. Select the normal JSX runtime using tsconfig’s `jsxImportSource` (including inherited settings) or the standard file pragma. Otherwise a Vue import selects Vue and React is the default. Use an explicit standard setting in files importing only Vue third-party libraries or combining frameworks. Prop and slot checking follows the framework’s own JSX declarations.

Native JSX can be freely mixed with these closures. No component-name configuration, adapters or runtime wrapping functions are used. Ordinary data processing uses normal JS collection APIs; there is no globally configured result-builder mode.

## Compatibility boundaries

Only `.twill` (TS) and `.twillx` (TSX/UI) opt into the dialect. Both accept JavaScript syntax with optional types. Native JS files retain JS/JSDoc checking, and all standard source files keep their native parsers. The virtual checker appends a native suffix internally; avoid declaring another real file such as `helper.twill.ts` beside `helper.twill`, since that name is reserved for its virtual representation.

Supported baselines are modern JavaScript and TypeScript 5.9 syntax, including generics, typed closures, interfaces, enums, namespaces, mapped types, `as`, `satisfies`, `const` type parameters, private fields, import attributes, decorators supported by the parser, and JSX in the `x` extensions. This is not a replacement implementation of the entire evolving TypeScript parser; unsupported constructs must fail with a source diagnostic. Use the compatibility tests as the exact executable contract.

JSX lowers to the selected automatic runtime in build plugins and the Node loader (React by default, Vue via its JSX runtime). `.vue` SFC transformation still requires the host’s Vue plugin. Other standard automatic JSX runtimes can be selected through `jsxImportSource`; their ecosystem-specific transformations are outside this compiler. Use `twill declarations [-p tsconfig.json] [-o dist] [--build]` for standard declarations and composed maps. `--build` visits references in dependency order; native incremental `tsc --build` remains unsupported. Vite handles JS library emission.

Local imports are supported. Standard resolver aliases, package exports and bare packages are delegated to the host; custom extensionless aliases should include the full extension when the host cannot resolve them. The opt-in Node loader emits local native ESM TS/TSX/JSX as well as Twill and delegates npm dependencies to Node. Native TS/JS documents in configured VS Code mixed projects use the bundled TS-server bridge for cross-file types and mapped definitions. See [interoperability](interoperability.md) for loader and CommonJS boundaries.

The VS Code extension's common-input recovery is deliberately limited. Arbitrarily malformed input can temporarily suspend semantic assistance; strict syntax diagnostics remain visible. Rename, auto-import edits, import organization and safe spelling fixes map back to source. Unmappable edits are withheld. Document formatting uses the Prettier package. The Vite React adapter supplies Fast Refresh. General refactoring and fix-all are unavailable.
