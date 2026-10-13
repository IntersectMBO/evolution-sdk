/**
 * The WALLET tier of the Blockfrost provider: history, discovery, accounts and governance.
 *
 * `BlockfrostEffect` covers the transaction builder's data dependency — utxos, params, submit,
 * await. These are the questions a wallet asks on top: what has touched these addresses, what
 * does this stake account hold, what is the committee, how did this DRep vote. Blockfrost serves
 * all of them from its own endpoints, so this is a second tier over one client rather than a
 * second client.
 *
 * ⚠️ Every field name here was read off a live response, not off the OpenAPI description: the
 * spec says what the server promises, a response says what it sends.
 *
 * ⚠️ Two members are deliberately NOT here. Blockfrost has no credential-keyed UTxO query at
 * all — not a missing parameter, an endpoint that does not exist — so `getUtxosByPaymentCredential`
 * and `getUtxosByPaymentCredentials` stay absent on this backend. Absent is load-bearing: a
 * capability probe reads `provider[member] !== undefined` to decide whether a wallet may
 * advertise a query layer to a dApp, so a member that exists and fails would make the claim true
 * up front and false mid-flow. Returning an empty list was never an option either — it cannot be
 * told apart from "this credential holds nothing", which is how a shared wallet would show a
 * silent zero balance.
 */

import { Effect, Schema } from "effect"

import * as CoreAddress from "../../../Address.js"
import * as NonnegativeInterval from "../../../NonnegativeInterval.js"
import * as ProtocolVersion from "../../../ProtocolVersion.js"
import type * as CoreRewardAddress from "../../../RewardAddress.js"
import * as TransactionHash from "../../../TransactionHash.js"
import * as UnitInterval from "../../../UnitInterval.js"
import type * as CoreUTxO from "../../../UTxO.js"
import * as Provider from "../Provider.js"
import * as Blockfrost from "./Blockfrost.js"
import { createHeaders, is404Error, utxoFromBlockfrost, withRateLimit, wrapError } from "./BlockfrostEffect.js"
import * as HttpUtils from "./HttpUtils.js"

/** Blockfrost's page size cap. */
const PAGE = 100

/** A GET that treats Blockfrost's 404 as a value rather than an error. */
const getOr = <A, I, R>(url: string, schema: Schema.Schema<A, I, R>, projectId: string | undefined, notFound: A) =>
  withRateLimit(HttpUtils.get(url, schema, createHeaders(projectId))).pipe(
    Effect.catchIf(is404Error, () => Effect.succeed(notFound))
  )

const get = <A, I, R>(url: string, schema: Schema.Schema<A, I, R>, projectId?: string) =>
  withRateLimit(HttpUtils.get(url, schema, createHeaders(projectId)))

/**
 * Blockfrost pages with a 1-based `page` and a `count` of at most 100; these members take
 * `offset`/`limit`.
 *
 * ⚠️ Rather than pretend the two line up, this walks whole pages from the start and slices —
 * correct for any offset, and the cost shows up in the request budget rather than as a wrong
 * answer.
 */
const paged = <A, E>(
  fetchPage: (page: number) => Effect.Effect<ReadonlyArray<A>, E>,
  opts?: { readonly offset?: number; readonly limit?: number }
) =>
  Effect.gen(function* () {
    const offset = opts?.offset ?? 0
    const want = opts?.limit
    const need = want === undefined ? Number.POSITIVE_INFINITY : offset + want
    const rows: Array<A> = []
    for (let page = 1; rows.length < need; page++) {
      const got = yield* fetchPage(page)
      rows.push(...got)
      if (got.length < PAGE) break
    }
    return want === undefined ? rows.slice(offset) : rows.slice(offset, offset + want)
  })

const q = (baseUrl: string, path: string, page?: number, extra = "") =>
  `${baseUrl}${path}?count=${PAGE}${page !== undefined ? `&page=${page}` : ""}${extra}`

// ── schemas, as the endpoints actually answer ─────────────────────────────────
//
// ⚠️ Every numeric field is `NumberFromString`, never `Schema.Number`. `HttpUtils` parses with a
// reviver that hands each JSON number to the schema as its exact SOURCE TEXT, so an integer past
// 2^53 survives — which means a plain `Schema.Number` matches nothing on this path and the member
// fails at decode rather than at the assertion.

