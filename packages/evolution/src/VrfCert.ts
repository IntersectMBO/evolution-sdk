import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Bytes32 from "./Bytes32.js"
import * as Bytes80 from "./Bytes80.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for VRF output (32 bytes).
 * vrf_output = bytes .size 32
 *
 * @since 2.0.0
 * @category schemas
 */
export class VRFOutput extends Schema.TaggedClass<VRFOutput>()("VrfOutput", {
  bytes: Bytes32.BytesFromHex
}) {
  toJSON() {
    return { _tag: "VrfOutput", bytes: this.bytes }
  }
  toString(): string {
    return Inspectable.format(this.toJSON())
  }
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }
  [Equal.symbol](that: unknown): boolean {
    return that instanceof VRFOutput && Bytes.equals(this.bytes, that.bytes)
  }
  [Hash.symbol](): number {
    return Hash.array(Array.from(this.bytes))
  }
}

// ============================================================================
// Write / Read — VRFOutput
// ============================================================================

export const writeVRFOutput = (w: CborWriter, v: VRFOutput): void => w.writeBytes(v.bytes)
export const readVRFOutput = (r: CborReader): VRFOutput => new VRFOutput({ bytes: r.readBytesView() })

/**
 * Schema for VRF output as a byte array.
 * vrf_output = bytes .size 32
 *
 * @since 2.0.0
 * @category schemas
 */
export const VRFOutputFromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(VRFOutput),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new VRFOutput({ bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.bytes)
  }
).annotations({
  identifier: "VrfOutput.Bytes"
})

/**
 * Schema for VRF output as a hex string.
 * vrf_output = bytes .size 32
 *
 * @since 2.0.0
 * @category schemas
 */
export const VRFOutputHexSchema = Schema.compose(
  Schema.Uint8ArrayFromHex,
  VRFOutputFromBytes
).annotations({
  identifier: "VrfOutput.Hex"
})

/**
 * Schema for VRF proof (80 bytes).
 * vrf_proof = bytes .size 80
 *
 * @since 2.0.0
 * @category schemas
 */
export class VRFProof extends Schema.TaggedClass<VRFProof>()("VrfProof", {
  bytes: Bytes80.BytesFromHex
}) {
  toJSON() {
    return { _tag: "VrfProof", bytes: this.bytes }
  }
  toString(): string {
    return Inspectable.format(this.toJSON())
  }
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }
  [Equal.symbol](that: unknown): boolean {
    return that instanceof VRFProof && Bytes.equals(this.bytes, that.bytes)
  }
  [Hash.symbol](): number {
    return Hash.array(Array.from(this.bytes))
  }
}

// ============================================================================
// Write / Read — VRFProof
// ============================================================================

export const writeVRFProof = (w: CborWriter, v: VRFProof): void => w.writeBytes(v.bytes)
export const readVRFProof = (r: CborReader): VRFProof => new VRFProof({ bytes: r.readBytesView() })

/**
 * Schema for VRF proof as a byte array.
 * vrf_proof = bytes .size 80
 *
 * @since 2.0.0
 * @category schemas
 */
export const VRFProofFromBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(VRFProof),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => new VRFProof({ bytes }),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (v) => ParseResult.succeed(v.bytes)
  }
).annotations({
  identifier: "VrfProof.Bytes"
})

/**
 * Schema for VRF proof as a hex string.
 * vrf_proof = bytes .size 80
 *
 * @since 2.0.0
 * @category schemas
 */
export const VRFProofHexSchema = Schema.compose(
  Schema.Uint8ArrayFromHex,
  VRFProofFromBytes
).annotations({
  identifier: "VrfProof.Hex"
})

/**
 * Schema for VrfCert representing a VRF certificate.
 * vrf_cert = [vrf_output, vrf_proof]
 *
 * @since 2.0.0
 * @category model
 */
export class VrfCert extends Schema.TaggedClass<VrfCert>()("VrfCert", {
  output: VRFOutput,
  proof: VRFProof
}) {
  toJSON() {
    return { _tag: "VrfCert", output: this.output, proof: this.proof }
  }
  toString(): string {
    return Inspectable.format(this.toJSON())
  }
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }
  [Equal.symbol](that: unknown): boolean {
    return that instanceof VrfCert && Equal.equals(this.output, that.output) && Equal.equals(this.proof, that.proof)
  }
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.output))(Hash.hash(this.proof)))
  }
}

// ============================================================================
// Write / Read — VrfCert
// ============================================================================

export const write = (w: CborWriter, v: VrfCert): void => {
  w.writeArrayHeader(2)
  writeVRFOutput(w, v.output)
  writeVRFProof(w, v.proof)
  w.writeArrayBreak()
}

export const read = (r: CborReader): VrfCert => {
  r.readArrayHeader()
  const output = readVRFOutput(r)
  const proof = readVRFProof(r)
  return new VrfCert({ output, proof })
}

/**
 * CBOR bytes transformation schema for VrfCert.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(VrfCert),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "VrfCert.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "VrfCert.FromCBORHex" })

/**
 * @since 2.0.0
 * @category FastCheck
 */
export const arbitrary = FastCheck.record({
  output: FastCheck.uint8Array({ minLength: 32, maxLength: 32 }),
  proof: FastCheck.uint8Array({ minLength: 80, maxLength: 80 })
}).chain(({ output, proof }) =>
  FastCheck.constant(
    new VrfCert({
      output: new VRFOutput({ bytes: output }),
      proof: new VRFProof({ bytes: proof })
    })
  )
)

/**
 * Check if the given value is a valid VrfCert.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isVrfCert = Schema.is(VrfCert)

/**
 * Convert CBOR bytes to VrfCert (unsafe).
 *
 * @since 2.0.0
 * @category encoding
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Convert CBOR hex to VrfCert (unsafe).
 *
 * @since 2.0.0
 * @category decoding
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Convert VrfCert to CBOR bytes (unsafe).
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (vrfCert: VrfCert, profile?: import("./v2/CborWriter.js").EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, vrfCert)
  return w.finishView()
}

/**
 * Convert VrfCert to CBOR hex (unsafe).
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (vrfCert: VrfCert, profile?: import("./v2/CborWriter.js").EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(vrfCert, profile))
