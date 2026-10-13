---
"@evolution-sdk/evolution": minor
---

The Conway fee components are computed in exact rational arithmetic, and the execution fee is charged the way the ledger charges it.

`NonnegativeInterval.fromDecimal` is the new constructor behind it: a protocol parameter that is a rational in the ledger arrives as a decimal over JSON, and `0.0577`, `0.0000721` and `1.2` are none of them representable in binary floating point. It reads a `number` through its shortest round-tripping decimal, so `1.2` becomes six fifths rather than the dyadic expansion of the nearest double, and `0.0577` becomes `577/10000`. `NonnegativeInterval.ceilDiv` comes with it.

**`tierRefScriptFee` keeps its signature and its rounding, and loses the doubles.** From the third tier on, the per-byte price stops being an integer (44 × 1.2 × 1.2 = 63.36), and a `number` accumulation drifts off the exact rational. At the cost-per-byte this module falls back to when the protocol parameter is absent — 44 — the drift put the fee **one lovelace below** the exact figure at 51 of the 204,800 permitted sizes, and below a fee minimum is a rejected transaction. Reproduced at `totalSize = 102_525` (6,057,920 exact against 6,057,919) and pinned as a test vector, along with two more at other cost-per-byte values. The single `floor` of the accumulated total is unchanged — that is what the ledger does, and the existing vectors still hold.

**The script-execution fee is now one ceiling over the transaction's total execution units**, which is what the ledger's `txscriptfee` computes. It was a ceiling applied to each price term of each redeemer separately, in floating point: for a three-redeemer transaction that came out four lovelace above the ledger's figure — money a caller pays for rounding the chain never asked for. `scriptExecutionFee` is exported for callers that need the component on its own.
