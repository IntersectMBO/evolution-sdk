import { Data, Equal, FastCheck, Hash, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Hash28 from "./Hash28.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Error class for Native script related operations.
 *
 * @since 2.0.0
 * @category errors
 */
export class NativeScriptError extends Data.TaggedError("NativeScriptError")<{
  message?: string
  cause?: unknown
}> {}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Native script encoded type definition (wire format)
 *
 * @since 2.0.0
 * @category model
 */
export type NativeScriptEncoded =
  | { readonly _tag: "ScriptPubKey"; readonly keyHash: string }
  | { readonly _tag: "InvalidBefore"; readonly slot: string }
  | { readonly _tag: "InvalidHereafter"; readonly slot: string }
  | { readonly _tag: "ScriptAll"; readonly scripts: ReadonlyArray<NativeScriptEncoded> }
  | { readonly _tag: "ScriptAny"; readonly scripts: ReadonlyArray<NativeScriptEncoded> }
  | { readonly _tag: "ScriptNOfK"; readonly required: string; readonly scripts: ReadonlyArray<NativeScriptEncoded> }

/**
 * Native script type definition (runtime representation)
 *
 * @since 2.0.0
 * @category model
 */
export type NativeScriptVariants =
  | { readonly _tag: "ScriptPubKey"; readonly keyHash: Uint8Array }
  | { readonly _tag: "InvalidBefore"; readonly slot: bigint }
  | { readonly _tag: "InvalidHereafter"; readonly slot: bigint }
  | { readonly _tag: "ScriptAll"; readonly scripts: ReadonlyArray<NativeScriptVariants> }
  | { readonly _tag: "ScriptAny"; readonly scripts: ReadonlyArray<NativeScriptVariants> }
  | { readonly _tag: "ScriptNOfK"; readonly required: bigint; readonly scripts: ReadonlyArray<NativeScriptVariants> }

// ============================================================================
// Schema Definition
// ============================================================================

/**
 * Helper function to recursively compare NativeScriptVariants
 */
const equalsVariant = (a: NativeScriptVariants, b: NativeScriptVariants): boolean => {
  if (a._tag !== b._tag) return false

  switch (a._tag) {
    case "ScriptPubKey": {
      const bScript = b as { readonly _tag: "ScriptPubKey"; readonly keyHash: Uint8Array }
      return Bytes.equals(a.keyHash, bScript.keyHash)
    }
    case "InvalidBefore": {
      const bScript = b as { readonly _tag: "InvalidBefore"; readonly slot: bigint }
      return a.slot === bScript.slot
    }
    case "InvalidHereafter": {
      const bScript = b as { readonly _tag: "InvalidHereafter"; readonly slot: bigint }
      return a.slot === bScript.slot
    }
    case "ScriptAll": {
      const bScript = b as { readonly _tag: "ScriptAll"; readonly scripts: ReadonlyArray<NativeScriptVariants> }
      if (a.scripts.length !== bScript.scripts.length) return false
      for (let i = 0; i < a.scripts.length; i++) {
        if (!equalsVariant(a.scripts[i]!, bScript.scripts[i]!)) return false
      }
      return true
    }
    case "ScriptAny": {
      const bScript = b as { readonly _tag: "ScriptAny"; readonly scripts: ReadonlyArray<NativeScriptVariants> }
      if (a.scripts.length !== bScript.scripts.length) return false
      for (let i = 0; i < a.scripts.length; i++) {
        if (!equalsVariant(a.scripts[i]!, bScript.scripts[i]!)) return false
      }
      return true
    }
    case "ScriptNOfK": {
      const bScript = b as {
        readonly _tag: "ScriptNOfK"
        readonly required: bigint
        readonly scripts: ReadonlyArray<NativeScriptVariants>
      }
      if (a.required !== bScript.required) return false
      if (a.scripts.length !== bScript.scripts.length) return false
      for (let i = 0; i < a.scripts.length; i++) {
        if (!equalsVariant(a.scripts[i]!, bScript.scripts[i]!)) return false
      }
      return true
    }
  }
}

/**
 * Internal Union schema for the actual native script variants
 *
 * @since 2.0.0
 * @category schemas
 */
export const NativeScriptVariants: Schema.Schema<NativeScriptVariants, NativeScriptEncoded> = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("ScriptPubKey"),
    keyHash: Hash28.BytesFromHex
  }),
  Schema.Struct({
    _tag: Schema.Literal("InvalidBefore"),
    slot: Schema.BigInt
  }),
  Schema.Struct({
    _tag: Schema.Literal("InvalidHereafter"),
    slot: Schema.BigInt
  }),
  Schema.Struct({
    _tag: Schema.Literal("ScriptAll"),
    scripts: Schema.Array(
      Schema.suspend((): Schema.Schema<NativeScriptVariants, NativeScriptEncoded> => NativeScriptVariants)
    )
  }),
  Schema.Struct({
    _tag: Schema.Literal("ScriptAny"),
    scripts: Schema.Array(
      Schema.suspend((): Schema.Schema<NativeScriptVariants, NativeScriptEncoded> => NativeScriptVariants)
    )
  }),
  Schema.Struct({
    _tag: Schema.Literal("ScriptNOfK"),
    required: Schema.BigInt,
    scripts: Schema.Array(
      Schema.suspend((): Schema.Schema<NativeScriptVariants, NativeScriptEncoded> => NativeScriptVariants)
    )
  })
)