const TxRefRow = Schema.Struct({
  tx_hash: Schema.String,
  block_height: Schema.NumberFromString,
  block_time: Schema.NumberFromString
})

const AddressRow = Schema.Struct({ address: Schema.String })

const TxRow = Schema.Struct({
  hash: Schema.String,
  block: Schema.String,
  block_height: Schema.NumberFromString,
  block_time: Schema.NumberFromString,
  slot: Schema.NumberFromString,
  fees: Schema.String,
  valid_contract: Schema.Boolean,
  withdrawal_count: Schema.NumberFromString,
  asset_mint_or_burn_count: Schema.NumberFromString,
  delegation_count: Schema.NumberFromString,
  stake_cert_count: Schema.NumberFromString,
  pool_update_count: Schema.NumberFromString,
  pool_retire_count: Schema.NumberFromString,
  mir_cert_count: Schema.NumberFromString
})

const TxUtxoRow = Schema.Struct({
  address: Schema.String,
  tx_hash: Schema.optional(Schema.String),
  output_index: Schema.NumberFromString,
  amount: Schema.Array(Schema.Struct({ unit: Schema.String, quantity: Schema.String })),
  collateral: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  reference: Schema.optionalWith(Schema.Boolean, { default: () => false })
})

const TxUtxos = Schema.Struct({
  hash: Schema.String,
  inputs: Schema.Array(TxUtxoRow),
  outputs: Schema.Array(TxUtxoRow)
})

const WithdrawalRow = Schema.Struct({ address: Schema.String, amount: Schema.String })
const TxCborRow = Schema.Struct({ cbor: Schema.NullOr(Schema.String) })

const AccountRow = Schema.Struct({
  active: Schema.Boolean,
  controlled_amount: Schema.String,
  withdrawable_amount: Schema.String,
  pool_id: Schema.NullOr(Schema.String),
  drep_id: Schema.optional(Schema.NullOr(Schema.String))
})

const ScriptInfoRow = Schema.Struct({ type: Schema.String })
const DRepListRow = Schema.Struct({
  drep_id: Schema.String,
  amount: Schema.String,
  retired: Schema.Boolean,
  expired: Schema.Boolean
})
const DRepRow = Schema.Struct({ drep_id: Schema.String, amount: Schema.String, active: Schema.Boolean })
const CommitteeRow = Schema.Struct({
  members: Schema.Array(
    Schema.Struct({ cc_cold_id: Schema.String, cc_hot_id: Schema.String, status: Schema.String })
  )
})
const PoolExtendedRow = Schema.Struct({
  pool_id: Schema.String,
  active_stake: Schema.String,
  live_stake: Schema.String
})
const PoolRow = Schema.Struct({
  pool_id: Schema.String,
  active_stake: Schema.String,
  live_stake: Schema.String,
  retirement: Schema.Array(Schema.Unknown)
})
const ProposalRow = Schema.Struct({
  ratified_epoch: Schema.NullOr(Schema.NumberFromString),
  enacted_epoch: Schema.NullOr(Schema.NumberFromString),
  expired_epoch: Schema.NullOr(Schema.NumberFromString),
  expiration: Schema.NullOr(Schema.NumberFromString)
})
const ProposalListRow = Schema.Struct({ tx_hash: Schema.String, cert_index: Schema.NumberFromString })
const VoterVoteRow = Schema.Struct({ proposal_id: Schema.String, tx_hash: Schema.String, vote: Schema.String })
const ProposalVoteRow = Schema.Struct({ tx_hash: Schema.String, vote: Schema.String })

// ── history ───────────────────────────────────────────────────────────────────

/**
 * ⚠️ `/addresses/{a}/transactions` takes ONE address. This member takes a set, so it fans out —
 * the single biggest reason the host request budget has to exist. A 60-address book is 60
 * requests, where Koios answers the same question in two.
 */
