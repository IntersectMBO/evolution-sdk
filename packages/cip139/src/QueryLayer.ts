/**
 * CIP-139 — the Universal Query Layer, as a CIP-30 extension.
 *
 * This is the "full-data wallet" half of CPS-10's taxonomy. CIP-30 serves the user's OWN
 * addresses and UTxOs, which leaves a dApp with two sources of truth — its own query layer
 * and the wallet's, which can disagree, so the wallet may refuse to sign a transaction
 * spending a UTxO it has not seen. CIP-139 lets the wallet answer for arbitrary chain data
 * instead, and `CIP-0139/cip-0144.md` puts it plainly: *"Enabling this extension, alongside
 * the `cip-30` extension, would give you a full-data wallet."*
 *
 * SCOPE — 20 of the CIP's 30 operations. The 10 that are absent all return the recursive
 * CIP-116 domain types, or in one case a shape no indexer can answer; each is listed in
 * {@link Types.UNIMPLEMENTED} with its reason, so "not here" is never mistaken for "not
 * needed".
 *
 * Method names are the operation names from `cip-0144.md` verbatim, so a JSON-RPC transport
 * can use them unmodified (`cip139_getUtxosByAddress`).
 *
 * TWO THINGS THIS LAYER OWNS, because nothing else can:
 *   1. Enum translation. The CIP's enums and a backend's spellings differ in ways that would
 *      silently produce schema-invalid JSON: `Yes` to `yes`, Koios's US `authorized` to the
 *      CIP's British `authorised`, and `registered` to `active`. An unrecognised value FAILS
 *      here rather than being passed through.
 *   2. Exact rationals. The CIP wants `{numerator, denominator}`; the provider tier already
 *      carries them as `UnitInterval` / `NonnegativeInterval`, so nothing on this path goes
 *      through a float.
 *
 * @since 0.1.0
 */

import { Cip116 } from "@evolution-sdk/canonical"
import {
  Address,
  AssetName,
  Assets as CoreAssets,
  Bytes,
  type Credential,
  Data,
  type InlineDatum,
  OriginalBytes,
  PolicyId,
  Provider,
  type RewardAddress,
  type Script,
  TransactionHash,
  type TransactionInput,
  type UTxO
} from "@evolution-sdk/evolution"
import { Analyze, type Decode, type Phase1 } from "@evolution-sdk/review"
import { Effect } from "effect"

import type * as Types from "./Types.js"

/**
 * Everything here needs chain access, and the UTxO reads additionally need the datum
 * decoder: an inline datum arrives as CBOR and leaves as CIP-116 JSON.
 *
 * @since 0.1.0
 */
export type QueryEff<A> = Effect.Effect<
  A,
  Provider.ProviderError | Analyze.DecodeError,
  Provider.ProviderEffect | Decode.Decode
>

/**
 * The `ProviderEffect` members the 20 implemented operations need beyond the required core.
 *
 * A wallet advertising `{cip: 139}` is telling a dApp it can stop bringing its own query
 * layer, so the claim has to be true of the backend actually wired in — hence a list,
 * checked, rather than a constant.
 *
 * @since 0.1.0
 */
export const QUERY_LAYER_MEMBERS = [
  "getUtxosByAsset",
  "getAccountUtxos",
  "getUtxosOfTransaction",
  "getChainParameters",
  "getProtocolParametersAt",
  "getDReps",
  "getDRep",
  "getCommittee",
  "getPools",
  "getPool",
  "getProposals",
  "getProposal",
  "getVotesByDRep",
  "getVotesByPool",
  "getVotesByCommittee",
  "getVotesByProposal"
] as const satisfies ReadonlyArray<keyof Provider.ProviderEffect>

/**
 * Whether `provider` implements every member {@link makeQueryLayer} depends on.
 *
 * ⚠️ `getAccountInfo` is deliberately NOT in this list. Only `getDrepByStakeCredential`
 * needs it, so a provider without it serves nineteen of the twenty operations — and
 * reporting the whole extension unavailable for one of them would be a worse answer than
 * failing that one call with the member it wanted named.
 *
 * @since 0.1.0
 */
