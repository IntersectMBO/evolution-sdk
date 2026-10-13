---
"@evolution-sdk/evolution": patch
---

An asset unit is spelled two ways, and both now mean the same asset everywhere.

The canonical spelling is the concatenation `policyId(56) + assetName`, which `getUnits` emits. `fromUnit` has always also accepted `policyId.assetName`, and a dot cannot occur in hex, so the form is unambiguous.

The two disagreed: `fromUnit("<policy>.<name>", 42n)` built the asset, and `getByUnit` with that **same string** answered `0n`, because it sliced the dotted text at 56. Zero is a plausible answer — it reads as "this asset is not here" — so the disagreement was silent, and silent is how it reaches a balance. One `splitUnit` now serves `fromUnit`, `fromRecord` and `getByUnit`.
