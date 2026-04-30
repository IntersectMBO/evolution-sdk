import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Ed25519Signature from "./Ed25519Signature.js"
import * as KESVkey from "./KESVkey.js"
import * as Numeric from "./Numeric.js"
import { CborReader } from "./v2/CborReader.js"
import { capture, CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * OperationalCert class based on Conway CDDL specification
 *
 * CDDL:
 * ```
 * operational_cert = [
 *   hot_vkey : kes_vkey,
 *   sequence_number : uint64,
 *   kes_period : uint64,
 *   sigma : ed25519_signature
 * ]
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class OperationalCert extends Schema.TaggedClass<OperationalCert>()("OperationalCert", {
  hotVkey: KESVkey.KESVkey,
  sequenceNumber: Numeric.Uint64Schema,
  kesPeriod: Numeric.Uint64Schema,
  sigma: Ed25519Signature.Ed25519Signature
}) {
  toJSON() {
    return {
      _tag: "OperationalCert" as const,
      hotVkey: this.hotVkey.toJSON(),
      sequenceNumber: this.sequenceNumber.toString(),
      kesPeriod: this.kesPeriod.toString(),
      sigma: this.sigma.toJSON()
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
      that instanceof OperationalCert &&
      Equal.equals(this.hotVkey, that.hotVkey) &&
      this.sequenceNumber === that.sequenceNumber &&
      this.kesPeriod === that.kesPeriod &&
      Equal.equals(this.sigma, that.sigma)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash(this.hotVkey))(
        Hash.combine(Hash.hash(this.sequenceNumber))(Hash.combine(Hash.hash(this.kesPeriod))(Hash.hash(this.sigma)))
      )
    )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: OperationalCert): void => {
  w.writeArrayHeader(4)
  KESVkey.write(w, v.hotVkey)
  w.writeUint(v.sequenceNumber)
  w.writeUint(v.kesPeriod)
  Ed25519Signature.write(w, v.sigma)
  w.writeArrayBreak()
}

export const read = (r: CborReader): OperationalCert => {
  const start = r.position()
  const count = r.readArrayHeader()
  const cert = new OperationalCert({
    hotVkey: KESVkey.read(r),
    sequenceNumber: r.readUint(),
    kesPeriod: r.readUint(),
    sigma: Ed25519Signature.read(r)
  })
  if (count === -1) r.isBreak()
  capture(cert, r.buffer().subarray(start, r.position()))
  return cert
}

/**
 * CBOR bytes transformation schema for OperationalCert.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(OperationalCert),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "OperationalCert.FromCBORBytes" })

/**
 * CBOR hex transformation schema for OperationalCert.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "OperationalCert.FromCBORHex" })

/**
 * Check if the given value is a valid OperationalCert
 *
 * @since 2.0.0
 * @category predicates
 */
export const isOperationalCert = Schema.is(OperationalCert)

/**
 * FastCheck arbitrary for generating random OperationalCert instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.record({
  hotVkey: KESVkey.arbitrary,
  sequenceNumber: FastCheck.bigUint(),
  kesPeriod: FastCheck.bigUint(),
  sigma: Ed25519Signature.arbitrary
}).map((props) => new OperationalCert(props))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse OperationalCert from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse OperationalCert from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode OperationalCert to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (cert: OperationalCert, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(256, profile)
  write(w, cert)
  return w.finishView()
}

/**
 * Encode OperationalCert to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (cert: OperationalCert, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(cert, profile))
