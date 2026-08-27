---
"@evolution-sdk/evolution": patch
---

Look assets up by structural equality in `MultiAsset` and compare quantities directly in `Value.geq`. `getAsset`, `hasAsset`, `getAssetsByPolicy`, and `MultiAsset.subtract` read the map with `Map.get`, which compares `PolicyId` and `AssetName` by reference. Keys decoded from CBOR are fresh instances, so every lookup against decoded data missed: `getAsset` returned `undefined` for an asset that was present, `hasAsset` returned `false`, `getAssetsByPolicy` returned an empty array, and `subtract` returned the minuend unchanged instead of reducing it. `Value.geq` inferred sufficiency from `subtract` not throwing, so it reported that a value covered an amount it did not hold. These functions now match keys the way `addAsset` already did, and `geq` compares the coin and each requested quantity directly.
