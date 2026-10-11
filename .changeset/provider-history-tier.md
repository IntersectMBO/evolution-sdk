---
"@evolution-sdk/evolution": minor
---

`ProviderEffect` gains the history and discovery tier: `getTxsAt`, `getAccountTxs`, `getAccountAddresses`, `getAddressesSeen`, `getTxInfo`, `getTxCbor`, `getScriptByHash`, `getUtxosByPaymentCredential` and `getUtxosByPaymentCredentials`.

A transaction builder never asks these; a wallet or an explorer cannot work without them. What has happened to these addresses, which addresses a stake account has ever used (including ones it has emptied, which UTxOs alone cannot tell you), whether the chain has seen an address at all, and the bytes of a transaction rather than an indexer's reading of them.

All nine are optional, so an implementation that cannot answer omits the member and a caller can say "history unavailable" instead of showing an empty list as a fact. Koios implements all of them. `getScriptByHash` returns `undefined` for a hash the chain has not seen — a different answer from a failed lookup — and refuses to report a Plutus version it does not recognise rather than defaulting to V1, because the version decides how the bytes are run.

`IndexedTxRef`, `IndexedTx`, `IndexedTxIO`, `IndexedTxCert` and `IndexedTxCbor` are the result types. `IndexedTx` is documented as the indexer's reading of a transaction rather than the transaction: it cannot be re-encoded to the bytes that were signed, and `IndexedTxCbor` is what to use when the bytes matter.
