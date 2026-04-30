import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bootstrap from "./BootstrapWitness.js"
import * as Bytes from "./Bytes.js"
import * as CBOR from "./CBOR.js"
import * as PlutusData from "./Data.js"
import * as Ed25519Signature from "./Ed25519Signature.js"
import * as NativeScripts from "./NativeScripts.js"
import * as PlutusV1 from "./PlutusV1.js"
import * as PlutusV2 from "./PlutusV2.js"
import * as PlutusV3 from "./PlutusV3.js"
import * as Redeemer from "./Redeemer.js"
import * as Redeemers from "./Redeemers.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"
import * as VKey from "./VKey.js"

// Helper function for array comparison
const arrayEquals = <A>(a: ReadonlyArray<A> | undefined, b: ReadonlyArray<A> | undefined): boolean => {
  if (a === b) return true
  // Treat empty arrays and undefined as equal
  const aLen = a?.length ?? 0
  const bLen = b?.length ?? 0
  if (aLen === 0 && bLen === 0) return true
  if (a === undefined || b === undefined) return false
  if (aLen !== bLen) return false
  for (let i = 0; i < aLen; i++) {
    if (!Equal.equals(a[i], b[i])) return false
  }
  return true
}

// Helper function for array hashing
const arrayHash = <A>(arr: ReadonlyArray<A> | undefined): number => {
  const len = arr?.length ?? 0
  if (len === 0) return Hash.hash(0) // Treat empty arrays and undefined the same
  let hash = Hash.hash(len)
  for (const item of arr!) {
    hash = Hash.combine(hash)(Hash.hash(item))
  }
  return hash
}

// Helper function for PlutusData array hashing (uses Data.hash instead of Hash.hash)
const plutusDataArrayHash = (arr: ReadonlyArray<PlutusData.Data> | undefined): number => {
  const len = arr?.length ?? 0
  if (len === 0) return Hash.hash(0)
  let hash = Hash.hash(len)
  for (const item of arr!) {
    hash = Hash.combine(hash)(PlutusData.hash(item))
  }
  return hash
}

// Helper function for PlutusData array comparison (uses Data.equals instead of Equal.equals)
const plutusDataArrayEquals = (
  a: ReadonlyArray<PlutusData.Data> | undefined,
  b: ReadonlyArray<PlutusData.Data> | undefined
): boolean => {
  if (a === b) return true
  const aLen = a?.length ?? 0
  const bLen = b?.length ?? 0
  if (aLen === 0 && bLen === 0) return true
  if (a === undefined || b === undefined) return false
  if (aLen !== bLen) return false
  for (let i = 0; i < aLen; i++) {
    if (!PlutusData.equals(a[i], b[i])) return false
  }
  return true
}

/**
 * VKey witness for Ed25519 signatures.
 *
 * CDDL: vkeywitness = [ vkey, ed25519_signature ]
 *
 * @since 2.0.0
 * @category model
 */
export class VKeyWitness extends Schema.Class<VKeyWitness>("VKeyWitness")({
  vkey: VKey.VKey,
  signature: Ed25519Signature.Ed25519Signature
}) {
  /**
   * @since 2.0.0
   * @category json
   */
  toJSON() {
    return { _tag: "VKeyWitness" as const, vkey: this.vkey, signature: this.signature }
  }

  /**
   * @since 2.0.0
   * @category string
   */
  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  /**
   * @since 2.0.0
   * @category inspect
   */
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /**
   * @since 2.0.0
   * @category equality
   */
  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof VKeyWitness && Equal.equals(this.vkey, that.vkey) && Equal.equals(this.signature, that.signature)
    )
  }

  /**
   * @since 2.0.0
   * @category hash
   */
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.hash(this.vkey))(Hash.hash(this.signature)))
  }
}

/**
 * Bootstrap witness for Byron-era addresses.
 *
 * CDDL: bootstrap_witness = [
 *   public_key : vkey,
 *   signature : ed25519_signature,
 *   chain_code : bytes .size 32,
 *   attributes : bytes
 * ]
 *
 * @since 2.0.0
 * @category model
 */
// BootstrapWitness moved to its own module in ./BootstrapWitness.ts