export const supportsQueryLayer = (provider: Provider.ProviderEffect): boolean =>
  QUERY_LAYER_MEMBERS.every((m) => provider[m] !== undefined)

// ── enum translation ────────────────────────────────────────────────────────────

const POOL_STATUS: Readonly<Record<string, Types.PoolStatus>> = {
  registered: "active", // the backend says `registered`; the CIP's enum has no such member
  retiring: "retiring",
  retired: "retired"
}
const VOTE: Readonly<Record<string, Types.Vote>> = { Yes: "yes", No: "no", Abstain: "abstain" }
const COMMITTEE_STATUS: Readonly<Record<string, Types.CommitteeStatus>> = {
  authorized: "authorised", // US to British: the CIP spells it with an s
  not_authorized: "not_authorised",
  resigned: "resigned"
}

/**
 * Translate a backend enum value, or FAIL.
 *
 * Passing an unrecognised value through would emit JSON that violates the CIP's enum while
 * looking entirely reasonable — the failure mode a consumer discovers last. A loud error
 * names the value, so a new backend spelling is a one-line fix.
 */
const mapEnum = <A>(what: string, table: Readonly<Record<string, A>>, raw: string): A => {
  const mapped = table[raw]
  if (mapped === undefined) {
    throw new Error(`unknown ${what} value "${raw}" (known: ${Object.keys(table).join(", ")})`)
  }
  return mapped
}

const interval = (i: { readonly numerator: bigint; readonly denominator: bigint }): Types.Interval => ({
  numerator: i.numerator.toString(),
  denominator: i.denominator.toString()
})

const model = (v: ReadonlyArray<bigint> | undefined): ReadonlyArray<string> | undefined =>
  v !== undefined && v.length > 0 ? v.map((n) => n.toString()) : undefined

// ── row to wire mappers (pure, throwing; wrapped by `tryMap` at the call site) ──

/** @since 0.1.0 */
export const voteInfo = (v: Provider.VoteRecord): Types.VoteInfo => ({
  proposal_id: v.proposalId,
  vote_tx_hash: v.voteTxHash,
  vote: mapEnum("vote", VOTE, v.vote)
})

/**
 * `DRepInfo.amount` is typed `PosInt64` — **zero-excluded**. A registered DRep with no
 * delegated stake is an ordinary on-chain state, so that is a spec defect rather than an
 * impossible case; `"0"` is emitted regardless, because omitting a required field would
 * break every consumer instead of only a strict validator.
 *
 * @since 0.1.0
 */
export const drepInfo = (d: Provider.DRepSummary): Types.DRepInfo => ({
  drep_id: d.drepId,
  amount: d.amount.toString(),
  active: d.active
})

/** @since 0.1.0 */
export const committeeMember = (m: Provider.CommitteeMember): Types.CommitteeMember => ({
  cc_cold_key: m.coldId,
  cc_hot_key: m.hotId,
  status: mapEnum("committee status", COMMITTEE_STATUS, m.status)
})

/**
 * `Pool` requires `live_stake`, which only the per-pool read carries. The provider is
 * responsible for having fetched it, and its absence is an error rather than a zero.
 *
 * @since 0.1.0
 */
export const pool = (p: Provider.PoolSummary): Types.Pool => {
  if (p.liveStake === undefined) {
    throw new Error(`pool ${p.poolId}: live_stake is required by CIP-139 but the backend did not report it`)
  }
  return {
    pool_id: p.poolId,
    status: mapEnum("pool status", POOL_STATUS, p.status),
    active_stake: p.activeStake.toString(),
    live_stake: p.liveStake.toString()
  }
}

