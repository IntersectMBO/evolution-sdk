---
"@evolution-sdk/evolution": patch
---

`NativeScripts.toJSON` refuses a `slot` or `required` outside ±`Number.MAX_SAFE_INTEGER` instead of truncating it. The cardano-cli JSON form carries both as JSON numbers, so a `uint64` slot above 2^53-1 has no exact representation in it, and `Number(slot)` returned a different slot with no error; `required` is an `int64` the ledger allows to be negative, so the lower bound is reachable the same way. A script decoded from the chain may carry either, so this was reachable on read, not only when authoring a script. The refusal is the module's `NativeScriptError`, so callers can catch it by tag.

`NativeScript`'s `Hash.symbol` now hashes the variant structurally instead of routing through `toJSON`, so such a script still hashes and compares. The structural hash also hashes a key hash from its bytes rather than its container, which keeps `Equal.equals` true for a `Buffer` and a `Uint8Array` over the same bytes.
