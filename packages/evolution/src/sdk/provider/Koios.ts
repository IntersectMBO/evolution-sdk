import { Effect } from "effect"

import type * as _Koios from "./internal/Koios.js"
import * as KoiosEffect from "./internal/KoiosEffect.js"
import * as KoiosQuery from "./internal/KoiosQuery.js"
import type { ProtocolParameters, Provider, ProviderEffectWithTip } from "./Provider.js"

/**
 * How long a fetched protocol-parameter set stays good for.
 *
 * Parameters change only at an epoch boundary (~5 days), so a TTL well under an epoch collapses
 * the per-transaction-build refetch to at most one request per window without ever going stale.
 * Measured on a device before the cache existed: **11 `/epoch_params` requests inside one
 * 60-second window**, for data that changes once every five days.
 *
 * @since 2.6.0
 * @category constants
 */
export const EPOCH_PARAMS_TTL_MS = 30 * 60_000

/**
 * The per-request timeout a Koios client uses when a caller sets none.
 *
 * Re-exported here because `KoiosEffect` is internal: a consumer raising the ceiling wants to say
 * what it is raising it from.
 *
 * @since 2.9.0
 * @category constants
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = KoiosEffect.DEFAULT_REQUEST_TIMEOUT_MS

/** Whether a parameter set captured at `at` is still fresh at `nowMs`. */
export const epochParamsFresh = (at: number, nowMs: number, ttlMs = EPOCH_PARAMS_TTL_MS): boolean => nowMs - at < ttlMs

/**
 * Options a caller can set on a Koios client, beyond its endpoint and credential.
 *
 * @since 2.9.0
 * @category models
 */
export interface KoiosOptions {
  /**
   * Per-request timeout, in milliseconds. Defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS} (10 s).
   *
   * ⚠️ Raise it when the LINK is slow rather than when a response is large: the ceiling is per
   * request, so a client on a phone over mobile data wants more than one on a fixed line asking
   * for the same bytes. `/address_info` for a busy address measured 764 KB.
   *
   * ⚠️ It does **not** reach the paged query tier (`getAccountUtxos`,
   * `getUtxosByPaymentCredential(s)`, the history reads), which carries no per-request timeout at
   * all — a single ceiling there would bound a whole multi-page walk rather than one request, so
   * it needs per-page placement to mean anything. Named here so the gap is not mistaken for this
   * option covering it.
   */
  readonly requestTimeoutMs?: number
}

/**
 * Koios provider for Cardano blockchain data access.
 * Provides support for interacting with the Koios API across multiple environments.
 *
 * `token` is a bearer token or a function returning one. A function is resolved per request,
 * so a credential refreshed while the provider lives is picked up without rebuilding it.
 *
 * `options.requestTimeoutMs` raises or lowers the per-request ceiling — see {@link KoiosOptions}.
 *
 * @since 2.0.0
 * @category constructors
 */
export class Koios implements Provider {
  private readonly baseUrl: string
  private readonly token?: _Koios.TokenSource
  private readonly timeoutMs: number

  /**
   * The epoch-stable parameter set, cached per INSTANCE.
   *
   * ⚠️ Per instance, never module-global. A `Map` keyed on the base URL leaks across providers,
   * networks and tests — one test then serves another's parameters and a provider built for one
   * network can answer with another's.
   */
  private params?: { readonly value: ProtocolParameters; readonly at: number }

  readonly effect: ProviderEffectWithTip

