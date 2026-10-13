import { Effect } from "effect"

import * as CoreAddress from "../../Address.js"
import * as CoreAssets from "../../Assets.js"
import * as Bytes from "../../Bytes.js"
import type * as Credential from "../../Credential.js"
import type * as PlutusData from "../../Data.js"
import * as DatumHash from "../../DatumHash.js"
import type * as RewardAddress from "../../RewardAddress.js"
import * as Script from "../../Script.js"
import type * as Transaction from "../../Transaction.js"
import * as TransactionBody from "../../TransactionBody.js"
import * as TransactionHash from "../../TransactionHash.js"
import type * as TransactionInput from "../../TransactionInput.js"
import * as CoreUTxO from "../../UTxO.js"
import type { EvalRedeemer } from "../EvalRedeemer.js"
import * as Provider from "./Provider.js"

/**
 * Protocol parameters the mock serves when a test does not supply its own.
 *
 * Mainnet values as of the Conway era. ⚠️ The cost models are **empty**: a mock runs no
 * Plutus script, and a transaction whose `script_data_hash` must be correct has to be given
 * the real cost models through {@link MockProviderConfig.protocolParameters}.
 *
 * @since 2.2.0
 * @category constructors
 */
export const defaultProtocolParameters: Provider.ProtocolParameters = {
  minFeeA: 44,
  minFeeB: 155_381,
  maxTxSize: 16_384,
  maxValSize: 5_000,
  keyDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  govActionDeposit: 100_000_000_000n,
  priceMem: 0.0577,
  priceStep: 0.0000721,
  maxTxExMem: 14_000_000n,
  maxTxExSteps: 10_000_000_000n,
  coinsPerUtxoByte: 4_310n,
  collateralPercentage: 150,
  maxCollateralInputs: 3,
  minFeeRefScriptCostPerByte: 15,
  costModels: {
    PlutusV1: {},
    PlutusV2: {},
    PlutusV3: {}
  }
}

/**
 * The tip the mock reports when a test does not supply one. A fixed point on preprod, well
 * past every era boundary, so slot arithmetic in a test lands in the current era.
 *
 * @since 2.2.0
 * @category constructors
 */
export const defaultTip: Provider.Tip = {
  slot: 100_000_000,
  blockHash: "00".repeat(32),
  epoch: 300,
  blockHeight: 4_000_000,
  blockTime: 1_750_000_000
}

/**
 * What a {@link MockProvider} is seeded with.
 *
 * Every field is optional, and an absent field means the mock knows nothing of that kind
 * rather than that the answer is empty: `getDatum` and `getDelegation` fail for anything not
 * seeded, exactly as the HTTP providers do, instead of inventing a null delegation.
 *
 * @since 2.2.0
 * @category model
 */
export interface MockProviderConfig {
  /** The starting UTxO set. Submitting a transaction spends from it and adds to it. */
  readonly utxos?: ReadonlyArray<CoreUTxO.UTxO>
  /** Served by `getProtocolParameters`. Defaults to {@link defaultProtocolParameters}. */
  readonly protocolParameters?: Provider.ProtocolParameters
  /** Served by `getTip`. Defaults to {@link defaultTip}. */
  readonly tip?: Provider.Tip
  /** Datums reachable by hash, keyed by the datum hash as hex. */
  readonly datums?: Readonly<Record<string, PlutusData.Data>>
  /** Delegation state, keyed by the bech32 reward address. */
  readonly delegations?: Readonly<Record<string, Provider.Delegation>>
  /**
   * What `evaluateTx` returns. A mock does not run Plutus scripts, so there is nothing to
   * compute: with this unset, evaluating a transaction that carries redeemers fails rather
   * than reporting ex-units it did not measure.
   */
  readonly evalRedeemers?: ReadonlyArray<EvalRedeemer>
  /** Transaction hashes, as hex, that `awaitTx` should already consider confirmed. */
  readonly confirmedTxs?: ReadonlyArray<string>

