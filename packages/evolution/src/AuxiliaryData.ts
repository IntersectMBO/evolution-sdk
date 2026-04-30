import { blake2b } from "@noble/hashes/blake2"
import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as AuxiliaryDataHash from "./AuxiliaryDataHash.js"
import * as Bytes from "./Bytes.js"
import * as Metadata from "./Metadata.js"
import * as NativeScripts from "./NativeScripts.js"
import * as PlutusV1 from "./PlutusV1.js"
import * as PlutusV2 from "./PlutusV2.js"
import * as PlutusV3 from "./PlutusV3.js"
import * as TransactionMetadatum from "./TransactionMetadatum.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

// ============================================================================
// Helper functions for Equal/Hash implementations
// ============================================================================

/**
 * Compare two optional arrays for equality using Equal.equals on elements
 */
const arrayEquals = <T>(x: ReadonlyArray<T> | undefined, y: ReadonlyArray<T> | undefined): boolean => {
  if (x === undefined && y === undefined) return true
  if (x === undefined || y === undefined) return false
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) {
    if (!Equal.equals(x[i], y[i])) return false
  }
  return true
}

/**
 * Compare two optional metadata Maps for equality
 */
const metadataMapEquals = (x: Metadata.Metadata | undefined, y: Metadata.Metadata | undefined): boolean => {
  if (x === undefined && y === undefined) return true
  if (x === undefined || y === undefined) return false
  if (x.size !== y.size) return false
  for (const [key, value] of x) {
    if (!y.has(key)) return false
    if (!TransactionMetadatum.equals(value, y.get(key)!)) return false
  }
  return true
}

/**
 * Hash an optional metadata Map using only cheap operations.
 * Hashes size and keys (bigints) but NOT values (which may contain Uint8Array).
 * This ensures equal objects have equal hashes without expensive value hashing.
 */
const hashMetadataMap = (m: Metadata.Metadata | undefined): number => {
  if (!m) return Hash.hash(undefined)
  let h = Hash.hash(m.size)
  // Only hash bigint keys (cheap), not TransactionMetadatum values (expensive)
  const sortedKeys = Array.from(m.keys()).sort((a, b) => Number(a - b))
  for (const key of sortedKeys) {
    h = Hash.combine(h)(Hash.hash(key))
  }
  return h
}

/**
 * Hash an optional array by hashing each element
 */
const hashArray = <T>(arr: ReadonlyArray<T> | undefined): number => {
  if (!arr) return Hash.hash(undefined)
  let h = Hash.hash(arr.length)
  for (const item of arr) {
    h = Hash.combine(h)(Hash.hash(item))
  }
  return h
}

// ============================================================================
// AuxiliaryData Classes
// ============================================================================

/**
 * AuxiliaryData based on Conway CDDL specification.
 *
 * CDDL (Conway era):
 * ```
 * auxiliary_data = {
 *   ? 0 => metadata           ; transaction_metadata
 *   ? 1 => [* native_script]  ; native_scripts
 *   ? 2 => [* plutus_v1_script] ; plutus_v1_scripts
 *   ? 3 => [* plutus_v2_script] ; plutus_v2_scripts
 *   ? 4 => [* plutus_v3_script] ; plutus_v3_scripts
 * }
 * ```
 *
 * Uses map format with numeric keys as per Conway specification.
 *
 * @since 2.0.0
 * @category model
 */
export class ConwayAuxiliaryData extends Schema.TaggedClass<ConwayAuxiliaryData>("ConwayAuxiliaryData")(
  "ConwayAuxiliaryData",
  {
    metadata: Schema.optional(Schema.typeSchema(Metadata.Metadata)),
    nativeScripts: Schema.optional(Schema.Array(NativeScripts.NativeScript)),
    plutusV1Scripts: Schema.optional(Schema.Array(PlutusV1.PlutusV1)),
    plutusV2Scripts: Schema.optional(Schema.Array(PlutusV2.PlutusV2)),
    plutusV3Scripts: Schema.optional(Schema.Array(PlutusV3.PlutusV3))
  }
) {
  /**
   * @since 2.0.0
   * @category json
   */
  toJSON() {
    return {
      _tag: "ConwayAuxiliaryData" as const,
      metadata: this.metadata,
      nativeScripts: this.nativeScripts,
      plutusV1Scripts: this.plutusV1Scripts,
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
    if (!(that instanceof ConwayAuxiliaryData)) return false
    return (
      metadataMapEquals(this.metadata, that.metadata) &&
      arrayEquals(this.nativeScripts, that.nativeScripts) &&
      arrayEquals(this.plutusV1Scripts, that.plutusV1Scripts) &&
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
          Hash.combine(Hash.combine(hashMetadataMap(this.metadata))(hashArray(this.nativeScripts)))(
            hashArray(this.plutusV1Scripts)
          )
        )(hashArray(this.plutusV2Scripts))
      )(hashArray(this.plutusV3Scripts))
    )
  }
}

