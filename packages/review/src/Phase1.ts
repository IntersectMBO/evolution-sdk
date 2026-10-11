/**
 * Phase-1 validation of a transaction you did NOT build: would the ledger refuse these bytes,
 * given what a provider can tell us?
 *
 * Building a transaction and accepting one are different jobs. A planner makes a balanced
 * transaction by construction, which is exactly why it cannot tell you whether someone else's
 * is. A co-signer, a multisig participant, an x402 facilitator and a hardware review rail all
 * want the same predicate, and nothing answered it in one call.
 *
 * Scope, stated precisely: this is phase 1 — the deterministic, pre-script part of ledger
 * validation — as far as PROVIDER data can prove it. It is not a node. It does not run Plutus
 * (that is phase 2), does not check witnesses or script-data hashes, and does not know the
 * mempool.
 *
 * @since 0.1.0
 */

import { MinAda, TransactionBody } from "@evolution-sdk/evolution"
import { Effect } from "effect"

import { TxHashHex } from "./Brands.js"
import { CborError } from "./Errors.js"
import { txBody, txBodyFromTx, type TxBodyView } from "./Inspect.js"
import { hexToBytes } from "./internal/Hex.js"

/**
 * One asset in a resolved output.
 *
 * @since 0.1.0
 */
export interface AssetAmount {
  readonly policyHex: string
  readonly nameHex: string
  readonly quantity: bigint
}

/**
 * An input the caller has already resolved against the chain.
 *
 * ⚠️ Deliberately narrower than a provider's full UTXO: these are the only fields phase 1
 * reads, so any provider's richer shape satisfies it structurally and no provider interface is
 * imposed on the caller.
 *
 * ⚠️ `spent` is three-valued. Resolution is NOT a liveness test — some backends return spent
 * outputs as readily as unspent ones — so `undefined` means *unknown*, not *unspent*.
 *
 * @since 0.1.0
 */
export interface ResolvedOutpoint {
  readonly txHash: TxHashHex
  readonly index: number
  readonly coin: bigint
  readonly assets: ReadonlyArray<AssetAmount>
  readonly spent?: boolean
}

/**
 * The protocol parameters phase 1 can be checked against.
 *
 * @since 0.1.0
 */
export interface Phase1Params {
  readonly minFeeA: bigint
  readonly minFeeB: bigint
  readonly coinsPerUtxoByte: bigint
  /** Conway sizing bound (body key-independent, the FULL signed tx). Optional: absent skips the size check. */
  readonly maxTxSize?: bigint
}

/**
 * One reason the ledger would refuse the transaction.
 *
 * A list, not a boolean and not a first-failure throw: a facilitator wants to tell
 * a payer everything that is wrong with a payment in one round trip, and a review
 * screen wants to render all of it. `_tag` is the discriminator; `message` is
 * already human-readable.
 */
/** The body fields that move value provider data cannot account for. */
export type UnbalanceableField = "mint" | "withdrawals" | "certificates" | "proposals" | "treasury" | "donation"

export type Phase1Violation =
  | { readonly _tag: "InputNotResolved"; readonly txHash: TxHashHex; readonly index: number; readonly message: string }
  | { readonly _tag: "InputSpent"; readonly txHash: TxHashHex; readonly index: number; readonly message: string }
  | {
      readonly _tag: "ValueNotConserved"
      /** `'lovelace'`, or `policyHex.nameHex` for a native asset. */
      readonly unit: string
      readonly consumed: bigint
      readonly produced: bigint
      readonly message: string
    }
  | {
      readonly _tag: "FeeBelowFloor"
      readonly fee: bigint
      readonly floor: bigint
      readonly txSize: number
      readonly message: string
    }
  | {
      readonly _tag: "OutputBelowMinAda"
      readonly index: number
      readonly coin: bigint
      readonly minAda: bigint
      readonly message: string
    }
  | { readonly _tag: "TtlPassed"; readonly ttl: bigint; readonly tipSlot: number; readonly message: string }
  | {
      readonly _tag: "NotYetValid"
      readonly validityIntervalStart: bigint
      readonly tipSlot: number
      readonly message: string
    }
  | { readonly _tag: "TtlBeyondBound"; readonly ttl: bigint; readonly bound: number; readonly message: string }
  | { readonly _tag: "TtlMissing"; readonly message: string }
  | { readonly _tag: "TxTooLarge"; readonly size: number; readonly maxTxSize: bigint; readonly message: string }
  | { readonly _tag: "WrongNetwork"; readonly networkId: number; readonly expected: number; readonly message: string }
  | {
      readonly _tag: "Unbalanceable"
      /** The body field that moves value the inputs and outputs do not show. */
      readonly field: UnbalanceableField
      readonly message: string
    }

