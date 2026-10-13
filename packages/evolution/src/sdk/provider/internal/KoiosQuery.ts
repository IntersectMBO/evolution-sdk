import { Effect, pipe, Schema } from "effect"

import * as CoreAddress from "../../../Address.js"
import * as Credential from "../../../Credential.js"
import * as NonnegativeInterval from "../../../NonnegativeInterval.js"
import * as ProtocolVersion from "../../../ProtocolVersion.js"
import type * as CoreRewardAddress from "../../../RewardAddress.js"
import * as TransactionHash from "../../../TransactionHash.js"
import * as UnitInterval from "../../../UnitInterval.js"
import type * as CoreUTxO from "../../../UTxO.js"
import * as Provider from "../Provider.js"
import * as HttpUtils from "./HttpUtils.js"
import * as _Koios from "./Koios.js"

// Koios's half of the chain-wide query tier — the seventeen optional members of
// `ProviderEffect`. They live apart from `KoiosEffect.ts` because they answer a
// different question: that file is what a transaction builder needs, this one is what a
// wallet's governance and discovery surfaces read.

/**
 * Any failure from a Koios read, as this port's error.
 *
 * ⚠️ The cause goes in the MESSAGE as well as the field. A caller that re-wraps this error — an
 * adapter onto another provider port, say — typically keeps `message` and drops `cause`, and then
 * "Koios getChainParameters failed" is all anyone ever sees. That happened: a decode that failed
 * on one named field read as an unattributable provider error through two layers of wrapping.
 */
const wrapError = (operation: string) => (cause: unknown) =>
  Effect.fail(
    new Provider.ProviderError({
      cause,
      message: `Koios ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`
    })
  )

const auth = (token?: _Koios.TokenSource) => _Koios.authHeader(token)

// ── exact rationals ──────────────────────────────────────────────────────────────

/**
 * A `cardano-cli` rational, exactly.
 *
 * The document spells these two ways and both appear in the wild: `{numerator,
 * denominator}` for the ones that are rationals on chain, and a bare JSON decimal for the
 * rest. The decimal is parsed as a STRING — never multiplied through a float — so
 * `0.0577` becomes `577/10000` rather than whatever the nearest double rounds to.
 */
const fraction = (value: unknown, what: string): readonly [bigint, bigint] => {
  if (value != null && typeof value === "object") {
    const o = value as Record<string, unknown>
    if (o.numerator != null && o.denominator != null) {
      return [BigInt(o.numerator as number), BigInt(o.denominator as number)]
    }
  }
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`missing or unreadable rational: ${what}`)
  }
  // ⚠️ One implementation of decimal → exact rational, and it must be the one that expands
  // exponent notation from the TEXT. Koios serves these in exponent form — `priceMemory` is
  // `5.77e-2`, `monetaryExpansion` is `3.0e-3` — and reading them back through `toFixed(20)`
  // re-introduces the binary error the exactness exists to avoid: it turned `7.21e-5` into a
  // twenty-digit fraction whose denominator (5e19) does not even fit a `uint64`, so the decode
  // failed outright on the document the endpoint actually serves.
  try {
    const exact = NonnegativeInterval.fromDecimal(value)
    return [exact.numerator, exact.denominator]
  } catch (cause) {
    throw new Error(`cannot parse a rational from "${String(value)}" (${what})`, { cause })
  }
}

const unitInterval = (value: unknown, what: string): UnitInterval.UnitInterval => {
  const [numerator, denominator] = fraction(value, what)
  return new UnitInterval.UnitInterval({ numerator, denominator })
}

const nonnegativeInterval = (value: unknown, what: string): NonnegativeInterval.NonnegativeInterval => {
  const [numerator, denominator] = fraction(value, what)
  return new NonnegativeInterval.NonnegativeInterval({ numerator, denominator })
}

/**
 * An integer field of a Koios document.
 *
 * ⚠️ **It arrives as a STRING, and that is not a Koios quirk — it is this client's own doing.**
 * `HttpUtils` parses every response with a reviver that hands each number to the schema as the
 * exact text the server wrote, so a `uint64` amount survives at any size. Which means a helper
 * that insists on `typeof value === "number"` rejects every populated document and accepts only
 * the hand-built fixtures that never went through the reviver.
 *
 * That is how `getChainParameters` came to fail on the live endpoint while its test stayed
 * green: the test calls the mapping with a JS object, and the wire delivers strings.
 */
const integer = (value: unknown, what: string): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  throw new Error(`missing integer: ${what}`)
}

const big = (value: unknown, what: string): bigint => {
  if (typeof value === "bigint") return value
  if (typeof value === "number" || typeof value === "string") return BigInt(value)
  throw new Error(`missing integer: ${what}`)
}

const exUnit = (value: unknown, what: string): { mem: bigint; steps: bigint } => {
  const o = (value ?? {}) as Record<string, unknown>
  return { mem: big(o.memory, `${what}.memory`), steps: big(o.steps, `${what}.steps`) }
}

const costModel = (value: unknown): ReadonlyArray<bigint> | undefined =>
  Array.isArray(value) ? value.map((n) => BigInt(n as number)) : undefined

// ── row schemas ─────────────────────────────────────────────────────────────────

/** `/account_info`, read for everything the row carries rather than for delegation alone. */
export const AccountInfoFullSchema = Schema.Struct({
  status: Schema.optional(Schema.String),
  delegated_pool: Schema.NullishOr(Schema.String),
  delegated_drep: Schema.NullishOr(Schema.String),
  rewards_available: Schema.BigInt,
  deposit: Schema.optional(Schema.NullOr(Schema.BigInt)),
  total_balance: Schema.optional(Schema.NullOr(Schema.BigInt))
})

export const DRepIdSchema = Schema.Struct({ drep_id: Schema.String })

export const DRepInfoSchema = Schema.Struct({
  drep_id: Schema.String,
  active: Schema.Boolean,
  amount: Schema.BigInt
})

export const CommitteeInfoSchema = Schema.Struct({
  members: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          cc_cold_id: Schema.NullishOr(Schema.String),
          cc_hot_id: Schema.NullishOr(Schema.String),
          status: Schema.NullishOr(Schema.String)
        })
      )
    )
  )
})

export const PoolIdSchema = Schema.Struct({ pool_id_bech32: Schema.String })

