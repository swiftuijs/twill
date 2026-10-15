---
title: 'Twill CLI reference'
description: 'Reference Twill compile, check, run, declarations, export and doctor commands, configuration options, source maps and diagnostic output.'
---

# CLI reference

The `@swiftuijs/twill` package provides the `twill` command. Install it in your application before running commands: `npm install --save-dev @swiftuijs/twill@0.3.1` or `pnpm add -D @swiftuijs/twill@0.3.1`. See [getting started](./getting-started.md#install) for prerequisites and a runnable first module, or [shell scripting](./scripting.md#install-a-global-command) for global installation.

Run project-local commands from your application root. Examples below use `pnpm exec twill ...`; with npm, use `npm exec -- twill ...`. Package scripts use `twill ...` directly. A global installation permits `twill ...` in your terminal.

```sh
pnpm exec twill --help
```

Your normal `tsconfig.json` supplies project types and JSX settings. Commands work without `twill.config.json`; its optional `implicitReturn` setting changes that language behavior. The [runtime helper option](./runtime.md) in 0.2.0 also selects inline or external cleanup emission.

## Run an executable script

Twill 0.2.0 accepts both direct and explicit script invocation:

```sh
pnpm exec twill scripts/build.twill 'app, tests'
pnpm exec twill run scripts/build.twill 'app, tests'
```

On Linux/macOS, start the file with `#!/usr/bin/env twill`, grant executable permission and use `./scripts/build.twill` when `twill` is on PATH. `pnpm exec ./scripts/build.twill` supplies a project-local binary. Windows uses the explicit CLI forms. Entry filenames may be extensionless.

Arguments after the file are script arguments, never compiler options. `twill run -- <file>` handles dash-prefixed filenames; `twill run check` disambiguates a filename from a compiler command. The script sees standard Node argv, cwd, environment and descriptors. It executes in the current process, with source maps enabled and native exit/signal behavior. Packages resolve from the script's location, independently of the installed CLI. There is no automatic package installation or type checking. The CLI imports the entry; Node main-module detection (`import.meta.main` / `require.main === module`) refers to the launcher rather than the script. Use a dedicated executable entry file.

The source runner caches compiled modules across launches. Set `TWILL_CACHE=0` to disable it, or `TWILL_CACHE_DIR` to select an absolute private directory. These are environment settings; arguments after the filename remain script arguments. See the scripting guide for source privacy, bounds and invalidation.

The runner is included in 0.2.0; the explicit Node loader remains available. See [shell scripting](./scripting.md) for the complete example and version boundary.

## Check types

```sh
pnpm exec twill check -p tsconfig.json
pnpm exec twill check -p tsconfig.json --json
```

Checks one configured mixed TS/JS/Twill project and maps diagnostics to original source. It proves switch-expression exhaustiveness using the existing TS type system. Native `tsc` cannot parse Twill source; a successful bundler build is not a substitute for this check.

`-p` / `--project` selects the tsconfig, defaulting to `tsconfig.json` in the current directory. `--json` writes the diagnostic array to standard output. Errors produce exit status 1; a successful check returns 0. This command performs a single check, without a watch loop or referenced-project build.

## Inspect project diagnostics

```sh
pnpm exec twill doctor -p tsconfig.json
pnpm exec twill doctor -p tsconfig.json --json
```

Reports compiler/checker/Node versions, project configuration, source counts and diagnostics. JSON provides the complete structured report. Errors produce a nonzero status. Reports include filenames and diagnostic text; review them before sharing.

Use this when editor types, source discovery or project settings differ from your expectations. The [editor guide](./tooling.md) describes the corresponding VS Code command.

## Compile one file

```sh
pnpm exec twill compile src/service.twill
pnpm exec twill compile src/service.twill -o generated/service.ts
pnpm exec twill compile src/service.twill --js -o generated/service.js
```

The default preserves TS types and lowers Twill syntax to native TS/TSX. `--js` also erases types and lowers JSX. Without `-o`, code goes to standard output. With `-o` / `--out`, it writes code plus an adjacent map, such as `generated/service.ts.map`; output must differ from input.

`-p` / `--project` can select a tsconfig for the compilation's project/JSX settings. Without it, configuration is read from the current directory. This command performs syntax emission, not project type checking.

Twill 0.2.0 accepts `--runtime inline|external` for this command only, overriding project configuration. Check/declarations/export and editor projects use `twill.config.json` so their types and emitted imports agree.

Single-file compilation preserves import specifiers. Use a [build adapter](./build-tools.md) for an application's module graph, or [source export](./adoption.md#export-back-to-native-ts) when converting the project to native TS/TSX.

## Emit library declarations

```sh
pnpm exec twill declarations -p tsconfig.json -o dist
pnpm exec twill declarations -p tsconfig.json --build --json
```

Emits `.d.ts` and declaration maps from a checked source project. It does not emit application JS; combine it with your bundler's library build.

- `-p` / `--project`: root tsconfig; defaults to `tsconfig.json`.
- `-o` / `--out`: root project's declaration output directory, relative to the current directory.
- `--build`: visits referenced declaration projects in dependency order.
- `--json`: reports emitted files, projects and diagnostics as structured output.

Errors prevent writes for the failing project and return a nonzero status. Earlier successfully emitted dependencies remain on disk. Circular references fail explicitly. This is a full declaration build without incremental `.tsbuildinfo`.

See [libraries and declarations](./libraries.md) for the build and package configuration consumers need.

## Export back to native TypeScript

```sh
pnpm exec twill export --help
pnpm exec twill export -p tsconfig.json -o ../native-project --dry-run --json
pnpm exec twill export -p tsconfig.json -o ../native-project
```

`export` writes a checked source graph to a **new directory**, converts `.twill` / `.twillx` into formatted TS/TSX, rewrites relative dialect imports and preserves originals.

- `-p` / `--project`: source tsconfig; defaults to `tsconfig.json`.
- `-o` / `--out`: required destination outside the input project; it must not already exist.
- `--dry-run`: checks and plans the export without writing files.
- `--json`: writes the structured export result to standard output.

Install the optional `@swiftuijs/twill-export` package from the same reviewed build as the compiler. The `twill` command loads it only for export, resolving it from the selected project's dependencies. Missing tooling produces installation guidance; it is never downloaded automatically. Type errors return status 1 without writing output. Invalid destinations and unsupported export constructs also fail with a nonzero status.

See [adoption and migration](./adoption.md) for installation and export boundaries.
