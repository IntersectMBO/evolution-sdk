/**
 * The Conway fee components the linear `minFeeA * size + minFeeB` does not cover.
 *
 * A transaction carrying redeemers or reference scripts owes these on top of the linear fee, and
 * a builder that charges only the linear part underpays — the node then rejects it.
 *
 * ⚠️ Every value here is computed in exact rational arithmetic. The execution prices and the
 * tier multiplier are rationals in the ledger and decimals on the wire, and `0.0577`,
 * `0.0000721` and `1.2` are none of them representable in binary floating point — so a fee that
 * passes through a `number` is a fee computed from a value the chain never specified.
 *
 * @since 2.5.0
 */

import * as NonnegativeInterval from "./NonnegativeInterval.js"

/** Greatest common divisor, so a rational accumulation stays small enough to keep multiplying. */
const gcdBigInt = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y > 0n) [x, y] = [y, x % y]
  return x > 0n ? x : 1n
}

/**
 * Conway script-execution fee: `⌈priceMem * totalMem + priceStep * totalSteps⌉`.
 *
 * The two prices are combined BEFORE the single ceiling, which is what the ledger's
 * `txscriptfee` does over a transaction's total execution units — so this is not the sum of two
 * independently rounded terms, and not a per-redeemer sum of those either.
 *
 * @since 2.5.0
 * @category fee-calculation
 */
export const scriptExecutionFee = (
  priceMem: NonnegativeInterval.NonnegativeInterval,
  priceStep: NonnegativeInterval.NonnegativeInterval,
  totalMem: bigint,
  totalSteps: bigint
): bigint =>
  NonnegativeInterval.ceilDiv(
    priceMem.numerator * totalMem * priceStep.denominator + priceStep.numerator * totalSteps * priceMem.denominator,
    priceMem.denominator * priceStep.denominator
  )

/**
 * The Conway reference-script ceiling: `maxRefScriptSizePerTx`, 200 KiB.
 *
 * Hardcoded in the Conway era and a protocol parameter from Dijkstra on. A transaction above it
 * is invalid, so there is no fee to report for one.
 *
 * @since 2.5.0
 * @category constants
 */
export const MAX_REF_SCRIPT_SIZE = 204_800n

/**
 * Conway tiered reference-script fee, over exact rationals.
 *
 * The base rate applies to the first `sizeIncrement` bytes and is multiplied by `multiplier`
 * for each tier after it, with a single `floor` of the accumulated total at the end — which is
 * what the ledger does. The accumulation never passes through a `number`, because from the
 * third tier on the per-byte price stops being an integer and a double drifts off the exact
 * value by enough to land a lovelace under the fee minimum.
 *
 * Defaults are the Conway constants: 1.2× per 25,600 bytes.
 *
 * @since 2.5.0
 * @category fee-calculation
 */
export const refScriptFee = (
  totalSize: bigint,
  costPerByte: NonnegativeInterval.NonnegativeInterval,
  options?: {
    readonly multiplier?: NonnegativeInterval.NonnegativeInterval
    readonly sizeIncrement?: bigint
  }
): bigint => {
  if (totalSize <= 0n) return 0n
  if (totalSize > MAX_REF_SCRIPT_SIZE) {
    throw new Error(
      `refScriptFee: ${totalSize} bytes of reference scripts exceeds the Conway maximum of ` +
        `${MAX_REF_SCRIPT_SIZE}; such a transaction is invalid, so it has no fee`
    )
  }
  const mul = options?.multiplier ?? NonnegativeInterval.fromDecimal("1.2")
  const increment = options?.sizeIncrement ?? 25_600n

  let tierNum = costPerByte.numerator
  let tierDen = costPerByte.denominator
  let feeNum = 0n
  let feeDen = 1n
  let remaining = totalSize

  for (;;) {
    const chunk = remaining < increment ? remaining : increment
    feeNum = feeNum * tierDen + chunk * tierNum * feeDen
    feeDen *= tierDen
    const divisor = gcdBigInt(feeNum, feeDen)
    feeNum /= divisor
    feeDen /= divisor
    if (remaining <= increment) break
    remaining -= increment
    tierNum *= mul.numerator
    tierDen *= mul.denominator
    const tierDivisor = gcdBigInt(tierNum, tierDen)
    tierNum /= tierDivisor
    tierDen /= tierDivisor
  }

  // ⚠️ **Floored, deliberately, and only at the end.** The ledger accumulates the tiers as an
  // exact rational and takes a single `floor` of the total, so flooring each tier — or rounding
  // up — reports a different fee than the node computes. What changed here is the arithmetic,
  // not the rounding: a `number` accumulation drifts off the exact rational from the third tier
  // on, where the per-byte price first stops being an integer (base 15 × 1.2 × 1.2 = 21.6).
  // BigInt division truncates, which for a non-negative rational is the floor.
  return feeNum / feeDen
}
