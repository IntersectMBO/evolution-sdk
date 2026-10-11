/**
 * Address header kind - used to determine the type of address from its header
 * Following CIP-0019 address types
 *
 * @since 2.0.0
 * @category model
 */
/**
 * Reading an address header WITHOUT validating the address.
 *
 * `AddressEras` is the decoder: it parses an address into one of the five typed shapes and
 * rejects anything malformed, which is what a builder or a wallet wants. An inspector wants the
 * opposite. A transaction-review screen has to render an output whose address it cannot fully
 * explain — trailing bytes, a truncated credential, a header kind CIP-19 does not define — because
 * refusing to decode it makes the whole transaction unreviewable, which is worse than showing it
 * with the little that can be derived.
 *
 * So these accessors never throw. They answer `undefined` for what the bytes do not support and
 * say nothing about whether the address as a whole is well formed; `AddressEras.fromBytes` is
 * still the thing to ask that.
 */

import type * as Credential from "./Credential.js"
import * as KeyHash from "./KeyHash.js"
import * as ScriptHash from "./ScriptHash.js"

export type AddressTag = "Base" | "Enterprise" | "Pointer" | "Reward" | "Byron"

/** A credential is a 28-byte blake2b-224 digest (CIP-19). */
const CREDENTIAL_LENGTH = 28

const credentialAt = (bytes: Uint8Array, offset: number, isScript: boolean): Credential.Credential | undefined => {
  if (offset + CREDENTIAL_LENGTH > bytes.length) return undefined
  const hash = bytes.slice(offset, offset + CREDENTIAL_LENGTH)
  return isScript
    ? new ScriptHash.ScriptHash({ hash }, { disableValidation: true })
    : new KeyHash.KeyHash({ hash }, { disableValidation: true })
}

/**
 * The address kind a header byte declares, or `undefined` for one CIP-19 does not define
 * (`1001`-`1101`, reserved for future formats).
 *
 * @since 2.0.0
 * @category transformation
 */
export const fromHeader = (header: number): AddressTag | undefined => {
  switch (header >> 4) {
    case 0b0000:
    case 0b0001:
    case 0b0010:
    case 0b0011:
      return "Base"
    case 0b0100:
    case 0b0101:
      return "Pointer"
    case 0b0110:
    case 0b0111:
      return "Enterprise"
    case 0b1000:
      return "Byron"
    case 0b1110:
    case 0b1111:
      return "Reward"
    default:
      return undefined
  }
}

/**
 * The address kind these bytes declare, or `undefined` when they are empty or carry an undefined
 * header kind.
 *
 * @since 2.0.0
 * @category transformation
 */
export const fromBytes = (bytes: Uint8Array): AddressTag | undefined =>
  bytes.length === 0 ? undefined : fromHeader(bytes[0]!)

/**
 * The network id in the header's low nibble (CIP-19 bits 3-0), or `undefined` for empty bytes.
 *
 * ⚠️ Byron addresses carry no network nibble — the low bits are part of the CBOR, not a network —
 * so this answers `undefined` for them rather than a number that means nothing.
 *
 * @since 2.0.0
 * @category transformation
 */
export const networkId = (bytes: Uint8Array): number | undefined => {
  if (bytes.length === 0) return undefined
  return fromHeader(bytes[0]!) === "Byron" ? undefined : bytes[0]! & 0b1111
}

/**
 * The payment credential, for the kinds that carry one (base, pointer, enterprise). `undefined`
 * for a reward or Byron address, and for bytes too short to hold it.
 *
 * @since 2.0.0
 * @category transformation
 */
export const paymentCredential = (bytes: Uint8Array): Credential.Credential | undefined => {
  if (bytes.length === 0) return undefined
  const type = bytes[0]! >> 4
  if (type > 0b0111) return undefined
  return credentialAt(bytes, 1, (type & 0b0001) === 0b0001)
}

/**
 * The staking credential, for the kinds that carry one: a base address holds it after the payment
 * credential, a reward address directly after the header. `undefined` for every other kind, and
 * for bytes too short to hold it.
 *
 * @since 2.0.0
 * @category transformation
 */
export const stakeCredential = (bytes: Uint8Array): Credential.Credential | undefined => {
  if (bytes.length === 0) return undefined
  const type = bytes[0]! >> 4
  if (type <= 0b0011) return credentialAt(bytes, 1 + CREDENTIAL_LENGTH, (type & 0b0010) === 0b0010)
  if (type === 0b1110 || type === 0b1111) return credentialAt(bytes, 1, (type & 0b0001) === 0b0001)
  return undefined
}
