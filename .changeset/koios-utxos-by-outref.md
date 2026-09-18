---
"@evolution-sdk/evolution": patch
---

Fix Koios `getUtxosByOutRef`, which failed for outputs of transactions that ran Plutus scripts and returned outputs from only one transaction when the refs spanned several. It now queries `/utxo_info` with the requested refs instead of decoding whole transactions from `/tx_info`.
