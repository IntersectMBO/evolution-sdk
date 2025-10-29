/**
 * Balance Verification Phase
 *
 * Verifies that transaction inputs exactly equal outputs + change + fees.
 * Handles three scenarios: balanced (complete), shortfall (retry), or excess (burn/drain).
 *
 * @module Balance
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"

import * as Assets from "../../Assets.js"
import { BuildOptionsTag, PhaseContextTag, TransactionBuilderError, TxContext } from "../TransactionBuilder.js"
import type { PhaseResult } from "./Phases.js"

/**
 * Helper: Format assets for logging (BigInt-safe, truncates long unit names)
 */
const formatAssetsForLog = (assets: Assets.Assets): string => {
  return Object.entries(assets)
    .map(([unit, amount]) => `${unit.substring(0, 16)}...: ${amount.toString()}`)
    .join(", ")
}

/**
 * Balance Verification Phase
 *
 * Verifies that transaction inputs exactly equal outputs + change + fees.
 * Handles three scenarios: balanced (complete), shortfall (retry), or excess (burn/drain).
 *
 * **Decision Flow:**
 * ```
 * Calculate Delta: inputs - outputs - change - fees
 *   ↓
 * Delta == 0?
 *   ├─ YES → BALANCED: Complete transaction
 *   └─ NO → Check delta value
 *           ↓
 *        Delta > 0 (Excess)?
 *           ├─ YES → Check strategy
 *           │         ├─ DrainTo mode? → Merge into target output → Complete
 *           │         ├─ Burn mode? → Accept as implicit fee → Complete
 *           │         └─ Neither? → ERROR (bug in change creation)
 *           └─ NO (Delta < 0, Shortfall) → Return to changeCreation
 * ```
 *
 * **Key Principles:**
 * - Delta must equal exactly 0 (balanced) or negative (shortfall) in normal flow
 * - Positive delta only occurs in burn/drainTo strategies (controlled scenarios)
 * - Shortfall means change was underestimated; retry with adjusted fee
 * - DrainTo merges excess into a specified output for exact balancing
 * - Burn strategy treats excess as implicit fee (leftover becomes network fee)
 * - Native assets in delta indicate a bug (should never happen with proper change creation)
 * - This is the final verification gate before transaction completion
 */
export const executeBalance = (): Effect.Effect<
  PhaseResult,
  TransactionBuilderError,
  PhaseContextTag | TxContext | BuildOptionsTag
