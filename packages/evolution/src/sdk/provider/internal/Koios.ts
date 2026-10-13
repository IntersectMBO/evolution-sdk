import { Effect, pipe, Schema } from "effect"
import type { TimeoutException } from "effect/Cause"
import type { ParseError } from "effect/ParseResult"

import * as CoreAddress from "../../../Address.js"
import * as CoreAssets from "../../../Assets.js"
import * as Bytes from "../../../Bytes.js"
import * as DatumHash from "../../../DatumHash.js"
import type * as DatumOption from "../../../DatumOption.js"
import * as InlineDatum from "../../../InlineDatum.js"
import * as NativeScripts from "../../../NativeScripts.js"
import * as PlutusV1 from "../../../PlutusV1.js"
import * as PlutusV2 from "../../../PlutusV2.js"
import * as PlutusV3 from "../../../PlutusV3.js"
import type * as Script from "../../../Script.js"
import * as TransactionHash from "../../../TransactionHash.js"
import * as CoreUTxO from "../../../UTxO.js"
import type * as Provider from "../Provider.js"
import * as HttpUtils from "./HttpUtils.js"

export const ProtocolParametersSchema = Schema.Struct({
  pvt_motion_no_confidence: Schema.NumberFromString,
  pvt_committee_normal: Schema.NumberFromString,
  pvt_committee_no_confidence: Schema.NumberFromString,
  pvt_hard_fork_initiation: Schema.NumberFromString,
  pvtpp_security_group: Schema.NumberFromString,
  dvt_motion_no_confidence: Schema.NumberFromString,
  dvt_committee_normal: Schema.NumberFromString,
  dvt_committee_no_confidence: Schema.NumberFromString,
  dvt_update_to_constitution: Schema.NumberFromString,
  dvt_hard_fork_initiation: Schema.NumberFromString,
  dvt_p_p_network_group: Schema.NumberFromString,
  dvt_p_p_economic_group: Schema.NumberFromString,
  dvt_p_p_technical_group: Schema.NumberFromString,
  dvt_p_p_gov_group: Schema.NumberFromString,
  dvt_treasury_withdrawal: Schema.NumberFromString,
  committee_min_size: Schema.BigInt,
  committee_max_term_length: Schema.BigInt,
  gov_action_lifetime: Schema.BigInt,
  gov_action_deposit: Schema.BigInt,
  drep_deposit: Schema.BigInt,
  drep_activity: Schema.BigInt,
  min_fee_ref_script_cost_per_byte: Schema.NumberFromString,
  epoch_no: Schema.BigInt,
  min_fee_a: Schema.BigInt,
  min_fee_b: Schema.BigInt,
  max_block_size: Schema.BigInt,
  max_tx_size: Schema.BigInt,
  max_bh_size: Schema.BigInt,
  key_deposit: Schema.BigInt,
  pool_deposit: Schema.BigInt,
  max_epoch: Schema.BigInt,
  optimal_pool_count: Schema.BigInt,
  influence: Schema.NumberFromString,
  monetary_expand_rate: Schema.NumberFromString,
  treasury_growth_rate: Schema.NumberFromString,
  decentralisation: Schema.NumberFromString,
  extra_entropy: Schema.NullOr(Schema.String),
  protocol_major: Schema.BigInt,
  protocol_minor: Schema.BigInt,
  min_utxo_value: Schema.BigInt,
  min_pool_cost: Schema.BigInt,
  nonce: Schema.NullOr(Schema.String),
  block_hash: Schema.NullOr(Schema.String),
  cost_models: Schema.Struct({
    PlutusV1: Schema.Array(Schema.BigInt),
    PlutusV2: Schema.Array(Schema.BigInt),
    PlutusV3: Schema.Array(Schema.BigInt)
  }),
  price_mem: Schema.NumberFromString,
  price_step: Schema.NumberFromString,
  max_tx_ex_mem: Schema.BigInt,
  max_tx_ex_steps: Schema.BigInt,
  max_block_ex_mem: Schema.BigInt,
  max_block_ex_steps: Schema.BigInt,
  max_val_size: Schema.BigInt,
  collateral_percent: Schema.BigInt,
  max_collateral_inputs: Schema.BigInt,
  coins_per_utxo_size: Schema.BigInt
})
export interface ProtocolParameters extends Schema.Schema.Type<typeof ProtocolParametersSchema> {}

