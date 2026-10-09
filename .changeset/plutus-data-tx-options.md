---
"@evolution-sdk/evolution": minor
---

Witness datums and redeemer data are now written with their own Plutus data options. Before, the witness set wrote them with the transaction options, so a datum in the witness set did not match the bytes its datum hash covers.

`CBOR.TxCodecOptions` holds two sets of options. `ledger` is for ledger structures: the body, the witness set, and the containers that hold datums and redeemers. `plutusData` is for Plutus data items: witness datums and redeemer data. Two presets come with it:

- `CBOR.TX_DEFAULT_OPTIONS`: `ledger` is `CBOR.CML_DEFAULT_OPTIONS` and `plutusData` is `CBOR.PLUTUS_DATA_OPTIONS`, the `Data` default.
- `CBOR.TX_CANONICAL_OPTIONS`: `CBOR.CANONICAL_OPTIONS` for both.

The encoders and schemas of `Transaction`, `TransactionWitnessSet`, `Redeemers` and `Redeemer`, and `Redeemers.toScriptDataHash`, take `CBOR.TxCodecOptions` and default to `CBOR.TX_DEFAULT_OPTIONS`:

```ts
Transaction.toCBORHex(tx)
Transaction.toCBORHex(tx, CBOR.TX_CANONICAL_OPTIONS)
Transaction.toCBORHex(tx, { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.PLUTUS_DATA_OPTIONS })
```

Plain `CBOR.CodecOptions` are still accepted, read as `CBOR.toTxCodecOptions` reads them: the options serve as both, except that `CBOR.CML_DEFAULT_OPTIONS` writes Plutus data with `CBOR.PLUTUS_DATA_OPTIONS`, as passing no options does. Decoded datums and redeemers keep their bytes, and a datum or redeemer added to a decoded transaction is written with the default Plutus data options.

Script transactions whose redeemer data or witness datums hold a non-empty list, map or constructor fields change bytes. Simple data such as `Data.constr(0n, [])` or an integer keeps its bytes. The builder wrote redeemer data definite, for example `d87982a101028103`, and now writes it in the data default with indefinite lists and constructor fields and a definite map: `d8799fa101029f03ffff`. To keep the old redeemer layout, pass `{ ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.CML_DATA_DEFINITE_OPTIONS }` to the encoders and to `Redeemers.toScriptDataHash`.
