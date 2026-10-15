---
"@evolution-sdk/evolution": patch
---

Scope reference UTxOs per transaction when signing (#483). Batch signing (`signTxsWithAutoFetch`) fetched the union of every transaction's reference inputs and passed the combined list to each transaction's signing call, so a native script referenced by one transaction could add an unneeded witness to an unrelated transaction in the batch. The batch path now signs each transaction with only its own reference UTxOs (the combined fetch is kept), and required-signer computation itself only counts reference UTxOs the transaction actually references, matching the single-transaction path.