/**
 * TaggedClass schema for native scripts containing the Union
 *
 * @since 2.0.0
 * @category schemas
 */
export class NativeScript extends Schema.TaggedClass<NativeScript>("NativeScript")(
  "NativeScript",
  {
    script: NativeScriptVariants
  },
  {
    identifier: "NativeScript",
    title: "Native Script",
    description: "A native script following Cardano specifications"
  }
) {
  [Equal.symbol](that: unknown): boolean {
    return that instanceof NativeScript && equalsVariant(this.script, that.script)
  }

  [Hash.symbol](): number {
    return Hash.hash(JSON.stringify(toJSON(this.script)))
  }
}

// ============================================================================
// Smart Constructors
// ============================================================================

/**
 * Create a signature script for a specific key hash
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeScriptPubKey = (keyHash: Uint8Array) =>
  new NativeScript({
    script: {
      _tag: "ScriptPubKey",
      keyHash
    }
  })

/**
 * Create a time-based script that is invalid before a slot
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeInvalidBefore = (slot: bigint) =>
  new NativeScript({
    script: {
      _tag: "InvalidBefore",
      slot
    }
  })

/**
 * Create a time-based script that is invalid after a slot
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeInvalidHereafter = (slot: bigint) =>
  new NativeScript({
    script: {
      _tag: "InvalidHereafter",
      slot
    }
  })

/**
 * Create a script that requires all nested scripts
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeScriptAll = (scripts: ReadonlyArray<NativeScriptVariants>) =>
  new NativeScript({
    script: {
      _tag: "ScriptAll",
      scripts
    }
  })

/**
 * Create a script that requires any one nested script
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeScriptAny = (scripts: ReadonlyArray<NativeScriptVariants>) =>
  new NativeScript({
    script: {
      _tag: "ScriptAny",
      scripts
    }
  })

/**
 * Create a script that requires at least N nested scripts
 *
 * @since 2.0.0
 * @category constructors
 */
export const makeScriptNOfK = (required: bigint, scripts: ReadonlyArray<NativeScriptVariants>) =>
  new NativeScript({
    script: {
      _tag: "ScriptNOfK",
      required,
      scripts
    }
  })

// ============================================================================
// JSON Conversion Utilities
// ============================================================================

/**
 * Convert a NativeScript to JSON representation matching cardano-cli format
 *
 * @since 2.0.0
 * @category conversion
 */
export const toJSON = (script: NativeScriptVariants): any => {
  switch (script._tag) {
    case "ScriptPubKey":
      return {
        type: "sig" as const,
        keyHash: Bytes.toHex(script.keyHash)
      }
    case "InvalidBefore":
      return {
        type: "after" as const,
        slot: Number(script.slot)
      }
    case "InvalidHereafter":
      return {
        type: "before" as const,
        slot: Number(script.slot)
      }
    case "ScriptAll":
      return {
        type: "all" as const,
        scripts: script.scripts.map(toJSON)
      }
    case "ScriptAny":
      return {
        type: "any" as const,
        scripts: script.scripts.map(toJSON)
      }
    case "ScriptNOfK":
      return {
        type: "atLeast" as const,
        required: Number(script.required),
        scripts: script.scripts.map(toJSON)
      }
  }
}


// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

const writeVariant = (w: CborWriter, script: NativeScriptVariants): void => {
  switch (script._tag) {
    case "ScriptPubKey":
      w.writeArrayHeader(2)
      w.writeUint(0n)
      w.writeBytes(script.keyHash)
      w.writeArrayBreak()
      break
    case "ScriptAll":
      w.writeArrayHeader(2)
      w.writeUint(1n)
      w.writeArrayHeader(script.scripts.length)
      for (const s of script.scripts) writeVariant(w, s)
      w.writeArrayBreak()
      w.writeArrayBreak()
      break
    case "ScriptAny":
      w.writeArrayHeader(2)
      w.writeUint(2n)
      w.writeArrayHeader(script.scripts.length)
      for (const s of script.scripts) writeVariant(w, s)
      w.writeArrayBreak()
      w.writeArrayBreak()
      break
    case "ScriptNOfK":
      w.writeArrayHeader(3)
      w.writeUint(3n)
      w.writeUint(script.required)
      w.writeArrayHeader(script.scripts.length)
      for (const s of script.scripts) writeVariant(w, s)
      w.writeArrayBreak()
      w.writeArrayBreak()
      break
    case "InvalidBefore":
      w.writeArrayHeader(2)
      w.writeUint(4n)
      w.writeUint(script.slot)
      w.writeArrayBreak()
      break
    case "InvalidHereafter":
      w.writeArrayHeader(2)
      w.writeUint(5n)
      w.writeUint(script.slot)
      w.writeArrayBreak()
      break
  }
}

