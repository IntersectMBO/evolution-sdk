---
"@evolution-sdk/evolution": minor
---

Plutus data is now encoded by default with `CBOR.PLUTUS_DATA_OPTIONS`, the layout the node writes: non-empty lists and constructor fields indefinite, maps definite. Before, the default was `CBOR.CML_DATA_DEFAULT_OPTIONS`, which also wrote non-empty maps indefinite. `Data.DEFAULT_CBOR_OPTIONS` and `CBOR.TX_DEFAULT_OPTIONS.plutusData` are now `CBOR.PLUTUS_DATA_OPTIONS`, and `CBOR.toTxCodecOptions` maps `CBOR.CML_DEFAULT_OPTIONS` to it.

Only data that holds a non-empty map changes, and only in its map headers. `Data.map([[1n, 2n]])` was `bf0102ff` and is now `a10102`. For such data these change:

- datum hashes from `Data.toDatumHash`, which now match the hashes the node computes
- inline datums, witness datums and redeemer data in new transactions
- script data hashes of transactions that carry such datums or redeemers

Applied script hashes do not change, since `UPLC.applyParamsToScript` already used `CBOR.PLUTUS_DATA_OPTIONS`. Decoding is unchanged, and a decoded transaction keeps the original bytes of its datums and redeemers.

To keep the old bytes, pass the old options:

```ts
Data.toDatumHash(datum, CBOR.CML_DATA_DEFAULT_OPTIONS)
Transaction.toCBORHex(tx, { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.CML_DATA_DEFAULT_OPTIONS })
```

The transaction options cover witness datums and redeemer data. An inline datum in a new output is written with the `Data` default under every option set, as before, so it takes the new layout.

`CBOR.CML_DATA_DEFAULT_OPTIONS` is deprecated in favor of `CBOR.PLUTUS_DATA_OPTIONS`. It keeps its bytes, but matches no tool exactly, so use it only to reproduce bytes and datum hashes written before this release.
