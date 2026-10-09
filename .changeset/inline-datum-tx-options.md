---
"@evolution-sdk/evolution": minor
---

A new inline datum is now written with the `plutusData` transaction options, as witness datums and redeemer data are. Before, it was written with `Data.DEFAULT_CBOR_OPTIONS` whatever options the caller passed to the transaction encoder.

```ts
const datum = Data.map([[1n, 2n]])
// Before: 24(h'a10102') under every option set
// Now: 24(h'bf0102ff'), the bytes Data.toCBORHex(datum, CBOR.CML_DATA_DEFAULT_OPTIONS) gives
Transaction.toCBORHex(tx, { ledger: CBOR.CML_DEFAULT_OPTIONS, plutusData: CBOR.CML_DATA_DEFAULT_OPTIONS })
```

The encoders and schemas of `TransactionBody`, `TxOut`, `TransactionOutput` and `DatumOption` take `CBOR.TxCodecOptions` and default to `CBOR.TX_DEFAULT_OPTIONS`. Plain `CBOR.CodecOptions` are still accepted, read as `CBOR.toTxCodecOptions` reads them. `DatumOption.makeFromCDDL` and `TxOut.makeFromCDDL` build the CDDL schema for given `plutusData` options.

With no options, `CBOR.TX_DEFAULT_OPTIONS` or `CBOR.CML_DEFAULT_OPTIONS`, every byte stays the same. Under other options only the bytes inside tag 24 change, so the transaction id of a transaction with a new inline datum changes. A decoded inline datum keeps its bytes, and an inline datum added to a decoded transaction is written with the default options.