export const getTxsAt =
  (baseUrl: string, projectId?: string) =>
  (
    addresses: ReadonlyArray<CoreAddress.Address>,
    options?: { readonly afterBlock?: number; readonly limit?: number; readonly offset?: number }
  ) =>
    Effect.gen(function* () {
      const seen = new Map<string, Provider.IndexedTxRef>()
      for (const address of addresses) {
        const bech32 = CoreAddress.toBech32(address)
        const rows = yield* paged(
          (page) =>
            getOr(q(baseUrl, `/addresses/${bech32}/transactions`, page), Schema.Array(TxRefRow), projectId, []),
          // `afterBlock` filters below, so the window cannot be applied while paging.
          options?.afterBlock === undefined ? options : undefined
        )
        for (const r of rows) {
          if (options?.afterBlock !== undefined && r.block_height <= options.afterBlock) continue
          // One transaction can touch several of the addresses asked about; this answers refs,
          // not per-address rows, so it is deduplicated here rather than repeated.
          seen.set(r.tx_hash, {
            txHash: TransactionHash.fromHex(r.tx_hash),
            blockHeight: r.block_height,
            blockTime: r.block_time
          })
        }
      }
      const all = [...seen.values()].sort((a, b) => (b.blockHeight ?? 0) - (a.blockHeight ?? 0))
      const start = options?.offset ?? 0
      return options?.limit !== undefined ? all.slice(start, start + options.limit) : all.slice(start)
    }).pipe(Effect.catchAll(wrapError("getTxsAt")))

/**
 * ⚠️ Blockfrost reports certificates as COUNTS on `/txs/{h}` and serves each kind from its own
 * endpoint. Returning `[]` for a transaction whose `stake_cert_count` is 3 would be the dangerous
 * kind of wrong, so the per-kind endpoints are fetched — but only for the kinds the counts say
 * are present, so an ordinary payment still costs two calls.
 */
const certificatesOf = (baseUrl: string, projectId: string | undefined, hash: string, tx: Schema.Schema.Type<typeof TxRow>) =>
  Effect.gen(function* () {
    const kinds = [
      ["delegation_count", "delegations", "delegation"],
      ["stake_cert_count", "stakes", "stake"],
      ["pool_update_count", "pool_updates", "pool_update"],
      ["pool_retire_count", "pool_retires", "pool_retire"],
      ["mir_cert_count", "mirs", "mir"]
    ] as const
    const out: Array<Provider.IndexedTxCert> = []
    for (const [countField, path, type] of kinds) {
      if (tx[countField] === 0) continue
      const rows = yield* getOr(
        `${baseUrl}/txs/${hash}/${path}`,
        Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
        projectId,
        []
      )
      for (const info of rows) out.push({ type, info })
    }
    return out
  })

export const getTxInfo =
  (baseUrl: string, projectId?: string) => (txHashes: ReadonlyArray<TransactionHash.TransactionHash>) =>
    Effect.gen(function* () {
      const out: Array<Provider.IndexedTx> = []
      for (const hash of txHashes) {
        const hex = TransactionHash.toHex(hash)
        const tx = yield* getOr(`${baseUrl}/txs/${hex}`, Schema.NullOr(TxRow), projectId, null)
        if (tx === null) continue
        const io = yield* get(`${baseUrl}/txs/${hex}/utxos`, TxUtxos, projectId)
        const withdrawals =
          tx.withdrawal_count === 0
            ? []
            : (yield* getOr(
                `${baseUrl}/txs/${hex}/withdrawals`,
                Schema.Array(WithdrawalRow),
                projectId,
                []
              )).map((w) => ({
                stakeAddress: w.address as CoreRewardAddress.RewardAddress,
                amount: BigInt(w.amount)
              }))
        const toIO = (
          u: Schema.Schema.Type<typeof TxUtxoRow>,
          withOutpoint: boolean
        ): Provider.IndexedTxIO => {
          const assets = u.amount
            .filter((a) => a.unit !== "lovelace")
            .map((a) => ({ unit: a.unit, quantity: BigInt(a.quantity) }))
          const coin = u.amount
            .filter((a) => a.unit === "lovelace")
            .reduce((sum, a) => sum + BigInt(a.quantity), 0n)
          return {
            address: CoreAddress.fromBech32(u.address),
            coin,
            assets,
            // An input row names the output it consumes; an output row's own position is its index.
            ...(withOutpoint && u.tx_hash !== undefined
              ? { outpoint: { txHash: TransactionHash.fromHex(u.tx_hash), index: u.output_index } }
              : {})
          }
        }
        out.push({
          txHash: TransactionHash.fromHex(tx.hash),
          blockHeight: tx.block_height,
          blockTime: tx.block_time,
          slot: tx.slot,
          blockHashHex: tx.block,
          fee: BigInt(tx.fees),
          // Blockfrost DOES report the phase-2 verdict, so it is carried. Koios does not and
          // leaves the field absent, which reads as "unknown" rather than as "valid".
          valid: tx.valid_contract,
          inputs: io.inputs.filter((i) => !i.collateral && !i.reference).map((i) => toIO(i, true)),
          outputs: io.outputs.filter((o) => !o.collateral).map((o) => toIO(o, false)),
          withdrawals,
          certificates: yield* certificatesOf(baseUrl, projectId, hex, tx),
          // ⚠️ EMPTY, not guessed. The mint bundle is on no Blockfrost endpoint as a SIGNED
          // quantity, and a burn is a negative one — the transaction's own CBOR is the only
          // complete source, which `getTxCbor` is how a caller reaches.
          mint: []
        })
      }
      return out
    }).pipe(Effect.catchAll(wrapError("getTxInfo")))

