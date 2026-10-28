---
"@evolution-sdk/evolution": patch
---

`NativeScripts.toJSON` refuses a `slot` or `required` above `Number.MAX_SAFE_INTEGER` instead of truncating it. The cardano-cli JSON form carries both as JSON numbers, so a CDDL uint64 above 2^53-1 has no exact representation in it, and `Number(slot)` returned a different slot with no error. A script decoded from the chain may carry any uint64, so this was reachable on read, not only when authoring a script. `Hash.symbol` no longer routes through `toJSON`, so such a script still hashes and compares.
