---
"@evolution-sdk/evolution": minor
---

`build()` takes a new `codecOptions` option, the CBOR options to encode the transaction with. The builder computes the fee, the size limit, the minimum UTxO of payment, change and collateral return outputs, the script data hash and the auxiliary data hash over that encoding. The built transaction keeps the encoding through `sign()`, `partialSign()`, `signWithWitness()`, `assemble()` and `submit()`, and evaluators and providers write the same bytes.

```ts
const signBuilder = await client.newTx().payToAddress({ address, assets }).build({ codecOptions: CBOR.TX_CANONICAL_OPTIONS })
const txHash = await (await signBuilder.sign()).submit()
```

For a transaction that hardware wallet tooling witnesses, pass `CBOR.TX_HW_CLI_OPTIONS`. Before it witnesses a transaction, that tooling checks that the map keys are in bytewise order, and `CBOR.TX_CANONICAL_OPTIONS` writes them in length-first order.

The build fails when the options write a native script in the witness set with other bytes than the default options, as options with indefinite arrays do. The ledger hashes the written bytes, so the script would no longer match its script hash.

Before, the builder always hashed the default encoding, so a transaction written with `CBOR.TX_CANONICAL_OPTIONS` carried a stale script data hash and auxiliary data hash.

With no `codecOptions`, `CBOR.TX_DEFAULT_OPTIONS` or `CBOR.CML_DEFAULT_OPTIONS`, every byte, transaction id, fee and signature stays the same.

`Transaction.withCodecOptions(tx, options)` records options for a transaction. `Transaction.toCBORBytes` and `Transaction.toCBORHex` then use them when the caller passes no options. Options passed explicitly, other than `CBOR.TX_DEFAULT_OPTIONS` and `CBOR.CML_DEFAULT_OPTIONS`, come first, then the encoding a decoded transaction was read from, then the recorded options. `Transaction.addVKeyWitnesses` keeps the recorded options.

The chain `txHash` and the seed and private key wallets now hash the body bytes the transaction is written with. Some valid bytes decode to a `Transaction` that the default encoder writes differently, such as a body with its keys in another order. Given such a `Transaction`, `signTx` now signs the decoded body bytes and gives the signature it gives for the hex. Before, it signed a re-encoded body, and the node rejected the witness.