export const getTxCbor =
  (baseUrl: string, projectId?: string) => (txHashes: ReadonlyArray<TransactionHash.TransactionHash>) =>
    Effect.gen(function* () {
      const out: Array<Provider.IndexedTxCbor> = []
      for (const hash of txHashes) {
        const hex = TransactionHash.toHex(hash)
        const row = yield* getOr(`${baseUrl}/txs/${hex}/cbor`, Schema.NullOr(TxCborRow), projectId, null)
        if (row?.cbor != null) out.push({ txHash: hash, cborHex: row.cbor })
      }
      return out
    }).pipe(Effect.catchAll(wrapError("getTxCbor")))

// ── account ───────────────────────────────────────────────────────────────────

export const getAccountInfo =
  (baseUrl: string, projectId?: string) => (rewardAddress: CoreRewardAddress.RewardAddress) =>
    getOr(`${baseUrl}/accounts/${rewardAddress}`, Schema.NullOr(AccountRow), projectId, null).pipe(
      Effect.map((a): Provider.AccountInfo | null =>
        a === null
          ? null
          : {
              registered: a.active,
              delegatedPool: a.pool_id,
              delegatedDRep: a.drep_id ?? null,
              rewardsAvailable: BigInt(a.withdrawable_amount),
              // ⚠️ Blockfrost does not report the registration deposit on an account. Absent,
              // not 0: a zero deposit and an unknown one are different facts to anything
              // computing a refundable balance.
              deposit: undefined,
              controlledBalance: BigInt(a.controlled_amount)
            }
      ),
      Effect.catchAll(wrapError("getAccountInfo"))
    )

export const getAccountAddresses =
  (baseUrl: string, projectId?: string) =>
  (stakeAddress: CoreRewardAddress.RewardAddress, options?: { readonly offset?: number }) =>
    paged(
      (page) =>
        getOr(q(baseUrl, `/accounts/${stakeAddress}/addresses`, page), Schema.Array(AddressRow), projectId, []),
      options
    ).pipe(
      Effect.map((rows) => rows.map((r) => CoreAddress.fromBech32(r.address))),
      Effect.catchAll(wrapError("getAccountAddresses"))
    )

export const getAccountUtxos =
  (baseUrl: string, projectId?: string) =>
  (
    rewardAddress: CoreRewardAddress.RewardAddress,
    options?: { readonly offset?: number; readonly limit?: number }
  ) =>
    paged(
      (page) =>
        getOr(
          q(baseUrl, `/accounts/${rewardAddress}/utxos`, page),
          Schema.Array(Blockfrost.BlockfrostUTxO),
          projectId,
          []
        ),
      options
    ).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (u) => utxoFromBlockfrost(baseUrl, projectId)(u), { concurrency: 10 })
      ),
      Effect.catchAll(wrapError("getAccountUtxos"))
    ) as Effect.Effect<Array<CoreUTxO.UTxO>, Provider.ProviderError>

