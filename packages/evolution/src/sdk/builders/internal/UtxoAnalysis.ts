/**
 * Low-level UTxO analysis utilities.
 *
 * Predicates and aggregators that inspect UTxO sets without constructing
 * new transaction structures.
 *
 * @module UtxoAnalysis
 * @since 2.0.0
 */

import type * as CoreAddress from "../../../Address.js"
import * as CoreAssets from "../../../Assets/index.js"
import type * as CoreUTxO from "../../../UTxO.js"

// ============================================================================
// Address Predicates
// ============================================================================

/**
 * Return true when the address payment credential is a ScriptHash.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isScriptAddress = (address: CoreAddress.Address): boolean =>
  address.paymentCredential?._tag === "ScriptHash"

/**
 * Filter UTxOs to those locked by a script payment credential.
 *
 * @since 2.0.0
 * @category predicates
 */
export const filterScriptUtxos = (utxos: ReadonlyArray<CoreUTxO.UTxO>): ReadonlyArray<CoreUTxO.UTxO> => {
  const scriptUtxos: Array<CoreUTxO.UTxO> = []
  for (const utxo of utxos) {
    if (isScriptAddress(utxo.address)) {
      scriptUtxos.push(utxo)
    }
  }
  return scriptUtxos
}

// ============================================================================
// Asset Aggregation
// ============================================================================

/**
 * Sum all assets across a UTxO set (or Set<UTxO>).
 *
 * @since 2.0.0
 * @category aggregation
 */
export const calculateTotalAssets = (utxos: ReadonlyArray<CoreUTxO.UTxO> | Set<CoreUTxO.UTxO>): CoreAssets.Assets => {
  const utxoArray = (
    globalThis.Array.isArray(utxos) ? utxos : globalThis.Array.from(utxos)
  ) as ReadonlyArray<CoreUTxO.UTxO>
  return utxoArray.reduce(
    (total: CoreAssets.Assets, utxo: CoreUTxO.UTxO) => CoreAssets.merge(total, utxo.assets),
    CoreAssets.zero
  )
}
