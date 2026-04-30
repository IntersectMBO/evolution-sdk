import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as CBOR from "./CBOR.js"
import * as PlutusData from "./Data.js"
import * as Numeric from "./Numeric.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Redeemer tag enum for different script execution contexts.
 *
 * CDDL: redeemer_tag = 0 ; spend | 1 ; mint | 2 ; cert | 3 ; reward | 4 ; vote | 5 ; propose
 *
 * @since 2.0.0
 * @category model
 */
export const RedeemerTag = Schema.Literal("spend", "mint", "cert", "reward", "vote", "propose").annotations({
  identifier: "Redeemer.Tag",
  title: "Redeemer Tag",
  description: "Tag indicating the context where the redeemer is used"
})

export type RedeemerTag = typeof RedeemerTag.Type

/**
 * Execution units for Plutus script execution.
 *
 * CDDL: ex_units = [mem: uint64, steps: uint64]
 *
 * @since 2.0.0
 * @category model
 */
export class ExUnits extends Schema.Class<ExUnits>("Redeemer.ExUnits")({
  mem: Numeric.Uint64Schema.annotations({
    identifier: "Redeemer.ExUnits.Memory",
    title: "Memory Units",
    description: "Memory units consumed by script execution"
  }),
  steps: Numeric.Uint64Schema.annotations({
    identifier: "Redeemer.ExUnits.Steps",
    title: "CPU Steps",
    description: "CPU steps consumed by script execution"
  })
}) {
  toJSON() {
    return {
      mem: this.mem.toString(),
      steps: this.steps.toString()
    }
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof ExUnits && Equal.equals(this.mem, that.mem) && Equal.equals(this.steps, that.steps)
  }

  [Hash.symbol](): number {
    // Only hash mem for performance
    return Hash.cached(this, Hash.hash(this.mem))
  }
}

/**
 * Redeemer for Plutus script execution based on Conway CDDL specification.
 *
 * CDDL: redeemer = [ tag, index, data, ex_units ]
 * Where:
 * - tag: redeemer_tag (0=spend, 1=mint, 2=cert, 3=reward)
 * - index: uint64 (index into the respective input/output/certificate/reward array)
 * - data: plutus_data (the actual redeemer data passed to the script)
 * - ex_units: [mem: uint64, steps: uint64] (execution unit limits)
 *
 * @since 2.0.0
 * @category model
 */