/**
 * `/pool_list` and `/pool_info` rows.
 *
 * ⚠️ `live_stake` is a `/pool_info` column, and the two absences are different facts: a
 * row that LACKS the key came from a listing that cannot report it, while a row that HAS
 * it as `null` is a pool with none — every retired pool on preprod reports
 * `active_stake: null, live_stake: null`. Reading null as unknown made "all pools" fail
 * on any chain containing a retired pool, which is all of them.
 */
export const PoolRowSchema = Schema.Struct({
  pool_id_bech32: Schema.String,
  pool_status: Schema.optional(Schema.NullOr(Schema.String)),
  active_stake: Schema.optional(Schema.NullOr(Schema.BigInt)),
  live_stake: Schema.optional(Schema.NullOr(Schema.BigInt))
})

export const ProposalRowSchema = Schema.Struct({
  proposal_id: Schema.String,
  ratified_epoch: Schema.optional(Schema.NullOr(Schema.Number)),
  enacted_epoch: Schema.optional(Schema.NullOr(Schema.Number)),
  expired_epoch: Schema.optional(Schema.NullOr(Schema.Number)),
  expiration: Schema.optional(Schema.NullOr(Schema.Number))
})

export const VoteRowSchema = Schema.Struct({
  proposal_id: Schema.String,
  vote_tx_hash: Schema.String,
  vote: Schema.String
})

/** One `/tx_info` OUTPUT row. The address is nested here, unlike every UTxO listing. */
export const TxOutputRowSchema = Schema.Struct({
  tx_hash: Schema.String,
  tx_index: Schema.BigInt,
  payment_addr: Schema.optional(Schema.NullOr(Schema.Struct({ bech32: Schema.String }))),
  address: Schema.optional(Schema.NullOr(Schema.String)),
  value: Schema.BigInt,
  datum_hash: Schema.NullishOr(Schema.String),
  inline_datum: Schema.NullishOr(Schema.Struct({ bytes: Schema.NullOr(Schema.String), value: Schema.Unknown })),
  reference_script: Schema.NullishOr(Schema.Unknown),
  asset_list: Schema.NullishOr(Schema.Unknown)
})

export const TxInfoOutputsSchema = Schema.Struct({
  outputs: Schema.optional(Schema.NullOr(Schema.Array(TxOutputRowSchema)))
})

// ── row mappers ─────────────────────────────────────────────────────────────────

export const toAccountInfo = (row: Schema.Schema.Type<typeof AccountInfoFullSchema>): Provider.AccountInfo => ({
  registered: row.status === "registered",
  delegatedPool: row.delegated_pool ?? null,
  delegatedDRep: row.delegated_drep ?? null,
  rewardsAvailable: row.rewards_available,
  deposit: row.deposit ?? undefined,
  controlledBalance: row.total_balance ?? undefined
})

export const toDRepSummary = (row: Schema.Schema.Type<typeof DRepInfoSchema>): Provider.DRepSummary => ({
  drepId: row.drep_id,
  active: row.active,
  amount: row.amount
})

export const toCommitteeMembers = (
  row: Schema.Schema.Type<typeof CommitteeInfoSchema>
): Array<Provider.CommitteeMember> =>
  (row.members ?? []).map((m) => ({
    coldId: m.cc_cold_id ?? "",
    hotId: m.cc_hot_id ?? "",
    status: m.status ?? ""
  }))

export const toPoolSummary = (row: Schema.Schema.Type<typeof PoolRowSchema>): Provider.PoolSummary => ({
  poolId: row.pool_id_bech32,
  status: row.pool_status ?? "",
  activeStake: row.active_stake ?? 0n,
  ...("live_stake" in row ? { liveStake: row.live_stake ?? 0n } : {})
})

export const toProposalSummary = (row: Schema.Schema.Type<typeof ProposalRowSchema>): Provider.ProposalSummary => ({
  proposalId: row.proposal_id,
  ...(row.ratified_epoch != null ? { ratifiedEpoch: row.ratified_epoch } : {}),
  ...(row.enacted_epoch != null ? { enactedEpoch: row.enacted_epoch } : {}),
  ...(row.expired_epoch != null ? { expiredEpoch: row.expired_epoch } : {}),
  ...(row.expiration != null ? { expiration: row.expiration } : {})
})

export const toVoteRecord = (row: Schema.Schema.Type<typeof VoteRowSchema>): Provider.VoteRecord => ({
  proposalId: row.proposal_id,
  voteTxHash: row.vote_tx_hash,
  vote: row.vote
})

/** The CDDL order of `pool_voting_thresholds` (5). Order IS the schema here. */
const POOL_THRESHOLDS = [
  "motionNoConfidence",
  "committeeNormal",
  "committeeNoConfidence",
  "hardForkInitiation",
  "ppSecurityGroup"
] as const
/** The CDDL order of `drep_voting_thresholds` (10). */
const DREP_THRESHOLDS = [
  "motionNoConfidence",
  "committeeNormal",
  "committeeNoConfidence",
  "updateToConstitution",
  "hardForkInitiation",
  "ppNetworkGroup",
  "ppEconomicGroup",
  "ppTechnicalGroup",
  "ppGovGroup",
  "treasuryWithdrawal"
] as const

/**
 * Koios's `/cli_protocol_params` document to {@link Provider.ChainParameters}.
 *
 * Exported so the mapping can be tested without a network. Thresholds are ORDERED CDDL
 * arrays, not the named object Koios returns: getting the order wrong yields plausible,
 * wrong numbers.
 */
