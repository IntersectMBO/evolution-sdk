/**
 * The brands and the network identifier CIP-113 carries across its modules.
 *
 * @since 0.1.0
 */

import type { NetworkId } from "@evolution-sdk/evolution"

// ⚠️ These four were defined HERE as well as in `@evolution-sdk/review`, identically. Two
// definitions of the same literal brand are interchangeable until one is renamed, at which point
// they diverge silently — so there is one home and this re-exports it. The names and the types a
// consumer sees are unchanged.
export {
  KeyHashHex,
  PlutusDataHex,
  ScriptHex,
  ValueHex
} from "@evolution-sdk/review/Brands"

/**
 * A network id, named at the call sites that would otherwise read `0` and `1`.
 *
 * ⚠️ Preview and preprod are BOTH `Network.Testnet`: the address header cannot tell them
 * apart, so a deployment record carries `protocolMagic` and that is what selects a chain.
 * Guessing between the two gives a real, well-formed address holding nothing.
 *
 * @since 0.1.0
 */
export const Network = { Testnet: 0, Mainnet: 1 } as const
/** @since 0.1.0 */
export type Network = NetworkId.NetworkId

/**
 * A Plutus `Credential` — verification-key (`Constr 0 [hash]`) or script (`Constr 1 [hash]`).
 *
 * @since 0.1.0
 */
export interface Credential {
  readonly kind: "key" | "script"
  readonly hashHex: string
}