/**
 * AuxiliaryData for ShelleyMA era (array format).
 *
 * CDDL (ShelleyMA era):
 * ```
 * auxiliary_data = [ metadata?, [* native_script]? ]
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class ShelleyMAAuxiliaryData extends Schema.TaggedClass<ShelleyMAAuxiliaryData>("ShelleyMAAuxiliaryData")(
  "ShelleyMAAuxiliaryData",
  {
    metadata: Schema.optional(Schema.typeSchema(Metadata.Metadata)),
    nativeScripts: Schema.optional(Schema.Array(NativeScripts.NativeScript))
  }
) {
  /**
   * @since 2.0.0
   * @category json
   */
  toJSON() {
    return { _tag: "ShelleyMAAuxiliaryData" as const, metadata: this.metadata, nativeScripts: this.nativeScripts }
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
    if (!(that instanceof ShelleyMAAuxiliaryData)) return false
    return metadataMapEquals(this.metadata, that.metadata) && arrayEquals(this.nativeScripts, that.nativeScripts)
  }

  /**
   * @since 2.0.0
   * @category hash
   */
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(hashMetadataMap(this.metadata))(hashArray(this.nativeScripts)))
  }
}

/**
 * AuxiliaryData for Shelley era (direct metadata).
 *
 * CDDL (Shelley era):
 * ```
 * auxiliary_data = metadata
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class ShelleyAuxiliaryData extends Schema.TaggedClass<ShelleyAuxiliaryData>("ShelleyAuxiliaryData")(
  "ShelleyAuxiliaryData",
  {
    metadata: Schema.typeSchema(Metadata.Metadata)
  }
) {
  /**
   * @since 2.0.0
   * @category json
   */
  toJSON() {
    return { _tag: "ShelleyAuxiliaryData" as const, metadata: this.metadata }
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
    if (!(that instanceof ShelleyAuxiliaryData)) return false
    return metadataMapEquals(this.metadata, that.metadata)
  }

  /**
   * @since 2.0.0
   * @category hash
   */
  [Hash.symbol](): number {
    return Hash.cached(this, hashMetadataMap(this.metadata))
  }
}

/**
 * Union of all AuxiliaryData era formats.
 *
 * @since 2.0.0
 * @category model
 */
export const AuxiliaryData = Schema.Union(ConwayAuxiliaryData, ShelleyMAAuxiliaryData, ShelleyAuxiliaryData)

/**
 * Type representing any AuxiliaryData format.
 *
 * @since 2.0.0
 * @category model
 */
export type AuxiliaryData = Schema.Schema.Type<typeof AuxiliaryData>

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

// Inline metadata write/read: { * uint => transaction_metadatum }
const writeMetadatum = (w: CborWriter, v: TransactionMetadatum.TransactionMetadatum): void => {
  TransactionMetadatum.write(w, v)
}

const readMetadatum = (r: CborReader): TransactionMetadatum.TransactionMetadatum => {
  const mt = r.peekMajorType()
  switch (mt) {
    case 0: return r.readUint()
    case 1: return r.readNint()
    case 2: return r.readBytes()
    case 3: return r.readText()
    case 4: {
      const count = r.readArrayHeader()
      const arr: Array<TransactionMetadatum.TransactionMetadatum> = []
      if (count === -1) {
        while (!r.isBreak()) arr.push(readMetadatum(r))
      } else {
        for (let i = 0; i < count; i++) arr.push(readMetadatum(r))
      }
      return arr
    }
    case 5: {
      const count = r.readMapHeader()
      const map = new Map<TransactionMetadatum.TransactionMetadatum, TransactionMetadatum.TransactionMetadatum>()
      if (count === -1) {
        while (!r.isBreak()) {
          const k = readMetadatum(r)
          const v2 = readMetadatum(r)
          map.set(k, v2)
        }
      } else {
        for (let i = 0; i < count; i++) {
          const k = readMetadatum(r)
          const v2 = readMetadatum(r)
          map.set(k, v2)
        }
      }
      return map
    }
    default: throw new Error(`readMetadatum: unexpected major type ${mt}`)
  }
}

