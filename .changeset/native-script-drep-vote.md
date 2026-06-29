---
"@evolution-sdk/evolution": patch
---

`TxBuilder.vote()` no longer requires a Plutus redeemer for native-script (multisig) voters. A native-script DRep or constitutional-committee voter is satisfied by vkey witnesses, not a redeemer, so previously such a vote could not be built even though it is ledger-valid. The native-vs-Plutus distinction is now made at build time, once the voter's script is attached or referenced: a redeemer is required only for Plutus-script voters, and a redeemer supplied for a native-script voter is pruned with a warning. The fee continues to be sized for the script's threshold number of vkey witnesses.
