/**
 * CIP-68 — the datum metadata standard.
 *
 * `datum = #6.121([metadata, version, extra])` (Plutus `Constr 0`). The reference NFT
 * (CIP-67 label 100) holds it; the user token (222 / 333 / 444) shares the asset-name content,
 * so the pair is linked by the bytes after the label.
 *
 * @since 0.1.0
 */

import { Data } from "@evolution-sdk/evolution"

import * as Cip67 from "./Cip67.js"

/**
 * The reference-NFT datum `#6.121([metadata, version, extra])`.
 *
 * @since 0.1.0
 */
export const datum = (metadata: Data.Data, version: bigint, extra: Data.Data): Data.Constr =>
  Data.constr(0n, [metadata, Data.int(version), extra])

/**
 * The minimal `extra` — Unit, `#6.121([])`.
 *
 * @since 0.1.0
 */
export const unitExtra = (): Data.Constr => Data.constr(0n, [])

/**
 * A CIP-68 datum whose metadata is a Plutus map, with the Unit `extra`.
 *
 * @since 0.1.0
 */
export const datumFromMetadata = (entries: Array<[key: Data.Data, value: Data.Data]>, version: bigint): Data.Constr =>
  datum(Data.map(entries), version, unitExtra())

/** Reference-NFT asset name (label 100). @since 0.1.0 */
export const referenceNftName = (content: Uint8Array): Uint8Array =>
  Cip67.toAssetName(Cip67.LABEL_REFERENCE_NFT, content)
/** User NFT asset name (label 222). @since 0.1.0 */
export const userNftName = (content: Uint8Array): Uint8Array => Cip67.toAssetName(Cip67.LABEL_USER_NFT, content)
/** User fungible-token asset name (label 333). @since 0.1.0 */
export const userFtName = (content: Uint8Array): Uint8Array => Cip67.toAssetName(Cip67.LABEL_USER_FT, content)
/** User rich-fungible-token asset name (label 444). @since 0.1.0 */
export const userRftName = (content: Uint8Array): Uint8Array => Cip67.toAssetName(Cip67.LABEL_USER_RFT, content)
