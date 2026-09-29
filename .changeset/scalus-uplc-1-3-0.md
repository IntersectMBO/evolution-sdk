---
"@evolution-sdk/scalus-uplc": minor
---

Move to Scalus 1.3.0 and evaluate through its CBOR-first API.

Scalus reads a UTxO set as CIP-30 `[input, output]` pairs, so the evaluator hands them over
directly instead of assembling a CBOR map with a hand-written map-header writer. Evaluation goes
through `evaluator.evaluateTx` rather than the deprecated `Scalus.evalPlutusScripts`, at protocol
version 11.

The evaluator now also passes the transaction's `maxTxExMem` / `maxTxExSteps` as one budget for all
its scripts, as the ledger applies them, so a transaction whose scripts do not fit fails at build
time rather than on submission.

An unknown redeemer tag is an error instead of defaulting to `"spend"`, which would have mis-priced
a different script. The "zero execution units means failure" check is gone: a failing script raises
an evaluation error, so zero units no longer needs to stand in for one.
