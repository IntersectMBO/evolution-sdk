---
"@evolution-sdk/evolution": patch
---

`TxBuilder` no longer requires a Plutus redeemer to register, update, or deregister a native-script (multisig) DRep. A script-controlled DRep certificate whose script is native is authorized by vkey witnesses, not a redeemer, so previously these certificates could not be built even though they are ledger-valid. Mirroring the native-script vote fix, the native-vs-Plutus distinction is now made at build time, once the DRep's script is attached via `.attachScript()` (or supplied through a reference input): a redeemer is required only for Plutus-script DRep credentials, and a redeemer mistakenly supplied for a native-script DRep certificate is pruned from the transaction.