---
"@evolution-sdk/evolution": patch
---

`TxBuilder` no longer requires a Plutus redeemer to authorize a hot credential or resign a native-script (multisig) constitutional committee cold credential. A CC certificate whose cold credential is a native script is authorized by vkey witnesses, not a redeemer, so previously `.authCommitteeHot()` and `.resignCommitteeCold()` could not build these ledger-valid certificates. Mirroring the DRep certificate fix, the native-vs-Plutus distinction is made at build time once the cold credential's script is attached via `.attachScript()` (or supplied through a reference input): a redeemer is required only for Plutus-script cold credentials, and a redeemer mistakenly supplied for a native-script cold credential is pruned from the transaction.