/**
 * Plutus script reference with version tag.
 *
 * ```
 * CDDL: plutus_script =
 *   [ 0, plutus_v1_script ]
 * / [ 1, plutus_v2_script ]
 * / [ 2, plutus_v3_script ]
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export const PlutusScript = Schema.Union(PlutusV1.PlutusV1, PlutusV2.PlutusV2, PlutusV3.PlutusV3).annotations({
  identifier: "PlutusScript",
  description: "Plutus script with version tag"
})

export type PlutusScript = typeof PlutusScript.Type

/**
 * TransactionWitnessSet based on Conway CDDL specification.
 *
 * ```
 * CDDL: transaction_witness_set = {
 *   ? 0 : nonempty_set<vkeywitness>
 *   ? 1 : nonempty_set<native_script>
 *   ? 2 : nonempty_set<bootstrap_witness>
 *   ? 3 : nonempty_set<plutus_v1_script>
 *   ? 4 : nonempty_set<plutus_data>
 *   ? 5 : redeemers
 *   ? 6 : nonempty_set<plutus_v2_script>
 *   ? 7 : nonempty_set<plutus_v3_script>
 * }
 *
 * nonempty_set<a0> = #6.258([+ a0])/ [+ a0]
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class TransactionWitnessSet extends Schema.Class<TransactionWitnessSet>("TransactionWitnessSet")({
  vkeyWitnesses: Schema.optional(Schema.Array(VKeyWitness)),
  nativeScripts: Schema.optional(Schema.Array(NativeScripts.NativeScript)),
  bootstrapWitnesses: Schema.optional(Schema.Array(Bootstrap.BootstrapWitness)),
  plutusV1Scripts: Schema.optional(Schema.Array(PlutusV1.PlutusV1)),
  plutusData: Schema.optional(Schema.Array(PlutusData.DataSchema)),
  redeemers: Schema.optional(Schema.typeSchema(Redeemers.Redeemers)),
  plutusV2Scripts: Schema.optional(Schema.Array(PlutusV2.PlutusV2)),
  plutusV3Scripts: Schema.optional(Schema.Array(PlutusV3.PlutusV3))
}) {
  /**
   * @since 2.0.0
   * @category json
   */
  toJSON() {
    return {
      _tag: "TransactionWitnessSet" as const,
      vkeyWitnesses: this.vkeyWitnesses?.map((v) => v.toJSON()),
      nativeScripts: this.nativeScripts?.map((s) => Schema.encodeSync(NativeScripts.NativeScript)(s)),
      bootstrapWitnesses: this.bootstrapWitnesses?.map((b) => b.toJSON()),
      plutusV1Scripts: this.plutusV1Scripts,
      plutusData: this.plutusData,
      redeemers: this.redeemers?.toJSON(),
      plutusV2Scripts: this.plutusV2Scripts,
      plutusV3Scripts: this.plutusV3Scripts
    }
  }

  /**
   * @since 2.0.0
   * @category string
   */
  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  /**
   * @since 2.0.0
   * @category inspect
   */
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /**
   * @since 2.0.0
   * @category equality
   */
  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof TransactionWitnessSet &&
      arrayEquals(this.vkeyWitnesses, that.vkeyWitnesses) &&
      arrayEquals(this.nativeScripts, that.nativeScripts) &&
      arrayEquals(this.bootstrapWitnesses, that.bootstrapWitnesses) &&
      arrayEquals(this.plutusV1Scripts, that.plutusV1Scripts) &&
      plutusDataArrayEquals(this.plutusData, that.plutusData) &&
      Equal.equals(this.redeemers, that.redeemers) &&
      arrayEquals(this.plutusV2Scripts, that.plutusV2Scripts) &&
      arrayEquals(this.plutusV3Scripts, that.plutusV3Scripts)
    )
  }

  /**
   * @since 2.0.0
   * @category hash
   */
  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(
        Hash.combine(
          Hash.combine(
            Hash.combine(
              Hash.combine(
                Hash.combine(Hash.combine(arrayHash(this.vkeyWitnesses))(arrayHash(this.nativeScripts)))(
                  arrayHash(this.bootstrapWitnesses)
                )
              )(arrayHash(this.plutusV1Scripts))
            )(plutusDataArrayHash(this.plutusData))
          )(Hash.hash(this.redeemers))
        )(arrayHash(this.plutusV2Scripts))
      )(arrayHash(this.plutusV3Scripts))
    )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

const writeVKeyWitness = (w: CborWriter, v: VKeyWitness): void => {
  w.writeArrayHeader(2)
  VKey.write(w, v.vkey)
  Ed25519Signature.write(w, v.signature)
  w.writeArrayBreak()
}

const readVKeyWitness = (r: CborReader): VKeyWitness => {
  const count = r.readArrayHeader()
  const vkey = VKey.read(r)
  const signature = Ed25519Signature.read(r)
  if (count === -1) r.isBreak()
  return new VKeyWitness({ vkey, signature })
}