/** @since 0.1.0 */
export const proposal = (p: Provider.ProposalSummary): Types.Proposal => ({
  proposal_id: p.proposalId,
  ...(p.ratifiedEpoch !== undefined ? { ratified_epoch: p.ratifiedEpoch } : {}),
  ...(p.enactedEpoch !== undefined ? { enacted_epoch: p.enactedEpoch } : {}),
  ...(p.expiredEpoch !== undefined ? { expired_epoch: p.expiredEpoch } : {}),
  ...(p.expiration !== undefined ? { expiration: p.expiration } : {})
})

/**
 * The provider's two parameter documents to CIP-139's one.
 *
 * Takes both halves because that is how the provider tier splits them:
 * {@link Provider.ProtocolParameters} is what a transaction needs and is on the hot path of
 * every send, {@link Provider.ChainParameters} is what a governance read needs — and carries
 * the prices and the reference-script cost exactly, where the first rounds them into a
 * `number`. CIP-139's document is the union, and it wants the exact form.
 *
 * @since 0.1.0
 */
export const protocolParams = (
  base: Provider.ProtocolParameters,
  chain: Provider.ChainParameters
): Types.ProtocolParams => {
  const v1 = model(chain.plutusV1CostModel)
  const v2 = model(chain.plutusV2CostModel)
  const v3 = model(chain.plutusV3CostModel)
  return {
    minfee_a: base.minFeeA.toString(),
    minfee_b: base.minFeeB.toString(),
    max_block_body_size: chain.maxBlockBodySize,
    max_tx_size: base.maxTxSize,
    max_block_header_size: chain.maxBlockHeaderSize,
    key_deposit: base.keyDeposit.toString(),
    pool_deposit: base.poolDeposit.toString(),
    max_epoch: chain.poolRetireMaxEpoch,
    n_opt: chain.stakePoolTargetNum,
    pool_pledge_influence: interval(chain.poolPledgeInfluence),
    expansion_rate: interval(chain.monetaryExpansion),
    treasury_growth_rate: interval(chain.treasuryCut),
    min_pool_cost: chain.minPoolCost.toString(),
    ada_per_utxo_byte: base.coinsPerUtxoByte.toString(),
    cost_models: {
      ...(v1 ? { plutus_v1: v1 } : {}),
      ...(v2 ? { plutus_v2: v2 } : {}),
      ...(v3 ? { plutus_v3: v3 } : {})
    },
    execution_costs: {
      mem_price: interval(chain.executionPrices.mem),
      step_price: interval(chain.executionPrices.step)
    },
    max_tx_ex_units: { mem: chain.maxTxExMem.toString(), steps: chain.maxTxExSteps.toString() },
    max_block_ex_units: { mem: chain.maxBlockExMem.toString(), steps: chain.maxBlockExSteps.toString() },
    max_value_size: base.maxValSize,
    collateral_percentage: base.collateralPercentage,
    max_collateral_inputs: base.maxCollateralInputs,
    protocol_version: {
      major: Number(chain.protocolVersion.major),
      minor: Number(chain.protocolVersion.minor)
    },
    pool_voting_thresholds: chain.poolVotingThresholds.map(interval),
    drep_voting_thresholds: chain.drepVotingThresholds.map(interval),
    committee_min_size: chain.committeeMinSize,
    committee_max_term_length: chain.committeeMaxTermLength,
    gov_action_lifetime: chain.govActionLifetime,
    gov_action_deposit: chain.govActionDeposit.toString(),
    drep_deposit: base.drepDeposit.toString(),
    drep_activity: chain.drepActivity,
    min_fee_ref_script_cost_per_byte: interval(chain.minFeeRefScriptCostPerByte)
  }
}

// ── plumbing ────────────────────────────────────────────────────────────────────

const tryMap = <A>(what: string, f: () => A): Effect.Effect<A, Provider.ProviderError> =>
  Effect.try({
    try: f,
    catch: (e) =>
      new Provider.ProviderError({
        cause: e,
        message: `cip139 ${what}: ${e instanceof Error ? e.message : String(e)}`
      })
  })