const writeMetadata = (w: CborWriter, m: Metadata.Metadata): void => {
  w.writeMapHeader(m.size)
  for (const [label, value] of m) {
    w.writeUint(label)
    writeMetadatum(w, value)
  }
  w.writeMapBreak()
}

const readMetadata = (r: CborReader): Metadata.Metadata => {
  const count = r.readMapHeader()
  const map = new Map<Metadata.MetadataLabel, TransactionMetadatum.TransactionMetadatum>()
  const readEntry = () => {
    const label = r.readUint() as Metadata.MetadataLabel
    const value = readMetadatum(r)
    map.set(label, value)
  }
  if (count === -1) {
    while (!r.isBreak()) readEntry()
  } else {
    for (let i = 0; i < count; i++) readEntry()
  }
  return map as Metadata.Metadata
}

export const write = (w: CborWriter, v: AuxiliaryData): void => {
  switch (v._tag) {
    case "ConwayAuxiliaryData": {
      w.writeTagHeader(259)
      let count = 0
      if (v.metadata !== undefined) count++
      if (v.nativeScripts !== undefined) count++
      if (v.plutusV1Scripts !== undefined) count++
      if (v.plutusV2Scripts !== undefined) count++
      if (v.plutusV3Scripts !== undefined) count++
      w.writeMapHeader(count)
      if (v.metadata !== undefined) {
        w.writeSmallUint(0)
        writeMetadata(w, v.metadata)
      }
      if (v.nativeScripts !== undefined) {
        w.writeSmallUint(1)
        w.writeArrayHeader(v.nativeScripts.length)
        for (const s of v.nativeScripts) NativeScripts.write(w, s)
        w.writeArrayBreak()
      }
      if (v.plutusV1Scripts !== undefined) {
        w.writeSmallUint(2)
        w.writeArrayHeader(v.plutusV1Scripts.length)
        for (const s of v.plutusV1Scripts) PlutusV1.write(w, s)
        w.writeArrayBreak()
      }
      if (v.plutusV2Scripts !== undefined) {
        w.writeSmallUint(3)
        w.writeArrayHeader(v.plutusV2Scripts.length)
        for (const s of v.plutusV2Scripts) PlutusV2.write(w, s)
        w.writeArrayBreak()
      }
      if (v.plutusV3Scripts !== undefined) {
        w.writeSmallUint(4)
        w.writeArrayHeader(v.plutusV3Scripts.length)
        for (const s of v.plutusV3Scripts) PlutusV3.write(w, s)
        w.writeArrayBreak()
      }
      w.writeMapBreak()
      break
    }
    case "ShelleyMAAuxiliaryData": {
      w.writeArrayHeader(2)
      if (v.metadata !== undefined) {
        writeMetadata(w, v.metadata)
      } else {
        w.writeMapHeader(0)
        w.writeMapBreak()
      }
      if (v.nativeScripts !== undefined && v.nativeScripts.length > 0) {
        w.writeArrayHeader(v.nativeScripts.length)
        for (const s of v.nativeScripts) NativeScripts.write(w, s)
        w.writeArrayBreak()
      } else {
        w.writeArrayHeader(0)
        w.writeArrayBreak()
      }
      w.writeArrayBreak()
      break
    }
    case "ShelleyAuxiliaryData": {
      writeMetadata(w, v.metadata)
      break
    }
  }
}

