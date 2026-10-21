---
"@evolution-sdk/evolution": minor
---

The transaction builder now spends outputs that hold a datum hash. `collectFrom` takes the datum of each such input in a new `datums` field, and `build({ onMissingDatum: "provider" })` fetches the missing ones with `provider.getDatum`. Before, the builder left the datum out of the witness set, and the node rejected the spend.

```ts
const datum = await client.getDatum(utxo.datumOption)
await client.newTx()
  .collectFrom({ inputs: [utxo], redeemer, datums: [datum] })
  .attachScript({ script })
  .build()

// or fetch each missing datum during the build
await client.newTx()
  .collectFrom({ inputs: [utxo], redeemer })
  .attachScript({ script })
  .build({ onMissingDatum: "provider" })
```

A spend of a datum-hash output at a Plutus script address now fails at `build()` when its datum is neither given nor fetched, and the error names each such input. Code that added the datum to the built transaction by hand should pass it to `collectFrom` instead.

- The built-in providers' `getDatum` keeps the bytes it fetched, through `OriginalBytes`. The witness set and the script data hash write a datum with those bytes, whatever the codec options say, because the datum hash covers them. A datum without recorded bytes is written with the `plutusData` options, as before.
- The builder matches each given datum to its input by hashing the bytes it will write. It fails when a given datum belongs to no spent input.
- The fee now counts the witness datums.
- `TransactionWitnessSet` keeps each datum as the same object when it is built from another witness set, so the recorded bytes survive signing.
- `SignBuilder.assemble` keeps the transaction's own datums and drops the datums of the given witness sets, since the body's script data hash covers only its own.
- `TxBuilderState` has a new `datums` field.
