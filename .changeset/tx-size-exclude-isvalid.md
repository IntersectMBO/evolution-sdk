---
"@evolution-sdk/evolution": patch
---

Transaction size is now measured the way the ledger measures it: `toCBORForSizeComputation`'s 3-element array `[body, witnessSet, auxiliaryData]`, with the `isValid` flag omitted. The new `Transaction.toCBORBytesForSizeComputation` produces those bytes, and both `calculateTransactionSize` (builder fee estimation and the `maxTxSize` check) and `FeeValidation.validateTransactionFee` use them. Measuring the full 4-element encoding overstated the size by exactly one byte — the boolean — so every built transaction overpaid the minimum fee by `minFeeCoefficient` lovelace (44 lovelace at the usual coefficient), and fee validation could reject a transaction whose fee was exactly the ledger minimum.