/** A provider member this operation cannot work without. Fails naming both sides. */
const needs = <A>(
  value: A | undefined,
  method: string,
  member: keyof Provider.ProviderEffect
): Effect.Effect<A, Provider.ProviderError> =>
  value === undefined
    ? Effect.fail(
        new Provider.ProviderError({
          message: `cip139 ${method} requires ProviderEffect.${String(member)}, which this provider does not implement`
        })
      )
    : Effect.succeed(value)

const assetAmounts = (assets: CoreAssets.Assets): ReadonlyArray<Phase1.AssetAmount> =>
  CoreAssets.flatten(assets).map(([policyId, assetName, quantity]) => ({
    policyHex: PolicyId.toHex(policyId),
    nameHex: AssetName.toHex(assetName),
    quantity
  }))

const plutusScriptRef = (script: Script.Script | undefined) => {
  if (script === undefined) return undefined
  switch (script._tag) {
    case "PlutusV1":
    case "PlutusV2":
    case "PlutusV3":
      return {
        tag: "plutus_script" as const,
        value: Cip116.plutusScript(
          script._tag === "PlutusV1" ? "V1" : script._tag === "PlutusV2" ? "V2" : "V3",
          Bytes.toHex(script.bytes)
        )
      }
    default:
      // A native script is not a `plutus_script`, and CIP-116's `script_ref` has no other arm
      // here. Dropped rather than mis-tagged.
      return undefined
  }
}

/**
 * A UTxO to CIP-116 `TransactionUnspentOutput`.
 *
 * The inline datum is emitted BOTH ways: as `plutus_data` (the CIP-116 tree, which is what
 * the spec asks for) and as `datum_hex` — the datum exactly as the chain carries it. The tree
 * alone is not enough for a consumer that must hash or re-submit the datum, because
 * re-encoding reframes an empty Plutus array and a datum that re-encodes differently hashes
 * differently.
 *
 * ⚠️ `datum_hex` is emitted only when the provider PRESERVED those bytes (recorded through
 * Evolution's `OriginalBytes`). A datum built from scratch, or decoded by a backend
 * that discarded its bytes, has no original to report — and re-deriving one would be a
 * fabrication of exactly the kind the field exists to prevent.
 */
const utxoJson = (utxo: UTxO.UTxO): QueryEff<Cip116.Cip116TransactionUnspentOutput> =>
  Effect.gen(function* () {
    const datum = utxo.datumOption
    const inline = datum !== undefined && datum._tag === "InlineDatum" ? (datum as InlineDatum.InlineDatum) : undefined
    const inlineRaw = inline !== undefined ? OriginalBytes.get(inline) : undefined
    const inlineHex = inlineRaw !== undefined ? Bytes.toHex(inlineRaw) : undefined
    const plutus =
      inline !== undefined
        ? {
            tag: "datum" as const,
            value: Cip116.plutusData(yield* Analyze.plutusData(inlineHex ?? Data.toCBORHex(inline.data)))
          }
        : datum !== undefined && datum._tag === "DatumHash"
          ? { tag: "datum_hash" as const, value: Bytes.toHex(datum.hash) }
          : undefined
    const script = plutusScriptRef(utxo.scriptRef)
    return Cip116.transactionUnspentOutput(
      Cip116.transactionInput(TransactionHash.toHex(utxo.transactionId), Number(utxo.index)),
      {
        address: Address.toBech32(utxo.address),
        amount: Cip116.value(CoreAssets.lovelaceOf(utxo.assets), assetAmounts(utxo.assets)),
        ...(plutus !== undefined ? { plutus_data: plutus } : {}),
        ...(script !== undefined ? { script_ref: script } : {}),
        ...(inlineHex !== undefined ? { datum_hex: inlineHex } : {})
      }
    )
  })

// ── the query layer ─────────────────────────────────────────────────────────────

/**
 * The 20 implemented CIP-139 operations, named exactly as in `cip-0144.md`.
 *
 * @since 0.1.0
 */