export const write = (w: CborWriter, v: TransactionWitnessSet): void => {
  // Count non-empty optional fields
  let count = 0
  if (v.vkeyWitnesses && v.vkeyWitnesses.length > 0) count++
  if (v.nativeScripts && v.nativeScripts.length > 0) count++
  if (v.bootstrapWitnesses && v.bootstrapWitnesses.length > 0) count++
  if (v.plutusV1Scripts && v.plutusV1Scripts.length > 0) count++
  if (v.plutusData && v.plutusData.length > 0) count++
  if (v.redeemers && v.redeemers.size > 0) count++
  if (v.plutusV2Scripts && v.plutusV2Scripts.length > 0) count++
  if (v.plutusV3Scripts && v.plutusV3Scripts.length > 0) count++
  w.writeMapHeader(count)

  // 0: vkeyWitnesses
  if (v.vkeyWitnesses && v.vkeyWitnesses.length > 0) {
    w.writeSmallUint(0)
    w.writeTagHeader(258)
    w.writeArrayHeader(v.vkeyWitnesses.length)
    for (const vk of v.vkeyWitnesses) writeVKeyWitness(w, vk)
    w.writeArrayBreak()
  }
  // 1: nativeScripts
  if (v.nativeScripts && v.nativeScripts.length > 0) {
    w.writeSmallUint(1)
    w.writeTagHeader(258)
    w.writeArrayHeader(v.nativeScripts.length)
    for (const s of v.nativeScripts) NativeScripts.write(w, s)
    w.writeArrayBreak()
  }
  // 2: bootstrapWitnesses
  if (v.bootstrapWitnesses && v.bootstrapWitnesses.length > 0) {
    w.writeSmallUint(2)
    w.writeTagHeader(258)
    w.writeArrayHeader(v.bootstrapWitnesses.length)
    for (const bw of v.bootstrapWitnesses) Bootstrap.write(w, bw)
    w.writeArrayBreak()
  }
  // 3: plutusV1Scripts
  if (v.plutusV1Scripts && v.plutusV1Scripts.length > 0) {
    w.writeSmallUint(3)
    w.writeTagHeader(258)
    w.writeArrayHeader(v.plutusV1Scripts.length)
    for (const s of v.plutusV1Scripts) PlutusV1.write(w, s)
    w.writeArrayBreak()
  }
  // 4: plutusData
  if (v.plutusData && v.plutusData.length > 0) {
    w.writeSmallUint(4)
    w.writeTagHeader(258)
    w.writeArrayHeader(v.plutusData.length)
    for (const d of v.plutusData) PlutusData.write(w, d)
    w.writeArrayBreak()
  }
  // 5: redeemers
  if (v.redeemers && v.redeemers.size > 0) {
    w.writeSmallUint(5)
    Redeemers.write(w, v.redeemers)
  }
  // 6: plutusV2Scripts
  if (v.plutusV2Scripts && v.plutusV2Scripts.length > 0) {
    w.writeSmallUint(6)
    w.writeTagHeader(258)
    w.writeArrayHeader(v.plutusV2Scripts.length)
    for (const s of v.plutusV2Scripts) PlutusV2.write(w, s)
    w.writeArrayBreak()
  }
  // 7: plutusV3Scripts
  if (v.plutusV3Scripts && v.plutusV3Scripts.length > 0) {
    w.writeSmallUint(7)
    w.writeTagHeader(258)
    w.writeArrayHeader(v.plutusV3Scripts.length)
    for (const s of v.plutusV3Scripts) PlutusV3.write(w, s)
    w.writeArrayBreak()
  }
  w.writeMapBreak()
}