const readVariant = (r: CborReader): NativeScriptVariants => {
  const count = r.readArrayHeader()
  const tag = r.readUint()
  let result: NativeScriptVariants
  switch (tag) {
    case 0n: {
      const keyHash = r.readBytes()
      result = { _tag: "ScriptPubKey", keyHash }
      break
    }
    case 1n: {
      const scriptCount = r.readArrayHeader()
      const scripts: Array<NativeScriptVariants> = []
      if (scriptCount === -1) {
        while (!r.isBreak()) scripts.push(readVariant(r))
      } else {
        for (let i = 0; i < scriptCount; i++) scripts.push(readVariant(r))
      }
      result = { _tag: "ScriptAll", scripts }
      break
    }
    case 2n: {
      const scriptCount = r.readArrayHeader()
      const scripts: Array<NativeScriptVariants> = []
      if (scriptCount === -1) {
        while (!r.isBreak()) scripts.push(readVariant(r))
      } else {
        for (let i = 0; i < scriptCount; i++) scripts.push(readVariant(r))
      }
      result = { _tag: "ScriptAny", scripts }
      break
    }
    case 3n: {
      const required = r.readUint()
      const scriptCount = r.readArrayHeader()
      const scripts: Array<NativeScriptVariants> = []
      if (scriptCount === -1) {
        while (!r.isBreak()) scripts.push(readVariant(r))
      } else {
        for (let i = 0; i < scriptCount; i++) scripts.push(readVariant(r))
      }
      result = { _tag: "ScriptNOfK", required, scripts }
      break
    }
    case 4n: {
      const slot = r.readUint()
      result = { _tag: "InvalidBefore", slot }
      break
    }
    case 5n: {
      const slot = r.readUint()
      result = { _tag: "InvalidHereafter", slot }
      break
    }
    default:
      throw new NativeScriptError({ message: `Unknown native script tag: ${tag}` })
  }
  if (count === -1) r.isBreak()
  return result
}

export const write = (w: CborWriter, v: NativeScript): void => writeVariant(w, v.script)

export const read = (r: CborReader): NativeScript => new NativeScript({ script: readVariant(r) })

export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(NativeScript),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "NativeScript.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "NativeScript.FromCBORHex" })

/**
 * Check if the given value is a valid NativeScript
 *
 * @since 2.0.0
 * @category predicates
 */
export const is = Schema.is(NativeScriptVariants)

/**
 * FastCheck arbitrary for generating random NativeScript instances
 *
 * @since 2.0.0
 * @category testing
 */
export const arbitrary: FastCheck.Arbitrary<NativeScript> = FastCheck.letrec((tie) => ({
  nativeScript: FastCheck.oneof(
    // ScriptPubKey
    FastCheck.uint8Array({ minLength: 28, maxLength: 28 }).map((keyHash) => makeScriptPubKey(keyHash)),
    // InvalidBefore
    FastCheck.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map((slot) => makeInvalidBefore(slot)),
    // InvalidHereafter
    FastCheck.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map((slot) => makeInvalidHereafter(slot)),
    // ScriptAll (limit depth to prevent infinite recursion)
    FastCheck.array(tie("nativeScriptVariant"), { maxLength: 3 }).map((scripts) =>
      makeScriptAll(scripts as ReadonlyArray<NativeScriptVariants>)
    ),
    // ScriptAny (limit depth to prevent infinite recursion)
    FastCheck.array(tie("nativeScriptVariant"), { maxLength: 3 }).map((scripts) =>
      makeScriptAny(scripts as ReadonlyArray<NativeScriptVariants>)
    ),
    // ScriptNOfK (limit depth to prevent infinite recursion)
    FastCheck.tuple(
      FastCheck.bigInt({ min: 0n, max: 10n }),
      FastCheck.array(tie("nativeScriptVariant"), { maxLength: 3 })
    ).map(([required, scripts]) => makeScriptNOfK(required, scripts as ReadonlyArray<NativeScriptVariants>))
  ),
  // IMPORTANT: this generates NativeScriptVariants (plain variant objects), not NativeScript wrappers
  nativeScriptVariant: FastCheck.oneof(
    // ScriptPubKey
    FastCheck.uint8Array({ minLength: 28, maxLength: 28 }).map((keyHash) => ({
      _tag: "ScriptPubKey" as const,
      keyHash
    })),
    // InvalidBefore
    FastCheck.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map((slot) => ({
      _tag: "InvalidBefore" as const,
      slot
    })),
    // InvalidHereafter
    FastCheck.bigInt({ min: 0n, max: 2n ** 64n - 1n }).map((slot) => ({
      _tag: "InvalidHereafter" as const,
      slot
    })),
    // ScriptAll (limit depth to prevent infinite recursion)
    FastCheck.array(tie("nativeScriptVariant"), { maxLength: 2 }).map((scripts) => ({
      _tag: "ScriptAll" as const,
      scripts: scripts as ReadonlyArray<NativeScriptVariants>
    })),
    // ScriptAny (limit depth to prevent infinite recursion)
    FastCheck.array(tie("nativeScriptVariant"), { maxLength: 2 }).map((scripts) => ({
      _tag: "ScriptAny" as const,
      scripts: scripts as ReadonlyArray<NativeScriptVariants>
    })),
    // ScriptNOfK (limit depth to prevent infinite recursion)
    FastCheck.tuple(
      FastCheck.bigInt({ min: 0n, max: 10n }),
      FastCheck.array(tie("nativeScriptVariant"), { maxLength: 2 })
    ).map(([required, scripts]) => ({
      _tag: "ScriptNOfK" as const,
      required,
      scripts: scripts as ReadonlyArray<NativeScriptVariants>
    }))
  )
})).nativeScript

