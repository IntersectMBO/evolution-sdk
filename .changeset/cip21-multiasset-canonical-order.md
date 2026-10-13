---
"@evolution-sdk/evolution": minor
---

`multiasset` and `mint` maps are written in CIP-21 canonical key order.

CIP-21 (Category: Wallets, Status: Active) requires canonical CBOR map-key order in the transaction body: shorter keys first, then lexicographic. It matters because a hardware wallet hashes the body in chunks and the client has to reconstruct those exact bytes. An insertion-ordered multiasset is accepted by a node and cannot be reliably signed by a device; for a mint it is also a transaction-id divergence, because the mint field lives in the body.

The sort is applied **by the encoder that owns the map** — `MultiAsset.FromCDDL` and `Mint.FromCDDL` — and deliberately not through a global codec option, because the same option would also reorder Plutus map keys, which must keep the order they were given. This is narrower than the default-encode-path sorting in the closed #584: nothing outside these two maps changes order.

⚠️ CML 6.2.0 is not an oracle here — it writes multiasset keys in insertion order, so it reproduces whatever order it was handed. The expected bytes in `Cip21CanonicalOrder.test.ts` come from cardano-serialization-lib 15.0.3, which sorts.