export const getAccountTxs =
  (baseUrl: string, projectId?: string) =>
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
    Effect.gen(function* () {
      const rows = yield* paged((page) =>
        getOr(
          q(baseUrl, `/accounts/${stakeAddress}/transactions`, page, `&order=${options?.order ?? "desc"}`),
          Schema.Array(TxRefRow),
          projectId,
          []
        )
      )
      const windowed = rows.filter(
        (r) =>
          (options?.afterBlock === undefined || r.block_height > options.afterBlock) &&
          (options?.beforeBlock === undefined || r.block_height < options.beforeBlock)
      )
      const start = options?.offset ?? 0
      const refs = windowed.map(
        (r): Provider.IndexedTxRef => ({
          txHash: TransactionHash.fromHex(r.tx_hash),
          blockHeight: r.block_height,
          blockTime: r.block_time
        })
      )
      return options?.limit !== undefined ? refs.slice(start, start + options.limit) : refs.slice(start)
    }).pipe(Effect.catchAll(wrapError("getAccountTxs")))

/**
 * ⚠️ There is no batched used-set oracle on Blockfrost, so this is one request per address — a
 * 20-address gap scan is 20 requests. A 404 means the chain has never seen the address, which is
 * a legitimate answer to a gap scan and not an error.
 */
export const getAddressesSeen =
  (baseUrl: string, projectId?: string) => (addresses: ReadonlyArray<CoreAddress.Address>) =>
    Effect.gen(function* () {
      const seen: Array<CoreAddress.Address> = []
      for (const address of addresses) {
        const bech32 = CoreAddress.toBech32(address)
        const row = yield* getOr(`${baseUrl}/addresses/${bech32}`, Schema.NullOr(AddressRow), projectId, null)
        if (row !== null) seen.push(address)
      }
      return seen
    }).pipe(Effect.catchAll(wrapError("getAddressesSeen")))

// ── chain-wide reads ──────────────────────────────────────────────────────────

export const getUtxosByAsset = (baseUrl: string, projectId?: string) => (unit: string) =>
  paged((page) =>
    getOr(q(baseUrl, `/assets/${unit}/utxos`, page), Schema.Array(Blockfrost.BlockfrostUTxO), projectId, [])
  ).pipe(
    Effect.flatMap((rows) =>
      Effect.forEach(rows, (u) => utxoFromBlockfrost(baseUrl, projectId)(u), { concurrency: 10 })
    ),
    Effect.catchAll(wrapError("getUtxosByAsset"))
  ) as Effect.Effect<Array<CoreUTxO.UTxO>, Provider.ProviderError>

export const getUtxosOfTransaction =
  (baseUrl: string, projectId?: string) => (txHash: TransactionHash.TransactionHash) => {
    const hex = TransactionHash.toHex(txHash)
    return get(`${baseUrl}/txs/${hex}/utxos`, TxUtxos, projectId).pipe(
      Effect.flatMap((io) =>
        Effect.forEach(
          io.outputs.filter((o) => !o.collateral),
          (o) =>
            utxoFromBlockfrost(baseUrl, projectId)(
              {
                // The tx-scoped listing carries no `tx_hash` on a row: the transaction is the one
                // asked about, which is what makes these outputs addressable at all.
                tx_hash: hex,
                output_index: o.output_index,
                address: o.address,
                amount: o.amount,
                data_hash: null,
                inline_datum: null,
                reference_script_hash: null
              } as unknown as Blockfrost.BlockfrostUTxO,
              o.address
            ),
          { concurrency: 10 }
        )
      ),
      Effect.catchAll(wrapError("getUtxosOfTransaction"))
    ) as Effect.Effect<Array<CoreUTxO.UTxO>, Provider.ProviderError>
  }

/**
 * ⚠️ A native script has no Plutus version, and `/scripts/{h}/cbor` answers `{"cbor": null}` for
 * scripts Blockfrost does not hold. Both are reported as `undefined` rather than coerced into a
 * Plutus version, which would misprice every fee that reads it.
 */
export const getScriptByHash = (baseUrl: string, projectId?: string) => (scriptHash: string) =>
  Effect.gen(function* () {
    const info = yield* getOr(`${baseUrl}/scripts/${scriptHash}`, Schema.NullOr(ScriptInfoRow), projectId, null)
    const version: "V1" | "V2" | "V3" | undefined =
      info?.type === "plutusV1" ? "V1" : info?.type === "plutusV2" ? "V2" : info?.type === "plutusV3" ? "V3" : undefined
    if (version === undefined) return undefined
    const body = yield* getOr(`${baseUrl}/scripts/${scriptHash}/cbor`, Schema.NullOr(TxCborRow), projectId, null)
    return body?.cbor == null ? undefined : { bytesHex: body.cbor, version }
  }).pipe(Effect.catchAll(wrapError("getScriptByHash")))

