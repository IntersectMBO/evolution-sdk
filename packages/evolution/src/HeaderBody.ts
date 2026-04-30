import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as BlockBodyHash from "./BlockBodyHash.js"
import * as BlockHeaderHash from "./BlockHeaderHash.js"
import * as Bytes from "./Bytes.js"
import * as Numeric from "./Numeric.js"
import * as OperationalCert from "./OperationalCert.js"
import * as ProtocolVersion from "./ProtocolVersion.js"
import { CborReader } from "./v2/CborReader.js"
import { capture, CborWriter, type EncodingProfile } from "./v2/CborWriter.js"
import * as VKey from "./VKey.js"
import * as VrfCert from "./VrfCert.js"
import * as VrfVkey from "./VrfVkey.js"

/**
 * Schema for HeaderBody representing a block header body.
 * header_body = [
 *   block_number : uint64,
 *   slot : uint64,
 *   prev_hash : block_header_hash / null,
 *   issuer_vkey : vkey,
 *   vrf_vkey : vrf_vkey,
 *   vrf_result : vrf_cert,
 *   block_body_size : uint32,
 *   block_body_hash : block_body_hash,
 *   operational_cert : operational_cert,
 *   protocol_version : protocol_version
 * ]
 *
 * @since 2.0.0
 * @category model
 */