export const toChainParameters = (doc: Record<string, unknown>): Provider.ChainParameters => {
  const models = (doc.costModels ?? {}) as Record<string, unknown>
  const pool = (doc.poolVotingThresholds ?? {}) as Record<string, unknown>
  const drep = (doc.dRepVotingThresholds ?? {}) as Record<string, unknown>
  const version = (doc.protocolVersion ?? {}) as Record<string, unknown>
  const prices = (doc.executionUnitPrices ?? {}) as Record<string, unknown>
  const maxTx = exUnit(doc.maxTxExecutionUnits, "maxTxExecutionUnits")
  const maxBlock = exUnit(doc.maxBlockExecutionUnits, "maxBlockExecutionUnits")
  const v1 = costModel(models.PlutusV1)
  const v2 = costModel(models.PlutusV2)
  const v3 = costModel(models.PlutusV3)
  return {
    poolVotingThresholds: POOL_THRESHOLDS.map((k) => unitInterval(pool[k], `poolVotingThresholds.${k}`)),
    drepVotingThresholds: DREP_THRESHOLDS.map((k) => unitInterval(drep[k], `dRepVotingThresholds.${k}`)),
    committeeMinSize: integer(doc.committeeMinSize, "committeeMinSize"),
    committeeMaxTermLength: integer(doc.committeeMaxTermLength, "committeeMaxTermLength"),
    govActionLifetime: integer(doc.govActionLifetime, "govActionLifetime"),
    govActionDeposit: big(doc.govActionDeposit, "govActionDeposit"),
    drepActivity: integer(doc.dRepActivity, "dRepActivity"),
    maxBlockBodySize: integer(doc.maxBlockBodySize, "maxBlockBodySize"),
    maxBlockHeaderSize: integer(doc.maxBlockHeaderSize, "maxBlockHeaderSize"),
    poolRetireMaxEpoch: integer(doc.poolRetireMaxEpoch, "poolRetireMaxEpoch"),
    stakePoolTargetNum: integer(doc.stakePoolTargetNum, "stakePoolTargetNum"),
    poolPledgeInfluence: nonnegativeInterval(doc.poolPledgeInfluence, "poolPledgeInfluence"),
    monetaryExpansion: unitInterval(doc.monetaryExpansion, "monetaryExpansion"),
    treasuryCut: unitInterval(doc.treasuryCut, "treasuryCut"),
    minPoolCost: big(doc.minPoolCost, "minPoolCost"),
    maxTxExMem: maxTx.mem,
    maxTxExSteps: maxTx.steps,
    maxBlockExMem: maxBlock.mem,
    maxBlockExSteps: maxBlock.steps,
    protocolVersion: new ProtocolVersion.ProtocolVersion({
      major: big(version.major, "protocolVersion.major"),
      minor: big(version.minor, "protocolVersion.minor")
    }),
    executionPrices: {
      mem: nonnegativeInterval(prices.priceMemory, "executionUnitPrices.priceMemory"),
      step: nonnegativeInterval(prices.priceSteps, "executionUnitPrices.priceSteps")
    },
    minFeeRefScriptCostPerByte: nonnegativeInterval(doc.minFeeRefScriptCostPerByte, "minFeeRefScriptCostPerByte"),
    ...(v1 !== undefined ? { plutusV1CostModel: v1 } : {}),
    ...(v2 !== undefined ? { plutusV2CostModel: v2 } : {}),
    ...(v3 !== undefined ? { plutusV3CostModel: v3 } : {})
  }
}

// ── the seventeen reads ─────────────────────────────────────────────────────────

/**
 * Every page of an extended UTxO listing, spent rows dropped.
 *
 * ⚠️ `timeoutMs` goes INSIDE `pageAll`, so each page gets the full ceiling. Wrapping the walk
 * instead would cut off a credential holding several pages for being large rather than slow.
 */
const pagedUtxos = (
  what: string,
  baseUrl: string,
  path: string,
  body: unknown,
  token?: _Koios.TokenSource,
  timeoutMs?: number
): Effect.Effect<Array<CoreUTxO.UTxO>, Provider.ProviderError> =>
  pipe(
    _Koios.pageAll(path, (offset) =>
      HttpUtils.postJson(
        `${baseUrl}${path}?order=tx_hash.asc,tx_index.asc&limit=${_Koios.PAGE_SIZE}&offset=${offset}`,
        body,
        Schema.Array(_Koios.CredentialUTxOSchema),
        auth(token),
        timeoutMs
      )
    ),
    Effect.map((rows) => rows.filter((u) => u.is_spent !== true).map(_Koios.extendedRowToUTxO)),
    Effect.catchAll(wrapError(what))
  )

export const getUtxosByAsset =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (unit: string) =>
    Effect.suspend(() => {
      if (unit.length < 56) {
        return Effect.fail(
          new Provider.ProviderError({
            cause: unit,
            message: "Koios getUtxosByAsset needs a unit of at least a 56-character policy id"
          })
        )
      }
      return pagedUtxos(
        "getUtxosByAsset",
        baseUrl,
        "/asset_utxos",
        {
          _asset_list: [[unit.slice(0, 56), unit.slice(56)]],
          _extended: true
        },
        token,
        timeoutMs
      )
    })

export const getAccountUtxos =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (rewardAddress: CoreRewardAddress.RewardAddress, options?: { readonly offset?: number; readonly limit?: number }) =>
    pipe(
      pagedUtxos(
        "getAccountUtxos",
        baseUrl,
        "/account_utxos",
        {
          // `_extended` populates each row's `asset_list`; without it Koios returns null.
          _stake_addresses: [rewardAddress],
          _extended: true
        },
        token,
        timeoutMs
      ),
      // ⚠️ `options` bounds the ANSWER, not the work. Spent rows are dropped after the walk,
      // so a window cannot be asked of the backend without over- or under-filling it: an
      // account whose first page is half spent would answer fewer rows than were asked for
      // and read as the end of the list.
      Effect.map((utxos) => {
        if (options?.offset == null && options?.limit == null) return utxos
        const start = options.offset ?? 0
        return options.limit != null ? utxos.slice(start, start + options.limit) : utxos.slice(start)
      })
    )

export const getUtxosOfTransaction =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (txHash: TransactionHash.TransactionHash) =>
    pipe(
      HttpUtils.postJson(
        `${baseUrl}/tx_info`,
        { _tx_hashes: [TransactionHash.toHex(txHash)], _assets: true },
        Schema.Array(TxInfoOutputsSchema),
        auth(token),
        timeoutMs
      ),
      // Every output the transaction PRODUCED, spent or not: this answers "what did tx X
      // create", not "what is still live", so nothing is filtered. `/tx_info` does not
      // report spentness on an output row at all.
      Effect.map((rows) =>
        (rows[0]?.outputs ?? []).map((o) =>
          _Koios.extendedRowToUTxO({
            tx_hash: o.tx_hash,
            tx_index: o.tx_index,
            address: o.payment_addr?.bech32 ?? o.address ?? "",
            value: o.value,
            datum_hash: o.datum_hash ?? null,
            inline_datum: o.inline_datum ?? null,
            reference_script: o.reference_script as never,
            asset_list: o.asset_list as never
          })
        )
      ),
      Effect.catchAll(wrapError("getUtxosOfTransaction"))
    )

export const getAccountInfo =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (rewardAddress: CoreRewardAddress.RewardAddress) =>
    pipe(
      HttpUtils.postJson(
        `${baseUrl}/account_info`,
        { _stake_addresses: [rewardAddress] },
        Schema.Array(AccountInfoFullSchema),
        auth(token),
        timeoutMs
      ),
      // No row = the chain has never seen this stake address. That is an ANSWER, and
      // conflating it with a failed query is what `getDelegation` does.
      Effect.map((rows) => (rows[0] === undefined ? null : toAccountInfo(rows[0]))),
      Effect.catchAll(wrapError("getAccountInfo"))
    )

