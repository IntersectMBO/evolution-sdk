/**
 * Selection Phase - UTxO Coin Selection
 *
 * Selects UTxOs from available pool to cover transaction outputs, fees, and change requirements.
 * Handles both initial selection and reselection with retry logic up to MAX_ATTEMPTS.
 *
 * @module Selection
 * @since 2.0.0
 */

import { Effect, Ref } from "effect"

import * as Assets from "../../Assets.js"
import type * as UTxO from "../../UTxO.js"
import type { CoinSelectionAlgorithm, CoinSelectionFunction } from "../CoinSelection.js"
import { largestFirstSelection } from "../CoinSelection.js"
import {
  AvailableUtxosTag,
  BuildOptionsTag,
  PhaseContextTag,
  TransactionBuilderError,
  TxContext
} from "../TransactionBuilder.js"
import { calculateTotalAssets } from "../TxBuilderImpl.js"
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
 * Get UTxOs that haven't been selected yet.
 * Uses Set for O(1) lookup instead of O(n) for better performance.
 */
const getAvailableUtxos = (
  allUtxos: ReadonlyArray<UTxO.UTxO>,
  selectedUtxos: ReadonlyArray<UTxO.UTxO>
): ReadonlyArray<UTxO.UTxO> => {
  const selectedKeys = new Set(selectedUtxos.map((u) => `${u.txHash}:${u.outputIndex}`))
  return allUtxos.filter((utxo) => !selectedKeys.has(`${utxo.txHash}:${utxo.outputIndex}`))
}

/**
 * Helper: Get coin selection algorithm function from name
 */
const getCoinSelectionAlgorithm = (algorithm: CoinSelectionAlgorithm): CoinSelectionFunction => {
  switch (algorithm) {
    case "largest-first":
      return largestFirstSelection
    case "random-improve":
      throw new TransactionBuilderError({
        message: "random-improve algorithm not yet implemented",
        cause: { algorithm }
      })
    case "optimal":
      throw new TransactionBuilderError({
        message: "optimal algorithm not yet implemented",
        cause: { algorithm }
      })
    default:
      throw new TransactionBuilderError({
        message: `Unknown coin selection algorithm: ${algorithm}`,
        cause: { algorithm }
      })
  }
}

/**
 * Resolve coin selection function from options.
 * Returns the configured algorithm or defaults to largest-first.
 */
const resolveCoinSelectionFn = (
  coinSelection?: CoinSelectionAlgorithm | CoinSelectionFunction
): CoinSelectionFunction => {
  if (!coinSelection) return largestFirstSelection
  if (typeof coinSelection === "function") return coinSelection
  return getCoinSelectionAlgorithm(coinSelection)
}

/**
 * Add selected UTxOs to transaction context state.
 * Updates both the selected UTxOs list and total input assets.
 */
const addUtxosToState = (selectedUtxos: ReadonlyArray<UTxO.UTxO>): Effect.Effect<void, never, TxContext> =>
  Effect.gen(function* () {
    const ctx = yield* TxContext

    // Log each UTxO being added
    for (const utxo of selectedUtxos) {
      const txHash = utxo.txHash
      const outputIndex = utxo.outputIndex
      yield* Effect.logDebug(`[Selection] Adding UTxO: ${txHash}#${outputIndex}, ${formatAssetsForLog(utxo.assets)}.`)
    }

    // Calculate total assets from selected UTxOs
    const additionalAssets = calculateTotalAssets(selectedUtxos)

    // Update state with new UTxOs and input assets
    yield* Ref.update(ctx, (state) => ({
      ...state,
      selectedUtxos: [...state.selectedUtxos, ...selectedUtxos],
      totalInputAssets: Assets.add(state.totalInputAssets, additionalAssets)
    }))
  })

/**
 * Helper: Perform coin selection and update TxContext.state
 */
const performCoinSelectionUpdateState = (assetShortfalls: Assets.Assets) =>
  Effect.gen(function* () {
    const ctx = yield* TxContext
    const state = yield* Ref.get(ctx)
    const alreadySelected = state.selectedUtxos

    // Get resolved availableUtxos from context tag
    const allAvailableUtxos = yield* AvailableUtxosTag
    const buildOptions = yield* BuildOptionsTag
    const availableUtxos = getAvailableUtxos(allAvailableUtxos, alreadySelected)
    const coinSelectionFn = resolveCoinSelectionFn(buildOptions.coinSelection)

    const { selectedUtxos } = yield* Effect.try({
      try: () => coinSelectionFn(availableUtxos, assetShortfalls),
      catch: (error) => {
        // Custom serialization for Assets (handles BigInt)
        return new TransactionBuilderError({
          message: `Coin selection failed for ${formatAssetsForLog(assetShortfalls)}`,
          cause: error
        })
      }
    })

    yield* addUtxosToState(selectedUtxos)
  })

