---
"@evolution-sdk/evolution": minor
---

Add Blockchain Applied (BCA) as a built-in provider (`Client.make(...).withBlockchainApplied({ baseUrl, token })`, or `BlockchainAppliedProvider` / `mainnet` / `preprod` / `preview` / `custom` directly). Covers the full `ProviderEffect` interface: `getProtocolParameters`, `getUtxos`, `getUtxosWithUnit`, `getUtxoByUnit`, `getUtxosByOutRef`, `getDelegation`, `getDatum`, `awaitTx`, `submitTx`, and `evaluateTx`.