export const getProtocolParametersAt =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (epoch: number) =>
    pipe(
      HttpUtils.get(
        `${baseUrl}/epoch_params?_epoch_no=${epoch}`,
        Schema.Array(_Koios.ProtocolParametersSchema),
        auth(token),
        timeoutMs
      ),
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.fail(`Koios /epoch_params returned no row for epoch ${epoch}`)
          : Effect.succeed(_Koios.toProtocolParameters(rows[0]))
      ),
      Effect.catchAll(wrapError("getProtocolParametersAt"))
    )

export const getChainParameters =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  () =>
    pipe(
      // Koios serves this one as a bare object, not a PostgREST row array.
      HttpUtils.get(`${baseUrl}/cli_protocol_params`, Schema.Unknown, auth(token), timeoutMs),
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => {
            const doc = Array.isArray(raw) ? raw[0] : raw
            if (doc == null || typeof doc !== "object") throw new Error("expected an object")
            return toChainParameters(doc as Record<string, unknown>)
          },
          catch: (cause) => cause
        })
      ),
      Effect.catchAll(wrapError("getChainParameters"))
    )

export const getDReps =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  () =>
    pipe(
      // `/drep_list` has the ids but neither voting power nor activity, so the full picture
      // is a list walk followed by a batched `/drep_info`. `select` trims both responses to
      // the three columns actually read.
      _Koios.pageAll("/drep_list", (offset) =>
        HttpUtils.get(
          `${baseUrl}/drep_list?select=drep_id&limit=${_Koios.PAGE_SIZE}&offset=${offset}`,
          Schema.Array(DRepIdSchema),
          auth(token),
          timeoutMs
        )
      ),
      Effect.flatMap((ids) =>
        _Koios.batched(
          ids.map((r) => r.drep_id),
          (chunk) =>
            HttpUtils.postJson(
              `${baseUrl}/drep_info?select=drep_id,active,amount`,
              { _drep_ids: chunk },
              Schema.Array(DRepInfoSchema),
              auth(token),
              timeoutMs
            )
        )
      ),
      Effect.map((rows) => rows.map(toDRepSummary)),
      Effect.catchAll(wrapError("getDReps"))
    )

export const getDRep =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (drepId: string) =>
    pipe(
      HttpUtils.postJson(
        `${baseUrl}/drep_info?select=drep_id,active,amount`,
        { _drep_ids: [drepId] },
        Schema.Array(DRepInfoSchema),
        auth(token),
        timeoutMs
      ),
      Effect.map((rows) => (rows[0] === undefined ? null : toDRepSummary(rows[0]))),
      Effect.catchAll(wrapError("getDRep"))
    )

export const getCommittee =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  () =>
    pipe(
      // Koios returns ONE row describing the committee with the members nested under it,
      // not one row per member.
      HttpUtils.get(`${baseUrl}/committee_info`, Schema.Array(CommitteeInfoSchema), auth(token), timeoutMs),
      Effect.map((rows) => (rows[0] === undefined ? [] : toCommitteeMembers(rows[0]))),
      Effect.catchAll(wrapError("getCommittee"))
    )

export const getPools =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  () =>
    pipe(
      // `/pool_list` carries active but not LIVE stake, and a CIP-139 `Pool` requires both,
      // so the list is re-read through the batched `/pool_info`. That costs ~60s for
      // preprod's 679 pools, dominated by the request budget rather than by Koios — the
      // honest price of an unpaginated "all pools". A caller wanting one pool uses `getPool`.
      _Koios.pageAll("/pool_list", (offset) =>
        HttpUtils.get(
          `${baseUrl}/pool_list?select=pool_id_bech32&limit=${_Koios.PAGE_SIZE}&offset=${offset}`,
          Schema.Array(PoolIdSchema),
          auth(token),
          timeoutMs
        )
      ),
      Effect.flatMap((ids) =>
        _Koios.batched(
          ids.map((r) => r.pool_id_bech32),
          (chunk) =>
            HttpUtils.postJson(
              `${baseUrl}/pool_info?select=pool_id_bech32,pool_status,active_stake,live_stake`,
              { _pool_bech32_ids: chunk },
              Schema.Array(PoolRowSchema),
              auth(token),
              timeoutMs
            )
        )
      ),
      Effect.map((rows) => rows.map(toPoolSummary)),
      Effect.catchAll(wrapError("getPools"))
    )

export const getPool =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (poolId: string) =>
    pipe(
      HttpUtils.postJson(
        `${baseUrl}/pool_info?select=pool_id_bech32,pool_status,active_stake,live_stake`,
        { _pool_bech32_ids: [poolId] },
        Schema.Array(PoolRowSchema),
        auth(token),
        timeoutMs
      ),
      Effect.map((rows) => (rows[0] === undefined ? null : toPoolSummary(rows[0]))),
      Effect.catchAll(wrapError("getPool"))
    )

const PROPOSAL_COLUMNS = "proposal_id,ratified_epoch,enacted_epoch,expired_epoch,expiration"

export const getProposals =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  () =>
    pipe(
      _Koios.pageAll("/proposal_list", (offset) =>
        HttpUtils.get(
          `${baseUrl}/proposal_list?select=${PROPOSAL_COLUMNS}&limit=${_Koios.PAGE_SIZE}&offset=${offset}`,
          Schema.Array(ProposalRowSchema),
          auth(token),
          timeoutMs
        )
      ),
      Effect.map((rows) => rows.map(toProposalSummary)),
      Effect.catchAll(wrapError("getProposals"))
    )

export const getProposal =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (proposalId: string) =>
    pipe(
      HttpUtils.get(
        `${baseUrl}/proposal_list?select=${PROPOSAL_COLUMNS}&proposal_id=eq.${encodeURIComponent(proposalId)}&limit=1`,
        Schema.Array(ProposalRowSchema),
        auth(token),
        timeoutMs
      ),
      Effect.map((rows) => (rows[0] === undefined ? null : toProposalSummary(rows[0]))),
      Effect.catchAll(wrapError("getProposal"))
    )

const votes = (
  what: string,
  baseUrl: string,
  path: string,
  query: string,
  token?: _Koios.TokenSource,
  timeoutMs?: number
) =>
  pipe(
    HttpUtils.get(`${baseUrl}${path}?${query}`, Schema.Array(VoteRowSchema), auth(token), timeoutMs),
    Effect.map((rows) => rows.map(toVoteRecord)),
    Effect.catchAll(wrapError(what))
  )

