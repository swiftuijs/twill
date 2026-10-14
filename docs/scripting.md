# Shell scripting

Twill scripts combine native Node APIs with Swift-inspired `guard`, trailing closures and `defer`. This guide takes you from installation to a runnable script, then adds subprocess execution.

## What to install

Use Node **24 LTS** for a new setup. The supported Node range is `^20.19.0 || >=22.12.0`. **Use compiler and SDK 0.3.0 or newer.**

| What you want to do                              | Required package                                       | Installation scope                             |
| ------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------- |
| Run `.twill` scripts with Node APIs              | `@swiftuijs/twill`, which provides the `twill` command | Project-local, or global for a command on PATH |
| Start subprocesses with `Command` / `Subprocess` | `@swiftuijs/twill-shell`                               | In the project containing the script           |
| Use the subprocess SDK from ordinary JS/TS       | `@swiftuijs/twill-shell` only                          | In the JS/TS project; use your normal runner   |

The SDK is optional for Twill scripts that only use Node APIs. It does not provide the `twill` executable. The 0.3.0 SDK has zero production dependencies; older npm 0.2.0 retains its native implementation dependency. Default inline compilation needs no `@swiftuijs/twill-runtime`. The VS Code extension and AI skill supply editing assistance and instructions; install execution packages separately.