  // ── the chain-wide query tier ──────────────────────────────────────────────
  // Seeding one of these makes the matching optional member EXIST on the mock, and
  // leaving it out makes the member absent. That is deliberate: a consumer that probes
  // before calling has to be testable against a provider that genuinely cannot answer,
  // and a mock that always answers would make every probe look satisfied.

  /** Stake-account state, keyed by bech32 reward address. Served by `getAccountInfo`,
   * which answers `null` for an address not in this map (the chain has not seen it). */
  readonly accounts?: Readonly<Record<string, Provider.AccountInfo>>
  /** Account-level UTxOs, keyed by bech32 reward address. */
  readonly accountUtxos?: Readonly<Record<string, ReadonlyArray<CoreUTxO.UTxO>>>
  /** Served by `getChainParameters`. */
  readonly chainParameters?: Provider.ChainParameters
  /** Served by `getProtocolParametersAt`, keyed by epoch. */
  readonly protocolParametersByEpoch?: Readonly<Record<number, Provider.ProtocolParameters>>
  /** The DRep index. `getDRep` answers `null` for an id not in it. */
  readonly dreps?: ReadonlyArray<Provider.DRepSummary>
  /** The constitutional committee. */
  readonly committee?: ReadonlyArray<Provider.CommitteeMember>
  /** The pool index. `getPool` answers `null` for an id not in it. */
  readonly pools?: ReadonlyArray<Provider.PoolSummary>
  /** The proposal index. `getProposal` answers `null` for an id not in it. */
  readonly proposals?: ReadonlyArray<Provider.ProposalSummary>
  /** Cast votes, keyed by voter id within each role. Each role seeds its own member. */
  readonly votes?: {
    readonly byDRep?: Readonly<Record<string, ReadonlyArray<Provider.VoteRecord>>>
    readonly byPool?: Readonly<Record<string, ReadonlyArray<Provider.VoteRecord>>>
    readonly byCommittee?: Readonly<Record<string, ReadonlyArray<Provider.VoteRecord>>>
    readonly byProposal?: Readonly<Record<string, ReadonlyArray<Provider.VoteRecord>>>
  }

  // ── the history and discovery tier ─────────────────────────────────────────
  // Same rule as above: seeding one makes the member exist, leaving it out makes it absent.
  // ⚠️ A consumer that reports "history unavailable" when the member is missing can only be
  // tested against a provider that genuinely has none, which is why the default is absence
  // rather than an empty list.

  /**
   * Transaction references, **newest first**. Seeds `getTxsAt` and `getAccountTxs`.
   *
   * ⚠️ Not keyed by address, and the members ignore the addresses they are asked about: an
   * `IndexedTxRef` carries no address, so an indexer's answer cannot be reconstructed per
   * address from one. A test that needs per-address history has to drive the real provider.
   * What this DOES reproduce faithfully is the windowing — `afterBlock`, `beforeBlock`,
   * `order`, `offset` and `limit` — which is what a history walk's correctness turns on.
   */
  readonly txRefs?: ReadonlyArray<Provider.IndexedTxRef>
  /** Structured transactions, keyed by transaction hash as hex. Seeds `getTxInfo`. */
  readonly txs?: Readonly<Record<string, Provider.IndexedTx>>
  /** Raw transaction CBOR, keyed by transaction hash as hex. Seeds `getTxCbor`. */
  readonly txCbor?: Readonly<Record<string, string>>
  /** Historical payment addresses, keyed by bech32 reward address. Seeds `getAccountAddresses`. */
  readonly accountAddresses?: Readonly<Record<string, ReadonlyArray<string>>>
  /** Bech32 addresses the chain has seen. Seeds `getAddressesSeen`. */
  readonly addressesSeen?: ReadonlyArray<string>
  /** Confirmation depth, keyed by transaction hash as hex. Seeds `getTxConfirmations`. */
  readonly txConfirmations?: Readonly<Record<string, number>>
  /** Scripts by hash, as hex. Seeds `getScriptByHash`. */
  readonly scripts?: Readonly<Record<string, { readonly bytesHex: string; readonly version: "V1" | "V2" | "V3" }>>
  /**
   * Whether `resolveOutRefs` exists. The ANSWERS come from the ledger, not from here.
   *
   * ⚠️ This mock is a ledger, so it knows the difference the member is about: an outpoint it
   * holds is `spent: false`, one it held and `submitTx` consumed is `spent: true`, and one it
   * has never seen is simply absent. A lookup table could not tell the second from the third,
   * which is the exact confusion the member exists to resolve.
   */
  readonly resolvesOutRefs?: boolean
}