export const read = (r: CborReader): TransactionWitnessSet => {
  const mapCount = r.readMapHeader()
  const ws: {
    vkeyWitnesses?: Array<VKeyWitness>
    nativeScripts?: Array<NativeScripts.NativeScript>
    bootstrapWitnesses?: Array<Bootstrap.BootstrapWitness>
    plutusV1Scripts?: Array<PlutusV1.PlutusV1>
    plutusData?: Array<PlutusData.Data>
    redeemers?: Redeemers.Redeemers
    plutusV2Scripts?: Array<PlutusV2.PlutusV2>
    plutusV3Scripts?: Array<PlutusV3.PlutusV3>
  } = {}

  const readTaggedArrayLen = (): number => {
    // Accept tag 258 wrapping or plain array
    if (r.peekMajorType() === 6) {
      const tag = r.readTagHeader()
      if (tag !== 258) throw new Error(`TransactionWitnessSet: expected tag 258, got ${tag}`)
    }
    return r.readArrayHeader()
  }

  const readEntry = () => {
    const key = r.readSmallUint()
    switch (key) {
      case 0: {
        const count = readTaggedArrayLen()
        const arr: Array<VKeyWitness> = []
        if (count === -1) { while (!r.isBreak()) arr.push(readVKeyWitness(r)) }
        else { for (let i = 0; i < count; i++) arr.push(readVKeyWitness(r)) }
        ws.vkeyWitnesses = arr
        break
      }
      case 1: {
        const count = readTaggedArrayLen()
        const arr: Array<NativeScripts.NativeScript> = []
        if (count === -1) { while (!r.isBreak()) arr.push(NativeScripts.read(r)) }
        else { for (let i = 0; i < count; i++) arr.push(NativeScripts.read(r)) }
        ws.nativeScripts = arr
        break
      }
      case 2: {
        const count = readTaggedArrayLen()
        const arr: Array<Bootstrap.BootstrapWitness> = []
        if (count === -1) { while (!r.isBreak()) arr.push(Bootstrap.read(r)) }
        else { for (let i = 0; i < count; i++) arr.push(Bootstrap.read(r)) }
        ws.bootstrapWitnesses = arr
        break
      }
      case 3: {
        const count = readTaggedArrayLen()
        const arr: Array<PlutusV1.PlutusV1> = []
        if (count === -1) { while (!r.isBreak()) arr.push(PlutusV1.read(r)) }
        else { for (let i = 0; i < count; i++) arr.push(PlutusV1.read(r)) }
        ws.plutusV1Scripts = arr
        break
      }
      case 4: {
        // PlutusData — extract raw CBOR bytes for each datum and decode via CBOR pipeline
        const count = readTaggedArrayLen()
        const arr: Array<PlutusData.Data> = []
        const readOneDatum = () => {
          const start = r.position()
          r.skip()
          const datumBytes = r.buffer().subarray(start, r.position())
          arr.push(PlutusData.fromCBORBytes(datumBytes))
        }
        if (count === -1) { while (!r.isBreak()) readOneDatum() }
        else { for (let i = 0; i < count; i++) readOneDatum() }
        ws.plutusData = arr
        break
      }
      case 5: {
        ws.redeemers = Redeemers.read(r)
        break
      }
      case 6: {
        const count = readTaggedArrayLen()
        const arr: Array<PlutusV2.PlutusV2> = []
        if (count === -1) { while (!r.isBreak()) arr.push(PlutusV2.read(r)) }
        else { for (let i = 0; i < count; i++) arr.push(PlutusV2.read(r)) }
        ws.plutusV2Scripts = arr
        break
      }
      case 7: {
        const count = readTaggedArrayLen()
        const arr: Array<PlutusV3.PlutusV3> = []
        if (count === -1) { while (!r.isBreak()) arr.push(PlutusV3.read(r)) }
        else { for (let i = 0; i < count; i++) arr.push(PlutusV3.read(r)) }
        ws.plutusV3Scripts = arr
        break
      }
      default: r.skip(); break
    }
  }

  if (mapCount === -1) { while (!r.isBreak()) readEntry() }
  else { for (let i = 0; i < mapCount; i++) readEntry() }

  return new TransactionWitnessSet(ws, { disableValidation: true })
}

export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(TransactionWitnessSet),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "TransactionWitnessSet.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "TransactionWitnessSet.FromCBORHex" })