/** What {@link phase1Violations} needs. All of it is obtainable from a provider. */
export interface Phase1Input {
  /** The decoded body — from `Inspect.txBody`. */
  readonly body: TxBodyView
  /**
   * Size in bytes of the **full signed transaction**, not the body. The fee floor
   * is `minFeeB + minFeeA * |transaction|`, and a body-only size underestimates it
   * by the whole witness set — which is how you accept a tx the node then rejects.
   */
  readonly txSize: number
  /** The resolved value of every input, by outpoint. Inputs absent from this map are reported, not assumed. */
  readonly resolved: ReadonlyArray<ResolvedOutpoint>
  readonly params: Phase1Params
  /**
   * Per-output minimum lovelace, parallel to `body.outputs`. Omit to skip the
   * min-ada check — which the x402 spec explicitly permits for a facilitator
   * without live protocol parameters. `checkTx` computes it for you.
   */
  readonly minAda?: ReadonlyArray<bigint>
  /** Current tip slot, for the TTL window. Omit to skip TTL checks. */
  readonly tipSlot?: number
  /** Highest permitted TTL slot (e.g. `Slots.ttlBound(...)` for x402 rule 7). */
  readonly ttlBound?: number
  /** Require a TTL to be present at all. A payment without one never expires on its own. */
  readonly requireTtl?: boolean
  /** Expected `network_id` (0 testnet, 1 mainnet). Only checked when the body carries key 15. */
  readonly expectedNetworkId?: number
}

const LOVELACE = "lovelace"
const unitOf = (a: AssetAmount): string => `${a.policyHex}.${a.nameHex}`

const bump = (m: Map<string, bigint>, unit: string, by: bigint): void => {
  m.set(unit, (m.get(unit) ?? 0n) + by)
}

/**
 * Every phase-1 violation provider data can prove, in declaration order.
 *
 * Pure: no Effect, no IO, no codec. Feed it `Inspect.txBody` output and a resolved
 * input set and it is fully offline-testable.
 */