export const getVotesByDRep =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (drepId: string) =>
    votes("getVotesByDRep", baseUrl, "/drep_votes", `_drep_id=${encodeURIComponent(drepId)}`, token, timeoutMs)

export const getVotesByPool =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (poolId: string) =>
    votes("getVotesByPool", baseUrl, "/pool_votes", `_pool_bech32=${encodeURIComponent(poolId)}`, token, timeoutMs)

export const getVotesByCommittee =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (ccHotId: string) =>
    votes(
      "getVotesByCommittee",
      baseUrl,
      "/committee_votes",
      `_cc_hot_id=${encodeURIComponent(ccHotId)}`,
      token,
      timeoutMs
    )

/**
 * NOT `/proposal_votes`: that endpoint reports the voter but omits both `proposal_id` and
 * `vote_tx_hash`, which are two of the three fields a vote record carries. `/vote_list`
 * has all three and takes a PostgREST column filter, so it is the only complete source.
 */
export const getVotesByProposal =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (proposalId: string) =>
    votes(
      "getVotesByProposal",
      baseUrl,
      "/vote_list",
      `proposal_id=eq.${encodeURIComponent(proposalId)}`,
      token,
      timeoutMs
    )

// ── history and discovery ────────────────────────────────────────────────────────
// The tier a wallet or an explorer needs and a transaction builder never does: what has
// happened to these addresses, which addresses an account has ever used, and the bytes of a
// transaction rather than an indexer's reading of it.

/**
 * ⚠️ The numbers arrive as strings. `HttpUtils` parses JSON numbers as strings so a 64-bit
 * amount does not lose precision through `number`, so a plain `Schema.Number` here rejects
 * every populated row while still accepting the nulls — a schema that passes its empty-case
 * tests and fails on real data.
 */
const TxRefSchema = Schema.Struct({
  tx_hash: Schema.String,
  block_height: Schema.NullishOr(Schema.NumberFromString),
  block_time: Schema.NullishOr(Schema.NumberFromString),
  epoch_no: Schema.NullishOr(Schema.NumberFromString)
})

const toTxRef = (row: Schema.Schema.Type<typeof TxRefSchema>): Provider.IndexedTxRef => ({
  txHash: TransactionHash.fromHex(row.tx_hash),
  ...(row.block_height != null ? { blockHeight: row.block_height } : {}),
  ...(row.block_time != null ? { blockTime: row.block_time } : {}),
  ...(row.epoch_no != null ? { epochNo: row.epoch_no } : {})
})

/**
 * `order`, `limit`, `offset` and a column filter are PostgREST query parameters, not RPC
 * arguments — which is why `beforeBlock` is a filter on the response and `afterBlock` is an
 * argument to the query.
 */
const pageQuery = (options?: {
  readonly limit?: number
  readonly offset?: number
  readonly order?: "asc" | "desc"
  readonly beforeBlock?: number
}) => {
  const qs = new URLSearchParams({ order: `block_height.${options?.order ?? "desc"}` })
  if (options?.limit != null) qs.set("limit", String(options.limit))
  if (options?.offset != null) qs.set("offset", String(options.offset))
  if (options?.beforeBlock != null) qs.set("block_height", `lt.${options.beforeBlock}`)
  return qs.toString()
}

/**
 * The row ceiling this deployment enforces, whatever `limit` asks for.
 *
 * Measured against preprod on 2026-10-09: `/address_txs` answers 1000 rows for `limit=1001`
 * and for `limit=1500`, and 1000 for no `limit` at all. A caller asking for more is therefore
 * served a truncated answer that reads exactly like a complete one, which is why a request
 * above this is refused rather than quietly satisfied.
 *
 * @since 2.5.0
 * @category constants
 */
export const MAX_ROWS_PER_RESPONSE = 1000

/**
 * Many address-scoped pages into the one answer the caller would have had from a single
 * request: duplicates dropped, newest first.
 *
 * ⚠️ **The dedupe is not tidying.** A transaction touching two of the requested addresses comes
 * back ONCE from a single multi-address request (measured) and once PER CHUNK from a split one,
 * so without this a split answer differs from an unsplit one by exactly the transactions that
 * involve the wallet twice.
 *
 * ⚠️ **The sort is not tidying either.** Each chunk is newest-first within itself; concatenating
 * them is newest-first within each chunk and meaningless across them — and with a `limit` it
 * would return the wrong rows, not merely the right rows in the wrong order.
 *
 * A row the indexer gave no block height cannot be placed, so it goes last in arrival order
 * rather than being treated as height zero.
 *
 * ⚠️ **Ties break on the transaction hash, and that is load-bearing.** Several transactions can
 * share a block height, so without a tie-break the merged order would depend on which chunk
 * answered first — and the caller's address order decides that. A caller comparing "the newest
 * transaction" against the last one it saw would then see it change without the chain changing,
 * and re-sync every time. The order here is a function of chain state alone.
 *
 * @since 2.5.0
 * @category utils
 */
export const mergeTxRefs = (
  pages: ReadonlyArray<Provider.IndexedTxRef>,
  limit?: number
): Array<Provider.IndexedTxRef> => {
  const seen = new Set<string>()
  const placed: Array<Provider.IndexedTxRef> = []
  const unplaceable: Array<Provider.IndexedTxRef> = []
  for (const row of pages) {
    const key = TransactionHash.toHex(row.txHash)
    if (seen.has(key)) continue
    seen.add(key)
    if (row.blockHeight === undefined) unplaceable.push(row)
    else placed.push(row)
  }
  placed.sort((a, b) =>
    b.blockHeight! === a.blockHeight!
      ? TransactionHash.toHex(b.txHash).localeCompare(TransactionHash.toHex(a.txHash))
      : b.blockHeight! - a.blockHeight!
  )
  const merged = [...placed, ...unplaceable]
  return limit === undefined ? merged : merged.slice(0, limit)
}

