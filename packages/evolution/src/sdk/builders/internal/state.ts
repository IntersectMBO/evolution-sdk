import * as Assets from "../../../Assets/index.js"
import type * as Ctx from "./ctx.js"

/**
 * Default build options used for transaction construction when callers do not
 * supply explicit overrides.
 *
 * @since 2.0.0
 * @category builders
 */
export const DEFAULT_BUILD_OPTIONS = {
  coinSelection: "largest-first",
  onInsufficientChange: "error",
  setCollateral: 5_000_000n
} satisfies Ctx.BuildOptions

/**
 * Create a fresh transaction-builder state for a build invocation.
 *
 * @since 2.0.0
 * @category builders
 */
export const makeInitialTxBuilderState = (): Ctx.TxBuilderState => ({
  selectedUtxos: [],
  outputs: [],
  scripts: new Map(),
  totalOutputAssets: Assets.zero,
  totalInputAssets: Assets.zero,
  redeemers: new Map(),
  deferredRedeemers: new Map(),
  referenceInputs: [],
  certificates: [],
  withdrawals: new Map(),
  poolDeposits: new Map(),
  requiredSigners: [],
  auxiliaryData: undefined
})

/**
 * Create the initial phase-context state for a build invocation.
 *
 * @since 2.0.0
 * @category builders
 */
export const makeInitialPhaseContext = (options: Ctx.BuildOptions): Ctx.PhaseContext => ({
  phase: "selection",
  attempt: 0,
  calculatedFee: 0n,
  shortfall: 0n,
  changeOutputs: [],
  leftoverAfterFee: Assets.zero,
  canUnfrack: options.unfrack !== undefined
})