export const AssetSchema = Schema.Struct({
  policy_id: Schema.String,
  asset_name: Schema.NullOr(Schema.String),
  fingerprint: Schema.String,
  // /address_info falls back to 0; /credential_utxos and /utxo_info pass null through
  decimals: Schema.NullOr(Schema.BigInt),
  quantity: Schema.BigInt
})

export interface Asset extends Schema.Schema.Type<typeof AssetSchema> {}

const ReferenceScriptSchema = Schema.Struct({
  hash: Schema.NullOr(Schema.String),
  size: Schema.NullOr(Schema.BigInt),
  type: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Schema.String),
  value: Schema.Unknown
})

export interface ReferenceScript extends Schema.Schema.Type<typeof ReferenceScriptSchema> {}

export const UTxOSchema = Schema.Struct({
  tx_hash: Schema.String,
  tx_index: Schema.BigInt,
  block_time: Schema.BigInt,
  block_height: Schema.NullOr(Schema.BigInt),
  value: Schema.BigInt,
  datum_hash: Schema.NullOr(Schema.String),
  inline_datum: Schema.NullOr(
    Schema.Struct({
      bytes: Schema.NullOr(Schema.String),
      value: Schema.Unknown
    })
  ),
  reference_script: Schema.NullOr(ReferenceScriptSchema),
  asset_list: Schema.NullOr(Schema.Array(AssetSchema))
})

export interface UTxO extends Schema.Schema.Type<typeof UTxOSchema> {}

export const AddressInfoSchema = Schema.Array(
  Schema.NullishOr(
    Schema.Struct({
      address: Schema.String,
      balance: Schema.BigInt,
      stake_address: Schema.NullOr(Schema.String),
      script_address: Schema.Boolean,
      utxo_set: Schema.Array(UTxOSchema)
    })
  )
)

export interface AddressInfo extends Schema.Schema.Type<typeof AddressInfoSchema> {}

/**
 * The part of a `/tx_info` row that `awaitTx` reads: a row exists once the transaction is on chain
 */
export const TxConfirmationSchema = Schema.Struct({
  tx_hash: Schema.String
})

export const TxHashSchema = Schema.String

export const AssetAddressSchema = Schema.Struct({
  payment_address: Schema.String,
  stake_address: Schema.NullOr(Schema.String),
  quantity: Schema.BigInt
})

export interface AssetAddress extends Schema.Schema.Type<typeof AssetAddressSchema> {}

//NOTE: account_info schema is not complete
// https://preprod.koios.rest/#post-/account_info
export const AccountInfoSchema = Schema.Struct({
  delegated_pool: Schema.NullOr(Schema.String),
  rewards_available: Schema.BigInt,
  /** Koios reports `registered` / `not registered`. Optional so an older deployment still parses. */
  status: Schema.optional(Schema.String)
})

//NOTE: datum_info schema is not complete
// https://preprod.koios.rest/#post-/datum_info
export const DatumInfo = Schema.Struct({
  bytes: Schema.String
})

/** A row of Koios `/tip`. `block_no` and `block_time` are null before the first block of a chain. */
export const TipSchema = Schema.Struct({
  hash: Schema.String,
  epoch_no: Schema.NumberFromString,
  abs_slot: Schema.NumberFromString,
  block_no: Schema.NullOr(Schema.NumberFromString),
  block_time: Schema.NullOr(Schema.NumberFromString)
})

/**
 * A bearer token, or a way to get one.
 *
 * A function is resolved per request rather than captured once, so a credential that is
 * refreshed or re-issued while the provider lives is picked up without rebuilding it. A plain
 * string behaves exactly as before.
 *
 * @since 2.4.0
 * @category model
 */