export const getTxsAt =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (
    addresses: ReadonlyArray<CoreAddress.Address>,
    options?: { readonly afterBlock?: number; readonly limit?: number; readonly offset?: number }
  ) => {
    if (addresses.length === 0) return Effect.succeed<Array<Provider.IndexedTxRef>>([])

    const ask = (chunk: Array<string>) =>
      pipe(
        HttpUtils.postJson(
          `${baseUrl}/address_txs?${pageQuery(options)}`,
          {
            _addresses: chunk,
            ...(options?.afterBlock != null ? { _after_block_height: options.afterBlock } : {})
          },
          Schema.Array(TxRefSchema),
          auth(token),
          timeoutMs
        ),
        Effect.map((rows) => rows.map(toTxRef))
      )

    // ⚠️ Koios refuses a body over 5120 bytes with a 413, which is around 47 base addresses —
    // fewer than a gap-scanned wallet has. One request is still one request whenever it fits,
    // because that is the only case in which every option means what it says.
    const chunks = _Koios.chunkByBodyBytes(addresses.map((a) => CoreAddress.toBech32(a)))
    if (chunks.length === 1) return pipe(ask(chunks[0]!), Effect.catchAll(wrapError("getTxsAt")))

    /**
     * ⚠️ Two requests this member will not pretend to serve across a split.
     *
     * `offset` is a window into ONE ordered result set. Over several address streams the global
     * rows `[offset, offset+limit)` are only knowable by reading the first `offset+limit` of
     * every chunk, which turns a walk that steps the offset into quadratic work — and silently
     * re-interpreting it per chunk would answer a different question than the caller asked. A
     * caller paging deeply should split the addresses itself and page each stream, which is what
     * a history walk wants anyway.
     *
     * A `limit` above {@link MAX_ROWS_PER_RESPONSE} cannot be served per chunk at all: the
     * backend caps each response there, so the global top-N argument this merge rests on stops
     * holding at exactly the point the answer would be wrong.
     */
    if (options?.offset != null) {
      return Effect.fail(
        new Provider.ProviderError({
          cause: { addresses: addresses.length, chunks: chunks.length, offset: options.offset },
          message:
            `Koios getTxsAt: ${addresses.length} addresses need ${chunks.length} requests, ` +
            "and an offset cannot be applied across them. Split the addresses and page each batch."
        })
      )
    }
    if (options?.limit != null && options.limit > MAX_ROWS_PER_RESPONSE) {
      return Effect.fail(
        new Provider.ProviderError({
          cause: { addresses: addresses.length, chunks: chunks.length, limit: options.limit },
          message:
            `Koios getTxsAt: a limit of ${options.limit} is above the ${MAX_ROWS_PER_RESPONSE}-row ` +
            "ceiling each response is capped at, so it cannot be satisfied across several requests."
        })
      )
    }

    return pipe(
      Effect.forEach(chunks, ask),
      Effect.map((pages) => mergeTxRefs(pages.flat(), options?.limit)),
      Effect.catchAll(wrapError("getTxsAt"))
    )
  }

/**
 * Addresses split into batches each of which {@link getTxsAt} serves in one request.
 *
 * The same chunking the member itself applies, published so a caller that must page can size its
 * batches without restating the budget. `getTxsAt` refuses an `offset` across a split body, so a
 * batch that does not fit is not a slower walk — it is a walk that returns nothing at all, before
 * a request is even issued.
 *
 * @since 2.5.0
 * @category history tier
 */
export const splitAddressesForTxsAt = (
  addresses: ReadonlyArray<CoreAddress.Address>
): Array<Array<CoreAddress.Address>> => {
  // Partitioned by LENGTH rather than by looking each address back up: the chunker preserves
  // order, so the sizes alone reproduce its partition — and a repeated address stays repeated,
  // which a map keyed on the bech32 would silently collapse.
  const sizes = _Koios.chunkByBodyBytes(addresses.map((a) => CoreAddress.toBech32(a))).map((c) => c.length)
  const batches: Array<Array<CoreAddress.Address>> = []
  let at = 0
  for (const size of sizes) {
    batches.push(addresses.slice(at, at + size))
    at += size
  }
  return batches
}

export const getAccountTxs =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (
    stakeAddress: CoreRewardAddress.RewardAddress,
    options?: {
      readonly afterBlock?: number
      readonly beforeBlock?: number
      readonly order?: "asc" | "desc"
      readonly limit?: number
      readonly offset?: number
    }
  ) =>
    options?.limit != null && options.limit > MAX_ROWS_PER_RESPONSE
      ? Effect.fail(
          new Provider.ProviderError({
            cause: { limit: options.limit },
            message:
              `Koios getAccountTxs: a limit of ${options.limit} is above the ` +
              `${MAX_ROWS_PER_RESPONSE}-row ceiling each response is capped at; it would be served ` +
              "truncated, which reads exactly like a complete answer. Page with offset instead."
          })
        )
      : pipe(
          HttpUtils.postJson(
            `${baseUrl}/account_txs?${pageQuery(options)}`,
            {
              _stake_address: stakeAddress,
              ...(options?.afterBlock != null ? { _after_block_height: options.afterBlock } : {})
            },
            Schema.Array(TxRefSchema),
            auth(token),
            timeoutMs
          ),
          Effect.map((rows) => rows.map(toTxRef)),
          Effect.catchAll(wrapError("getAccountTxs"))
        )

/**
 * Koios returns one row per stake key with the addresses nested inside. Some deployments
 * answer the flat `{stake_address, address}` shape instead, so both are accepted — a row
 * carrying neither decodes to no addresses rather than failing the call.
 */
const AccountAddressRowSchema = Schema.Struct({
  addresses: Schema.optional(Schema.Array(Schema.String)),
  address: Schema.optional(Schema.String)
})

export const getAccountAddresses =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (stakeAddress: CoreRewardAddress.RewardAddress, options?: { readonly offset?: number }) => {
    const qs = options?.offset != null ? `?offset=${options.offset}` : ""
    const ask = (includeEmpty: boolean) =>
      pipe(
        HttpUtils.postJson(
          `${baseUrl}/account_addresses${qs}`,
          { _stake_addresses: [stakeAddress], ...(includeEmpty ? { _empty: true } : {}) },
          Schema.Array(AccountAddressRowSchema),
          auth(token),
          timeoutMs
        ),
        Effect.map((rows) => rows.flatMap((r) => [...(r.addresses ?? []), ...(r.address != null ? [r.address] : [])]))
      )

    /**
     * ⚠️ Two questions, in this order, and the order is the whole point.
     *
     * Without `_empty`, Koios answers only where a UTxO currently sits, so a registered and
     * delegated account spent down to zero enumerates to NOTHING — which contradicts what this
     * member promises. With it, a real mainnet key holding value at four addresses and having
     * derived ~490,000 answers **51,465,168 bytes** (measured 2026-08-27; 843 without). `offset`
     * cannot bound that: the addresses are nested inside one row per stake key, so paging pages
     * the outer rows and a caller stepping `offset` in thousands bounds nothing.
     *
     * So the full enumeration is paid for only when the cheap question answers nothing, which is
     * exactly the spent-down account it exists for. An account that is spent down AND enormous
     * still pays it; nothing here can know that in advance, because the count is only knowable
     * from the response.
     *
     * ⚠️ **This narrows the answer for a funded account, and a caller must know which it got.**
     * Where the account holds value somewhere, the result is those addresses only (4 rather than
     * 490,000 on the key above), so a caller building a complete historical address book does not
     * get one. `getAccountUtxos` and `getAccountTxs` are stake-keyed and need no address book.
     */
    return pipe(
      ask(false),
      Effect.flatMap((found) => (found.length > 0 ? Effect.succeed(found) : ask(true))),
      Effect.map((found) => found.map((a) => CoreAddress.fromBech32(a))),
      Effect.catchAll(wrapError("getAccountAddresses"))
    )
  }