/**
 * FastCheck arbitrary for generating random TransactionWitnessSet instances.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<TransactionWitnessSet> = FastCheck.record({
  vkeyWitnesses: FastCheck.option(
    FastCheck.array(
      FastCheck.record({
        vkey: VKey.arbitrary,
        signature: Ed25519Signature.arbitrary
      }).map(({ signature, vkey }) => new VKeyWitness({ vkey, signature }))
    )
  ),
  // Generate valid NativeScripts via its own arbitrary
  nativeScripts: FastCheck.option(FastCheck.array(NativeScripts.arbitrary)),
  bootstrapWitnesses: FastCheck.option(FastCheck.array(Bootstrap.arbitrary)),
  plutusV1Scripts: FastCheck.option(
    FastCheck.array(FastCheck.uint8Array({ minLength: 1, maxLength: 1000 })).map((scripts) =>
      scripts.map((bytes) => new PlutusV1.PlutusV1({ bytes }))
    )
  ),
  plutusData: FastCheck.option(FastCheck.array(PlutusData.arbitrary)),
  redeemers: FastCheck.option(
    FastCheck.uniqueArray(
      FastCheck.record({
        data: PlutusData.arbitrary,
        exUnits: FastCheck.tuple(
          FastCheck.bigInt({ min: 0n, max: 10000000n }),
          FastCheck.bigInt({ min: 0n, max: 10000000n })
        ).map(([mem, steps]) => new Redeemer.ExUnits({ mem, steps })),
        index: FastCheck.bigInt({ min: 0n, max: 1000n }),
        tag: FastCheck.constantFrom("spend" as const, "mint" as const, "cert" as const, "reward" as const)
      }).map(({ data, exUnits, index, tag }) => new Redeemer.Redeemer({ tag, index, data, exUnits })),
      {
        minLength: 1,
        maxLength: 5,
        selector: (r) => `${r.tag}:${r.index}`
      }
    ).chain((redeemers) =>
      FastCheck.constantFrom<Redeemers.Redeemers>(
        Redeemers.makeRedeemerMap(redeemers),
        new Redeemers.RedeemerArray({ value: redeemers })
      )
    )
  ),
  plutusV2Scripts: FastCheck.option(
    FastCheck.array(FastCheck.uint8Array({ minLength: 1, maxLength: 1000 })).map((scripts) =>
      scripts.map((bytes) => new PlutusV2.PlutusV2({ bytes }))
    )
  ),
  plutusV3Scripts: FastCheck.option(
    FastCheck.array(FastCheck.uint8Array({ minLength: 1, maxLength: 1000 })).map((scripts) =>
      scripts.map((bytes) => new PlutusV3.PlutusV3({ bytes }))
    )
  )
}).map((witnessSetData) => {
  // Convert null values to undefined for optional fields
  const cleanedData = Object.fromEntries(Object.entries(witnessSetData).filter(([_, value]) => value !== null))
  return TransactionWitnessSet.make(cleanedData)
})

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a TransactionWitnessSet from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse a TransactionWitnessSet from CBOR bytes and return the root format tree.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytesWithFormat = (
  bytes: Uint8Array
): CBOR.DecodedWithFormat<TransactionWitnessSet> => {
  const decoded = CBOR.fromCBORBytesWithFormat(bytes)
  const value = read(new CborReader(bytes))

  return {
    value,
    format: decoded.format
  }
}

/**
 * Parse a TransactionWitnessSet from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Parse a TransactionWitnessSet from CBOR hex string and return the root format tree.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHexWithFormat = (
  hex: string
): CBOR.DecodedWithFormat<TransactionWitnessSet> => {
  const bytes = Bytes.fromHex(hex)
  const decoded = CBOR.fromCBORBytesWithFormat(bytes)
  const value = read(new CborReader(bytes))

  return {
    value,
    format: decoded.format
  }
}

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Convert a TransactionWitnessSet to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: TransactionWitnessSet, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(1024, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Convert a TransactionWitnessSet to CBOR bytes using an explicit root format tree.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytesWithFormat = (
  data: TransactionWitnessSet,
  format: CBOR.CBORFormat,
  profile?: EncodingProfile
): Uint8Array => {
  const plain = toCBORBytes(data, profile)
  return CBOR.toCBORBytesWithFormat(CBOR.fromCBORBytes(plain) as unknown as CBOR.CBOR, format)
}

/**
 * Convert a TransactionWitnessSet to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: TransactionWitnessSet, profile?: EncodingProfile): string => {
  return Bytes.toHex(toCBORBytes(data, profile))
}

/**
 * Convert a TransactionWitnessSet to CBOR hex string using an explicit root format tree.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHexWithFormat = (
  data: TransactionWitnessSet,
  format: CBOR.CBORFormat,
  profile?: EncodingProfile
): string => {
  return Bytes.toHex(toCBORBytesWithFormat(data, format, profile))
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an empty TransactionWitnessSet.
 *
 * @since 2.0.0
 * @category constructors
 */
export const empty = (): TransactionWitnessSet => TransactionWitnessSet.make({})

/**
 * Create a TransactionWitnessSet with only VKey witnesses.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromVKeyWitnesses = (witnesses: Array<VKeyWitness>): TransactionWitnessSet =>
  TransactionWitnessSet.make({ vkeyWitnesses: witnesses })

/**
 * Create a TransactionWitnessSet with only native scripts.
 *
 * @since 2.0.0
 * @category constructors
 */
export const fromNativeScripts = (scripts: Array<NativeScripts.NativeScript>): TransactionWitnessSet =>
  TransactionWitnessSet.make({ nativeScripts: scripts })