export interface QueryLayer {
  readonly getUtxosByAddress: (
    address: Address.Address
  ) => QueryEff<ReadonlyArray<Cip116.Cip116TransactionUnspentOutput>>
  readonly getUtxosByAsset: (
    assetNameHex: string,
    mintingPolicyHashHex: string
  ) => QueryEff<ReadonlyArray<Cip116.Cip116TransactionUnspentOutput>>
  readonly getUtxosByPaymentCredential: (
    credential: Credential.Credential
  ) => QueryEff<ReadonlyArray<Cip116.Cip116TransactionUnspentOutput>>
  readonly getUtxosByStakeCredential: (
    rewardAddress: RewardAddress.RewardAddress
  ) => QueryEff<ReadonlyArray<Cip116.Cip116TransactionUnspentOutput>>
  readonly getUtxosByTransactionHash: (
    txHash: TransactionHash.TransactionHash
  ) => QueryEff<ReadonlyArray<Cip116.Cip116TransactionUnspentOutput>>
  readonly getProtocolParametersByLatest: () => QueryEff<Types.ProtocolParams>
  readonly getProtocolParametersByEpoch: (epoch: number) => QueryEff<Types.ProtocolParams>
  readonly getVotesByDrepId: (drepId: string) => QueryEff<ReadonlyArray<Types.VoteInfo>>
  readonly getVotesBySpoId: (poolId: string) => QueryEff<ReadonlyArray<Types.VoteInfo>>
  readonly getVotesByCcId: (ccHotId: string) => QueryEff<ReadonlyArray<Types.VoteInfo>>
  readonly getVotesByProposalId: (proposalId: string) => QueryEff<ReadonlyArray<Types.VoteInfo>>
  readonly getAllDreps: () => QueryEff<ReadonlyArray<Types.DRepInfo>>
  readonly getDrepById: (drepId: string) => QueryEff<Types.DRepInfo | null>
  readonly getDrepByStakeCredential: (rewardAddress: RewardAddress.RewardAddress) => QueryEff<Types.DRepInfo | null>
  readonly getAllCommitteeMembers: () => QueryEff<ReadonlyArray<Types.CommitteeMember>>
  readonly getCommitteeMemberById: (ccHotId: string) => QueryEff<Types.CommitteeMember | null>
  readonly getAllPools: () => QueryEff<ReadonlyArray<Types.Pool>>
  readonly getPoolById: (poolId: string) => QueryEff<Types.Pool | null>
  readonly getAllProposals: () => QueryEff<ReadonlyArray<Types.Proposal>>
  readonly getProposalById: (proposalId: string) => QueryEff<Types.Proposal | null>
}

/**
 * The CIP-139 read surface over whatever provider is in context.
 *
 * Takes no account and no keys — a query layer is not custody, so this needs nothing a
 * wallet would have to guard. Whether a dApp may CALL it is a policy question for the host
 * wallet (it spends the wallet's query budget), which is why gating lives there and not here.
 *
 * @since 0.1.0
 */