/**
 * Selection Phase - UTxO Coin Selection
 *
 * Selects UTxOs from available pool to cover transaction outputs, fees, and change requirements.
 * Handles both initial selection and reselection with retry logic up to MAX_ATTEMPTS.
 *
 * **Decision Flow:**
 * ```
 * Calculate Required Assets
 * (outputs + shortfall for fees/change)
 *   ↓
 * Assets Sufficient?
 * (inputs >= required)
 *   ├─ YES → No selection needed
 *   │        (use existing explicit inputs only)
 *   │        goto changeCreation
 *   └─ NO → Calculate asset delta
 *           ├─ Shortfall from fees? → Reselection mode
 *           │  (select more lovelace for change minUTxO)
 *           └─ Shortfall from outputs? → Normal selection
 *              (select missing native assets or lovelace)
 *           ↓
 *        Perform coin selection
 *        (update totalInputAssets)
 *        ↓
 *        Increment attempt counter
 *        goto changeCreation
 * ```
 *
 * **Key Principles:**
 * - Selection phase runs once per state machine iteration
 * - Reselection (shortfall > 0) adds more UTxOs within MAX_ATTEMPTS limit
 * - Selection itself doesn't fail; ChangeCreation may trigger reselection
 * - No selection needed if explicit inputs already cover requirements
 * - Shortfall tracks lovelace deficit for change output minUTxO
 * - Asset delta identifies what additional UTxOs must contain
 * - Attempt counter resets at phase start, incremented at phase end
 * - Selection is deterministic (same inputs = same selection)
 */
export const executeSelection = (): Effect.Effect<PhaseResult, TransactionBuilderError, PhaseContextTag | TxContext | AvailableUtxosTag | BuildOptionsTag> =>
  Effect.gen(function* () {
    const ctx = yield* TxContext
    const buildCtxRef = yield* PhaseContextTag
    const buildCtx = yield* Ref.get(buildCtxRef)

    const state = yield* Ref.get(ctx)
    const inputAssets = state.totalInputAssets
    const outputAssets = state.totalOutputAssets

    // Step 3: Calculate total needed (outputs + shortfall)
    // Shortfall contains fee + any missing lovelace for change outputs
    const totalNeeded: Assets.Assets = {
      ...outputAssets,
      lovelace: outputAssets.lovelace + buildCtx.shortfall
    }

    // Step 4: Calculate asset delta & extract shortfalls
    const assetDelta = Assets.subtract(totalNeeded, inputAssets)
    const assetShortfalls = Assets.filter(assetDelta, (_unit, amount) => amount > 0n)

    // During reselection (shortfall > 0), we need to select MORE lovelace
    // even if inputAssets >= totalNeeded, because the shortfall indicates
    // insufficient lovelace for change output minUTxO requirement
    const isReselection = buildCtx.shortfall > 0n
    const needsSelection = !Assets.isEmpty(assetShortfalls) || isReselection

    yield* Effect.logDebug(
      `[Selection] Needed: {${formatAssetsForLog(totalNeeded)}}, ` +
        `Available: {${formatAssetsForLog(inputAssets)}}, ` +
        `Delta: {${formatAssetsForLog(assetDelta)}}` +
        (isReselection ? `, Reselection: shortfall=${buildCtx.shortfall}` : "")
    )

    // Step 5: Perform selection or skip
    if (!needsSelection) {
      yield* Effect.logDebug("[Selection] Assets sufficient")
      const state = yield* Ref.get(ctx)
      const selectedUtxos = state.selectedUtxos
      yield* Effect.logDebug(
        `[Selection] No selection needed: ${selectedUtxos.length} UTxO(s) already available from explicit inputs (collectFrom), ` +
          `Total lovelace: ${inputAssets.lovelace || 0n}`
      )
    } else {
      if (isReselection) {
        yield* Effect.logDebug(
          `[Selection] Reselection attempt ${buildCtx.attempt + 1}: ` +
            `Need ${buildCtx.shortfall} more lovelace for change minUTxO`
        )
        // During reselection, select for the shortfall amount only
        const reselectionShortfall: Assets.Assets = { lovelace: buildCtx.shortfall }
        yield* performCoinSelectionUpdateState(reselectionShortfall)
      } else {
        yield* Effect.logDebug(`[Selection] Selecting for shortfall: ${formatAssetsForLog(assetShortfalls)}`)
        yield* performCoinSelectionUpdateState(assetShortfalls)
      }
    }

    // Step 6: Update context and proceed
    yield* Ref.update(buildCtxRef, (ctx) => ({ ...ctx, attempt: ctx.attempt + 1, shortfall: 0n }))

    return { next: "changeCreation" as const }
  })