export const read = (r: CborReader): AuxiliaryData => {
  const mt = r.peekMajorType()

  // Conway: tag(259, map)
  if (mt === 6) {
    const tag = r.readTagHeader()
    if (tag !== 259) throw new Error(`AuxiliaryData: expected tag 259, got ${tag}`)
    const mapCount = r.readMapHeader()
    let metadata: Metadata.Metadata | undefined
    let nativeScripts: Array<NativeScripts.NativeScript> | undefined
    let plutusV1Scripts: Array<PlutusV1.PlutusV1> | undefined
    let plutusV2Scripts: Array<PlutusV2.PlutusV2> | undefined
    let plutusV3Scripts: Array<PlutusV3.PlutusV3> | undefined
    const readEntry = () => {
      const key = Number(r.readUint())
      switch (key) {
        case 0: metadata = readMetadata(r); break
        case 1: {
          const count = r.readArrayHeader()
          nativeScripts = []
          if (count === -1) {
            while (!r.isBreak()) nativeScripts.push(NativeScripts.read(r))
          } else {
            for (let i = 0; i < count; i++) nativeScripts.push(NativeScripts.read(r))
          }
          break
        }
        case 2: {
          const count = r.readArrayHeader()
          plutusV1Scripts = []
          if (count === -1) {
            while (!r.isBreak()) plutusV1Scripts.push(PlutusV1.read(r))
          } else {
            for (let i = 0; i < count; i++) plutusV1Scripts.push(PlutusV1.read(r))
          }
          break
        }
        case 3: {
          const count = r.readArrayHeader()
          plutusV2Scripts = []
          if (count === -1) {
            while (!r.isBreak()) plutusV2Scripts.push(PlutusV2.read(r))
          } else {
            for (let i = 0; i < count; i++) plutusV2Scripts.push(PlutusV2.read(r))
          }
          break
        }
        case 4: {
          const count = r.readArrayHeader()
          plutusV3Scripts = []
          if (count === -1) {
            while (!r.isBreak()) plutusV3Scripts.push(PlutusV3.read(r))
          } else {
            for (let i = 0; i < count; i++) plutusV3Scripts.push(PlutusV3.read(r))
          }
          break
        }
        default: r.skip(); break
      }
    }
    if (mapCount === -1) {
      while (!r.isBreak()) readEntry()
    } else {
      for (let i = 0; i < mapCount; i++) readEntry()
    }
    return new ConwayAuxiliaryData({ metadata, nativeScripts, plutusV1Scripts, plutusV2Scripts, plutusV3Scripts })
  }

  // ShelleyMA: array [metadata, [native_scripts]]
  if (mt === 4) {
    const count = r.readArrayHeader()
    let metadata: Metadata.Metadata | undefined
    if (count === -1 || count >= 1) {
      const innerMt = r.peekMajorType()
      if (innerMt === 5) {
        const m = readMetadata(r)
        metadata = m.size > 0 ? m : undefined
      } else {
        r.skip()
      }
    }
    let nativeScripts: Array<NativeScripts.NativeScript> | undefined
    if (count === -1) {
      if (!r.isBreak()) {
        const nsCount = r.readArrayHeader()
        if (nsCount !== 0) {
          nativeScripts = []
          if (nsCount === -1) {
            while (!r.isBreak()) nativeScripts.push(NativeScripts.read(r))
          } else {
            for (let i = 0; i < nsCount; i++) nativeScripts.push(NativeScripts.read(r))
          }
        } else {
          // empty array
        }
        r.isBreak() // consume outer break
      }
    } else if (count >= 2) {
      const nsCount = r.readArrayHeader()
      if (nsCount !== 0) {
        nativeScripts = []
        if (nsCount === -1) {
          while (!r.isBreak()) nativeScripts.push(NativeScripts.read(r))
        } else {
          for (let i = 0; i < nsCount; i++) nativeScripts.push(NativeScripts.read(r))
        }
      }
    }
    return new ShelleyMAAuxiliaryData({ metadata, nativeScripts })
  }

  // Shelley: metadata map directly
  if (mt === 5) {
    const metadata = readMetadata(r)
    return new ShelleyAuxiliaryData({ metadata })
  }

  throw new Error(`AuxiliaryData: expected tag (6), array (4), or map (5), got major type ${mt}`)
}

/**
 * Tagged CDDL schema for AuxiliaryData (#6.259 wrapping the struct).
 *
 * @since 2.0.0
 * @category schemas
 */

/**
 * CBOR bytes transformation schema for AuxiliaryData.
 * Transforms between CBOR bytes and AuxiliaryData using CDDL format.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(AuxiliaryData),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "AuxiliaryData.FromCBORBytes" })

/**
 * CBOR hex transformation schema for AuxiliaryData.
 * Transforms between CBOR hex string and AuxiliaryData using CDDL format.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "AuxiliaryData.FromCBORHex" })

/**
 * Create an empty Conway AuxiliaryData instance.
 *
 * @since 2.0.0
 * @category constructors
 */
export const emptyConwayAuxiliaryData = (): AuxiliaryData => new ConwayAuxiliaryData({})

/**
 * Backwards-friendly helper returning empty Conway-format auxiliary data.
 * Alias kept for ergonomics and CML-compat tests.
 */