  constructor(baseUrl: string, token?: _Koios.TokenSource, options?: KoiosOptions) {
    this.baseUrl = baseUrl
    this.token = token
    this.timeoutMs = options?.requestTimeoutMs ?? KoiosEffect.DEFAULT_REQUEST_TIMEOUT_MS

    this.effect = {
      /**
       * ⚠️ Cached here rather than by a caller, because only the client sees every caller.
       * A wallet, a dApp bridge and a CIP-113 transfer all cost a transaction build, and a cache
       * one of them holds does nothing for the other two.
       */
      getProtocolParameters: () =>
        Effect.suspend(() => {
          const held = this.params
          if (held !== undefined && epochParamsFresh(held.at, Date.now())) return Effect.succeed(held.value)
          return Effect.tap(KoiosEffect.getProtocolParameters(this.baseUrl, this.token, this.timeoutMs), (value) =>
            Effect.sync(() => {
              this.params = { value, at: Date.now() }
            })
          )
        }),
      getTip: KoiosEffect.getTip(this.baseUrl, this.token, this.timeoutMs),
      getUtxos: KoiosEffect.getUtxos(this.baseUrl, this.token, this.timeoutMs),
      getUtxosWithUnit: KoiosEffect.getUtxosWithUnit(this.baseUrl, this.token, this.timeoutMs),
      getUtxoByUnit: KoiosEffect.getUtxoByUnit(this.baseUrl, this.token, this.timeoutMs),
      getUtxosByOutRef: KoiosEffect.getUtxosByOutRef(this.baseUrl, this.token, this.timeoutMs),
      resolveOutRefs: KoiosEffect.resolveOutRefs(this.baseUrl, this.token, this.timeoutMs),
      getDelegation: KoiosEffect.getDelegation(this.baseUrl, this.token, this.timeoutMs),
      getDatum: KoiosEffect.getDatum(this.baseUrl, this.token, this.timeoutMs),
      awaitTx: KoiosEffect.awaitTx(this.baseUrl, this.token, this.timeoutMs),
      submitTx: KoiosEffect.submitTx(this.baseUrl, this.token, this.timeoutMs),
      evaluateTx: KoiosEffect.evaluateTx(this.baseUrl, this.token, this.timeoutMs),

      // The chain-wide query tier plus the history and discovery tier. Koios serves all of
      // them, which is why they are declared here and nowhere else: a backend that cannot
      // answer one omits it, so a caller can tell "unsupported" from "nothing found".
      getUtxosByAsset: KoiosQuery.getUtxosByAsset(this.baseUrl, this.token, this.timeoutMs),
      getAccountUtxos: KoiosQuery.getAccountUtxos(this.baseUrl, this.token, this.timeoutMs),
      getUtxosOfTransaction: KoiosQuery.getUtxosOfTransaction(this.baseUrl, this.token, this.timeoutMs),
      getAccountInfo: KoiosQuery.getAccountInfo(this.baseUrl, this.token, this.timeoutMs),
      getProtocolParametersAt: KoiosQuery.getProtocolParametersAt(this.baseUrl, this.token, this.timeoutMs),
      getChainParameters: KoiosQuery.getChainParameters(this.baseUrl, this.token, this.timeoutMs),
      getDReps: KoiosQuery.getDReps(this.baseUrl, this.token, this.timeoutMs),
      getDRep: KoiosQuery.getDRep(this.baseUrl, this.token, this.timeoutMs),
      getCommittee: KoiosQuery.getCommittee(this.baseUrl, this.token, this.timeoutMs),
      getPools: KoiosQuery.getPools(this.baseUrl, this.token, this.timeoutMs),
      getPool: KoiosQuery.getPool(this.baseUrl, this.token, this.timeoutMs),
      getProposals: KoiosQuery.getProposals(this.baseUrl, this.token, this.timeoutMs),
      getProposal: KoiosQuery.getProposal(this.baseUrl, this.token, this.timeoutMs),
      getVotesByDRep: KoiosQuery.getVotesByDRep(this.baseUrl, this.token, this.timeoutMs),
      getVotesByPool: KoiosQuery.getVotesByPool(this.baseUrl, this.token, this.timeoutMs),
      getVotesByCommittee: KoiosQuery.getVotesByCommittee(this.baseUrl, this.token, this.timeoutMs),
      getVotesByProposal: KoiosQuery.getVotesByProposal(this.baseUrl, this.token, this.timeoutMs),
      getTxsAt: KoiosQuery.getTxsAt(this.baseUrl, this.token, this.timeoutMs),
      splitAddressesForTxsAt: KoiosQuery.splitAddressesForTxsAt,
      getAccountTxs: KoiosQuery.getAccountTxs(this.baseUrl, this.token, this.timeoutMs),
      getAccountAddresses: KoiosQuery.getAccountAddresses(this.baseUrl, this.token, this.timeoutMs),
      getAddressesSeen: KoiosQuery.getAddressesSeen(this.baseUrl, this.token, this.timeoutMs),
      getTxConfirmations: KoiosQuery.getTxConfirmations(this.baseUrl, this.token, this.timeoutMs),
      getTxInfo: KoiosQuery.getTxInfo(this.baseUrl, this.token, this.timeoutMs),
      getTxCbor: KoiosQuery.getTxCbor(this.baseUrl, this.token, this.timeoutMs),
      getScriptByHash: KoiosQuery.getScriptByHash(this.baseUrl, this.token, this.timeoutMs),
      getUtxosByPaymentCredential: KoiosQuery.getUtxosByPaymentCredential(this.baseUrl, this.token, this.timeoutMs),
      getUtxosByPaymentCredentials: KoiosQuery.getUtxosByPaymentCredentials(this.baseUrl, this.token, this.timeoutMs)
    }
  }

  getProtocolParameters = () => Effect.runPromise(this.effect.getProtocolParameters())

  getTip = () => Effect.runPromise(this.effect.getTip())

  getUtxos = (addressOrCredential: Parameters<Provider["getUtxos"]>[0]) =>
    Effect.runPromise(this.effect.getUtxos(addressOrCredential))

  getUtxosWithUnit = (
    addressOrCredential: Parameters<Provider["getUtxosWithUnit"]>[0],
    unit: Parameters<Provider["getUtxosWithUnit"]>[1]
  ) => Effect.runPromise(this.effect.getUtxosWithUnit(addressOrCredential, unit))

