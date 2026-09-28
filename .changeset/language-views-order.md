---
"@evolution-sdk/evolution": patch
---

Fix the script data hash for transactions that use a PlutusV1 script together with a PlutusV2 or V3 script. The language views map put the PlutusV1 entry first, but the ledger sorts its keys shortest first. The V1 key is two bytes, while the V2 and V3 keys are one byte each. The node rejected such transactions before running any script. `CostModel.languageViewsEncoding` now encodes the map with canonical key order, and transactions with a single Plutus language keep the same hash.
