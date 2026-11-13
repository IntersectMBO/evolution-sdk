---
"@evolution-sdk/evolution": patch
---

The CIP-30 wallet decodes the UTxOs `getUtxos` returns with `TxOut` instead of the deprecated `TransactionOutput`, building each `UTxO` straight from the decoded fields. The `UTxO`s it returns are unchanged.
