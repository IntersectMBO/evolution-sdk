---
"@evolution-sdk/evolution": patch
---

`Assets.getByUnit` reads a dotted unit (`policyId.assetName`), which `Assets.fromUnit` has always accepted. The two disagreed: a value built from a dotted unit answered `0n` when read back with that same string, because the reader sliced the dotted text at 56 characters. `0n` reads as "this asset is not here", so the disagreement was silent. `fromUnit`, `fromRecord` and `getByUnit` now share one parse, and a dot cannot occur in hex, so both spellings stay unambiguous.

The same shared parse reads a unit case-insensitively. `Bytes.fromHex` accepts either case, so `fromUnit` built an asset from an uppercase unit that `getByUnit` then answered `0n` for, because it compares against `PolicyId.toHex`, which emits lowercase. `getUnits` still emits the canonical lowercase spelling.

⚠️ `Assets.fromUnit` accepts one input it rejected before: the concatenated spelling `policyId` followed by `assetName` with no dot, which is what `getUnits` emits. Sharing the parse means a dotless unit longer than 56 characters now splits at 56, where before the whole string was taken as the policy id and failed with a `PolicyId` parse error.
