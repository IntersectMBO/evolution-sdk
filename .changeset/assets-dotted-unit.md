---
"@evolution-sdk/evolution": patch
---

`Assets.getByUnit` reads a dotted unit (`policyId.assetName`), which `Assets.fromUnit` has always accepted. The two disagreed: a value built from a dotted unit answered `0n` when read back with that same string, because the reader sliced the dotted text at 56 characters. `0n` reads as "this asset is not here", so the disagreement was silent. `fromUnit`, `fromRecord` and `getByUnit` now share one parse, and a dot cannot occur in hex, so both spellings stay unambiguous.