  getUtxoByUnit = (unit: Parameters<Provider["getUtxoByUnit"]>[0]) => Effect.runPromise(this.effect.getUtxoByUnit(unit))

  getUtxosByOutRef = (outRefs: Parameters<Provider["getUtxosByOutRef"]>[0]) =>
    Effect.runPromise(this.effect.getUtxosByOutRef(outRefs))

  getDelegation = (rewardAddress: Parameters<Provider["getDelegation"]>[0]) =>
    Effect.runPromise(this.effect.getDelegation(rewardAddress))

  getDatum = (datumHash: Parameters<Provider["getDatum"]>[0]) => Effect.runPromise(this.effect.getDatum(datumHash))

  awaitTx = (
    txHash: Parameters<Provider["awaitTx"]>[0],
    checkInterval?: Parameters<Provider["awaitTx"]>[1],
    timeout?: Parameters<Provider["awaitTx"]>[2]
  ) => Effect.runPromise(this.effect.awaitTx(txHash, checkInterval, timeout))

  submitTx = (tx: Parameters<Provider["submitTx"]>[0]) => Effect.runPromise(this.effect.submitTx(tx))

  evaluateTx = (tx: Parameters<Provider["evaluateTx"]>[0], additionalUTxOs?: Parameters<Provider["evaluateTx"]>[1]) =>
    Effect.runPromise(this.effect.evaluateTx(tx, additionalUTxOs))

  // The query tier's promise wrappers go through the effect constructors rather than
  // through `this.effect`, whose members are optional on the interface: reaching for them
  // there would need a non-null assertion on every line to say what the constructor above
  // already guarantees.
  getUtxosByAsset = (unit: string) =>
    Effect.runPromise(KoiosQuery.getUtxosByAsset(this.baseUrl, this.token, this.timeoutMs)(unit))

  getAccountUtxos = (
    rewardAddress: Parameters<Provider["getDelegation"]>[0],
    options?: { readonly offset?: number; readonly limit?: number }
  ) => Effect.runPromise(KoiosQuery.getAccountUtxos(this.baseUrl, this.token, this.timeoutMs)(rewardAddress, options))

  getUtxosOfTransaction = (txHash: Parameters<Provider["awaitTx"]>[0]) =>
    Effect.runPromise(KoiosQuery.getUtxosOfTransaction(this.baseUrl, this.token, this.timeoutMs)(txHash))

  getAccountInfo = (rewardAddress: Parameters<Provider["getDelegation"]>[0]) =>
    Effect.runPromise(KoiosQuery.getAccountInfo(this.baseUrl, this.token, this.timeoutMs)(rewardAddress))

  getProtocolParametersAt = (epoch: number) =>
    Effect.runPromise(KoiosQuery.getProtocolParametersAt(this.baseUrl, this.token, this.timeoutMs)(epoch))

  getChainParameters = () =>
    Effect.runPromise(KoiosQuery.getChainParameters(this.baseUrl, this.token, this.timeoutMs)())

  getDReps = () => Effect.runPromise(KoiosQuery.getDReps(this.baseUrl, this.token, this.timeoutMs)())

  getDRep = (drepId: string) => Effect.runPromise(KoiosQuery.getDRep(this.baseUrl, this.token, this.timeoutMs)(drepId))

  getCommittee = () => Effect.runPromise(KoiosQuery.getCommittee(this.baseUrl, this.token, this.timeoutMs)())

  getPools = () => Effect.runPromise(KoiosQuery.getPools(this.baseUrl, this.token, this.timeoutMs)())

  getPool = (poolId: string) => Effect.runPromise(KoiosQuery.getPool(this.baseUrl, this.token, this.timeoutMs)(poolId))

  getTxConfirmations = (txHash: Parameters<Provider["awaitTx"]>[0]) =>
    Effect.runPromise(KoiosQuery.getTxConfirmations(this.baseUrl, this.token, this.timeoutMs)(txHash))

  getProposals = () => Effect.runPromise(KoiosQuery.getProposals(this.baseUrl, this.token, this.timeoutMs)())

  getProposal = (proposalId: string) =>
    Effect.runPromise(KoiosQuery.getProposal(this.baseUrl, this.token, this.timeoutMs)(proposalId))

  getVotesByDRep = (drepId: string) =>
    Effect.runPromise(KoiosQuery.getVotesByDRep(this.baseUrl, this.token, this.timeoutMs)(drepId))

  getVotesByPool = (poolId: string) =>
    Effect.runPromise(KoiosQuery.getVotesByPool(this.baseUrl, this.token, this.timeoutMs)(poolId))

  getVotesByCommittee = (ccHotId: string) =>
    Effect.runPromise(KoiosQuery.getVotesByCommittee(this.baseUrl, this.token, this.timeoutMs)(ccHotId))

  getVotesByProposal = (proposalId: string) =>
    Effect.runPromise(KoiosQuery.getVotesByProposal(this.baseUrl, this.token, this.timeoutMs)(proposalId))
}