export class HeaderBody extends Schema.TaggedClass<HeaderBody>()("HeaderBody", {
  blockNumber: Numeric.Uint64Schema,
  slot: Numeric.Uint64Schema,
  prevHash: Schema.NullOr(BlockHeaderHash.BlockHeaderHash),
  issuerVkey: VKey.VKey,
  vrfVkey: VrfVkey.VrfVkey,
  vrfResult: VrfCert.VrfCert,
  blockBodySize: Numeric.Uint32Schema,
  blockBodyHash: BlockBodyHash.BlockBodyHash,
  operationalCert: OperationalCert.OperationalCert,
  protocolVersion: ProtocolVersion.ProtocolVersion
}) {
  toJSON() {
    return {
      _tag: "HeaderBody" as const,
      blockNumber: this.blockNumber.toString(),
      slot: this.slot.toString(),
      prevHash: this.prevHash ? this.prevHash.toJSON() : null,
      issuerVkey: this.issuerVkey.toJSON(),
      vrfVkey: this.vrfVkey.toJSON(),
      vrfResult: this.vrfResult.toString(),
      blockBodySize: Number(this.blockBodySize),
      blockBodyHash: this.blockBodyHash.toJSON(),
      operationalCert: this.operationalCert.toString(),
      protocolVersion: this.protocolVersion.toJSON()
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
      that instanceof HeaderBody &&
      this.blockNumber === that.blockNumber &&
      this.slot === that.slot &&
      this.prevHash === that.prevHash &&
      Equal.equals(this.issuerVkey, that.issuerVkey) &&
      Equal.equals(this.vrfVkey, that.vrfVkey) &&
      Equal.equals(this.vrfResult, that.vrfResult) &&
      this.blockBodySize === that.blockBodySize &&
      Equal.equals(this.blockBodyHash, that.blockBodyHash) &&
      Equal.equals(this.operationalCert, that.operationalCert) &&
      Equal.equals(this.protocolVersion, that.protocolVersion)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(Hash.hash("HeaderBody"))(
        Hash.combine(Hash.hash(this.blockNumber))(
          Hash.combine(Hash.hash(this.slot))(
            Hash.combine(Hash.hash(this.prevHash))(
              Hash.combine(Hash.hash(this.issuerVkey))(
                Hash.combine(Hash.hash(this.vrfVkey))(
                  Hash.combine(Hash.hash(this.vrfResult))(
                    Hash.combine(Hash.hash(this.blockBodySize))(
                      Hash.combine(Hash.hash(this.blockBodyHash))(
                        Hash.combine(Hash.hash(this.operationalCert))(Hash.hash(this.protocolVersion))
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  }
}

/**
 * FastCheck arbitrary for generating random HeaderBody instances
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary = FastCheck.record({
  blockNumber: Numeric.Uint64Arbitrary,
  slot: Numeric.Uint64Arbitrary,
  prevHash: FastCheck.option(BlockHeaderHash.arbitrary),
  issuerVkey: VKey.arbitrary,
  vrfVkey: VrfVkey.arbitrary,
  vrfResult: FastCheck.record({
    output: FastCheck.uint8Array({ minLength: 32, maxLength: 32 }),
    proof: FastCheck.uint8Array({ minLength: 80, maxLength: 80 })
  }),
  blockBodySize: Numeric.Uint32Arbitrary,
  blockBodyHash: BlockBodyHash.arbitrary,
  operationalCert: OperationalCert.arbitrary,
  protocolVersion: ProtocolVersion.arbitrary
}).map(
  (props) =>
    new HeaderBody({
      blockNumber: props.blockNumber,
      slot: props.slot,
      prevHash: props.prevHash,
      issuerVkey: props.issuerVkey,
      vrfVkey: props.vrfVkey,
      vrfResult: new VrfCert.VrfCert({
        output: new VrfCert.VRFOutput({ bytes: props.vrfResult.output }),
        proof: new VrfCert.VRFProof({ bytes: props.vrfResult.proof })
      }),
      blockBodySize: props.blockBodySize,
      blockBodyHash: props.blockBodyHash,
      operationalCert: props.operationalCert,
      protocolVersion: props.protocolVersion
    })
)

/**
 * CDDL schema for HeaderBody.
 * header_body = [
 *   block_number : uint64,
 *   slot : uint64,
 *   prev_hash : block_header_hash / null,
 *   issuer_vkey : vkey,
 *   vrf_vkey : vrf_vkey,
 *   vrf_result : vrf_cert,
 *   block_body_size : uint32,
 *   block_body_hash : block_body_hash,
 *   operational_cert : operational_cert,
 *   protocol_version : protocol_version
 * ]
 *
 * @since 2.0.0
 * @category schemas
 */
// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: HeaderBody): void => {
  w.writeArrayHeader(10)
  w.writeUint(v.blockNumber)
  w.writeUint(v.slot)
  if (v.prevHash === null) { w.writeNull() } else { BlockHeaderHash.write(w, v.prevHash) }
  VKey.write(w, v.issuerVkey)
  VrfVkey.write(w, v.vrfVkey)
  // vrf_result = [vrf_output, vrf_proof]
  w.writeArrayHeader(2)
  VrfCert.writeVRFOutput(w, v.vrfResult.output)
  VrfCert.writeVRFProof(w, v.vrfResult.proof)
  w.writeArrayBreak()
  w.writeUint(v.blockBodySize)
  BlockBodyHash.write(w, v.blockBodyHash)
  OperationalCert.write(w, v.operationalCert)
  ProtocolVersion.write(w, v.protocolVersion)
  w.writeArrayBreak()
}

export const read = (r: CborReader): HeaderBody => {
  const start = r.position()
  const count = r.readArrayHeader()
  const blockNumber = r.readUint()
  const slot = r.readUint()
  const prevHash = r.peekMajorType() === 7 ? (r.readNull(), null) : BlockHeaderHash.read(r)
  const issuerVkey = VKey.read(r)
  const vrfVkey = VrfVkey.read(r)
  // vrf_result = [vrf_output, vrf_proof]
  const vrfCount = r.readArrayHeader()
  const vrfOutput = VrfCert.readVRFOutput(r)
  const vrfProof = VrfCert.readVRFProof(r)
  if (vrfCount === -1) r.isBreak()
  const vrfResult = new VrfCert.VrfCert({ output: vrfOutput, proof: vrfProof })
  const blockBodySize = r.readUint()
  const blockBodyHash = BlockBodyHash.read(r)
  const operationalCert = OperationalCert.read(r)
  const protocolVersion = ProtocolVersion.read(r)
  if (count === -1) r.isBreak()
  const hb = new HeaderBody({
    blockNumber,
    slot,
    prevHash,
    issuerVkey,
    vrfVkey,
    vrfResult,
    blockBodySize,
    blockBodyHash,
    operationalCert,
    protocolVersion
  })
  capture(hb, r.buffer().subarray(start, r.position()))
  return hb
}

/**
 * Check if the given value is a valid HeaderBody.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isHeaderBody = Schema.is(HeaderBody)

/**
 * CBOR bytes transformation schema for HeaderBody.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(HeaderBody),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "HeaderBody.FromCBORBytes" })

/**
 * CBOR hex transformation schema for HeaderBody.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "HeaderBody.FromCBORHex" })

/**
 * Convert CBOR bytes to HeaderBody
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Convert CBOR hex string to HeaderBody
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Convert HeaderBody to CBOR bytes
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORBytes = (headerBody: HeaderBody, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(512, profile)
  write(w, headerBody)
  return w.finishView()
}

/**
 * Convert HeaderBody to CBOR hex string
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORHex = (headerBody: HeaderBody, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(headerBody, profile))
