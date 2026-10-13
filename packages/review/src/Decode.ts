/**
 * The `Decode` service: a received transaction back into typed objects.
 *
 * Where a codec is hex-in/hex-out (building and signing), `Decode` answers "what does this
 * transaction do" — certificates, mint, governance, native scripts, Plutus data, redeemers,
 * scripts. The review tier is written against this interface rather than against a concrete
 * decoder, so an embedder can supply its own backend and the views above never move.
 *
 * Leaf operations are synchronous and **throw** on malformed input; `Analyze` runs them inside
 * `Effect.try` so a throw lands in the typed failure channel.
 *
 * @since 0.1.0
 */

import { Context, Layer } from "effect"

import * as Internal from "./internal/EvolutionDecode.js"
import type {
  Certificate,
  Mint,
  NativeScript,
  PlutusData,
  ProposalProcedure,
  Redeemer,
  VotingProcedures
} from "./Types.js"

/**
 * ⚠️ A body field reads `undefined` when the key is absent, and a witness field reads `[]`. The
 * two are different facts: a transaction with no `certificates` key is not the same as one
 * whose certificate list failed to decode, and a backend that answered `[]` for both would show
 * a script transaction as carrying no scripts — the failure a review surface exists to prevent.
 *
 * @since 0.1.0
 */
export interface Decode {
  readonly certificates: (bodyHex: string) => Array<Certificate> | undefined
  readonly mint: (bodyHex: string) => Mint | undefined
  readonly votingProcedures: (bodyHex: string) => VotingProcedures | undefined
  readonly proposalProcedures: (bodyHex: string) => Array<ProposalProcedure> | undefined
  readonly nativeScripts: (witnessHex: string) => Array<NativeScript>
  readonly datums: (witnessHex: string) => Array<PlutusData>
  readonly redeemers: (witnessHex: string) => Array<Redeemer>
  readonly plutusScripts: (witnessHex: string, version: 1 | 2 | 3) => Array<Uint8Array>
  readonly plutusData: (itemHex: string) => PlutusData
}

/**
 * The `Decode` service tag.
 *
 * @since 0.1.0
 */
export const Decode = Context.GenericTag<Decode>("@evolution-sdk/review/Decode")

/**
 * The Evolution-backed backend.
 *
 * ⚠️ Two shapes have no source on Evolution's side and this **throws** rather than inventing
 * one: a `require_guard` native script (Dijkstra, pre-fork) and any certificate its schema
 * rejects.
 *
 * @since 0.1.0
 */
export const make = (): Decode => Internal.makeEvolutionDecode()

/**
 * The Evolution-backed backend as a Layer.
 *
 * @since 0.1.0
 */
export const layer: Layer.Layer<Decode> = Layer.succeed(Decode, Decode.of(make()))
