/**
 * CIP-102 — the royalty datum.
 *
 * `royalty_info = #6.121([[recipient…], version, extra])`, each
 * `recipient = #6.121([address, fee, opt_min, opt_max])`, carried in the `(500)Royalty` NFT's
 * inline datum. An `optional` is `#6.121([x])` for Some and `#6.122([])` for None.
 *
 * ⚠️ **PROPOSED**, not ratified, and there is no library oracle for it — verified against the
 * CIP-102 datum structure and its `(500)Royalty` vector only.
 *
 * @since 0.1.0
 */

import { Data } from "@evolution-sdk/evolution"

import * as Cip67 from "./Cip67.js"

/**
 * `optional_big_int`: `Some(x)` is `#6.121([x])`, `None` is `#6.122([])`.
 *
 * @since 0.1.0
 */
export const optionalInt = (v: bigint | undefined): Data.Constr =>
  v === undefined ? Data.constr(1n, []) : Data.constr(0n, [Data.int(v)])

/**
 * One `royalty_recipient`.
 *
 * @since 0.1.0
 */
export const royaltyRecipient = (
  address: Data.Data,
  fee: bigint,
  minFee: bigint | undefined,
  maxFee: bigint | undefined
): Data.Constr => Data.constr(0n, [address, Data.int(fee), optionalInt(minFee), optionalInt(maxFee)])

/**
 * The royalty datum.
 *
 * @since 0.1.0
 */
export const royaltyInfo = (recipients: Array<Data.Data>, version: bigint, extra: Data.Data): Data.Constr =>
  Data.constr(0n, [Data.list(recipients), Data.int(version), extra])

/**
 * The `(500)Royalty` asset name: CIP-67 label 500, then `Royalty`, then an optional decimal
 * postfix (`postfix: 2` gives `(500)Royalty2`).
 *
 * @since 0.1.0
 */
export const royaltyAssetName = (postfix?: number): Uint8Array =>
  Cip67.toAssetName(500, new TextEncoder().encode(`Royalty${postfix === undefined ? "" : String(postfix)}`))