For application modules and bundler setup, start with [getting started](./getting-started.md). For scripts, choose either the project-local setup below or the [global command](#install-a-global-command).

## Run your first project-local script

Run installation commands from the directory containing your application's `package.json`. If you are starting from an empty directory, create a project first:

```sh
mkdir twill-scripts
cd twill-scripts
npm init -y
npm pkg set type=module
```

Install the compiler locally. These commands pin 0.3.0 so the installed runner matches this guide, including when a package manager delays recently published versions:

::: code-group

```sh [npm]
npm install --save-dev @swiftuijs/twill@0.3.0
```

```sh [pnpm]
pnpm add -D @swiftuijs/twill@0.3.0
```

:::

Save this as `hello.twill` in the project root:

```twill
#!/usr/bin/env twill
console.log(process.argv.slice(2));
```

Run it through the installed local command. These forms work on Linux, macOS and Windows:

::: code-group

```sh [npm]
npm exec -- twill hello.twill 'hello world'
npm exec -- twill run hello.twill 'hello world'
```

```sh [pnpm]
pnpm exec twill hello.twill 'hello world'
pnpm exec twill run hello.twill 'hello world'
```

:::

Expected output:

```text
[ 'hello world' ]
```

No bundler or tsconfig is needed to execute this example. Type checking is a separate step, described [below](#type-check-your-scripts).

### Use a package script

Add a script to your existing `package.json`:

```json
{
  "scripts": {
    "hello": "twill hello.twill"
  }
}
```

Run `npm run hello -- 'hello world'` or `pnpm run hello 'hello world'`. Package scripts put `node_modules/.bin` on PATH automatically, so this setup needs no global installation. Commit your manifest and lockfile; teammates install the project dependencies before running it.

### Use the shebang locally

On Linux/macOS, give the file executable permission and let the package manager supply the local command on PATH:

::: code-group

```sh [npm]
chmod +x hello.twill
npm exec --call './hello.twill "hello world"'
```

```sh [pnpm]
chmod +x hello.twill
pnpm exec ./hello.twill 'hello world'
```

:::

The shebang is `#!/usr/bin/env twill` with an ASCII `#!` at the very start of the file. Running `./hello.twill` directly requires `twill` on your shell's PATH; a local dependency alone does not add it there. Windows uses the explicit CLI or package-script forms above.

## Install a global command

For a standalone script that you want to run directly from your terminal, install the compiler globally:

```sh
npm install --global @swiftuijs/twill@0.3.0
twill --help
twill hello.twill 'hello world'
```

On Linux/macOS, the same `hello.twill` can be executed directly:

```sh
chmod +x hello.twill
./hello.twill 'hello world'
```

Your Node installation must make npm's global executable directory available on PATH. If `twill --help` is not found, fix that PATH or use the project-local setup. A global compiler supplies the command; SDK and other imports still resolve from the script's directory. Install them in that script's project, even when the compiler is global.

<a id="optional-subprocess-sdk"></a>

## Add subprocess execution

In the same project, install the SDK as a production dependency. Keep it on the same release version as the compiler:

::: code-group

```sh [npm]
npm install @swiftuijs/twill-shell@0.3.0
```

```sh [pnpm]
pnpm add @swiftuijs/twill-shell@0.3.0
```

:::

Save this as `command.twill`. It starts the current Node executable, so no Git installation or repository is needed:

```twill
#!/usr/bin/env twill
import { Command, Output, Subprocess } from '@swiftuijs/twill-shell';

const result = await Subprocess.run(
  Command.path(process.execPath, ['-e', 'console.log("Hello from a child process")']),
  { output: Output.text({ limit: 64 * 1024 }), timeoutMs: 5000 },
);
console.log(result.standardOutput.trim());
```

Run `npm exec -- twill command.twill` or `pnpm exec twill command.twill`. With a global compiler, use `twill command.twill`. Expected output is `Hello from a child process`.

The SDK follows [Swift Subprocess](https://github.com/swiftlang/swift-subprocess): immutable commands, explicit input/output policies, typed status and owned teardown. Commands execute as literal argv without shell interpretation (`shell: false`). For example, use `Command.name('git', ['status', '--short'])` in a Git repository with Git installed. Each argument is separate; a string such as `'git status | head'` is not a command pipeline. See [command arguments](#run-a-command) and [results and errors](#results-errors-and-cancellation).

### Use the SDK in ordinary JavaScript

Install only `@swiftuijs/twill-shell` in your JS project. Copy the `command.twill` example to `command.mjs`, **omit the Twill shebang**, and run:

```sh
node command.mjs
```

This example uses ordinary JavaScript and needs no compiler. Native TypeScript uses your existing TS runner/build. SDK imports always come from `@swiftuijs/twill-shell`. Version 0.3.0 has no native dependency; the deprecated native package remains only for older SDK compatibility.

## Type-check your scripts

Running a script emits and executes code without checking types. For a new Node script project, install Node type declarations:

::: code-group

```sh [npm]
npm install --save-dev @types/node
```

```sh [pnpm]
pnpm add -D @types/node
```

:::

Create `tsconfig.json` in the project root, or add your script directory to the existing config:

```json
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"]
  },
  "include": ["**/*.twill"]
}
```

Run `npm exec -- twill check -p tsconfig.json` or `pnpm exec twill check -p tsconfig.json`; a globally installed compiler can use `twill check -p tsconfig.json`. A successful check exits with status 0. Native `tsc` cannot parse Twill files. Continue with [editor, formatting and lint setup](./tooling.md).

## Arguments, imports and execution

Extensionless entry scripts work as well. The [CLI reference](./cli.md#run-an-executable-script) covers direct and explicit invocation.

All arguments after the script path are forwarded unchanged, including `--help`, `-p`, `--` and shell metacharacters. Use `twill run -- <file>` for a filename beginning with a dash, or `twill run check` for a filename matching a compiler subcommand. `process.argv` has the normal Node shape: executable, absolute script path, then arguments.

Execution uses the current Node process, native stdin/stdout/stderr, unchanged cwd/environment and the script's own exit status and signal behavior. Imports resolve from the script's location, so making `twill` available globally does not install its application dependencies globally. Configuration still comes from the nearest source project. Source maps are enabled; native `.ts`/`.js` imports and top-level await keep their normal loader meaning. Run `twill check` separately: running a script does not perform type checking. The CLI imports the entry module; `import.meta.main` / `require.main === module` do not identify it as Node's main module. Put executable code in a dedicated entry file and reusable code in imported modules.

The Node ESM loader remains available for advanced Node integration:

```sh
node --enable-source-maps --import @swiftuijs/twill/register scripts/build.twill
```

## Loader registration update (unreleased)

The source update uses Node's synchronous hooks where available, removing Twill's DEP0205 warning on Node 26. npm 0.3.0 still uses the old registration API; installing that version does not include this migration. Supported Node 20 and early Node 22 keep the compatibility adapter. No command syntax or SDK installation changes.

For a Worker that imports Twill, install `@swiftuijs/twill` locally in the script's project. A CLI script registers hooks for its own interpreter; configure the Worker's preload explicitly:

```twill
import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
  execArgv: ['--enable-source-maps', '--import', '@swiftuijs/twill/register'],
});
```

Use a native bootstrap file `worker.mjs`:

```js
import './task.twill';
```

Alternatively, start the parent with `node --enable-source-maps --import @swiftuijs/twill/register parent.twill`; default and nested Workers then inherit those real startup arguments through Node. Replacing `execArgv` replaces inherited preloads. Public registration does not enable the CLI compilation cache. Native CJS and dependencies remain delegated to Node.

## Repeated script startup

The runner caches successfully compiled modules so subsequent fresh launches can skip loading the compiler. Each run still executes the script and its imports normally. Source content, compiler/dependency code and observed project configuration determine validity; editing an imported file or inherited config invalidates the affected module even if timestamps stay unchanged. Source maps keep their original filenames and text. The advanced Node loader above remains uncached by default.

Set `TWILL_CACHE=0` in the environment to disable caching:

```sh
TWILL_CACHE=0 twill scripts/build.twill
# PowerShell: $env:TWILL_CACHE = '0'; twill scripts/build.twill
```

The default directory is `~/.twill/script-cache-v1`. `TWILL_CACHE_DIR` can select an absolute private directory; deleting that directory clears it. Cache files include original source through maps, so disable caching for source you do not want stored. POSIX ownership/permissions and regular-file checks reject unsafe locations; Windows uses the selected directory's inherited user-profile ACL, which Node does not validate. Treat custom directories as user-trusted. Unavailable locations, corrupt entries and cache I/O errors fall back to compilation without changing script output.

Completed storage uses 128 slots of at most 512 KiB each (64 MiB total, excluding filesystem overhead and concurrent temporary files). Collisions or larger modules compile normally. The runner and cache are included in 0.2.0. Native exported/prebuilt JavaScript still avoids compiler work on its first launch.

## Execution and version boundary

The 0.3.0 SDK uses Node's `child_process.spawn` and streams, with zero production dependencies. It has no Rust addon, binary selection or installation-time build. Node starts the child directly and drains both captured streams concurrently. Twill source still runs through the compiler/Node runner; the SDK is a subprocess toolkit.

**Changed in 0.3.0:** the SDK no longer installs `@swiftuijs/twill-shell-native`. Older npm 0.2.0 still requires that retired implementation; its package versions remain downloadable for compatibility. Upgrade the SDK to 0.3.0 instead of installing the native package directly. The command/policy/error API below works in both versions. See the [historical 0.2.0 engine](https://github.com/swiftuijs/twill/tree/v0.2.0/packages/shell-native) for its prebuilds and native cleanup guarantees.

Await each operation. When cancelling a group of commands, abort their shared controller and await `Promise.allSettled(tasks)` before a worker shuts down. Set `process.exitCode` after awaited work. The Node implementation cannot asynchronously join children during `process.exit()` or forced `Worker.terminate()`; the retired native cleanup barrier is absent. Descendants and pipelines remain outside direct-child ownership. Unix cancellation requests SIGTERM before SIGKILL; Windows follows Node's process termination behavior.

## Run a command

```twill
#!/usr/bin/env twill
import { Command, Output, Subprocess } from '@swiftuijs/twill-shell';

guard const input = process.argv[2] else {
  throw new Error('Pass an input argument');
}
const result = await Subprocess.run(
  Command.path(process.execPath, [
    '-e',
    'process.stdout.write(JSON.stringify(process.argv[1]))',
    '--',
    input,
  ]),
  { output: Output.text({ limit: 64 * 1024 }), timeoutMs: 5000 },
);
console.log(result.standardOutput);
```

Spaces, quotes, `$`, newlines and shell operators remain one literal argument. This prevents shell interpretation; executable-specific option parsing still applies. Use the tool's `--` separator where supported. `Command.path` requires an absolute executable path. `Command.name` accepts a bare executable name and uses native PATH search, including Node's platform defaults when PATH is omitted. Prefer a trusted absolute path for controlled automation. Windows `.cmd`/`.bat` files are shell scripts, not directly executable binaries under this contract.

## Input, output and environment

Stdin defaults to EOF via `Input.none()`; stdout and stderr default to `Output.inherit()`, without capture buffers. A string or `Uint8Array` supplies stdin data; `Input.inherit()` explicitly inherits stdin. Node streams write with backpressure and close stdin. Byte input is copied at submission; later caller mutation cannot change it.

Capture is explicit and bounded per stream:

| Policy                    | Result      | Behavior                                               |
| ------------------------- | ----------- | ------------------------------------------------------ |
| `Output.inherit()`        | `undefined` | Inherits the caller's output descriptor                |
| `Output.discard()`        | `undefined` | Uses the native null output descriptor                 |
| `Output.text({ limit })`  | `string`    | Captures up to the byte limit, then decodes UTF-8 once |
| `Output.bytes({ limit })` | `Buffer`    | Captures bytes without text decoding                   |

Each capture requires a finite positive integer byte limit within Node's buffer limit. Limits count bytes, not Unicode characters. Invalid UTF-8 follows Node's replacement-character behavior. Both captured streams drain concurrently. Overflow rejects after cleanup instead of silently truncating a successful result. On a failure, captured fields may contain the retained prefix; chunks beyond the limit are not retained. Limits bound retained stream bytes, not total RSS: concatenation and text decoding need additional memory. Use inherited/discarded output for large output that does not need to be returned; streaming is a later milestone.

`cwd` applies to the child, never `process.chdir`. `Environment.inherit(updates)` snapshots updates and uses the parent's environment at launch; an `undefined` value removes a key. `Environment.replace(values)` uses only those values. Windows keys are normalized case-insensitively. Concurrent runs do not mutate the parent environment or working directory. Commands snapshot/freeze argv at construction and may be reused; each run starts a distinct child. NUL characters and invalid/unknown options reject before launch.

## Results, errors and cancellation

Results expose `processIdentifier`, `standardOutput`, `standardError` and an ordinary TypeScript discriminated union:

```ts
type TerminationStatus =
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'signaled'; readonly signal: NodeJS.Signals | number };
```

`check` defaults to true. Nonzero/signal exits throw `ProcessExitError`, whose `result` contains status and captured output. From 0.3.0, statuses follow Node's reported codes/signals, including Node's limitations for unnamed Unix signals. Released 0.2.0 additionally preserves unnamed numeric signals; the public union remains compatible. `check: false` returns status for native `switch`/`if` handling; it does not hide launch, I/O, abort, timeout or output-limit failures. Exported classes distinguish `ProcessLaunchError`, `ProcessIOError`, `ProcessAbortError`, `ProcessTimeoutError`, `OutputLimitError` and `ProcessTeardownError`. They extend `ProcessError`; use native `try/catch` and `instanceof` rather than proposed typed-throws syntax.

Pass `signal` and/or `timeoutMs` to bound execution. An already-aborted signal starts nothing. On failure, the SDK requests SIGTERM, then SIGKILL after `gracePeriodMs` (default 250 ms). It waits for the directly owned child and I/O to close; `killTimeoutMs` bounds the join after forced termination (default 1000 ms). Timers are scheduling bounds, not real-time deadlines. Windows termination uses the native process handle and cannot promise POSIX graceful handling. Owned listeners/timers are removed on settlement.

The first observed failure remains primary. `cleanupErrors` retains secondary failures; `unresolvedProcessIdentifier` identifies a child that could not be reaped within the bound. These cases reject, even with `check: false`. Error objects may contain bounded output and native causes; the SDK does not automatically log arguments, environment values or output. Choose what to expose in your application logs.

Ownership covers the direct child. Detached grandchildren and arbitrary process trees need a separate contract; killing a shell parent cannot establish tree cleanup. If a descendant retains a captured pipe after the parent exits, a timeout can close the SDK's owned descriptors without claiming to terminate that descendant.

## A Twill build-script example

The [complete example](https://github.com/swiftuijs/twill/blob/main/packages/shell/examples/build.twill) checks input with `guard`, trims a list using a trailing closure, gives a child an isolated working directory/environment and passes JSON on stdin. `defer` removes the temporary directory on success and failure. Real-process tests execute it through the loader, check types/declarations and export it for native JS execution.

To use it in your application, save [build.twill](https://github.com/swiftuijs/twill/blob/main/packages/shell/examples/build.twill) and [main.twill](https://github.com/swiftuijs/twill/blob/main/packages/shell/examples/main.twill) together in a `scripts` directory. With the compiler and SDK installed as above, run `npm exec -- twill scripts/main.twill 'app, tests'` or `pnpm exec twill scripts/main.twill 'app, tests'`. The example prints its JSON result. You do not need to clone or build the Twill repository; source-development commands belong in the [contributor testing guide](https://github.com/swiftuijs/twill/blob/main/docs/contributing/testing.md).

A distributed JS application importing the SDK needs it as a production dependency. The compiler is only needed to load `.twill` source or build/export it. [Native source export](libraries.md) retains the ordinary SDK import, and the emitted JS runs without a compiler loader.

The first stage contains argv execution, bounded collection, status/errors, input, environment/cwd and cancellation. `withProcess`, `Output.stream`, pipelines and shell-tagged templates are not implemented. Continue using native Node APIs for those needs.

## Troubleshooting

| Symptom                                                                        | What to do                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `twill: command not found` or `/usr/bin/env: twill: No such file or directory` | Install `@swiftuijs/twill`. For a local installation, use `npm exec -- twill ...` / `pnpm exec twill ...`, a package script, or the local shebang commands above. For global installation, check npm's executable directory is on PATH. |
| `Permission denied` when running `./hello.twill`                               | On Linux/macOS, run `chmod +x hello.twill`. On Windows, use the explicit CLI.                                                                                                                                                           |
| The shebang mentions `twill\r` or reports a bad interpreter                    | Save the script with LF line endings and put ASCII `#!/usr/bin/env twill` at the start of the file, without a BOM.                                                                                                                      |
| Cannot find `@swiftuijs/twill-shell` or another imported package               | Install it in the project containing the script. A global compiler installation does not provide project imports.                                                                                                                       |
| `process`, `Buffer` or Node modules lack types                                 | Install `@types/node` and include Node types in the script's tsconfig. See [type checking](#type-check-your-scripts).                                                                                                                   |
| A child command is not found, or `git status` fails outside a repository       | The child executable must be installed and on PATH (or supplied as an absolute path); it still has its own working-directory and argument requirements. Try the portable `command.twill` example first.                                 |
| SDK import reports an unsupported or missing native binary                     | This applies to npm 0.2.0. The 0.3.0 SDK has no native binaries; keep SDK versions coordinated and see the version boundary above.                                                                                                      |

## Performance boundaries

The inherited/discarded path uses Node descriptors without capture buffers. Each run starts one child and returns one settlement promise, without per-chunk promises or compilation. Capture retains bounded chunks and decodes text once; input snapshots and concatenation still allocate.

The [complete SDK comparison](https://github.com/swiftuijs/twill/blob/main/packages/shell/benchmarks/complete.mjs) retains equivalent handwritten Node comparisons, all paired samples and source/build hashes. The unchanged gate requires both paired median and upper 95% bound at most 1.10 for seven warm workloads and both 32/128-child default-pool concurrency workloads. Memory, filesystem, cancellation and fresh Node/Twill startup remain separate observations. The smaller cross-platform `benchmark:shell` is an additional diagnostic. See [performance](performance.md) for measured results and historical 0.2.0 Rust observations; those Rust speedups do not describe the replacement.

The executable runner has its own [cold-start report](https://github.com/swiftuijs/twill/blob/main/packages/twill/benchmarks/results/README.md). Fifteen paired Linux/Node 24 launches measured 520.8 ms for the existing loader and 475.0 ms for direct `twill` invocation, with no added regression in that sample. The runner skips compile/check/export tooling initialization and keeps the interpreter PID; source compilation still costs startup time. This is not a general speedup or native-Node cold-start parity claim.

The [source-only runner cache measurements](https://github.com/swiftuijs/twill/blob/main/packages/twill/benchmarks/results/README.md#compilation-cache-prototype) retain 21 fresh-interpreter pairs and compiler/dependency validation. On this Linux/Node 24 workload, uncached/empty-cache/cached/native medians were 513.6/544.3/157.3/43.9 ms. The paired cache-hit ratio was 0.2938 (95% interval 0.2826–0.3046); empty-cache paired overhead was about 7%. These are source-startup observations, not native parity, external-command acceleration or Rust measurements. A valid hit skips compiler initialization; prebuilt JavaScript remains the faster first-launch path.

Environment replacement follows native Node boundaries: Windows supplements omitted libuv-required system variables (including PATH, SYSTEMROOT and TEMP) from the parent; explicit empty strings override those defaults. Node coverage output settings propagate when not explicitly supplied. Use a trusted executable path rather than assuming an omitted Windows PATH disables lookup.
