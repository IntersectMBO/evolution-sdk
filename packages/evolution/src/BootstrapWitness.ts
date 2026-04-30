import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import * as CBOR from "./CBOR.js"
import * as Ed25519Signature from "./Ed25519Signature.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"
import * as VKey from "./VKey.js"

/**
 * Helper to compare two Uint8Arrays by content.
 */
const uint8ArrayEquals = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Bootstrap witness for Byron-era addresses.
 *
 * CDDL:
 * ```
 * bootstrap_witness = [
 *   public_key : vkey,
 *   signature : ed25519_signature,
 *   chain_code : bytes .size 32,
 *   attributes : bytes
 * ]
 * ```
 */
export class BootstrapWitness extends Schema.Class<BootstrapWitness>("BootstrapWitness")({
  publicKey: VKey.VKey,
  signature: Ed25519Signature.Ed25519Signature,
  chainCode: Bytes32.BytesFromHex,
  attributes: Schema.Uint8ArrayFromHex
}) {
  /**
   * Convert to JSON representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toJSON() {
    return {
      _tag: "BootstrapWitness",
      publicKey: this.publicKey,
      signature: this.signature,
      chainCode: this.chainCode,
      attributes: this.attributes
    }
  }

  /**
   * Convert to string representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  /**
   * Custom inspect for Node.js REPL.
   *
   * @since 2.0.0
   * @category conversions
   */
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /**
   * Structural equality check.
   *
   * @since 2.0.0
   * @category equality
   */
  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof BootstrapWitness &&
      Equal.equals(this.publicKey, that.publicKey) &&
      Equal.equals(this.signature, that.signature) &&
      uint8ArrayEquals(this.chainCode, that.chainCode) &&
      uint8ArrayEquals(this.attributes, that.attributes)
    )
  }

  /**
   * Hash code generation.
   * Only hashes publicKey for performance (minimal identifying field).
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.publicKey))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: BootstrapWitness): void => {
  w.writeArrayHeader(4)
  VKey.write(w, v.publicKey)
  Ed25519Signature.write(w, v.signature)
  w.writeBytes(v.chainCode)
  const attrs = v.attributes.length === 0 ? new Uint8Array([0xa0]) : v.attributes
  w.writeBytes(attrs)
  w.writeArrayBreak()
}

export const read = (r: CborReader): BootstrapWitness => {
  const count = r.readArrayHeader()
  const publicKey = VKey.read(r)
  const signature = Ed25519Signature.read(r)
  const chainCode = r.readBytes()
  const attributes = r.readBytes()
  if (count === -1) r.isBreak()
  return new BootstrapWitness({ publicKey, signature, chainCode, attributes })
}


/**
 * CBOR bytes transformation schema for BootstrapWitness.
 * Transforms between Uint8Array and BootstrapWitness using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(BootstrapWitness),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "BootstrapWitness.FromCBORBytes" })

/**
 * CBOR hex transformation schema for BootstrapWitness.
 * Transforms between hex string and BootstrapWitness using CBOR encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "BootstrapWitness.FromCBORHex" })

/**
 * Parse BootstrapWitness from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse BootstrapWitness from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode BootstrapWitness to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (witness: BootstrapWitness, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(256, profile)
  write(w, witness)
  return w.finishView()
}

/**
 * Encode BootstrapWitness to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (witness: BootstrapWitness, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(witness, profile))

/**
 * Arbitrary generator for BootstrapWitness instances.
 */
export const arbitrary: FastCheck.Arbitrary<BootstrapWitness> = FastCheck.record({
  attributes: FastCheck.oneof(
    FastCheck.constant(new Uint8Array([0xa0])),
    FastCheck.uint8Array({ minLength: 1, maxLength: 64 }).map((path) => {
      const m = new Map<bigint, Uint8Array>()
      // Byron AddrAttributes: key 1 holds derivation_path; value is CBOR-encoded bytes
      const inner = CBOR.internalEncodeSync(path, CBOR.CML_DEFAULT_OPTIONS)
      m.set(1n, inner)
      return CBOR.internalEncodeSync(m, CBOR.CML_DEFAULT_OPTIONS)
    })
  ),
  chainCode: FastCheck.uint8Array({ minLength: 32, maxLength: 32 }),
  publicKey: VKey.arbitrary,
  signature: Ed25519Signature.arbitrary
}).map(
  ({ attributes, chainCode, publicKey, signature }) =>
    new BootstrapWitness({ attributes, chainCode, publicKey, signature })
)