const outRefKey = (transactionId: TransactionHash.TransactionHash, index: bigint): string =>
  `${TransactionHash.toHex(transactionId)}#${index}`

const credentialEquals = (a: Credential.Credential, b: Credential.Credential): boolean =>
  a._tag === b._tag && Bytes.toHex(a.hash) === Bytes.toHex(b.hash)

const holdsUnit = (utxo: CoreUTxO.UTxO, unit: string): boolean => CoreAssets.getUnits(utxo.assets).includes(unit)

/**
 * An in-memory provider: a full {@link Provider} over a UTxO set held in this process.
 *
 * It exists so that code written against a provider can be tested without a network and
 * without Docker — `@evolution-sdk/devnet` runs a real node, which a unit test cannot.
 *
 * It is a ledger rather than a lookup table: `submitTx` computes the real transaction hash,
 * **rejects an input it does not hold** (unknown, or already spent by an earlier submit),
 * spends the inputs it does, and adds the outputs as new UTxOs. A build → submit → build
 * sequence therefore sees the chain it just made, and a double spend fails here the way it
 * would on a node.
 *
 * @example
 * ```typescript
 * import { MockProvider } from "@evolution-sdk/evolution/sdk/provider/Mock"
 *
 * const provider = new MockProvider({ utxos: [myUtxo] })
 * const utxos = await provider.getUtxos(address)
 * const txHash = await provider.submitTx(signedTx)
 * ```
 *
 * @since 2.2.0
 * @category constructors
 */
export class MockProvider implements Provider.Provider {
  private readonly protocolParameters: Provider.ProtocolParameters
  private readonly tip: Provider.Tip
  private readonly datums: Readonly<Record<string, PlutusData.Data>>
  private readonly delegations: Readonly<Record<string, Provider.Delegation>>
  private readonly evalRedeemers?: ReadonlyArray<EvalRedeemer>
  private readonly utxos: Map<string, CoreUTxO.UTxO>
  private readonly confirmed: Set<string>
  /**
   * Outpoints this ledger held and `submitTx` consumed, kept with their value.
   *
   * ⚠️ Kept rather than forgotten so "spent" stays distinct from "never existed" — the one
   * distinction a lookup table cannot make, and the whole reason `resolveOutRefs` exists.
   */
  private readonly consumed: Map<string, CoreUTxO.UTxO>

  readonly effect: Provider.ProviderEffectWithTip