export type TokenSource = string | (() => string | undefined)

/**
 * Resolve a {@link TokenSource} at the moment a request is made.
 *
 * @since 2.4.0
 * @category utils
 */
/**
 * How long a single Koios read may take before it fails as a `ProviderError`.
 *
 * ⚠️ A ceiling on ONE request, not on an operation: a paged walk spends it per page. Ten seconds
 * suits a desktop on a fixed link, which is what this was written against. It is low for a large
 * body over a slow one — `/address_info` for a busy address measured 764 KB — so a client that
 * knows its link is slow (a phone) can raise it: `new Koios(url, token, { requestTimeoutMs })`.
 *
 * Raising it trades a longer wait for a better chance of an answer, and the failure is typed
 * either way. Lowering it below a round trip makes every read fail.
 *
 * @since 2.9.0
 * @category constants
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

export const resolveToken = (token?: TokenSource): string | undefined => (typeof token === "function" ? token() : token)

/**
 * The Authorization header for a token, or nothing when there is none.
 *
 * @since 2.4.0
 * @category utils
 */
export const authHeader = (token?: TokenSource): Record<string, string> | undefined => {
  const resolved = resolveToken(token)
  return resolved ? { Authorization: `Bearer ${resolved}` } : undefined
}

export const getHeadersWithToken = (
  token?: TokenSource,
  headers: Record<string, string> = {}
): Record<string, string> => {
  const resolved = resolveToken(token)
  if (resolved) {
    return {
      ...headers,
      Authorization: `Bearer ${resolved}`
    }
  }
  return headers
}

export const toUTxO = (koiosUTxO: UTxO, addressStr: string): CoreUTxO.UTxO => {
  // Build Core Assets
  let assets = CoreAssets.fromLovelace(koiosUTxO.value)

  if (koiosUTxO.asset_list) {
    for (const am of koiosUTxO.asset_list) {
      // policy_id is hex (56 chars), asset_name is hex
      assets = CoreAssets.addByHex(assets, am.policy_id, am.asset_name || "", am.quantity)
    }
  }

  const address = CoreAddress.fromBech32(addressStr)
  const transactionId = TransactionHash.fromHex(koiosUTxO.tx_hash)

  let datumOption: DatumOption.DatumOption | undefined
  if (koiosUTxO.inline_datum?.bytes) {
    // Re-deriving the bytes from the parsed tree reframes an empty Plutus array, and a datum
    // that re-encodes differently hashes differently, so a consumer that must hash or re-submit
    // this needs the bytes the chain carried.
    datumOption = InlineDatum.fromCBORHex(koiosUTxO.inline_datum.bytes)
  } else if (koiosUTxO.datum_hash) {
    datumOption = DatumHash.fromHex(koiosUTxO.datum_hash)
  }

  let scriptRef: Script.Script | undefined
  const rs = koiosUTxO.reference_script
  if (rs?.bytes && rs.type) {
    const scriptBytes = Bytes.fromHex(rs.bytes)
    switch (rs.type) {
      case "plutusV1":
        scriptRef = new PlutusV1.PlutusV1({ bytes: scriptBytes })
        break
      case "plutusV2":
        scriptRef = new PlutusV2.PlutusV2({ bytes: scriptBytes })
        break
      case "plutusV3":
        scriptRef = new PlutusV3.PlutusV3({ bytes: scriptBytes })
        break
      case "timelock":
        scriptRef = NativeScripts.fromCBORHex(rs.bytes)
        break
    }
  }

  return new CoreUTxO.UTxO({
    transactionId,
    index: koiosUTxO.tx_index,
    address,
    assets,
    datumOption,
    scriptRef
  })
}

