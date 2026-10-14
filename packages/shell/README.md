# <img src="https://twill.evecalm.com/logo.png" alt="Twill hummingbird" align="right" width="40" height="40" /> Twill shell

Swift-inspired subprocess tools for Twill and ordinary Node JS/TS scripts, Node-based in 0.3.0.

## Install in your project

Use Node 24 LTS for a new setup (supported range: `^20.19.0 || >=22.12.0`). Run from the directory containing your `package.json`; for a new project, run `npm init -y` first. Install the SDK as a production dependency:

```sh
npm install @swiftuijs/twill-shell@0.3.1
```

With pnpm, use `pnpm add @swiftuijs/twill-shell@0.3.1`. This package supplies the process API; `@swiftuijs/twill` supplies the optional Twill source runner. A global compiler does not make this SDK available to project imports. Keep Twill packages on the same version.

## Run ordinary JavaScript

The SDK uses Node spawn/streams with literal argv (`shell: false`), bounded capture and owned cancellation/timeout teardown. It has zero production dependencies; native JS/TS needs no Twill compiler or Rust toolchain.

Changed in 0.3.0: the SDK no longer depends on `@swiftuijs/twill-shell-native`. Older npm 0.2.0 still requires the retired Rust addon; its versions remain downloadable for compatibility. The public command/policy/error API remains; abrupt worker/process-exit cleanup and unnamed Unix signal reporting change to Node's boundaries. See the [scripting guide](https://twill.evecalm.com/scripting#execution-and-version-boundary).

Save this as `command.mjs`:

```js
import { Command, Output, Subprocess } from '@swiftuijs/twill-shell';

const result = await Subprocess.run(
  Command.path(process.execPath, ['-e', 'console.log("Hello from a child process")']),
  { output: Output.text({ limit: 64 * 1024 }), timeoutMs: 5000 },
);
console.log(result.standardOutput.trim());
```

Run `node command.mjs`. Expected output is `Hello from a child process`. This works without Git, a Twill compiler or a global installation. Native TypeScript uses your existing TS runner/build.

## Run Twill source

Install the compiler as well:

```sh
npm install --save-dev @swiftuijs/twill@0.3.1
# pnpm add -D @swiftuijs/twill@0.3.1
```

Copy the JavaScript example to `command.twill` and add `#!/usr/bin/env twill` as its first line. Use the local command:

```sh
npm exec -- twill command.twill
# pnpm exec twill command.twill
```

On Linux/macOS, `chmod +x command.twill` enables `npm exec --call './command.twill'` or `pnpm exec ./command.twill`. To run `./command.twill` directly, install the compiler globally with `npm install --global @swiftuijs/twill@0.3.1` and keep its executable directory on PATH. Windows uses the explicit CLI. Arguments after the script path pass through unchanged. Application dependencies resolve from the script's location. Use compiler and SDK 0.3.0 or newer.

For package scripts, Node type declarations, error handling and troubleshooting, follow the [complete shell scripting guide](https://twill.evecalm.com/scripting). [Getting started](https://twill.evecalm.com/getting-started) covers application modules and build integration.

## Process contracts

Use `Command.path(absolutePath, args)` for a trusted executable; `Command.name(name, args)` uses native PATH search. Arguments are immutable snapshots and remain literal strings, including spaces, quotes, newlines and shell metacharacters. Tool-specific options still matter: use `--` before user-supplied filenames when the executable supports it.

Stdin defaults to EOF; stdout/stderr inherit without capture. `Input.inherit()` inherits stdin; a string or `Uint8Array` writes input with native backpressure. Byte input is copied at submission; cwd and environment are snapshotted then. `Output.text({limit})` and `Output.bytes({limit})` require positive byte limits; `Output.discard()` retains nothing. Output-limit failure rejects after teardown, never returns silent truncation. Capture limits bound retained stream bytes, not total process memory or the final UTF-8 string/buffer allocation.

From 0.3.0, statuses follow Node reports, including its unnamed-signal limitations. Released 0.2.0 preserves numeric unnamed Unix signals. A successful result contains `processIdentifier`, `terminationStatus`, `standardOutput` and `standardError`. Nonzero/signal exits reject with `ProcessExitError`; `check: false` returns that status. Launch/I/O failures, abort, timeout and output overflow always reject. Use ordinary `try/catch` and exported error classes. Errors can carry bounded output and native causes; the SDK never logs them automatically.

`cwd` and `Environment.inherit(updates)` / `.replace(values)` apply only to the child. Pass an `AbortSignal` or `timeoutMs` for cancellation. The default grace period is 250 ms before forced termination, followed by at most 1000 ms joining time. Settlement normally waits for child close and owned I/O. Failed teardown reports `unresolvedProcessIdentifier` and `cleanupErrors`, preserving the first failure. Ownership covers the direct child; descendants and arbitrary process trees are outside this contract. Windows uses its native process handle for termination, without POSIX graceful-signal guarantees.

This first stage does not implement scoped streaming, pipelines, shell templates or shell-text execution. Node ESM is required (`^20.19.0 || >=22.12.0`). Twill source execution uses its existing loader; exported/native JS only needs this SDK. See the [scripting guide](https://twill.evecalm.com/scripting), [RFC 0034](https://github.com/swiftuijs/twill/blob/main/docs/rfcs/0034-shell-scripting-toolkit.md) and [official AI skill](https://twill.evecalm.com/ai). Twill's sibling UI project is [SwiftUI.js](https://swiftuijs.evecalm.com/).

Cancel and await outstanding work before a worker shuts down. Set `process.exitCode` after awaited work; forced `Worker.terminate()` and `process.exit()` cannot perform an asynchronous join. Version 0.3.0 removes the old native cleanup barrier. OS creation and event-loop scheduling are not hard real-time deadlines.

Bounded capture and lifecycle checks add overhead. The reviewed Linux/Node 24 report measured about 17% median overhead for native dual 1 MiB capture and 11% for full duplex, accepted for 0.3.0. See the [recorded costs](https://twill.evecalm.com/performance#node-shell-sdk); this is not a universal native-parity guarantee.

## Development

This package's implementation uses Twill and emits ordinary JavaScript. Build and check a checkout with the workspace tools; see [developing tooling in Twill](https://github.com/swiftuijs/twill/blob/main/docs/contributing/dogfooding.md) for bootstrap and contribution instructions.