  constructor(config: MockProviderConfig = {}) {
    this.protocolParameters = config.protocolParameters ?? defaultProtocolParameters
    this.tip = config.tip ?? defaultTip
    this.datums = config.datums ?? {}
    this.delegations = config.delegations ?? {}
    this.evalRedeemers = config.evalRedeemers
    this.utxos = new Map((config.utxos ?? []).map((utxo) => [outRefKey(utxo.transactionId, utxo.index), utxo]))
    this.confirmed = new Set(config.confirmedTxs ?? [])
    this.consumed = new Map()

    const accounts = config.accounts ?? {}
    const accountUtxos = config.accountUtxos ?? {}
    const paramsByEpoch = config.protocolParametersByEpoch ?? {}
    const dreps = config.dreps ?? []
    const committee = config.committee ?? []
    const pools = config.pools ?? []
    const proposals = config.proposals ?? []
    const byDRep = config.votes?.byDRep ?? {}
    const byPool = config.votes?.byPool ?? {}
    const byCommittee = config.votes?.byCommittee ?? {}
    const byProposal = config.votes?.byProposal ?? {}
    const txRefs = config.txRefs ?? []
    const txs = config.txs ?? {}
    const txCbor = config.txCbor ?? {}
    const accountAddresses = config.accountAddresses ?? {}
    const addressesSeen = new Set(config.addressesSeen ?? [])
    const txConfirmations = config.txConfirmations ?? {}
    const scripts = config.scripts ?? {}

    /**
     * `afterBlock` exclusive below, `beforeBlock` exclusive above, then `order`, then the
     * offset/limit page — the order the real providers apply them in. ⚠️ Windowing before
     * ordering would answer a different page for `order: "asc"`.
     */
    const windowed = (
      all: ReadonlyArray<Provider.IndexedTxRef>,
      options?: {
        readonly afterBlock?: number
        readonly beforeBlock?: number
        readonly order?: "asc" | "desc"
        readonly offset?: number
        readonly limit?: number
      }
    ): Array<Provider.IndexedTxRef> => {
      const kept = all.filter(
        (ref) =>
          (options?.afterBlock === undefined || (ref.blockHeight ?? 0) > options.afterBlock) &&
          (options?.beforeBlock === undefined || (ref.blockHeight ?? 0) < options.beforeBlock)
      )
      const ordered = options?.order === "asc" ? [...kept].reverse() : kept
      const start = options?.offset ?? 0
      return options?.limit === undefined ? ordered.slice(start) : ordered.slice(start, start + options.limit)
    }

    this.effect = {
      getProtocolParameters: () => Effect.succeed(this.protocolParameters),
      getTip: () => Effect.succeed(this.tip),
      getUtxos: (addressOrCredential) => Effect.succeed(this.owned(addressOrCredential)),
      getUtxosWithUnit: (addressOrCredential, unit) =>
        Effect.succeed(this.owned(addressOrCredential).filter((utxo) => holdsUnit(utxo, unit))),
      getUtxoByUnit: (unit) => this.utxoByUnit(unit),
      getUtxosByOutRef: (inputs) => Effect.succeed(this.byOutRef(inputs)),
      getDelegation: (rewardAddress) => this.delegation(rewardAddress),
      getDatum: (datumHash) => this.datum(datumHash),
      awaitTx: (txHash) => Effect.succeed(this.confirmed.has(TransactionHash.toHex(txHash))),
      submitTx: (tx) => this.submit(tx),
      evaluateTx: (tx) => this.evaluate(tx),

      // Derivable from the ledger the mock already holds, so always answerable.
      getUtxosByAsset: (unit) => Effect.succeed(this.ledger().filter((utxo) => holdsUnit(utxo, unit))),
      // ⚠️ The same question `getUtxos` already answers for a credential — a base address and an
      // enterprise address sharing one payment credential are one spender — so a mock that
      // served the first and not these two would make a consumer look unsupported over a ledger
      // that holds the answer.
      getUtxosByPaymentCredential: (credential) => Effect.succeed(this.owned(credential)),
      getUtxosByPaymentCredentials: (credentials) =>
        Effect.succeed(credentials.flatMap((credential) => this.owned(credential))),
      getUtxosOfTransaction: (txHash) =>
        Effect.succeed(
          this.ledger().filter((utxo) =>
            TransactionHash.toHex(utxo.transactionId) === TransactionHash.toHex(txHash)
          )
        ),

      // Everything below exists only where the test seeded it; see MockProviderConfig.
      ...(config.accounts !== undefined
        ? { getAccountInfo: (rewardAddress: RewardAddress.RewardAddress) => Effect.succeed(accounts[rewardAddress] ?? null) }
        : {}),
      ...(config.accountUtxos !== undefined
        ? {
          getAccountUtxos: (rewardAddress: RewardAddress.RewardAddress) =>
            Effect.succeed([...(accountUtxos[rewardAddress] ?? [])])
        }
        : {}),
      ...(config.chainParameters !== undefined
        ? { getChainParameters: () => Effect.succeed(config.chainParameters as Provider.ChainParameters) }
        : {}),
      ...(config.protocolParametersByEpoch !== undefined
        ? {
          getProtocolParametersAt: (epoch: number) => {
            const found = paramsByEpoch[epoch]
            return found === undefined
              ? Effect.fail(new Provider.ProviderError({ message: `MockProvider has no parameters for epoch ${epoch}` }))
              : Effect.succeed(found)
          }
        }
        : {}),
      ...(config.dreps !== undefined
        ? {
          getDReps: () => Effect.succeed([...dreps]),
          getDRep: (drepId: string) => Effect.succeed(dreps.find((d) => d.drepId === drepId) ?? null)
        }
        : {}),
      ...(config.committee !== undefined ? { getCommittee: () => Effect.succeed([...committee]) } : {}),
      ...(config.pools !== undefined
        ? {
          getPools: () => Effect.succeed([...pools]),
          getPool: (poolId: string) => Effect.succeed(pools.find((p) => p.poolId === poolId) ?? null)
        }
        : {}),
      ...(config.proposals !== undefined
        ? {
          getProposals: () => Effect.succeed([...proposals]),
          getProposal: (proposalId: string) =>
            Effect.succeed(proposals.find((p) => p.proposalId === proposalId) ?? null)
        }
        : {}),
      ...(config.votes?.byDRep !== undefined
        ? { getVotesByDRep: (id: string) => Effect.succeed([...(byDRep[id] ?? [])]) }
        : {}),
      ...(config.votes?.byPool !== undefined
        ? { getVotesByPool: (id: string) => Effect.succeed([...(byPool[id] ?? [])]) }
        : {}),
      ...(config.votes?.byCommittee !== undefined
        ? { getVotesByCommittee: (id: string) => Effect.succeed([...(byCommittee[id] ?? [])]) }
        : {}),
      ...(config.votes?.byProposal !== undefined
        ? { getVotesByProposal: (id: string) => Effect.succeed([...(byProposal[id] ?? [])]) }
        : {}),

      // ── the history and discovery tier ──
      ...(config.txRefs !== undefined
        ? {
          getTxsAt: (_addresses: ReadonlyArray<CoreAddress.Address>, options?: Parameters<
            NonNullable<Provider.ProviderEffect["getTxsAt"]>
          >[1]) => Effect.succeed(windowed(txRefs, options)),
          getAccountTxs: (
            _stakeAddress: RewardAddress.RewardAddress,
            options?: Parameters<NonNullable<Provider.ProviderEffect["getAccountTxs"]>>[1]
          ) => Effect.succeed(windowed(txRefs, options))
        }
        : {}),
      ...(config.txs !== undefined
        ? {
          getTxInfo: (txHashes: ReadonlyArray<TransactionHash.TransactionHash>) =>
            Effect.succeed(
              txHashes
                .map((hash) => txs[TransactionHash.toHex(hash)])
                .filter((tx): tx is Provider.IndexedTx => tx !== undefined)
            )
        }
        : {}),
      ...(config.txCbor !== undefined
        ? {
          getTxCbor: (txHashes: ReadonlyArray<TransactionHash.TransactionHash>) =>
            Effect.succeed(
              txHashes.flatMap((hash) => {
                const cborHex = txCbor[TransactionHash.toHex(hash)]
                return cborHex === undefined ? [] : [{ txHash: hash, cborHex }]
              })
            )
        }
        : {}),
      ...(config.accountAddresses !== undefined
        ? {
          getAccountAddresses: (
            stakeAddress: RewardAddress.RewardAddress,
            options?: { readonly offset?: number }
          ) => {
            const all = accountAddresses[stakeAddress] ?? []
            const start = options?.offset ?? 0
            return Effect.succeed(all.slice(start).map((bech32) => CoreAddress.fromBech32(bech32)))
          }
        }
        : {}),
      ...(config.addressesSeen !== undefined
        ? {
          getAddressesSeen: (addresses: ReadonlyArray<CoreAddress.Address>) =>
            Effect.succeed(addresses.filter((address) => addressesSeen.has(CoreAddress.toBech32(address))))
        }
        : {}),
      ...(config.txConfirmations !== undefined
        ? {
          getTxConfirmations: (txHash: TransactionHash.TransactionHash) =>
            Effect.succeed(txConfirmations[TransactionHash.toHex(txHash)] ?? null)
        }
        : {}),
      ...(config.scripts !== undefined
        ? { getScriptByHash: (scriptHash: string) => Effect.succeed(scripts[scriptHash.toLowerCase()]) }
        : {}),
      ...(config.resolvesOutRefs === true
        ? {
          resolveOutRefs: (inputs: ReadonlyArray<TransactionInput.TransactionInput>) =>
            Effect.succeed(
              inputs.flatMap((input): Array<Provider.ResolvedOutRef> => {
                const key = outRefKey(input.transactionId, input.index)
                const held = this.utxos.get(key)
                if (held !== undefined) return [{ utxo: held, spent: false }]
                const consumed = this.consumed.get(key)
                // Never seen: absent, which is NOT the same answer as spent.
                return consumed === undefined ? [] : [{ utxo: consumed, spent: true }]
              })
            )
        }
        : {})
    }
  }