/** The same mapping as `getProtocolParameters`, against a named epoch rather than the latest. */
export const getProtocolParametersAt = (baseUrl: string, projectId?: string) => (epoch: number) =>
  get(`${baseUrl}/epochs/${epoch}/parameters`, Blockfrost.BlockfrostProtocolParameters, projectId).pipe(
    Effect.map(Blockfrost.transformProtocolParameters),
    Effect.catchAll(wrapError("getProtocolParametersAt"))
  )

/** `pvt_…`/`dvt_…` in the CDDL order the member promises. Order IS the schema here. */
const POOL_THRESHOLDS = [
  "pvt_motion_no_confidence",
  "pvt_committee_normal",
  "pvt_committee_no_confidence",
  "pvt_hard_fork_initiation",
  "pvt_p_p_security_group"
] as const
const DREP_THRESHOLDS = [
  "dvt_motion_no_confidence",
  "dvt_committee_normal",
  "dvt_committee_no_confidence",
  "dvt_update_to_constitution",
  "dvt_hard_fork_initiation",
  "dvt_p_p_network_group",
  "dvt_p_p_economic_group",
  "dvt_p_p_technical_group",
  "dvt_p_p_gov_group",
  "dvt_treasury_withdrawal"
] as const

/**
 * ⚠️ The thresholds arrive as DECIMALS (`0.51`), and `0.51` has no exact binary double. They are
 * read into exact rationals, which is the form the chain itself uses and the only one a
 * comparison against another backend can be made in.
 */
const fraction = (value: unknown, what: string): readonly [bigint, bigint] => {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`blockfrost epoch parameters carry no ${what}`)
  }
  const exact = NonnegativeInterval.fromDecimal(value)
  return [exact.numerator, exact.denominator]
}

const unitInterval = (value: unknown, what: string): UnitInterval.UnitInterval => {
  const [numerator, denominator] = fraction(value, what)
  return new UnitInterval.UnitInterval({ numerator, denominator })
}

const nonnegativeInterval = (value: unknown, what: string): NonnegativeInterval.NonnegativeInterval => {
  const [numerator, denominator] = fraction(value, what)
  return new NonnegativeInterval.NonnegativeInterval({ numerator, denominator })
}

const bigintsOf = (model: unknown): ReadonlyArray<bigint> | undefined =>
  Array.isArray(model) ? model.map((n) => BigInt(n as number)) : undefined

export const getChainParameters = (baseUrl: string, projectId?: string) => () =>
  get(
    `${baseUrl}/epochs/latest/parameters`,
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    projectId
  ).pipe(
    Effect.map((p): Provider.ChainParameters => {
      const raw = p.cost_models_raw as Record<string, unknown> | null | undefined
      const v1 = bigintsOf(raw?.PlutusV1)
      const v2 = bigintsOf(raw?.PlutusV2)
      const v3 = bigintsOf(raw?.PlutusV3)
      return {
        poolVotingThresholds: POOL_THRESHOLDS.map((k) => unitInterval(p[k], `poolVotingThresholds.${k}`)),
        drepVotingThresholds: DREP_THRESHOLDS.map((k) => unitInterval(p[k], `drepVotingThresholds.${k}`)),
        committeeMinSize: Number(p.committee_min_size),
        committeeMaxTermLength: Number(p.committee_max_term_length),
        govActionLifetime: Number(p.gov_action_lifetime),
        govActionDeposit: BigInt(p.gov_action_deposit as string),
        drepActivity: Number(p.drep_activity),
        maxBlockBodySize: Number(p.max_block_size),
        maxBlockHeaderSize: Number(p.max_block_header_size),
        poolRetireMaxEpoch: Number(p.e_max),
        stakePoolTargetNum: Number(p.n_opt),
        poolPledgeInfluence: nonnegativeInterval(p.a0, "a0"),
        monetaryExpansion: unitInterval(p.rho, "rho"),
        treasuryCut: unitInterval(p.tau, "tau"),
        minPoolCost: BigInt(p.min_pool_cost as string),
        maxTxExMem: BigInt(p.max_tx_ex_mem as string),
        maxTxExSteps: BigInt(p.max_tx_ex_steps as string),
        maxBlockExMem: BigInt(p.max_block_ex_mem as string),
        maxBlockExSteps: BigInt(p.max_block_ex_steps as string),
        protocolVersion: new ProtocolVersion.ProtocolVersion({
          major: BigInt(p.protocol_major_ver as number),
          minor: BigInt(p.protocol_minor_ver as number)
        }),
        executionPrices: {
          mem: nonnegativeInterval(p.price_mem, "price_mem"),
          step: nonnegativeInterval(p.price_step, "price_step")
        },
        minFeeRefScriptCostPerByte: nonnegativeInterval(
          p.min_fee_ref_script_cost_per_byte,
          "min_fee_ref_script_cost_per_byte"
        ),
        ...(v1 !== undefined ? { plutusV1CostModel: v1 } : {}),
        ...(v2 !== undefined ? { plutusV2CostModel: v2 } : {}),
        ...(v3 !== undefined ? { plutusV3CostModel: v3 } : {})
      }
    }),
    Effect.catchAll(wrapError("getChainParameters"))
  )

