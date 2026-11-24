---
"@evolution-sdk/evolution": minor
---

`toString` and `toJSON` now render Plutus data. `toString` threw `Do not know how to serialize a BigInt` on any `InlineDatum`, `UTxO`, `TxOut`, `TransactionOutput`, `Redeemer`, `RedeemerMap`, `RedeemerArray` or `TransactionWitnessSet` whose data held an integer or a constructor, and so did a template string or `JSON.stringify` holding one. Data without integers rendered wrongly: a byte string as an object of byte values, and a map as `{}`.

The new `Data.toJSON` returns data in its encoded form, as `DataSchema` writes it: an integer as a decimal string, a byte string as hex, a map as `[key, value]` pairs and a constructor as `{ index, fields }`. These classes use it in `toJSON`, so `toJSON().data` is now that encoded form rather than `Data`. `RedeemerValue`, which `RedeemerMap.get` returns, gains `toJSON` and `toString`.

`Value.toJSON` writes `coin` as a decimal string, as `MultiAsset` already writes quantities, so `toString` no longer throws on a `BabbageTransactionOutput`.

`console.log` and `util.inspect` still show the data itself, with `bigint` integers and `Uint8Array` bytes.