/**
 * A row of any Koios `_extended: true` UTxO listing (`/credential_utxos`, `/utxo_info`,
 * `/asset_utxos`, `/account_utxos`).
 *
 * ⚠️ `is_spent` is part of the row and must not be dropped. `/utxo_info` resolves SPENT
 * outputs as readily as unspent ones, so a listing decoded without this field reports a
 * consumed output as a live UTxO — and a builder handed one produces a transaction the
 * node rejects. Optional because `/credential_utxos` only carries it with `_extended`.
 */
export const CredentialUTxOSchema = Schema.Struct({
  tx_hash: Schema.String,
  tx_index: Schema.BigInt,
  address: Schema.String,
  value: Schema.BigInt,
  is_spent: Schema.optional(Schema.Boolean),
  datum_hash: Schema.NullOr(Schema.String),
  inline_datum: Schema.NullOr(
    Schema.Struct({
      bytes: Schema.NullOr(Schema.String),
      value: Schema.Unknown
    })
  ),
  reference_script: Schema.NullOr(ReferenceScriptSchema),
  asset_list: Schema.NullOr(Schema.Array(AssetSchema))
})

/**
 * One extended listing row to a core UTxO.
 *
 * `block_time` / `block_height` are not in the listing shape and `toUTxO` reads neither;
 * they are passed as placeholders only to satisfy the wider row type.
 */
/** One `/epoch_params` row to the builder's {@link Provider.ProtocolParameters}. */
export const toProtocolParameters = (
  row: Schema.Schema.Type<typeof ProtocolParametersSchema>
): Provider.ProtocolParameters => ({
  minFeeA: Number(row.min_fee_a),
  minFeeB: Number(row.min_fee_b),
  maxTxSize: Number(row.max_tx_size),
  maxValSize: Number(row.max_val_size),
  keyDeposit: row.key_deposit,
  poolDeposit: row.pool_deposit,
  drepDeposit: row.drep_deposit,
  govActionDeposit: row.gov_action_deposit,
  priceMem: row.price_mem,
  priceStep: row.price_step,
  maxTxExMem: row.max_tx_ex_mem,
  maxTxExSteps: row.max_tx_ex_steps,
  coinsPerUtxoByte: row.coins_per_utxo_size,
  collateralPercentage: Number(row.collateral_percent),
  maxCollateralInputs: Number(row.max_collateral_inputs),
  minFeeRefScriptCostPerByte: row.min_fee_ref_script_cost_per_byte,
  costModels: {
    PlutusV1: Object.fromEntries(row.cost_models.PlutusV1.map((value, index) => [index.toString(), Number(value)])),
    PlutusV2: Object.fromEntries(row.cost_models.PlutusV2.map((value, index) => [index.toString(), Number(value)])),
    PlutusV3: Object.fromEntries(row.cost_models.PlutusV3.map((value, index) => [index.toString(), Number(value)]))
  }
})

export const extendedRowToUTxO = (row: Schema.Schema.Type<typeof CredentialUTxOSchema>): CoreUTxO.UTxO =>
  toUTxO(
    {
      tx_hash: row.tx_hash,
      tx_index: row.tx_index,
      block_time: 0n,
      block_height: null,
      value: row.value,
      datum_hash: row.datum_hash,
      inline_datum: row.inline_datum,
      reference_script: row.reference_script,
      asset_list: row.asset_list
    },
    row.address
  )

/** Koios caps every listing at 1000 rows. */
export const PAGE_SIZE = 1000

/**
 * Pages a listing to exhaustion, refusing rather than truncating.
 *
 * A short page ends the walk. The cap exists because an unbounded loop against a
 * misbehaving deployment is worse than a named failure; it is set far above any real
 * answer (10,000 pages = ten million rows).
 */
export const pageAll = <A, E, R>(
  what: string,
  fetchPage: (offset: number) => Effect.Effect<ReadonlyArray<A>, E, R>
): Effect.Effect<Array<A>, E | string, R> =>
  Effect.gen(function* () {
    const all: Array<A> = []
    for (let page = 0; page < 10_000; page++) {
      const batch = yield* fetchPage(page * PAGE_SIZE)
      all.push(...batch)
      if (batch.length < PAGE_SIZE) return all
    }
    return yield* Effect.fail(`Koios ${what}: more than ten million rows, refusing to return a truncated list`)
  })