export function phase1Violations(input: Phase1Input): ReadonlyArray<Phase1Violation> {
  const { body, params, resolved, txSize } = input
  const out: Array<Phase1Violation> = []

  // ── unbalanceable fields ──
  //
  // These move value that the inputs and outputs do not account for, so the
  // conservation arithmetic below cannot be completed at all. Report them and
  // skip conservation rather than emit a bogus imbalance: a withdrawal of 5 ADA
  // would otherwise surface as "consumed 5 ADA less than produced", which sends
  // the reader hunting for a coin-selection bug that does not exist.
  const unbalanceable: Array<Phase1Violation> = []
  const flag = (field: UnbalanceableField, what: string): void => {
    unbalanceable.push({
      _tag: "Unbalanceable",
      field,
      message: `transaction carries ${what}, which moves value the inputs and outputs do not show; provider data cannot balance it (run a complete ledger phase-1 validator instead)`
    })
  }
  if (body.mint !== undefined) flag("mint", "a mint/burn (body key 9)")
  if (body.withdrawals !== undefined && body.withdrawals.length > 0)
    flag("withdrawals", "reward withdrawals (body key 5)")
  if (body.certificates !== undefined && body.certificates.length > 0) flag("certificates", "certificates (body key 4)")
  if (body.proposals !== undefined && body.proposals.length > 0) flag("proposals", "governance proposals (body key 20)")
  if (body.treasury !== undefined) flag("treasury", "a current-treasury-value (body key 21)")
  if (body.donation !== undefined) flag("donation", "a treasury donation (body key 22)")
  out.push(...unbalanceable)

  // ── inputs resolve, and are unspent ──
  const byOutpoint = new Map<string, ResolvedOutpoint>()
  for (const r of resolved) byOutpoint.set(`${r.txHash}#${r.index}`, r)

  const consumed = new Map<string, bigint>()
  let allResolved = true
  for (const i of body.inputs) {
    const key = `${i.txHashHex}#${i.index}`
    const r = byOutpoint.get(key)
    if (r === undefined) {
      allResolved = false
      // Not resolving and being spent are the same observation from a UTXO-set
      // query, but not the same from a partial lookup — so the caller decides
      // which it is by what it puts in `resolved`. We report the weaker claim.
      out.push({
        _tag: "InputNotResolved",
        txHash: TxHashHex(i.txHashHex),
        index: i.index,
        message: `input ${key} is not in the resolved UTXO set: either it is already spent (the node will reject this transaction) or the lookup was incomplete`
      })
      continue
    }
    // Resolution is NOT a liveness test — Koios `/utxo_info` returns spent outputs
    // as readily as unspent ones (see `ResolvedOutpoint.spent`). Treating "present
    // in `resolved`" as "unspent" would pass a transaction whose inputs are gone,
    // which is the one thing this check exists to prevent. `undefined` stays
    // unknown: we do not invent liveness the provider did not claim.
    if (r.spent === true) {
      out.push({
        _tag: "InputSpent",
        txHash: TxHashHex(i.txHashHex),
        index: i.index,
        message: `input ${key} is already spent; the node will reject this transaction`
      })
    }
    bump(consumed, LOVELACE, r.coin)
    for (const a of r.assets) bump(consumed, unitOf(a), a.quantity)
  }

  // ── value conservation, per asset ──
  if (unbalanceable.length === 0 && allResolved) {
    const produced = new Map<string, bigint>()
    bump(produced, LOVELACE, body.fee)
    for (const o of body.outputs) {
      bump(produced, LOVELACE, o.value.amount)
      for (const t of o.value.tokens) bump(produced, `${t.policyIdHex}.${t.assetNameHex}`, t.amount)
    }
    for (const unit of new Set([...consumed.keys(), ...produced.keys()])) {
      const c = consumed.get(unit) ?? 0n
      const p = produced.get(unit) ?? 0n
      if (c !== p) {
        out.push({
          _tag: "ValueNotConserved",
          unit,
          consumed: c,
          produced: p,
          message:
            unit === LOVELACE
              ? `lovelace not conserved: inputs ${c} != outputs + fee ${p} (difference ${c - p})`
              : `asset ${unit} not conserved: inputs ${c} != outputs ${p} (difference ${c - p})`
        })
      }
    }
  }

  // ── fee floor ──
  //
  // A necessary condition only: script execution and reference-script surcharges
  // raise it further, and we cannot see those from provider data. A fee at or
  // above the floor still tells us nothing; a fee below it is definitively
  // rejected, which is the useful half.
  const floor = params.minFeeB + params.minFeeA * BigInt(txSize)
  if (body.fee < floor) {
    out.push({
      _tag: "FeeBelowFloor",
      fee: body.fee,
      floor,
      txSize,
      message: `fee ${body.fee} is below the linear floor ${floor} = minFeeB ${params.minFeeB} + minFeeA ${params.minFeeA} * ${txSize} bytes`
    })
  }

  // ── size bound ──
  if (params.maxTxSize !== undefined && BigInt(txSize) > params.maxTxSize) {
    out.push({
      _tag: "TxTooLarge",
      size: txSize,
      maxTxSize: params.maxTxSize,
      message: `transaction is ${txSize} bytes, over the ${params.maxTxSize}-byte protocol maximum`
    })
  }

  // ── min-ada per output ──
  if (input.minAda !== undefined) {
    body.outputs.forEach((o, idx) => {
      const min = input.minAda![idx]
      if (min === undefined) return
      if (o.value.amount < min) {
        out.push({
          _tag: "OutputBelowMinAda",
          index: idx,
          coin: o.value.amount,
          minAda: min,
          message: `output ${idx} holds ${o.value.amount} lovelace, below the ${min} required for its serialized size at coinsPerUtxoByte ${params.coinsPerUtxoByte}`
        })
      }
    })
  }

  // ── validity interval ──
  if (input.requireTtl === true && body.ttl === undefined) {
    out.push({
      _tag: "TtlMissing",
      message: "transaction carries no TTL (body key 3), so a signed payment never expires on its own"
    })
  }
  if (input.tipSlot !== undefined) {
    const tip = input.tipSlot
    if (body.ttl !== undefined && body.ttl < BigInt(tip)) {
      out.push({
        _tag: "TtlPassed",
        ttl: body.ttl,
        tipSlot: tip,
        message: `TTL slot ${body.ttl} has already passed (tip is ${tip}); the node will reject this transaction`
      })
    }
    if (body.validityIntervalStart !== undefined && body.validityIntervalStart > BigInt(tip)) {
      out.push({
        _tag: "NotYetValid",
        validityIntervalStart: body.validityIntervalStart,
        tipSlot: tip,
        message: `transaction is not valid before slot ${body.validityIntervalStart} (tip is ${tip})`
      })
    }
  }
  if (input.ttlBound !== undefined && body.ttl !== undefined && body.ttl > BigInt(input.ttlBound)) {
    out.push({
      _tag: "TtlBeyondBound",
      ttl: body.ttl,
      bound: input.ttlBound,
      message: `TTL slot ${body.ttl} is later than the permitted bound ${input.ttlBound}`
    })
  }

  // ── network ──
  if (
    input.expectedNetworkId !== undefined &&
    body.networkId !== undefined &&
    body.networkId !== input.expectedNetworkId
  ) {
    out.push({
      _tag: "WrongNetwork",
      networkId: body.networkId,
      expected: input.expectedNetworkId,
      message: `transaction declares network_id ${body.networkId}, expected ${input.expectedNetworkId}`
    })
  }

  return out
}