const AddressInfoRowSchema = Schema.Struct({ address: Schema.String })

export const getAddressesSeen =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (addresses: ReadonlyArray<CoreAddress.Address>) =>
    addresses.length === 0
      ? Effect.succeed<Array<CoreAddress.Address>>([])
      : pipe(
          // ⚠️ Chunked by SERIALIZED BYTES, because Koios refuses a body over 5120 with a 413
          // (measured: 48 mainnet base addresses = 5104 bytes → 200, 50 = 5316 → 413). A gap
          // scan asks about more addresses than that in one call, so an unchunked body fails
          // at exactly the sizes this member exists to serve.
          //
          // `select=address` drops `utxo_set` from the response, which is otherwise the whole
          // cost of the call: the row wanted here is the address string alone.
          _Koios.batched(
            addresses.map((a) => CoreAddress.toBech32(a)),
            (chunk) =>
              HttpUtils.postJson(
                `${baseUrl}/address_info?select=address`,
                { _addresses: chunk },
                Schema.Array(AddressInfoRowSchema),
                auth(token),
                timeoutMs
              )
          ),
          // `/address_info` returns a row only for an address the chain has seen, so the
          // response IS the answer. An address missing from it is unseen, not failed.
          Effect.map((rows) => rows.map((r) => CoreAddress.fromBech32(r.address))),
          Effect.catchAll(wrapError("getAddressesSeen"))
        )

/**
 * `/tx_status` carries the depth and nothing else. `num_confirmations` is null for a
 * transaction the indexer has not seen, which is the answer, not a zero.
 */
const TxStatusRowSchema = Schema.Struct({
  tx_hash: Schema.String,
  num_confirmations: Schema.NullishOr(Schema.NumberFromString)
})

export const getTxConfirmations =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (txHash: TransactionHash.TransactionHash) =>
    pipe(
      HttpUtils.postJson(
        `${baseUrl}/tx_status`,
        { _tx_hashes: [TransactionHash.toHex(txHash)] },
        Schema.Array(TxStatusRowSchema),
        auth(token),
        timeoutMs
      ),
      // No row, or a row with no count, both mean the indexer has not seen it. Reporting 0
      // would say "seen, zero deep", which no transaction on chain ever is.
      Effect.map((rows) => rows[0]?.num_confirmations ?? null),
      Effect.catchAll(wrapError("getTxConfirmations"))
    )

const TxCborRowSchema = Schema.Struct({
  tx_hash: Schema.String,
  cbor: Schema.NullishOr(Schema.String)
})

export const getTxCbor =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (txHashes: ReadonlyArray<TransactionHash.TransactionHash>) =>
    txHashes.length === 0
      ? Effect.succeed<Array<Provider.IndexedTxCbor>>([])
      : pipe(
          // ⚠️ Chunked: a transaction hash is 64 characters, so Koios's 5120-byte body limit is
          // reached at ~76 of them and a history hydrate asks for more. The answer is keyed by
          // hash and carries no order, so the chunks concatenate with nothing to reconcile.
          _Koios.batched(
            txHashes.map((h) => TransactionHash.toHex(h)),
            (chunk) =>
              HttpUtils.postJson(
                `${baseUrl}/tx_cbor`,
                { _tx_hashes: chunk },
                Schema.Array(TxCborRowSchema),
                auth(token),
                timeoutMs
              )
          ),
          // A row with no `cbor` is dropped rather than returned empty: "" is not a
          // transaction, and a caller that decoded it would fail further from the cause.
          Effect.map((rows) =>
            rows
              .filter((r): r is { tx_hash: string; cbor: string } => typeof r.cbor === "string" && r.cbor.length > 0)
              .map((r) => ({ txHash: TransactionHash.fromHex(r.tx_hash), cborHex: r.cbor }))
          ),
          Effect.catchAll(wrapError("getTxCbor"))
        )

const ScriptInfoRowSchema = Schema.Struct({
  script_hash: Schema.String,
  bytes: Schema.NullishOr(Schema.String),
  type: Schema.NullishOr(Schema.String)
})

const PLUTUS_VERSION: Record<string, "V1" | "V2" | "V3"> = {
  plutusV1: "V1",
  plutusV2: "V2",
  plutusV3: "V3"
}

export const getScriptByHash =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (scriptHash: string) =>
    pipe(
      HttpUtils.postJson(
        `${baseUrl}/script_info`,
        { _script_hashes: [scriptHash] },
        Schema.Array(ScriptInfoRowSchema),
        auth(token),
        timeoutMs
      ),
      Effect.map((rows) => {
        const row = rows[0]
        if (row == null || typeof row.bytes !== "string" || row.bytes.length === 0) return undefined
        const version = row.type == null ? undefined : PLUTUS_VERSION[row.type]
        // A native script, or a Plutus version this build does not know, is not reported as
        // some default version: the version decides how the bytes are run.
        return version === undefined ? undefined : { bytesHex: row.bytes, version }
      }),
      Effect.catchAll(wrapError("getScriptByHash"))
    )