  /**
   * The current UTxO set, after every transaction submitted so far. Not part of the
   * provider interface: it is how a test reads the ledger it has been driving.
   */
  ledger(): Array<CoreUTxO.UTxO> {
    return Array.from(this.utxos.values())
  }

  private owned(
    addressOrCredential: CoreAddress.Address | Credential.Credential
  ): Array<CoreUTxO.UTxO> {
    if ("hash" in addressOrCredential) {
      return this.ledger().filter((utxo) => {
        const payment = utxo.address.paymentCredential
        return payment !== undefined && credentialEquals(payment, addressOrCredential)
      })
    }
    const addressHex = CoreAddress.toHex(addressOrCredential)
    return this.ledger().filter((utxo) => CoreAddress.toHex(utxo.address) === addressHex)
  }

  private byOutRef(inputs: ReadonlyArray<TransactionInput.TransactionInput>): Array<CoreUTxO.UTxO> {
    const found: Array<CoreUTxO.UTxO> = []
    for (const key of new Set(inputs.map((input) => outRefKey(input.transactionId, input.index)))) {
      const utxo = this.utxos.get(key)
      if (utxo !== undefined) found.push(utxo)
    }
    return found
  }

  private utxoByUnit(unit: string): Effect.Effect<CoreUTxO.UTxO, Provider.ProviderError> {
    const held = this.ledger().filter((utxo) => holdsUnit(utxo, unit))
    if (held.length === 0) {
      return Effect.fail(new Provider.ProviderError({ cause: "Unit not found", message: "Unit not found" }))
    }
    const addresses = new Set(held.map((utxo) => CoreAddress.toHex(utxo.address)))
    if (addresses.size > 1) {
      return Effect.fail(
        new Provider.ProviderError({
          cause: "Multiple addresses found",
          message: "Unit needs to be an NFT or only held by one address."
        })
      )
    }
    return Effect.succeed(held[0])
  }

