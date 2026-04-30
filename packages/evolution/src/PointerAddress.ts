import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Credential from "./Credential.js"
import * as KeyHash from "./KeyHash.js"
import * as Natural from "./Natural.js"
import * as NetworkId from "./NetworkId.js"
import * as Pointer from "./Pointer.js"
import * as ScriptHash from "./ScriptHash.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Pointer address with payment credential and pointer to stake registration
 *
 * @since 2.0.0
 * @category schemas
 */
export class PointerAddress extends Schema.TaggedClass<PointerAddress>("PointerAddress")("PointerAddress", {
  networkId: NetworkId.NetworkId,
  paymentCredential: Credential.Credential,
  pointer: Pointer.Pointer
}) {
  toJSON() {
    return {
      _tag: "PointerAddress" as const,
      networkId: this.networkId,
      paymentCredential: this.paymentCredential,
      pointer: this.pointer
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof PointerAddress &&
      Equal.equals(this.networkId, that.networkId) &&
      Equal.equals(this.paymentCredential, that.paymentCredential) &&
      Equal.equals(this.pointer, that.pointer)
    )
  }

  [Hash.symbol](): number {
    return Hash.combine(Hash.combine(Hash.hash(this.networkId))(Hash.hash(this.paymentCredential)))(
      Hash.hash(this.pointer)
    )
  }
}

/**
 * Encode a positive integer using Cardano pointer varint (LEB128-like) encoding.
 * - Little-endian base-128: emit 7-bit groups, low to high, set MSB (0x80) on all but last.
 * - Matches decodeVarint below and Cardano pointer address spec.
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const encodeVarint = (natural: Natural.Natural): Uint8Array => {
  let n = natural as number
  if (n === 0) return new Uint8Array([0])
  const chunks: Array<number> = []

  // Collect 7-bit chunks (LSB first)
  while (n > 0) {
    chunks.push(n & 0x7f)
    n = Math.floor(n / 128)
  }

  // Emit in big-endian order with continuation bit on all but the last
  const out: Array<number> = []
  for (let i = chunks.length - 1; i >= 0; i--) {
    let byte = chunks[i]
    if (i !== 0) byte |= 0x80
    out.push(byte)
  }

  return new Uint8Array(out)
}

/**
 * Decode a variable length integer from a Uint8Array (LEB128-like).
 * Following the Cardano ledger implementation for variable-length integers.
 * Returns [value, bytesRead].
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const decodeVarint = (
  bytes: Uint8Array,
  offset = 0
): [Natural.Natural, number] => {
  let number = 0
  let bytesRead = 0

  while (true) {
    if (offset + bytesRead >= bytes.length) {
      throw new Error(`Buffer overflow decoding varint at offset ${offset}`)
    }

    const b = bytes[offset + bytesRead]
    bytesRead++

    // Big-endian base-128 accumulate
    // Use arithmetic multiplication instead of bitwise shift to avoid
    // 32-bit signed integer overflow caused by JS bitwise operators.
    number = number * 128 + (b & 0x7f)

    if ((b & 0x80) === 0) {
      return [number as Natural.Natural, bytesRead]
    }
  }
}

/**
 * Schema-compatible version of encodeVarint (returns Effect).
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const encodeVariableLength = (natural: Natural.Natural) =>
  ParseResult.succeed(encodeVarint(natural))

/**
 * Schema-compatible version of decodeVarint (returns Effect).
 *
 * @since 2.0.0
 * @category encoding/decoding
 */
export const decodeVariableLength = (
  bytes: Uint8Array,
  offset = 0
) =>
  ParseResult.try({
    try: () => decodeVarint(bytes, offset),
    catch: (e) => new ParseResult.Type(Natural.Natural.ast, bytes, e instanceof Error ? e.message : String(e))
  })