export const getUtxosByPaymentCredentials =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (credentials: ReadonlyArray<Credential.Credential>) =>
    credentials.length === 0
      ? Effect.succeed<Array<CoreUTxO.UTxO>>([])
      : // ⚠️ Chunked by serialized bytes: Koios refuses a body over 5120 with a 413, and a
        // wallet asking about its whole signable set passes that at ~90 credentials — measured,
        // 664 credentials come to 39,219 bytes in one body. Each row carries its own address, so
        // nothing has to be attributed back to the credential that matched it, and the chunks
        // concatenate in order.
        _Koios.batched(
          // ⚠️ `Credential.toHex`, not `c.hash`: the hash is a `Uint8Array`, and
          // `JSON.stringify` turns one into `{"0":171,"1":…}` — a body Koios cannot read at
          // all. The tests that covered this built their credentials by hand with a string
          // hash, so the fixture was the only thing that ever matched the code.
          credentials.map((c) => Credential.toHex(c)),
          (chunk) =>
            pagedUtxos(
              "getUtxosByPaymentCredentials",
              baseUrl,
              "/credential_utxos",
              { _payment_credentials: chunk, _extended: true },
              token,
              timeoutMs
            )
        )

export const getUtxosByPaymentCredential =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (credential: Credential.Credential) =>
    getUtxosByPaymentCredentials(baseUrl, token, timeoutMs)([credential])

const TxIoRowSchema = Schema.Struct({
  tx_hash: Schema.optional(Schema.NullOr(Schema.String)),
  tx_index: Schema.optional(Schema.NullOr(Schema.BigInt)),
  payment_addr: Schema.optional(Schema.NullOr(Schema.Struct({ bech32: Schema.String }))),
  value: Schema.NullishOr(Schema.BigInt),
  asset_list: Schema.NullishOr(Schema.Array(_Koios.AssetSchema))
})

const TxInfoRowSchema = Schema.Struct({
  tx_hash: Schema.String,
  block_hash: Schema.NullishOr(Schema.String),
  block_height: Schema.NullishOr(Schema.NumberFromString),
  epoch_no: Schema.NullishOr(Schema.NumberFromString),
  absolute_slot: Schema.NullishOr(Schema.NumberFromString),
  tx_timestamp: Schema.NullishOr(Schema.NumberFromString),
  fee: Schema.NullishOr(Schema.BigInt),
  inputs: Schema.NullishOr(Schema.Array(TxIoRowSchema)),
  outputs: Schema.NullishOr(Schema.Array(TxIoRowSchema)),
  withdrawals: Schema.NullishOr(Schema.Array(Schema.Struct({ stake_addr: Schema.String, amount: Schema.BigInt }))),
  certificates: Schema.NullishOr(
    Schema.Array(Schema.Struct({ type: Schema.NullishOr(Schema.String), info: Schema.NullishOr(Schema.Unknown) }))
  ),
  assets_minted: Schema.NullishOr(Schema.Array(_Koios.AssetSchema)),
  metadata: Schema.NullishOr(Schema.Unknown)
})

const toAssetAmounts = (
  list: ReadonlyArray<Schema.Schema.Type<typeof _Koios.AssetSchema>> | null | undefined
): Array<{ readonly unit: string; readonly quantity: bigint }> =>
  (list ?? []).map((a) => ({ unit: `${a.policy_id}${a.asset_name ?? ""}`, quantity: a.quantity }))

const toTxIo = (row: Schema.Schema.Type<typeof TxIoRowSchema>): Provider.IndexedTxIO | undefined => {
  const bech32 = row.payment_addr?.bech32
  // An IO with no address is not an IO this type can describe. Dropped rather than given a
  // placeholder address, which would read downstream as a real counterparty.
  if (bech32 == null) return undefined
  return {
    address: CoreAddress.fromBech32(bech32),
    coin: row.value ?? 0n,
    assets: toAssetAmounts(row.asset_list),
    ...(row.tx_hash != null && row.tx_index != null
      ? { outpoint: { txHash: TransactionHash.fromHex(row.tx_hash), index: Number(row.tx_index) } }
      : {})
  }
}

const toIndexedTx = (row: Schema.Schema.Type<typeof TxInfoRowSchema>): Provider.IndexedTx => ({
  txHash: TransactionHash.fromHex(row.tx_hash),
  ...(row.block_height != null ? { blockHeight: row.block_height } : {}),
  ...(row.tx_timestamp != null ? { blockTime: row.tx_timestamp } : {}),
  ...(row.absolute_slot != null ? { slot: row.absolute_slot } : {}),
  ...(row.epoch_no != null ? { epochNo: row.epoch_no } : {}),
  ...(row.block_hash != null ? { blockHashHex: row.block_hash } : {}),
  fee: row.fee ?? 0n,
  inputs: (row.inputs ?? []).map(toTxIo).filter((io): io is Provider.IndexedTxIO => io !== undefined),
  outputs: (row.outputs ?? []).map(toTxIo).filter((io): io is Provider.IndexedTxIO => io !== undefined),
  withdrawals: (row.withdrawals ?? []).map((w) => ({
    stakeAddress: w.stake_addr as CoreRewardAddress.RewardAddress,
    amount: w.amount
  })),
  certificates: (row.certificates ?? []).map((c) => ({
    type: c.type ?? "unknown",
    ...(c.info != null ? { info: c.info as Record<string, unknown> } : {})
  })),
  mint: toAssetAmounts(row.assets_minted),
  ...(row.metadata != null ? { metadata: row.metadata as Record<string, unknown> } : {})
  // ⚠️ No `valid`: `/tx_info` carries no phase-2 verdict, and asserting `true` here would make
  // a script-invalid transaction indistinguishable from a successful one. Left ABSENT, which
  // the field documents as "unknown"; the flag lives in the transaction's own bytes, which is
  // what `getTxCbor` is for.
})

export const getTxInfo =
  (baseUrl: string, token?: _Koios.TokenSource, timeoutMs: number = _Koios.DEFAULT_REQUEST_TIMEOUT_MS) =>
  (txHashes: ReadonlyArray<TransactionHash.TransactionHash>) =>
    txHashes.length === 0
      ? Effect.succeed<Array<Provider.IndexedTx>>([])
      : pipe(
          // Chunked for the reason `getTxCbor` is: 64 characters a hash, a 5120-byte body limit,
          // and a history hydrate that asks about more than seventy transactions at once.
          _Koios.batched(
            txHashes.map((h) => TransactionHash.toHex(h)),
            (chunk) =>
              HttpUtils.postJson(
                `${baseUrl}/tx_info`,
                {
                  _tx_hashes: chunk,
                  _inputs: true,
                  _metadata: true,
                  _certs: true,
                  _withdrawals: true,
                  _assets: true
                },
                Schema.Array(TxInfoRowSchema),
                auth(token),
                timeoutMs
              )
          ),
          Effect.map((rows) => rows.map(toIndexedTx)),
          Effect.catchAll(wrapError("getTxInfo"))
        )