  private delegation(
    rewardAddress: RewardAddress.RewardAddress
  ): Effect.Effect<Provider.Delegation, Provider.ProviderError> {
    const delegation = this.delegations[rewardAddress]
    return delegation === undefined
      ? Effect.fail(
          new Provider.ProviderError({ cause: "No delegation found", message: "No Delegation Found by Reward Address" })
        )
      : Effect.succeed(delegation)
  }

  private datum(datumHash: DatumHash.DatumHash): Effect.Effect<PlutusData.Data, Provider.ProviderError> {
    const datum = this.datums[DatumHash.toHex(datumHash)]
    return datum === undefined
      ? Effect.fail(new Provider.ProviderError({ cause: "No datum found", message: "No Datum Found by Datum Hash" }))
      : Effect.succeed(datum)
  }

  private submit(
    tx: Transaction.Transaction
  ): Effect.Effect<TransactionHash.TransactionHash, Provider.ProviderError> {
    const txHash = TransactionBody.toHash(tx.body)
    const spent = tx.body.inputs.map((input) => outRefKey(input.transactionId, input.index))
    const missing = spent.filter((key) => !this.utxos.has(key))
    if (missing.length > 0) {
      return Effect.fail(
        new Provider.ProviderError({
          cause: missing,
          message: `Input not in the mock ledger (unknown, or already spent): ${missing.join(", ")}`
        })
      )
    }

    for (const key of spent) {
      const utxo = this.utxos.get(key)
      if (utxo !== undefined) this.consumed.set(key, utxo)
      this.utxos.delete(key)
    }
    tx.body.outputs.forEach((output, index) => {
      const utxo = new CoreUTxO.UTxO({
        transactionId: txHash,
        index: BigInt(index),
        address: output.address,
        assets: output.assets,
        datumOption: output.datumOption,
        scriptRef: output.scriptRef ? Script.fromCBOR(output.scriptRef.bytes) : undefined
      })
      this.utxos.set(outRefKey(txHash, BigInt(index)), utxo)
    })
    this.confirmed.add(TransactionHash.toHex(txHash))

    return Effect.succeed(txHash)
  }