export const makeQueryLayer = (): QueryLayer => {
  const utxoList = (
    fetch: (p: Provider.ProviderEffect) => Effect.Effect<Array<UTxO.UTxO>, Provider.ProviderError> | undefined,
    method: string,
    member: keyof Provider.ProviderEffect
  ): QueryEff<ReadonlyArray<Cip116.Cip116TransactionUnspentOutput>> =>
    Effect.gen(function* () {
      const provider = yield* Provider.ProviderEffect
      const fetched = yield* needs(fetch(provider), method, member)
      const utxos = yield* fetched
      return yield* Effect.forEach(utxos, utxoJson)
    })

  const votes =
    (
      pick: (
        p: Provider.ProviderEffect
      ) => ((id: string) => Effect.Effect<Array<Provider.VoteRecord>, Provider.ProviderError>) | undefined,
      method: string,
      member: keyof Provider.ProviderEffect
    ) =>
    (id: string): QueryEff<ReadonlyArray<Types.VoteInfo>> =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const fetch = yield* needs(pick(provider), method, member)
        const rows = yield* fetch(id)
        return yield* tryMap(method, () => rows.map(voteInfo))
      })

  const params = (epoch?: number) =>
    Effect.gen(function* () {
      const provider = yield* Provider.ProviderEffect
      // Even for a historical epoch the thresholds only exist in the chain-parameters
      // document, so both variants need it; the epoch variant additionally reads that
      // epoch's fee and deposit values.
      const chainFetch = yield* needs(provider.getChainParameters, "getProtocolParameters", "getChainParameters")
      const chain = yield* chainFetch()
      const current = yield* provider.getProtocolParameters()
      const base = yield* tryMap("getProtocolParameters", () => protocolParams(current, chain))
      if (epoch === undefined) return base
      const at = yield* needs(
        provider.getProtocolParametersAt,
        "getProtocolParametersByEpoch",
        "getProtocolParametersAt"
      )
      const historical = yield* at(epoch)
      return yield* tryMap("getProtocolParametersByEpoch", () => protocolParams(historical, chain))
    })

  return {
    getUtxosByAddress: (address) => utxoList((p) => p.getUtxos(address), "getUtxosByAddress", "getUtxos"),
    getUtxosByAsset: (assetNameHex, mintingPolicyHashHex) =>
      utxoList(
        (p) => p.getUtxosByAsset?.(`${mintingPolicyHashHex}${assetNameHex}`),
        "getUtxosByAsset",
        "getUtxosByAsset"
      ),
    getUtxosByPaymentCredential: (credential) =>
      utxoList((p) => p.getUtxos(credential), "getUtxosByPaymentCredential", "getUtxos"),
    getUtxosByStakeCredential: (rewardAddress) =>
      utxoList((p) => p.getAccountUtxos?.(rewardAddress), "getUtxosByStakeCredential", "getAccountUtxos"),
    getUtxosByTransactionHash: (txHash) =>
      utxoList((p) => p.getUtxosOfTransaction?.(txHash), "getUtxosByTransactionHash", "getUtxosOfTransaction"),
    getProtocolParametersByLatest: () => params(),
    getProtocolParametersByEpoch: (epoch) => params(epoch),
    getVotesByDrepId: votes((p) => p.getVotesByDRep, "getVotesByDrepId", "getVotesByDRep"),
    getVotesBySpoId: votes((p) => p.getVotesByPool, "getVotesBySpoId", "getVotesByPool"),
    getVotesByCcId: votes((p) => p.getVotesByCommittee, "getVotesByCcId", "getVotesByCommittee"),
    getVotesByProposalId: votes((p) => p.getVotesByProposal, "getVotesByProposalId", "getVotesByProposal"),
    getAllDreps: () =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const fetch = yield* needs(provider.getDReps, "getAllDreps", "getDReps")
        const rows = yield* fetch()
        return yield* tryMap("getAllDreps", () => rows.map(drepInfo))
      }),
    getDrepById: (drepId) =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const fetch = yield* needs(provider.getDRep, "getDrepById", "getDRep")
        const row = yield* fetch(drepId)
        return row === null ? null : yield* tryMap("getDrepById", () => drepInfo(row))
      }),
    getDrepByStakeCredential: (rewardAddress) =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const account = yield* needs(provider.getAccountInfo, "getDrepByStakeCredential", "getAccountInfo")
        const fetch = yield* needs(provider.getDRep, "getDrepByStakeCredential", "getDRep")
        const info = yield* account(rewardAddress)
        const target = info?.delegatedDRep
        // `null` = not delegated. The predefined targets (`drep_always_abstain` /
        // `drep_always_no_confidence`) are voting behaviours, not registered DReps with
        // stake, so there is no DRepInfo to return for them either.
        if (target == null || target.startsWith("drep_always")) return null
        const row = yield* fetch(target)
        return row === null ? null : yield* tryMap("getDrepByStakeCredential", () => drepInfo(row))
      }),
    getAllCommitteeMembers: () =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const fetch = yield* needs(provider.getCommittee, "getAllCommitteeMembers", "getCommittee")
        const rows = yield* fetch()
        return yield* tryMap("getAllCommitteeMembers", () => rows.map(committeeMember))
      }),
    getCommitteeMemberById: (ccHotId) =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const fetch = yield* needs(provider.getCommittee, "getCommitteeMemberById", "getCommittee")
        const rows = yield* fetch()
        const found = rows.find((m) => m.hotId === ccHotId)
        return found === undefined ? null : yield* tryMap("getCommitteeMemberById", () => committeeMember(found))
      }),
    getAllPools: () =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const fetch = yield* needs(provider.getPools, "getAllPools", "getPools")
        const rows = yield* fetch()
        return yield* tryMap("getAllPools", () => rows.map(pool))
      }),
    getPoolById: (poolId) =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const fetch = yield* needs(provider.getPool, "getPoolById", "getPool")
        const row = yield* fetch(poolId)
        return row === null ? null : yield* tryMap("getPoolById", () => pool(row))
      }),
    getAllProposals: () =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const fetch = yield* needs(provider.getProposals, "getAllProposals", "getProposals")
        const rows = yield* fetch()
        return yield* tryMap("getAllProposals", () => rows.map(proposal))
      }),
    getProposalById: (proposalId) =>
      Effect.gen(function* () {
        const provider = yield* Provider.ProviderEffect
        const fetch = yield* needs(provider.getProposal, "getProposalById", "getProposal")
        const row = yield* fetch(proposalId)
        return row === null ? null : yield* tryMap("getProposalById", () => proposal(row))
      })
  }
}