// ── governance ────────────────────────────────────────────────────────────────

export const getDReps = (baseUrl: string, projectId?: string) => () =>
  paged((page) => getOr(q(baseUrl, "/governance/dreps", page), Schema.Array(DRepListRow), projectId, [])).pipe(
    Effect.map((rows) =>
      rows.map(
        (r): Provider.DRepSummary => ({
          drepId: r.drep_id,
          active: !r.retired && !r.expired,
          amount: BigInt(r.amount)
        })
      )
    ),
    Effect.catchAll(wrapError("getDReps"))
  )

export const getDRep = (baseUrl: string, projectId?: string) => (drepId: string) =>
  getOr(`${baseUrl}/governance/dreps/${drepId}`, Schema.NullOr(DRepRow), projectId, null).pipe(
    Effect.map((r): Provider.DRepSummary | null =>
      r === null ? null : { drepId: r.drep_id, active: r.active, amount: BigInt(r.amount) }
    ),
    Effect.catchAll(wrapError("getDRep"))
  )

export const getCommittee = (baseUrl: string, projectId?: string) => () =>
  get(`${baseUrl}/governance/committee`, CommitteeRow, projectId).pipe(
    Effect.map((r) =>
      r.members.map(
        (m): Provider.CommitteeMember => ({ coldId: m.cc_cold_id, hotId: m.cc_hot_id, status: m.status })
      )
    ),
    Effect.catchAll(wrapError("getCommittee"))
  )

export const getPools = (baseUrl: string, projectId?: string) => () =>
  paged((page) => getOr(q(baseUrl, "/pools/extended", page), Schema.Array(PoolExtendedRow), projectId, [])).pipe(
    Effect.map((rows) =>
      rows.map(
        (r): Provider.PoolSummary => ({
          poolId: r.pool_id,
          // ⚠️ `/pools/extended` lists REGISTERED pools and carries no status column; a
          // retirement shows up on `/pools/{id}`. Reported as "registered" because that is what
          // the listing means, not as a status read off a field that does not exist.
          status: "registered",
          activeStake: BigInt(r.active_stake),
          liveStake: BigInt(r.live_stake)
        })
      )
    ),
    Effect.catchAll(wrapError("getPools"))
  )

export const getPool = (baseUrl: string, projectId?: string) => (poolId: string) =>
  getOr(`${baseUrl}/pools/${poolId}`, Schema.NullOr(PoolRow), projectId, null).pipe(
    Effect.map((r): Provider.PoolSummary | null =>
      r === null
        ? null
        : {
            poolId: r.pool_id,
            status: r.retirement.length > 0 ? "retiring" : "registered",
            activeStake: BigInt(r.active_stake),
            liveStake: BigInt(r.live_stake)
          }
    ),
    Effect.catchAll(wrapError("getPool"))
  )

/**
 * ⚠️ The proposal LISTING carries only identifiers; ratification and enactment epochs are on the
 * per-proposal endpoint. Fetching N of those to fill a list would be a request storm, so these
 * summaries carry the id alone and `getProposal(id)` is where the rest comes from.
 */