/**
 * Parse a NativeScript from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = (bytes: Uint8Array): NativeScript =>
  read(new CborReader(bytes))

/**
 * Parse a NativeScript from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = (hex: string): NativeScript =>
  fromCBORBytes(Schema.decodeSync(Schema.Uint8ArrayFromHex)(hex))

/**
 * Convert a NativeScript to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (nativeScript: NativeScript, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, nativeScript)
  return w.finish()
}

/**
 * Convert a NativeScript to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (nativeScript: NativeScript, profile?: EncodingProfile): string => {
  const bytes = toCBORBytes(nativeScript, profile)
  return Schema.encodeSync(Schema.Uint8ArrayFromHex)(bytes)
}

// ============================================================================
// Required Signers Calculation
// ============================================================================

/**
 * Count the maximum number of key hashes (signers) required to satisfy a native script.
 * This is used for fee calculation to ensure the fake witness set has the correct size.
 *
 * Algorithm:
 * - ScriptPubKey: 1 signer required
 * - ScriptAll: sum of all nested scripts (all must be satisfied)
 * - ScriptAny: maximum of nested scripts (pessimistic - assume most expensive path)
 * - ScriptNOfK: sum of top N most expensive nested scripts
 * - InvalidBefore/InvalidHereafter: 0 signers (time-based only)
 *
 * @since 2.0.0
 * @category utilities
 */
export const countRequiredSigners = (script: NativeScriptVariants): number => {
  switch (script._tag) {
    case "ScriptPubKey":
      return 1

    case "InvalidBefore":
    case "InvalidHereafter":
      return 0

    case "ScriptAll": {
      // All nested scripts must be satisfied, sum them all
      return script.scripts.reduce((sum, nested) => sum + countRequiredSigners(nested), 0)
    }

    case "ScriptAny": {
      // Any one nested script can satisfy, use maximum (pessimistic for fee calculation)
      if (script.scripts.length === 0) return 0
      return Math.max(...script.scripts.map(countRequiredSigners))
    }

    case "ScriptNOfK": {
      // At least N scripts must be satisfied
      // Pessimistic approach: assume we need the N most expensive paths
      if (script.scripts.length === 0) return 0
      const counts = script.scripts.map(countRequiredSigners).sort((a, b) => b - a)
      const required = Number(script.required)
      return counts.slice(0, required).reduce((sum, count) => sum + count, 0)
    }

    default:
      return 0
  }
}
/**
 * Extract all key hashes from a native script.
 * Recursively traverses nested scripts to find all ScriptPubKey key hashes.
 *
 * @since 2.0.0
 * @category utilities
 */
export const extractKeyHashes = (script: NativeScriptVariants): ReadonlyArray<Uint8Array> => {
  const keyHashes: Array<Uint8Array> = []

  const traverse = (s: NativeScriptVariants): void => {
    switch (s._tag) {
      case "ScriptPubKey":
        keyHashes.push(s.keyHash)
        break
      case "ScriptAll":
      case "ScriptAny":
        for (const nested of s.scripts) traverse(nested)
        break
      case "ScriptNOfK":
        for (const nested of s.scripts) traverse(nested)
        break
      case "InvalidBefore":
      case "InvalidHereafter":
        // Time-based scripts don't contain key hashes
        break
    }
  }

  traverse(script)
  return keyHashes
}