// ── the gap fillers — NOT CIP-139 ───────────────────────────────────────────────

/**
 * What CIP-139 cannot answer but a transaction-building dApp needs anyway.
 *
 * Deliberately NOT part of {@link QueryLayer}: a wallet should expose these under CIP-30's
 * experimental namespace (`api.experimental.*`), which is exactly what that namespace is
 * for, so nothing here can be mistaken for standard surface.
 *
 * - **`tip`** — CIP-139 has no chain-tip operation at all (verified against both
 *   `endpoints.md` and `cip-0144.md`). A dApp setting a transaction's validity interval
 *   cannot work without the current slot, so a strict 139 implementation leaves the dApp
 *   still needing its own backend for this one value.
 * - **`resolveOutpoints`** — 139's per-transaction UTxO query is keyed by tx hash, so
 *   resolving N outpoints spread over N transactions costs N round trips. This is the
 *   batched form. ⚠️ An outpoint that has been SPENT is simply absent from the answer: the
 *   provider tier filters consumed outputs out of `getUtxosByOutRef`, because handing one to
 *   a builder produces a transaction the node rejects. So the result is a subset of the
 *   input, and membership is the liveness signal.
 *
 * @since 0.1.0
 */
export interface QueryExperimental {
  readonly tip: () => Effect.Effect<Provider.Tip, Provider.ProviderError, Provider.ProviderEffect>
  readonly resolveOutpoints: (
    refs: ReadonlyArray<TransactionInput.TransactionInput>
  ) => QueryEff<ReadonlyArray<Cip116.Cip116TransactionUnspentOutput>>
}

/** @since 0.1.0 */
export const makeQueryExperimental = (): QueryExperimental => ({
  // `getTip` is optional on their interface: a backend written elsewhere need not report a
  // tip. This layer is built over backends that do, so the assertion is local and checked here.
  tip: () => Effect.flatMap(Provider.ProviderEffect, (p) => p.getTip!()),
  resolveOutpoints: (refs) =>
    Effect.gen(function* () {
      const provider = yield* Provider.ProviderEffect
      const resolved = yield* provider.getUtxosByOutRef([...refs])
      return yield* Effect.forEach(resolved, utxoJson)
    })
})
