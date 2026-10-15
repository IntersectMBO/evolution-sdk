import { describe, expect, it } from "vitest"

import * as FeeValidation from "../src/FeeValidation.js"
import { calculateTransactionSize } from "../src/sdk/builders/internal/txBuilder.js"
import * as Transaction from "../src/Transaction.js"

// ---------------------------------------------------------------------------
// Ledger size computation (#179)
//
// The ledger measures a transaction with `toCBORForSizeComputation`
// (Cardano.Ledger.Alonzo.Tx): a 3-element array [body, witnessSet,
// auxiliaryData] — the `isValid` flag is omitted. That one size feeds both
// the minimum fee (FeeTooSmallUTxO) and the maxTxSize check
// (validateMaxTxSizeUTxO reads `tx ^. sizeTxF`), so measuring the full
// 4-element encoding overstates the size by exactly one byte (the bool;
// the array header is one byte at both lengths) and the fee by
// 1 × minFeeCoefficient.
// ---------------------------------------------------------------------------

// body = {0: #6.258([]), 1: [], 2: 200000}, witness set = {}, aux = null
const NO_AUX_TX_HEX = "84a300d90102800180021a00030d40a0f5f6"
const NO_AUX_SIZE_HEX = "83a300d90102800180021a00030d40a0f6"

// same body, aux = metadata {0: 0}
const AUX_TX_HEX = "84a300d90102800180021a00030d40a0f5a10000"
const AUX_SIZE_HEX = "83a300d90102800180021a00030d40a0a10000"

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex")

describe("Transaction size computation (ledger, #179)", () => {
  it("encodes a 3-element array without isValid when there is no auxiliary data", () => {
    const tx = Transaction.fromCBORHex(NO_AUX_TX_HEX)
    expect(hex(Transaction.toCBORBytesForSizeComputation(tx))).toBe(NO_AUX_SIZE_HEX)
  })

  it("encodes a 3-element array without isValid when auxiliary data is present", () => {
    const tx = Transaction.fromCBORHex(AUX_TX_HEX)
    expect(hex(Transaction.toCBORBytesForSizeComputation(tx))).toBe(AUX_SIZE_HEX)
  })

  it("does not depend on the isValid flag value", () => {
    const tx = Transaction.fromCBORHex(NO_AUX_TX_HEX)
    const invalid = new Transaction.Transaction({
      body: tx.body,
      witnessSet: tx.witnessSet,
      isValid: false,
      auxiliaryData: tx.auxiliaryData
    })
    expect(hex(Transaction.toCBORBytesForSizeComputation(invalid))).toBe(NO_AUX_SIZE_HEX)
  })

  it("is exactly one byte shorter than the full encoding", () => {
    const tx = Transaction.fromCBORHex(AUX_TX_HEX)
    const full = Transaction.toCBORBytes(tx)
    const size = Transaction.toCBORBytesForSizeComputation(tx)
    expect(full.length - size.length).toBe(1)
    expect(size[0]).toBe(0x83)
  })

  it("calculateTransactionSize returns the ledger size", () => {
    const tx = Transaction.fromCBORHex(NO_AUX_TX_HEX)
    expect(calculateTransactionSize(tx)).toBe(17)
  })

  it("validateTransactionFee accepts a fee at the ledger minimum", () => {
    const tx = Transaction.fromCBORHex(NO_AUX_TX_HEX)
    // fee is 200000; with the ledger size of 17 bytes and a coefficient of
    // 44, the constant that makes the fee exactly the minimum is
    // 200000 - 44 * 17 = 199252. Measuring the full 18-byte encoding would
    // demand 200044 and reject this transaction.
    const result = FeeValidation.validateTransactionFee(tx, {
      minFeeCoefficient: 44n,
      minFeeConstant: 199_252n
    })
    expect(result.txSizeBytes).toBe(17)
    expect(result.minRequiredFee).toBe(200_000n)
    expect(result.isValid).toBe(true)
  })
})