export class Redeemer extends Schema.Class<Redeemer>("Redeemer")({
  tag: RedeemerTag,
  index: Numeric.Uint64Schema.annotations({
    identifier: "Redeemer.Index",
    title: "Redeemer Index",
    description: "Index into the respective transaction array (inputs, outputs, certificates, or rewards)"
  }),
  data: PlutusData.DataSchema.annotations({
    identifier: "Redeemer.Data",
    title: "Redeemer Data",
    description: "PlutusData passed to the script for validation"
  }),
  exUnits: ExUnits
}) {
  /**
   * Convert to JSON representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toJSON() {
    return {
      _tag: "Redeemer",
      tag: this.tag,
      index: this.index.toString(),
      data: this.data,
      exUnits: this.exUnits.toJSON()
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
      that instanceof Redeemer &&
      this.tag === that.tag &&
      this.index === that.index &&
      PlutusData.equals(this.data, that.data) &&
      Equal.equals(this.exUnits, that.exUnits)
    )
  }

  /**
   * Hash code generation.
   * Only hashes tag and index for performance (minimal structure).
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    return Hash.cached(this, Hash.combine(Hash.string(this.tag))(Hash.hash(this.index)))
  }
}

/**
 * Helper function to convert RedeemerTag string to CBOR integer.
 *
 * @since 2.0.0
 * @category utilities
 */
export const tagToInteger = (tag: RedeemerTag): bigint => {
  switch (tag) {
    case "spend":
      return 0n
    case "mint":
      return 1n
    case "cert":
      return 2n
    case "reward":
      return 3n
    case "vote":
      return 4n
    case "propose":
      return 5n
  }
}

/**
 * Helper function to convert CBOR integer to RedeemerTag string.
 *
 * @since 2.0.0
 * @category utilities
 */
export const integerToTag = (value: bigint): RedeemerTag => {
  switch (value) {
    case 0n:
      return "spend"
    case 1n:
      return "mint"
    case 2n:
      return "cert"
    case 3n:
      return "reward"
    case 4n:
      return "vote"
    case 5n:
      return "propose"
    default:
      throw new Error(
        `Invalid redeemer tag: ${value}. Must be 0 (spend), 1 (mint), 2 (cert), 3 (reward), 4 (vote), or 5 (propose)`
      )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const writeExUnits = (w: CborWriter, v: ExUnits): void => {
  w.writeArrayHeader(2)
  w.writeUint(v.mem)
  w.writeUint(v.steps)
  w.writeArrayBreak()
}

export const readExUnits = (r: CborReader): ExUnits => {
  const count = r.readArrayHeader()
  const mem = r.readUint()
  const steps = r.readUint()
  if (count === -1) r.isBreak()
  return new ExUnits({ mem, steps })
}

export const write = (w: CborWriter, v: Redeemer): void => {
  w.writeArrayHeader(4)
  w.writeSmallUint(Number(tagToInteger(v.tag)))
  w.writeUint(v.index)
  PlutusData.write(w, v.data, CBOR.CML_DEFAULT_OPTIONS)
  writeExUnits(w, v.exUnits)
  w.writeArrayBreak()
}

export const read = (r: CborReader): Redeemer => {
  const count = r.readArrayHeader()
  const tagInt = BigInt(r.readSmallUint())
  const tag = integerToTag(tagInt)
  const index = r.readUint()
  const data = PlutusData.read(r)
  const exUnits = readExUnits(r)
  if (count === -1) r.isBreak()
  return new Redeemer({ tag, index, data, exUnits })
}

/**
 * CBOR bytes transformation schema for Redeemer using CDDL.
 * Transforms between CBOR bytes and Redeemer using CDDL encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Redeemer),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Redeemer.FromCBORBytes" })

/**
 * CBOR hex transformation schema for Redeemer using CDDL.
 * Transforms between CBOR hex string and Redeemer using CDDL encoding.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Redeemer.FromCBORHex" })

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a spend redeemer for spending UTxO inputs.
 *
 * @since 2.0.0
 * @category constructors
 */
export const spend = (index: bigint, data: PlutusData.Data, exUnits: ExUnits): Redeemer =>
  new Redeemer({ tag: "spend", index, data, exUnits })

/**
 * Create a mint redeemer for minting/burning tokens.
 *
 * @since 2.0.0
 * @category constructors
 */
export const mint = (index: bigint, data: PlutusData.Data, exUnits: ExUnits): Redeemer =>
  new Redeemer({ tag: "mint", index, data, exUnits })

/**
 * Create a cert redeemer for certificate validation.
 *
 * @since 2.0.0
 * @category constructors
 */
export const cert = (index: bigint, data: PlutusData.Data, exUnits: ExUnits): Redeemer =>
  new Redeemer({ tag: "cert", index, data, exUnits })

/**
 * Create a reward redeemer for withdrawal validation.
 *
 * @since 2.0.0
 * @category constructors
 */
export const reward = (index: bigint, data: PlutusData.Data, exUnits: ExUnits): Redeemer =>
  new Redeemer({ tag: "reward", index, data, exUnits })

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if a redeemer is for spending inputs.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isSpend = (redeemer: Redeemer): boolean => redeemer.tag === "spend"

/**
 * Check if a redeemer is for minting/burning.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isMint = (redeemer: Redeemer): boolean => redeemer.tag === "mint"

/**
 * Check if a redeemer is for certificates.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isCert = (redeemer: Redeemer): boolean => redeemer.tag === "cert"

/**
 * Check if a redeemer is for withdrawals.
 *
 * @since 2.0.0
 * @category predicates
 */
export const isReward = (redeemer: Redeemer): boolean => redeemer.tag === "reward"

// ============================================================================
// Transformations
// ============================================================================

/**
 * Encode Redeemer to CBOR bytes.
 *
 * @since 2.0.0
 * @category transformation
 */
export const toCBORBytes = (redeemer: Redeemer, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(256, profile)
  write(w, redeemer)
  return w.finishView()
}

/**
 * Encode Redeemer to CBOR hex string.
 *
 * @since 2.0.0
 * @category transformation
 */
export const toCBORHex = (redeemer: Redeemer, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(redeemer, profile))

/**
 * Decode Redeemer from CBOR bytes.
 *
 * @since 2.0.0
 * @category transformation
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Decode Redeemer from CBOR hex string.
 *
 * @since 2.0.0
 * @category transformation
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

// ============================================================================
// Generators
// ============================================================================

/**
 * FastCheck arbitrary for generating random RedeemerTag values.
 *
 * @since 2.0.0
 * @category generators
 */
export const arbitraryRedeemerTag: FastCheck.Arbitrary<RedeemerTag> = FastCheck.constantFrom(
  "spend",
  "mint",
  "cert",
  "reward"
)

/**
 * FastCheck arbitrary for generating random ExUnits values.
 *
 * @since 2.0.0
 * @category generators
 */
export const arbitraryExUnits: FastCheck.Arbitrary<ExUnits> = FastCheck.tuple(
  FastCheck.bigInt({ min: 0n, max: 10_000_000n }), // memory
  FastCheck.bigInt({ min: 0n, max: 10_000_000n }) // steps
).map(([mem, steps]) => new ExUnits({ mem, steps }))

/**
 * FastCheck arbitrary for generating random Redeemer instances.
 *
 * @since 2.0.0
 * @category generators
 */
/**
 * Compute total ex_units by summing over redeemers.
 *
 * @since 2.0.0
 * @category utilities
 */
export const totalExUnits = (redeemers: ReadonlyArray<Redeemer>): ExUnits => {
  let mem = 0n
  let steps = 0n
  for (const r of redeemers) {
    mem += r.exUnits.mem
    steps += r.exUnits.steps
  }
  return new ExUnits({ mem, steps })
}

export const arbitrary: FastCheck.Arbitrary<Redeemer> = FastCheck.record({
  index: FastCheck.bigInt({ min: 0n, max: 1000n }),
  tag: arbitraryRedeemerTag,
  data: PlutusData.arbitrary,
  exUnits: arbitraryExUnits
}).map(({ data, exUnits, index, tag }) => new Redeemer({ tag, index, data, exUnits }))
