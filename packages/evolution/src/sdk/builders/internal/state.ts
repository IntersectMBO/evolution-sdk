import * as CoreAssets from "../../../Assets.js"
import type { BuildOptions, PhaseContext, TxBuilderState } from "../TransactionBuilder.js"

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
} satisfies BuildOptions

/**
 * Create a fresh transaction-builder state for a build invocation.
 *
 * @since 2.0.0
 * @category builders
 */
export const makeInitialTxBuilderState = (): TxBuilderState => ({
  selectedUtxos: [],
  outputs: [],
  scripts: new Map(),
  totalOutputAssets: CoreAssets.zero,
  totalInputAssets: CoreAssets.zero,
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
export const makeInitialPhaseContext = (options: BuildOptions): PhaseContext => ({
  phase: "selection",
  attempt: 0,
  calculatedFee: 0n,
  shortfall: 0n,
  changeOutputs: [],
  leftoverAfterFee: CoreAssets.zero,
  canUnfrack: options.unfrack !== undefined
})