export const getProposals = (baseUrl: string, projectId?: string) => () =>
  paged((page) =>
    getOr(q(baseUrl, "/governance/proposals", page), Schema.Array(ProposalListRow), projectId, [])
  ).pipe(
    Effect.map((rows) =>
      rows.map((r): Provider.ProposalSummary => ({ proposalId: `${r.tx_hash}#${r.cert_index}` }))
    ),
    Effect.catchAll(wrapError("getProposals"))
  )

/**
 * Blockfrost's per-proposal endpoint is keyed on the transaction and the certificate index inside
 * it, which is what a `tx_hash#index` id carries.
 */
const splitProposalId = (proposalId: string): readonly [string, number] | undefined => {
  const [hex, index] = proposalId.split("#")
  if (hex === undefined || index === undefined) return undefined
  const n = Number(index)
  return /^[0-9a-f]{64}$/i.test(hex) && Number.isInteger(n) && n >= 0 ? [hex, n] : undefined
}

export const getProposal = (baseUrl: string, projectId?: string) => (proposalId: string) =>
  Effect.gen(function* () {
    const parsed = splitProposalId(proposalId)
    if (parsed === undefined) {
      return yield* Effect.fail(
        new Provider.ProviderError({
          message: `getProposal: ${proposalId} is not a <txHash>#<certIndex> proposal id`
        })
      )
    }
    const [hex, index] = parsed
    const r = yield* getOr(
      `${baseUrl}/governance/proposals/${hex}/${index}`,
      Schema.NullOr(ProposalRow),
      projectId,
      null
    )
    return r === null
      ? null
      : ({
          proposalId,
          ...(r.ratified_epoch !== null ? { ratifiedEpoch: r.ratified_epoch } : {}),
          ...(r.enacted_epoch !== null ? { enactedEpoch: r.enacted_epoch } : {}),
          ...(r.expired_epoch !== null ? { expiredEpoch: r.expired_epoch } : {}),
          ...(r.expiration !== null ? { expiration: r.expiration } : {})
        } satisfies Provider.ProposalSummary)
  }).pipe(Effect.catchAll((e) => (e instanceof Provider.ProviderError ? Effect.fail(e) : wrapError("getProposal")(e))))

/**
 * A voter-scoped vote row names the proposal it is about and the transaction the vote was cast
 * in; a proposal-scoped one names only the voter, so there the proposal comes from the argument.
 */
const voterVotes = (baseUrl: string, projectId: string | undefined, path: string, operation: string) =>
  paged((page) => getOr(q(baseUrl, path, page), Schema.Array(VoterVoteRow), projectId, [])).pipe(
    Effect.map((rows) =>
      rows.map((r): Provider.VoteRecord => ({ proposalId: r.proposal_id, voteTxHash: r.tx_hash, vote: r.vote }))
    ),
    Effect.catchAll(wrapError(operation))
  )

export const getVotesByDRep = (baseUrl: string, projectId?: string) => (drepId: string) =>
  voterVotes(baseUrl, projectId, `/governance/dreps/${drepId}/votes`, "getVotesByDRep")

export const getVotesByPool = (baseUrl: string, projectId?: string) => (poolId: string) =>
  voterVotes(baseUrl, projectId, `/pools/${poolId}/votes`, "getVotesByPool")

export const getVotesByCommittee = (baseUrl: string, projectId?: string) => (ccHotId: string) =>
  voterVotes(baseUrl, projectId, `/governance/committee/${ccHotId}/votes`, "getVotesByCommittee")

export const getVotesByProposal = (baseUrl: string, projectId?: string) => (proposalId: string) =>
  Effect.gen(function* () {
    const parsed = splitProposalId(proposalId)
    if (parsed === undefined) {
      return yield* Effect.fail(
        new Provider.ProviderError({
          message: `getVotesByProposal: ${proposalId} is not a <txHash>#<certIndex> proposal id`
        })
      )
    }
    const [hex, index] = parsed
    const rows = yield* paged((page) =>
      getOr(
        q(baseUrl, `/governance/proposals/${hex}/${index}/votes`, page),
        Schema.Array(ProposalVoteRow),
        projectId,
        []
      )
    )
    return rows.map((r): Provider.VoteRecord => ({ proposalId, voteTxHash: r.tx_hash, vote: r.vote }))
  }).pipe(
    Effect.catchAll((e) => (e instanceof Provider.ProviderError ? Effect.fail(e) : wrapError("getVotesByProposal")(e)))
  )