/** Options for {@link checkTx} — everything in {@link Phase1Input} except what the tx itself supplies. */
export type CheckTxOptions = Omit<Phase1Input, "body" | "txSize" | "minAda"> & {
  /** Skip the per-output min-ada check (the x402 carve-out for a facilitator without live params). */
  readonly skipMinAda?: boolean
}

/**
 * {@link phase1Violations} over a full signed transaction CBOR hex.
 *
 * Takes the size from the transaction bytes (not the body) and derives per-output
 * min-ada exactly, by re-encoding each decoded output at a representative coin
 * width — the same iteration the ledger does, so the answer is byte-exact rather
 * than a 1.2-ADA rule of thumb.
 */
export const checkTx = (
  fullTxHex: string,
  opts: CheckTxOptions
): Effect.Effect<ReadonlyArray<Phase1Violation>, CborError> =>
  Effect.gen(function* () {
    const bodyHex = yield* txBodyFromTx(fullTxHex)
    const { body } = yield* txBody(bodyHex)
    const txSize = fullTxHex.length / 2
    const minAda = opts.skipMinAda === true ? undefined : yield* minAdaPerOutput(bodyHex, opts.params.coinsPerUtxoByte)
    return phase1Violations({ ...opts, body, txSize, ...(minAda !== undefined ? { minAda } : {}) })
  })

/**
 * Byte-exact minimum lovelace for every output of a body, parallel to
 * `Inspect.txBody(...).body.outputs`.
 *
 * Decodes the body a second time to reach the output objects `MinAda.forOutput` needs.
 * `TxBodyView` is deliberately a flat hex/bigint view for UI and hardware rails, and widening it
 * to carry codec objects would push those types through every consumer to serve this one caller.
 *
 * ⚠️ Min-ada is not an estimate: under-state it and the node rejects the transaction. It is
 * computed over the output's serialized size, so it moves whenever the serialization does — which
 * is how ledger D10 was found here, as a one-byte difference on an output whose inline datum
 * carried an empty indefinite Plutus array. Guarded by the `minAda` and `roundTripTxOutput`
 * vectors in harness/evolution-codec-conformance.mjs, and at body scale by
 * harness/minada-body-conformance.mjs.
 */
export const minAdaPerOutput = (
  bodyHex: string,
  coinsPerUtxoByte: bigint
): Effect.Effect<ReadonlyArray<bigint>, CborError> =>
  Effect.try({
    try: () => {
      if (bodyHex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(bodyHex))
        throw new Error(`invalid hex: ${bodyHex.slice(0, 32)}…`)
      const b = TransactionBody.fromCBORBytes(hexToBytes(bodyHex))
      return b.outputs.map((o) => MinAda.forOutput(o, coinsPerUtxoByte))
    },
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })
