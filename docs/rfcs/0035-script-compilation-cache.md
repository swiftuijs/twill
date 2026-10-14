# RFC 0035: Script compilation cache

**Release reference:** 0.2.0 implements the accepted scope; broader/deferred items below remain proposals.
**Status:** Implemented in 0.2.0 for the accepted scope; deferred capabilities remain proposals.
**Kind:** Tooling.
**Release:** 0.2.0.
**Dependencies:** RFC 0026 and RFC 0034 executable-script amendment.
**Review:** Separate startup follow-up to PR #20. Prototype authorization does not imply acceptance, merging or publication.

## Problem and native baseline

A source script starts a fresh Node interpreter and the asynchronous module-hook worker. The current loader eagerly initializes the Twill parser, TypeScript emitter and configuration reader. Existing Linux/Node 24 runner samples measured a 475 ms median for a tiny script, including compilation. Native exported JavaScript has neither compiler initialization nor source transformation.

Cache successful emitted modules for subsequent fresh interpreter launches. Keep source execution, module resolution, argv, I/O, exit codes, evaluation order and source-map behavior identical. Rust does not remove Node/compiler initialization merely by launching the interpreter; profile and remove avoidable work first.

## Design

Enable a disk compilation cache only for the executable runner. The advanced `@swiftuijs/twill/register` loader remains uncached by default. `TWILL_CACHE=0` disables the runner cache. `TWILL_CACHE_DIR` selects an absolute private cache directory; otherwise use a dedicated directory in the current user's home. Invalid, inaccessible or unsafe cache locations silently fall back to compilation. Flags after a script filename remain script arguments, not cache options.

Load the compiler/configuration implementation lazily on the first actual miss. Native JavaScript, CommonJS, dependencies and non-file URLs retain their host paths. Cache only modules the existing loader transforms: Twill entries/imports and local native TS/JSX. Explicit extensionless entries retain their dialect treatment. Node remains the module resolver and executor; no daemon, interpreter, script result cache or global cleanup policy is introduced.

Cache identity includes the source URL, actual source content, dialect/native distinction, fixed emission target, Node version, compiler JavaScript artifact contents and the installed transpilation dependency code/metadata. Each module has its own original filename/source map; cache hits return the same emitted source including its inline map. Imports execute normally on every run. Changed imported source invalidates that module, without caching its runtime values or package resolution.

Record configuration file reads, existence probes and directory probes used to choose the nearest project and resolve inherited tsconfigs. Validate current contents/existence before accepting a hit, including optional/missing files, package-based extends, and changes that preserve timestamps. Unreadable observations disable cache use rather than masquerading as missing files. Malformed Twill configuration and invalid source must still fail; cache only successful compilation. Revalidate configuration observations before storing a miss result. Existing compiler/parser/checker/native semantics are not amended.

Use a private directory and regular private files, reject symlink cache entries, check ownership/permissions on POSIX, and atomically replace entries from exclusive private temporary files. On Windows rely on the selected directory's inherited user-profile ACL; Node does not validate Windows ACLs. This is a user-trusted executable cache, not protection against another process running as the same user. Cache entries contain source text through maps: users handling sensitive source can disable caching.

Use 128 fixed slots of at most 512 KiB each. Content identity inside each slot distinguishes collisions; collisions cause ordinary compilation and replacement. Completed slot storage is bounded to 64 MiB, excluding filesystem overhead and temporary files from concurrent writers. Larger modules compile normally. Validate entry structure and content digest before using it. Truncated/corrupt entries, concurrent writers and cache I/O failures must not alter program results. No cached compiler errors or stdout/stderr/arguments/environment.

## Lowering and interoperability

No new syntax, generated runtime dependency or JavaScript wrapper is added. A hit hashes source/configuration and reads emitted module bytes; a miss additionally initializes the existing compiler and emitter, then writes an optional cache record. The SDK itself never compiles commands. Cache identity and file traversal do not execute package code. Package updates/rebuilds get different identities even when coordinated manifest versions stay unchanged.

## Compatibility and alternatives

### Refinement in 0.3.0

The loader may reuse parsed configuration for up to 64 source directories within its process. Every reuse validates the existing content/existence observations, including absent nearer files and inherited configuration probes; same-size/same-timestamp edits still invalidate it. Reuse skips configuration parsing, not dependency hashing. Failed configuration is not cached. Persistent module-cache identity, bounds, emitted bytes and script behavior stay unchanged. This reduces repeated configuration work in module graphs without claiming native startup parity.

Exported/prebuilt JavaScript remains the smallest startup path. A Rust launcher alone retains the compiler work. A separate native emitter requires TypeScript/JSX, Twill syntax and source-map conformance; it is outside this proposal. Source-only version boundaries must remain explicit in guides and the official skill. Parser/checker, editor, formatter, linter, highlighter, declaration/export and bundler contracts are unchanged because cached output is the existing emitter result.

### Synchronous hook migration (unreleased)

RFC 0026's registration amendment changes the Node adapter, not the cache contract. A hit must still avoid evaluating TypeScript/parser/configuration code in a fresh process. The same lazy compiler, observation validation, emitted bytes, source maps, bounds and optional-I/O fallback serve both adapters. Distinct build contents already invalidate old records. The CLI cache applies to its own interpreter. Workers use the public registration preload, which remains uncached; see RFC 0026 for explicit CLI Worker registration and native startup-argument inheritance.

## Validation and completion

Exercise real fresh interpreter runs: miss/hit, direct/explicit/shebang and extensionless entry, mixed native/dialect imports, query URLs, symlinks, argv/I/O/PID/exit/error behavior, and identical original-source maps. Test content changes with preserved timestamps; inherited configuration changes/creation/deletion; malformed configuration; source/build/dependency identity changes; cache collisions, bounds, corruption, permissions, symlinks, concurrent writes and inaccessible directories. Independent packed consumers on Node 20 and Windows/macOS must exercise miss and hit.

Retain all alternating paired startup samples, environment and source/build hashes. Compare uncached source, empty-cache source, cached source and equivalent native emitted JS separately. Report cache disk bytes and phase profiles. Require a demonstrated cached-startup improvement and inspect miss overhead; do not claim native startup parity or faster external commands. Keep existing coverage, output-size and package gates unchanged.

## Open questions and decision history

The accepted bounded cache shipped in 0.2.0. Broader native-emitter work remains outside that scope, and the native subprocess design is independent. The parsed-configuration refinement above ships in 0.3.0.
