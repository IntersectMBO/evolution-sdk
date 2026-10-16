---
"@evolution-sdk/evolution": patch
---

The redeemer `Data.int(0n)` now works in every builder operation. A Plutus integer is a `bigint`, so that redeemer is `0n`, and the operations tested the redeemer for truthiness. `collectFrom` and the stake operations, such as `withdraw`, failed with "Redeemer required". The DRep and committee operations and `vote` dropped the redeemer, so the build failed later. `mintAssets` dropped it without an error and built a transaction with no mint redeemer. The operations now test whether a redeemer was given, as `propose` already did.