/**
 * Byte budget for a batched POST body. Koios refuses a body over 5120 bytes with a 413,
 * so batches are sized by SERIALIZED LENGTH: a fixed count silently works for short
 * identifiers and fails for long ones. 4096 leaves room for the wrapping object.
 */
const MAX_BODY_BYTES = 4096

/**
 * Split ids into chunks whose JSON array stays inside {@link MAX_BODY_BYTES}.
 *
 * An id longer than the budget still gets its own chunk: letting the backend refuse it
 * beats dropping it silently.
 */
export const chunkByBodyBytes = (ids: ReadonlyArray<string>, budget: number = MAX_BODY_BYTES): Array<Array<string>> => {
  const out: Array<Array<string>> = []
  let current: Array<string> = []
  let size = 2 // the enclosing [ ]
  for (const id of ids) {
    const cost = id.length + 3 // two quotes and a comma
    if (current.length > 0 && size + cost > budget) {
      out.push(current)
      current = []
      size = 2
    }
    current.push(id)
    size += cost
  }
  if (current.length > 0) out.push(current)
  return out
}

/** Fan a long id list over body-size-bounded POSTs, in order. No request when empty. */
export const batched = <A, E, R>(
  ids: ReadonlyArray<string>,
  fetchChunk: (chunk: Array<string>) => Effect.Effect<ReadonlyArray<A>, E, R>
): Effect.Effect<Array<A>, E, R> =>
  Effect.gen(function* () {
    const out: Array<A> = []
    for (const chunk of chunkByBodyBytes(ids)) out.push(...(yield* fetchChunk(chunk)))
    return out
  })

export const getUtxosEffect = (
  baseUrl: string,
  address: string,
  headers: Record<string, string> | undefined,
  timeoutMs?: number
): Effect.Effect<Array<CoreUTxO.UTxO>, string | HttpUtils.HttpError | ParseError | TimeoutException, never> => {
  const url = `${baseUrl}/address_info`
  const body = {
    _addresses: [address]
  }
  const result = pipe(
    HttpUtils.postJson(url, body, AddressInfoSchema, headers, timeoutMs),
    Effect.map(([result]) => (result ? result.utxo_set.map((koiosUtxo) => toUTxO(koiosUtxo, result.address)) : []))
  )
  return result
}

/**
 * Every live UTxO under a payment credential.
 *
 * ⚠️ **Paged, and it must be.** `/credential_utxos` is capped at 1000 rows like every
 * other Koios listing, and a truncated UTxO set reads exactly like a smaller balance —
 * a script credential answering a full 1000 with more behind it is an ordinary case.
 * Paging needs a stable `order`, or two pages can repeat and skip rows.
 */
export const getCredentialUtxosEffect = (
  baseUrl: string,
  credentialHash: string,
  headers: Record<string, string> | undefined,
  timeoutMs?: number
): Effect.Effect<Array<CoreUTxO.UTxO>, string | HttpUtils.HttpError | ParseError | TimeoutException, never> =>
  // ⚠️ The ceiling goes INSIDE `pageAll`, so each page gets it. Around `pageAll` it would bound
  // the whole walk, and a credential holding three pages of UTxOs would be cut off for being
  // large rather than for being slow.
  pageAll("/credential_utxos", (offset) =>
    HttpUtils.postJson(
      `${baseUrl}/credential_utxos?order=tx_hash.asc,tx_index.asc&limit=${PAGE_SIZE}&offset=${offset}`,
      { _payment_credentials: [credentialHash], _extended: true },
      Schema.Array(CredentialUTxOSchema),
      headers,
      timeoutMs
    )
  ).pipe(Effect.map((rows) => rows.filter((u) => u.is_spent !== true).map(extendedRowToUTxO)))