export const FromBytes = Schema.transformOrFail(Schema.Uint8ArrayFromSelf, Schema.typeSchema(PointerAddress), {
  strict: true,
  encode: (_, __, ___, toA) =>
    ParseResult.try({
      try: () => {
        const paymentBit = toA.paymentCredential._tag === "KeyHash" ? 0 : 1
        const header = (0b01 << 6) | (0b0 << 5) | (paymentBit << 4) | (toA.networkId & 0b00001111)

        // Get variable length encoded bytes first to determine total size
        const slotBytes = encodeVarint(toA.pointer.slot)
        const txIndexBytes = encodeVarint(toA.pointer.txIndex)
        const certIndexBytes = encodeVarint(toA.pointer.certIndex)

        const totalSize = 1 + 28 + slotBytes.length + txIndexBytes.length + certIndexBytes.length
        const result = new Uint8Array(totalSize)
        result[0] = header

        // payment credential
        result.set(toA.paymentCredential.hash, 1)

        // pointer components
        let offset = 29
        result.set(slotBytes, offset)
        offset += slotBytes.length
        result.set(txIndexBytes, offset)
        offset += txIndexBytes.length
        result.set(certIndexBytes, offset)

        return result
      },
      catch: (e) => new ParseResult.Type(Schema.Uint8ArrayFromSelf.ast, toA, e instanceof Error ? e.message : String(e))
    }),
  decode: (fromA, _, ast) =>
    ParseResult.try({
      try: () => {
        if (fromA.length < 30) {
          throw new Error("PointerAddress: too few bytes")
        }

        const header = fromA[0]
        const networkId = header & 0b00001111
        const addressType = header >> 4

        // validate pointer address type group: top bits 01 and bit5=0
        const top2 = (header >> 6) & 0b11
        const stakeOrPtrBit = (header >> 5) & 0b1
        if (!(top2 === 0b01 && stakeOrPtrBit === 0b0)) {
          throw new Error("PointerAddress: invalid header for pointer address")
        }

        // payment credential kind
        const isPaymentKey = (addressType & 0b0001) === 0
        const paymentCredential: Credential.Credential = isPaymentKey
          ? new KeyHash.KeyHash({ hash: fromA.slice(1, 29) })
          : new ScriptHash.ScriptHash({ hash: fromA.slice(1, 29) })

        // decode pointer components
        let offset = 29
        const [slot, r1] = decodeVarint(fromA, offset)
        offset += r1
        const [txIndex, r2] = decodeVarint(fromA, offset)
        offset += r2
        const [certIndex, r3] = decodeVarint(fromA, offset)
        offset += r3

        if (offset !== fromA.length) {
          throw new Error("PointerAddress: unexpected trailing bytes")
        }

        return PointerAddress.make({
          networkId,
          paymentCredential,
          pointer: new Pointer.Pointer({ slot, txIndex, certIndex })
        })
      },
      catch: (e) => new ParseResult.Type(ast, fromA, e instanceof Error ? e.message : String(e))
    })
}).annotations({
  identifier: "PointerAddress.FromBytes",
  description: "Transforms raw bytes to PointerAddress"
})

export const FromHex = Schema.compose(
  Schema.Uint8ArrayFromHex, // string → Uint8Array
  FromBytes // Uint8Array → PointerAddress
).annotations({
  identifier: "PointerAddress.FromHex",
  description: "Transforms raw hex string to PointerAddress"
})

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: PointerAddress): void => w.writeBytes(toBytes(v))

export const read = (r: CborReader): PointerAddress => {
  const bytes = r.readBytesView()
  return fromBytes(bytes)
}

/**
 * FastCheck arbitrary for generating random PointerAddress instances
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.tuple(NetworkId.arbitrary, Credential.arbitrary, Pointer.arbitrary).map(
  ([networkId, paymentCredential, pointer]) =>
    new PointerAddress({
      networkId,
      paymentCredential,
      pointer
    })
)

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a PointerAddress from bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromBytes = (bytes: Uint8Array) => Schema.decodeSync(FromBytes)(bytes)

/**
 * Parse a PointerAddress from hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromHex = (hex: string) => Schema.decodeSync(FromHex)(hex)

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert a PointerAddress to bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toBytes = (data: PointerAddress): Uint8Array => {
  const paymentBit = data.paymentCredential._tag === "KeyHash" ? 0 : 1
  const header = (0b01 << 6) | (0b0 << 5) | (paymentBit << 4) | (data.networkId & 0b00001111)

  const slotBytes = encodeVarint(data.pointer.slot)
  const txIndexBytes = encodeVarint(data.pointer.txIndex)
  const certIndexBytes = encodeVarint(data.pointer.certIndex)

  const totalSize = 1 + 28 + slotBytes.length + txIndexBytes.length + certIndexBytes.length
  const result = new Uint8Array(totalSize)
  result[0] = header
  result.set(data.paymentCredential.hash, 1)

  let offset = 29
  result.set(slotBytes, offset)
  offset += slotBytes.length
  result.set(txIndexBytes, offset)
  offset += txIndexBytes.length
  result.set(certIndexBytes, offset)

  return result
}

/**
 * Convert a PointerAddress to hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toHex = (data: PointerAddress): string => Bytes.toHex(toBytes(data))