> =>
  Effect.gen(function* () {
    // Step 1: Get contexts and log start
    const ctx = yield* TxContext
    const buildCtxRef = yield* PhaseContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    yield* Effect.logDebug(`[Balance] Starting balance verification (attempt ${buildCtx.attempt})`)

    // Step 2: Calculate delta = inputs - outputs - change - fee
    const state = yield* Ref.get(ctx)
    const inputAssets = state.totalInputAssets
    const outputAssets = state.totalOutputAssets

    // Calculate total change assets
    const changeAssets = buildCtx.changeOutputs.reduce(
      (acc, output) => Assets.merge(acc, output.assets),
      { lovelace: 0n } as Assets.Assets
    )

    // Delta = inputs - outputs - change - fee
    let delta = Assets.subtract(inputAssets, outputAssets)
    delta = Assets.subtract(delta, changeAssets)
    delta = { ...delta, lovelace: delta.lovelace - buildCtx.calculatedFee }

    // Check if balanced: lovelace must be exactly 0 and all native assets must be 0
    const isBalanced = delta.lovelace === 0n

    yield* Effect.logDebug(
      `[Balance] Inputs: ${formatAssetsForLog(inputAssets)}, ` +
        `Outputs: ${formatAssetsForLog(outputAssets)}, ` +
        `Change: ${formatAssetsForLog(changeAssets)}, ` +
        `Fee: ${buildCtx.calculatedFee}, ` +
        `Delta: ${formatAssetsForLog(delta)}, ` +
        `Balanced: ${isBalanced}`
    )

    // Step 3: Check if balanced (delta is empty) → complete
    if (isBalanced) {
      yield* Effect.logDebug("[Balance] Transaction balanced!")
      return { next: "complete" as const }
    }

    // Step 4: Not balanced - check for native assets in delta (shouldn't happen)
    const hasNativeAssets = Object.keys(delta).some((key) => key !== "lovelace")
    if (hasNativeAssets) {
      return yield* Effect.fail(
        new TransactionBuilderError({
          message: `Balance verification failed: Delta contains native assets. This indicates a bug in change creation logic.`,
          cause: { delta: formatAssetsForLog(delta) }
        })
      )
    }

    // Step 5: Handle imbalance (excess or shortfall)
    const deltaLovelace = delta.lovelace

    // Excess: inputs > outputs + change + fee
    if (deltaLovelace > 0n) {
      // Check if this is expected from burn strategy
      const buildOptions = yield* BuildOptionsTag
      const isBurnMode = buildOptions.onInsufficientChange === "burn" && buildCtx.changeOutputs.length === 0

      // Check if this is expected from drainTo strategy
      const isDrainToMode = buildOptions.drainTo !== undefined && buildCtx.changeOutputs.length === 0

      if (isDrainToMode) {
        // DrainTo mode: Merge positive delta (leftover after fee) into target output
        const drainToIndex = buildOptions.drainTo!
        const state = yield* Ref.get(ctx)
        const outputs = state.outputs

        // Validate drainTo index (should already be validated in Fallback, but double-check)
        if (drainToIndex < 0 || drainToIndex >= outputs.length) {
          return yield* Effect.fail(
            new TransactionBuilderError({
              message: `Invalid drainTo index: ${drainToIndex}. Must be between 0 and ${outputs.length - 1}`,
              cause: { drainToIndex, outputCount: outputs.length }
            })
          )
        }

        // Merge delta into target output
        const targetOutput = outputs[drainToIndex]
        const newLovelace = targetOutput.assets.lovelace + deltaLovelace
        const newAssets = { ...targetOutput.assets, lovelace: newLovelace }
        const updatedOutput = { ...targetOutput, assets: newAssets }

        // Update outputs
        const newOutputs = [...outputs]
        newOutputs[drainToIndex] = updatedOutput

        // Recalculate totalOutputAssets
        const newTotalOutputAssets = newOutputs.reduce(
          (acc, output) => Assets.merge(acc, output.assets),
          { lovelace: 0n } as Assets.Assets
        )

        yield* Ref.update(ctx, (s) => ({
          ...s,
          outputs: newOutputs,
          totalOutputAssets: newTotalOutputAssets
        }))

        yield* Effect.logDebug(
          `[Balance] DrainTo mode: Merged ${deltaLovelace} lovelace into output[${drainToIndex}]. ` +
            `New output value: ${newLovelace}. Transaction balanced.`
        )
        return { next: "complete" as const }
      } else if (isBurnMode) {
        // Burn mode: Positive delta is the burned leftover (becomes implicit fee)
        yield* Effect.logDebug(
          `[Balance] Burn mode: ${deltaLovelace} lovelace burned as implicit fee. ` + `Transaction balanced.`
        )
        return { next: "complete" as const }
      } else {
        // Not burn mode or drainTo: This is a bug
        return yield* Effect.fail(
          new TransactionBuilderError({
            message:
              ` CRITICAL BUG: Excess lovelace detected (${deltaLovelace}). ` +
              `Option B design should never produce positive delta. ` +
              `This indicates incorrect change creation or fee calculation logic.`,
            cause: {
              delta: formatAssetsForLog(delta),
              attempt: buildCtx.attempt,
              calculatedFee: buildCtx.calculatedFee.toString(),
              changeOutputs: buildCtx.changeOutputs.length,
              totalInputs: formatAssetsForLog(inputAssets),
              totalOutputs: formatAssetsForLog(outputAssets),
              changeTotal: formatAssetsForLog(changeAssets)
            }
          })
        )
      }
    }

    // Shortfall: inputs < outputs + change + fee
    // Return to changeCreation to recreate change with correct fee
    // If leftover < minLovelace, changeCreation will trigger selection

    yield* Effect.logDebug(
      `[Balance] Shortfall detected: ${-deltaLovelace} lovelace. ` +
        `Returning to changeCreation to adjust change output.`
    )

    return { next: "changeCreation" as const }
  })
