---
"@evolution-sdk/evolution": minor
---

The Conway fee components live here as `Fees`, in one implementation, computed in exact rational arithmetic.

The plan engine carried its own `scriptExecutionFee` and `refScriptFee` — exact rational arithmetic, independently written, against a builder that computed the same two numbers in floating point. Holding them against each other decided which half of each survived rather than which file did:

- the **execution fee** takes the plan engine's shape, one ceiling over the transaction's total execution units, because that is what the ledger's `txscriptfee` computes. The per-redeemer, per-term ceilings here came out four lovelace high on three redeemers.
- the **reference-script fee** keeps this package's rounding, a single `floor` of the accumulated total, because that is what the ledger's `tierRefScriptFee` does — the plan engine rounded up, which is one lovelace above the node's figure wherever a tier price stops being an integer. It also keeps this package's bound: the real Conway `maxRefScriptSizePerTx` of 204,800 bytes, in place of the plan engine's 64-tier (1.6 MB) guess, now enforced in the fee function itself rather than only in one caller.
- the arithmetic is exact on both, which was the plan engine's contribution: double accumulation here landed a lovelace *below* the exact figure at 51 of the 204,800 permitted sizes.

`ceilDiv` lives on `NonnegativeInterval`, where the other exact-rational helpers are.
