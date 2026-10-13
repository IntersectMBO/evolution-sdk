/**
 * Minimum lovelace for a transaction output.
 *
 * A UTxO must hold at least `(160 + its serialized size) * coinsPerUtxoByte`, and the value is a
 * fixed point: raising the coin can widen its own CBOR encoding, which raises the size, which
 * raises the coin. The loop below solves it the way the ledger's own sizing does.
 *
 * This lived inside `sdk/builders/internal/txBuilder` where a wallet could not reach it, so
 * anyone balancing a transaction outside the builder had to reimplement it — and an
 * under-estimate produces outputs a node rejects. `calculateMinimumUtxoLovelace` in the builder
 * now delegates here, so there is one implementation.
 *
 * @since 2.0.0
 */
import * as CoreAssets from "./Assets.js"
import * as TxOut from "./TxOut.js"

/**
 * Per-UTxO overhead in bytes, from the Babbage spec (figure 5, UTxO entry size).
 *
 * @since 2.0.0
 * @category constants
 */
export const UTXO_ENTRY_OVERHEAD_BYTES = 160n

/**
 * Iteration cap for the fixed point. It converges in two or three passes in practice; the cap
 * only exists so a pathological input fails instead of spinning.
 *
 * @since 2.0.0
 * @category constants
 */
export const MAX_ITERATIONS = 8

/**
 * The minimum lovelace `output` must hold at `coinsPerUtxoByte`.
 *
 * The output's own coin is ignored — it is what we are solving for — but its address, assets,
 * datum, script reference and encoding format all affect the size and so the answer.
 *
 * @since 2.0.0
 * @category transformation
 */
export const forOutput = (output: TxOut.TransactionOutput, coinsPerUtxoByte: bigint): bigint => {
  const sizedAt = (lovelace: bigint): bigint => {
    const probe = new TxOut.TransactionOutput({
      address: output.address,
      assets: CoreAssets.withLovelace(output.assets, lovelace),
      datumOption: output.datumOption,
      scriptRef: output.scriptRef,
      encodingFormat: output.encodingFormat
    })
    return coinsPerUtxoByte * (UTXO_ENTRY_OVERHEAD_BYTES + BigInt(TxOut.toCBORBytes(probe).length))
  }

  let current = 0n
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const required = sizedAt(current)
    if (required === current) return required
    current = required
  }
  throw new Error(`MinAda.forOutput: did not converge within ${MAX_ITERATIONS} iterations`)
}
