---
"@evolution-sdk/cip113": minor
---

New package: CIP-113 programmable tokens — the consumer transfer path, the registry codecs, the deployment records and the issuer derivation.

`Cip113` is what a holder needs: the registry and params codecs, the withdraw-zero redeemers, the smart-wallet address, and `buildTransferTx`, which assembles the unsigned transfer. `Query` fetches the chain state a transfer needs, `Classify` answers what a UTxO is, and `Budgets` carries measured ex-units for the framework scripts.

**Everything is parameterised by a descriptor rather than branching on a version id.** That is not future-proofing: the on-chain shapes moved four times inside one audit window, and a codec that branches on an id has to be edited for each move while one that reads a descriptor does not.

`Deployment` says *where* an instance lives. Script hashes are deploy-time data, never constants — an instance deployed from a different compilation has different hashes, and a constant would send a transfer to a script that does not exist. Where a chain has more than one record, resolution is the consumer's to make explicit: guessing points every holder's smart-wallet address at the wrong protocol.

The ex-units in `Budgets` are re-derivable: `harness/budgets.ts` rebuilds a deployment from the reference blueprint, prices the framework scripts on a local Plutus VM through `@evolution-sdk/aiken-uplc`, and **fails if the recorded presets no longer reproduce** — so an upstream cost change surfaces as a failing check rather than as a rejected transaction. Without a blueprint clone it skips loudly rather than passing quietly.