export const empty = (): AuxiliaryData => new ConwayAuxiliaryData({})

/**
 * Create a Conway-era AuxiliaryData instance.
 *
 * @since 2.0.0
 * @category constructors
 */
export const conway = (input: {
  metadata?: Metadata.Metadata
  nativeScripts?: Array<NativeScripts.NativeScript>
  plutusV1Scripts?: Array<PlutusV1.PlutusV1>
  plutusV2Scripts?: Array<PlutusV2.PlutusV2>
  plutusV3Scripts?: Array<PlutusV3.PlutusV3>
}): AuxiliaryData => new ConwayAuxiliaryData({ ...input })

/**
 * Create a ShelleyMA-era AuxiliaryData instance.
 *
 * @since 2.0.0
 * @category constructors
 */
export const shelleyMA = (input: {
  metadata?: Metadata.Metadata
  nativeScripts?: Array<NativeScripts.NativeScript>
}): AuxiliaryData => new ShelleyMAAuxiliaryData({ ...input })

/**
 * Create a Shelley-era AuxiliaryData instance.
 *
 * @since 2.0.0
 * @category constructors
 */
export const shelley = (input: { metadata: Metadata.Metadata }): AuxiliaryData =>
  new ShelleyAuxiliaryData({ metadata: input.metadata })

/**
 * FastCheck arbitrary for generating Conway-era AuxiliaryData instances.
 * Conway era supports all features: metadata, native scripts, and all Plutus script versions.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const conwayArbitrary: FastCheck.Arbitrary<ConwayAuxiliaryData> = FastCheck.record({
  metadata: FastCheck.option(Metadata.arbitrary, { nil: undefined }),
  nativeScripts: FastCheck.option(FastCheck.array(NativeScripts.arbitrary, { maxLength: 3 }), { nil: undefined }),
  plutusV1Scripts: FastCheck.option(FastCheck.array(PlutusV1.arbitrary, { maxLength: 3 }), { nil: undefined }),
  plutusV2Scripts: FastCheck.option(FastCheck.array(PlutusV2.arbitrary, { maxLength: 3 }), { nil: undefined }),
  plutusV3Scripts: FastCheck.option(FastCheck.array(PlutusV3.arbitrary, { maxLength: 3 }), { nil: undefined })
}).map((r) => new ConwayAuxiliaryData(r))

export const shelleyMAArbitrary: FastCheck.Arbitrary<ShelleyMAAuxiliaryData> = FastCheck.record({
  metadata: FastCheck.option(Metadata.arbitrary, { nil: undefined }),
  nativeScripts: FastCheck.option(FastCheck.array(NativeScripts.arbitrary, { maxLength: 3 }), { nil: undefined })
})
  .filter((r) => {
    const hasMeta = r.metadata !== undefined
    // Disallow both undefined and scripts-only (since encoder omits scripts without metadata)
    return hasMeta
  })
  .map(
    (r) =>
      new ShelleyMAAuxiliaryData({
        metadata: r.metadata && r.metadata.size > 0 ? r.metadata : undefined,
        nativeScripts: r.nativeScripts && r.nativeScripts.length > 0 ? r.nativeScripts : undefined
      })
  )

export const shelleyArbitrary: FastCheck.Arbitrary<ShelleyAuxiliaryData> = Metadata.arbitrary.map(
  (metadata) => new ShelleyAuxiliaryData({ metadata })
)

/**
 * FastCheck arbitrary for generating random AuxiliaryData instances.
 * Generates all three era formats with equal probability.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary: FastCheck.Arbitrary<AuxiliaryData> = FastCheck.oneof(
  conwayArbitrary,
  shelleyMAArbitrary,
  shelleyArbitrary
)

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Decode AuxiliaryData from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Decode AuxiliaryData from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode AuxiliaryData to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: AuxiliaryData, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(256, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Encode AuxiliaryData to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: AuxiliaryData, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))

/**
 * Compute hash of auxiliary data (tag 259) per ledger rules.
 *
 * @since 2.0.0
 * @category hashing
 */
export const toHash = (aux: AuxiliaryData): AuxiliaryDataHash.AuxiliaryDataHash => {
  const bytes = toCBORBytes(aux)
  const digest = blake2b(bytes, { dkLen: 32 })
  return new AuxiliaryDataHash.AuxiliaryDataHash({ hash: digest })
}
