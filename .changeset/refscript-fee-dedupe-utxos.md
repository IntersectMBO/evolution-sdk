---
"@evolution-sdk/evolution": patch
---

`calculateReferenceScriptFee` now deduplicates its UTxO list by output reference before summing scriptRef sizes. The ledger scans the union of a transaction's spent inputs and reference inputs (`txNonDistinctRefScriptsSize`), so a UTxO that is both spent and referenced was counted twice — overcharging the reference-script fee and, for a duplicated scriptRef over half the limit, wrongly failing the build against the 204,800-byte per-transaction cap. Distinct UTxOs carrying the same script still count separately, as the node counts them.
