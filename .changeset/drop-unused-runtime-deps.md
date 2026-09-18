---
"@evolution-sdk/evolution": patch
---

Remove three dependencies the published package never imports. `@effect/platform-node` was declared but is not referenced anywhere in the package; because it pins `@effect/cluster`, `@effect/rpc` and `@effect/sql` as peer dependencies, every consumer auto-installed that entire subtree along with `@effect/experimental`, `@effect/workflow`, `@effect/platform-node-shared`, and `@parcel/watcher` with its thirteen prebuilt native binaries. `bip39` is used only by one test and moves to `devDependencies`; `@scure/bip39` remains the runtime implementation. `@types/bip39` is a deprecated stub whose own npm metadata states that `bip39` ships its own type definitions. A fresh install of `@evolution-sdk/evolution` now resolves 23 packages instead of 55, and 72 MB instead of 89 MB, with no source or public API change.
