/**
 * Transaction output construction utilities.
 *
 * Provides the canonical function for building `TransactionOutput` values
 * and computing the minimum lovelace required to satisfy the ledger's
 * coinsPerUtxoByte rule.
 *
 * @module TxOutput
 * @since 2.0.0
 */

import { Effect } from "effect"

import type * as CoreAddress from "../../../Address.js"
import * as CoreAssets from "../../../Assets/index.js"
import type * as DatumOption from "../../../DatumOption.js"
import * as CoreScript from "../../../Script.js"
import * as ScriptRef from "../../../ScriptRef.js"
import * as TxOut from "../../../TxOut.js"
import { TransactionBuilderError } from "../TransactionBuilder.js"

// ============================================================================
// Output Construction
// ============================================================================

/**
 * Build a `TransactionOutput` from typed parameters.
 *
 * This is the canonical output-construction helper used by all builder
 * operations and phases.
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeTxOutput = (params: {
  address: CoreAddress.Address
  assets: CoreAssets.Assets
  datum?: DatumOption.DatumOption
  scriptRef?: CoreScript.Script
}): TxOut.TransactionOutput => {
  const scriptRefEncoded = params.scriptRef
    ? new ScriptRef.ScriptRef({ bytes: CoreScript.toCBOR(params.scriptRef) })
    : undefined

  return new TxOut.TransactionOutput({
    address: params.address,
    assets: params.assets,
    datumOption: params.datum,
    scriptRef: scriptRefEncoded
  })
}

// ============================================================================
// Minimum UTxO Lovelace
// ============================================================================

/**
 * Constant overhead in bytes for a UTxO entry in the ledger state.
 * Accounts for the transaction hash (32 bytes) and output index that are
 * part of the UTxO key but not serialised in the transaction output itself.
 *
 * @see Babbage ledger spec: utxoEntrySizeWithoutVal = 160
 */
const UTXO_ENTRY_OVERHEAD_BYTES = 160n

/**
 * Maximum iterations for exact min-UTxO fixed-point solving.
 * Converges in 1–3 iterations because only the lovelace CBOR-width can change.
 */
const MAX_MIN_UTXO_ITERATIONS = 10

/**
 * Calculate the minimum lovelace required for an output based on its actual
 * CBOR-encoded size.
 *
 * Uses the Babbage/Conway formula:
 * ```
 * minLovelace = coinsPerUtxoByte × (160 + serialisedOutputSize)
 * ```
 *
 * Iterates to a fixed point because the lovelace amount itself affects the
 * CBOR encoding width, which feeds back into the size calculation.
 *
 * @since 2.0.0
 * @category ledger-rules
 */
export const calculateMinimumUtxoLovelace = (params: {
  address: CoreAddress.Address
  assets: CoreAssets.Assets
  datum?: DatumOption.DatumOption
  scriptRef?: CoreScript.Script
  coinsPerUtxoByte: bigint
}): Effect.Effect<bigint, TransactionBuilderError> =>
  Effect.gen(function* () {
    const calculateRequiredLovelace = (lovelace: bigint): bigint => {
      const assetsForSizing = CoreAssets.withLovelace(params.assets, lovelace)

      const tempOutput = makeTxOutput({
        address: params.address,
        assets: assetsForSizing,
        datum: params.datum,
        scriptRef: params.scriptRef
      })

      const cborBytes = TxOut.toCBORBytes(tempOutput)
      return params.coinsPerUtxoByte * (UTXO_ENTRY_OVERHEAD_BYTES + BigInt(cborBytes.length))
    }

    let currentLovelace = 0n

    for (let i = 0; i < MAX_MIN_UTXO_ITERATIONS; i++) {
      const requiredLovelace = calculateRequiredLovelace(currentLovelace)
      if (requiredLovelace === currentLovelace) {
        return requiredLovelace
      }
      currentLovelace = requiredLovelace
    }

    return yield* Effect.fail(
      new TransactionBuilderError({
        message: `Minimum UTxO calculation did not converge within ${MAX_MIN_UTXO_ITERATIONS} iterations`
      })
    )
  })
