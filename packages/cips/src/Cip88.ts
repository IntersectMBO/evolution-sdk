/**
 * CIP-88 — token policy registration, label 867.
 *
 * A policy declares what it is and which CIPs it supports, signed by the policy key so a
 * consumer can tell a real declaration from anyone else's claim about the policy.
 *
 * ⚠️ The map keys are ascending integers, which is already canonical order, and the encoding is
 * canonical as well. Registration metadata is hashed into `auxiliary_data_hash`, and the payload
 * is also the **signing preimage** — so a byte that moves invalidates every witness over it.
 *
 * @since 0.1.0
 */

import {
  Bip32PrivateKey,
  CBOR,
  Ed25519Signature,
  Metadata,
  PrivateKey,
  TransactionMetadatum,
  VKey
} from "@evolution-sdk/evolution"
import { Data, Effect } from "effect"

/** @since 0.1.0 */
export class Cip88Error extends Data.TaggedError("Cip88Error")<{ readonly reason: string }> {}

/** The CIP-88 token-policy-registration metadata label. @since 0.1.0 */
export const REGISTRATION_LABEL = 867n

/** Metadatum byte strings are capped at 64 bytes. */
const MAX_BYTES = 64

/**
 * Validation method: `[0]` an ed25519 key signature, or `[1, [policyId, assetId]]` a beacon or
 * reference token.
 *
 * @since 0.1.0
 */
export type Validation =
  { readonly method: 0 } | { readonly method: 1; readonly policyIdHex: string; readonly assetIdHex: string }

/** @since 0.1.0 */
export interface RegistrationOptions {
  /** 28-byte native-script policy id (script hash), hex. */
  readonly policyIdHex: string
  /** The native-script CBOR, hex — chunked into 64-byte metadatum byte strings. */
  readonly nativeScriptHex: string
  /** The CIP numbers this policy declares, e.g. `[25, 27]`. */
  readonly featureSet: ReadonlyArray<number>
  readonly validation: Validation
  /** Replay guard; the current slot height is the recommendation. */
  readonly nonce: number | bigint
  /** Registration version (default 1). */
  readonly version?: number
  /** Optional oracle URI as `[scheme, ...path]`, each element at most 64 bytes. */
  readonly oracleUri?: ReadonlyArray<string>
}

/** @since 0.1.0 */
export interface Witness {
  readonly pubkeyHex: string
  readonly sigHex: string
}

const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new Error(`not hex: ${hex.slice(0, 32)}`)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

const hexChunks = (hex: string, maxBytes: number): Array<string> => {
  const max = maxBytes * 2
  const out: Array<string> = []
  for (let i = 0; i < hex.length; i += max) out.push(hex.slice(i, i + max))
  return out.length > 0 ? out : [""]
}

type M = TransactionMetadatum.TransactionMetadatum
const mmap = (entries: Array<[M, M]>): M => new globalThis.Map<M, M>(entries)

const buildPayload = (o: RegistrationOptions): M => {
  const scriptChunks = hexChunks(o.nativeScriptHex, MAX_BYTES).map((h) => hexToBytes(h) as M)
  const tokenScope: M = [0n, hexToBytes(o.policyIdHex), scriptChunks]
  const featureSet: M = o.featureSet.map((n) => BigInt(n) as M)
  const validation: M =
    o.validation.method === 0 ? [0n] : [1n, [hexToBytes(o.validation.policyIdHex), hexToBytes(o.validation.assetIdHex)]]

  const entries: Array<[M, M]> = [
    [1n, tokenScope],
    [2n, featureSet],
    [3n, validation],
    [4n, BigInt(o.nonce)]
  ]
  if (o.oracleUri && o.oracleUri.length > 0) {
    for (const part of o.oracleUri) {
      if (new TextEncoder().encode(part).length > MAX_BYTES)
        throw new Error(`oracle URI part exceeds ${MAX_BYTES} bytes`)
    }
    entries.push([5n, o.oracleUri.map((s) => s as M)])
  }
  return mmap(entries)
}

/**
 * Build the CIP-88 registration payload — the scope-details map — as CBOR hex.
 *
 * @since 0.1.0
 */
export const payload = (o: RegistrationOptions): Effect.Effect<string, Cip88Error> =>
  Effect.try({
    try: () => TransactionMetadatum.toCBORHex(buildPayload(o), CBOR.CANONICAL_OPTIONS),
    catch: (e) => new Cip88Error({ reason: e instanceof Error ? e.message : String(e) })
  })

/**
 * The bytes a witness signs: the raw payload CBOR.
 *
 * @since 0.1.0
 */
export const signingPayload = (payloadHex: string): string => payloadHex

/**
 * Sign the payload with a BIP-32 policy key.
 *
 * ⚠️ `pubkeyHex` is the 32-byte Ed25519 public key, not the 64-byte extended one: it is what the
 * signature verifies against.
 *
 * @since 0.1.0
 */
export const sign = (payloadHex: string, xprvHex: string): Effect.Effect<Witness, Cip88Error> =>
  Effect.try({
    try: (): Witness => {
      const priv = Bip32PrivateKey.toPrivateKey(Bip32PrivateKey.fromBytes(hexToBytes(xprvHex)))
      return {
        pubkeyHex: VKey.toHex(VKey.fromPrivateKey(priv)),
        sigHex: Ed25519Signature.toHex(PrivateKey.sign(priv, hexToBytes(payloadHex)))
      }
    },
    catch: (e) => new Cip88Error({ reason: e instanceof Error ? e.message : String(e) })
  })

/**
 * Verify a witness against the payload.
 *
 * @since 0.1.0
 */
export const verify = (payloadHex: string, w: Witness): Effect.Effect<boolean, Cip88Error> =>
  Effect.try({
    try: () => VKey.verify(VKey.fromHex(w.pubkeyHex), hexToBytes(payloadHex), hexToBytes(w.sigHex)),
    catch: (e) => new Cip88Error({ reason: e instanceof Error ? e.message : String(e) })
  })

/**
 * Assemble the full label-867 registration metadata from a payload and its witnesses.
 *
 * @since 0.1.0
 */
export const registration = (
  payloadHex: string,
  witnesses: ReadonlyArray<Witness>,
  version = 1
): Effect.Effect<string, Cip88Error> =>
  Effect.try({
    try: () => {
      const witList: M = witnesses.map((w) => [hexToBytes(w.pubkeyHex), hexToBytes(w.sigHex)] as M)
      const payloadMetadatum = TransactionMetadatum.fromCBORHex(payloadHex, CBOR.CANONICAL_OPTIONS)
      const regMap = mmap([
        [0n, BigInt(version)],
        [1n, payloadMetadatum],
        [2n, witList]
      ])
      return Metadata.toCBORHex(CBOR.CANONICAL_OPTIONS)(Metadata.fromEntries([[REGISTRATION_LABEL, regMap]]))
    },
    catch: (e) => new Cip88Error({ reason: e instanceof Error ? e.message : String(e) })
  })

/**
 * Build the payload, sign it with each policy key, and assemble the metadata.
 *
 * @since 0.1.0
 */
export const build = (
  o: RegistrationOptions,
  signerXprvHexes: ReadonlyArray<string>
): Effect.Effect<{ readonly payloadHex: string; readonly metadataHex: string }, Cip88Error> =>
  Effect.gen(function* () {
    const payloadHex = yield* payload(o)
    const witnesses: Array<Witness> = []
    for (const xprv of signerXprvHexes) witnesses.push(yield* sign(payloadHex, xprv))
    const metadataHex = yield* registration(payloadHex, witnesses, o.version ?? 1)
    return { payloadHex, metadataHex }
  })