  private evaluate(
    tx: Transaction.Transaction
  ): Effect.Effect<Array<EvalRedeemer>, Provider.ProviderError> {
    if (this.evalRedeemers !== undefined) return Effect.succeed([...this.evalRedeemers])
    const redeemers = tx.witnessSet.redeemers?.size ?? 0
    return redeemers === 0
      ? Effect.succeed([])
      : Effect.fail(
          new Provider.ProviderError({
            message:
              `Transaction carries ${redeemers} redeemer(s) and no evaluation result was configured. ` +
              "A mock provider runs no Plutus script; seed `evalRedeemers` with the ex-units the test expects."
          })
        )
  }

  getProtocolParameters = () => Effect.runPromise(this.effect.getProtocolParameters())

  getTip = () => Effect.runPromise(this.effect.getTip())

  getUtxos = (addressOrCredential: Parameters<Provider.Provider["getUtxos"]>[0]) =>
    Effect.runPromise(this.effect.getUtxos(addressOrCredential))

  getUtxosWithUnit = (
    addressOrCredential: Parameters<Provider.Provider["getUtxosWithUnit"]>[0],
    unit: Parameters<Provider.Provider["getUtxosWithUnit"]>[1]
  ) => Effect.runPromise(this.effect.getUtxosWithUnit(addressOrCredential, unit))

  getUtxoByUnit = (unit: Parameters<Provider.Provider["getUtxoByUnit"]>[0]) =>
    Effect.runPromise(this.effect.getUtxoByUnit(unit))

  getUtxosByOutRef = (outRefs: Parameters<Provider.Provider["getUtxosByOutRef"]>[0]) =>
    Effect.runPromise(this.effect.getUtxosByOutRef(outRefs))

  getDelegation = (rewardAddress: Parameters<Provider.Provider["getDelegation"]>[0]) =>
    Effect.runPromise(this.effect.getDelegation(rewardAddress))

  getDatum = (datumHash: Parameters<Provider.Provider["getDatum"]>[0]) =>
    Effect.runPromise(this.effect.getDatum(datumHash))

  awaitTx = (
    txHash: Parameters<Provider.Provider["awaitTx"]>[0],
    checkInterval?: Parameters<Provider.Provider["awaitTx"]>[1],
    timeout?: Parameters<Provider.Provider["awaitTx"]>[2]
  ) => Effect.runPromise(this.effect.awaitTx(txHash, checkInterval, timeout))

  submitTx = (tx: Parameters<Provider.Provider["submitTx"]>[0]) => Effect.runPromise(this.effect.submitTx(tx))

  evaluateTx = (
    tx: Parameters<Provider.Provider["evaluateTx"]>[0],
    additionalUTxOs?: Parameters<Provider.Provider["evaluateTx"]>[1]
  ) => Effect.runPromise(this.effect.evaluateTx(tx, additionalUTxOs))
}
