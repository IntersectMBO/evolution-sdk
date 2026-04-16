/**
 * PlutusSchema — Declarative Plutus Data encoding for Effect Schema
 *
 * Uses Effect's annotation system and AST compiler pattern to derive
 * Plutus Data encoders/decoders from standard Effect Schema types.
 *
 * Two paths:
 * 1. `Plutus.data(schema)` — annotate any Effect Schema, derive Plutus encoding via AST compiler
 * 2. Direct combinators — TSchema re-exports for power users
 *
 * Mirrors Haskell's PlutusTx deriving pattern for Plutus Data encoding
 *
 * @since 2.0.0
 */
import { Schema, SchemaAST } from "effect"

import * as Data from "./Data.js"
import * as PA from "./PlutusAnnotation.js"
import { compile } from "./PlutusCompiler.js"
import * as TSchema from "./TSchema.js"

// ============================================================
// Core: data() — Annotate + Compile
// ============================================================

/**
 * Options for `data()` / `fromSchema()`.
 *
 * @since 2.0.0
 */
export interface DataOptions {
  /** Constructor index (default: 0) */
  readonly index?: number
  /** Flat encoding in unions — fields not wrapped in nested Constr */
  readonly flatInUnion?: boolean
  /** Flatten nested struct fields into parent Constr */
  readonly flatFields?: boolean
  /** Tag field name to strip, or false to disable auto-detection */
  readonly tagField?: string | false
}

/**
 * Derive Plutus Data encoding from any Effect Schema.
 *
 * Walks the schema's AST using the annotation-driven compiler and produces
 * a `Schema<A, Data.Data>` transformation that encodes/decodes between
 * TypeScript values and Plutus Data.
 *
 * Inference rules:
 * - `Schema.BigIntFromSelf` → Integer (passthrough)
 * - `Schema.Uint8ArrayFromSelf` → ByteArray (passthrough)
 * - `Schema.Boolean` → Boolean (Constr 0/1)
 * - `Schema.Struct({...})` → Constr(index, [fields])
 * - `Schema.Union(...)` → indexed Constr per member
 * - `Schema.NullOr(T)` → Option (Constr 0 = Just, Constr 1 = Nothing)
 * - `Schema.Array(T)` → List
 * - `Schema.suspend(...)` → Recursive (memoized)
 *
 * @example
 * ```typescript
 * const MyDatum = Plutus.data(Schema.Struct({
 *   owner: Schema.Uint8ArrayFromSelf,
 *   amount: Schema.BigIntFromSelf
 * }))
 * const codec = Plutus.codec(MyDatum)
 * const cbor = codec.toCBORHex({ owner: bytes, amount: 42n })
 * ```
 *
 * @since 2.0.0
 */
export const data = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  options?: DataOptions
): Schema.Schema<A, Data.Data, R> => {
  // Apply annotations from options to the schema's AST before compiling
  const ast = options
    ? applyAnnotations(schema.ast, options)
    : schema.ast

  // Compile the AST into a PlutusCodec
  const codec = compile(ast, [])

  // Wrap in a Schema.transform: A <-> Data.Data
  return Schema.transform(
    Schema.typeSchema(Data.DataSchema) as Schema.Schema<Data.Data, Data.Data>,
    Schema.typeSchema(schema),
    {
      strict: false,
      encode: (a: A) => codec.toData(a),
      decode: (d: unknown) => codec.fromData(d as Data.Data) as A
    }
  ).annotations({
    identifier: "PlutusSchema.data"
  }) as unknown as Schema.Schema<A, Data.Data, R>
  // Cast required: Schema.transform produces a complex intersection type that
  // doesn't unify with Schema<A, Data.Data, R> even though it's structurally compatible.
}

// ============================================================
// Convenience Combinators
// ============================================================

/** Maybe/Option encoding — Constr(0,[value]) for Just, Constr(1,[]) for Nothing */
export const option = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  data(Schema.NullOr(schema) as Schema.Schema<A | null, I | null, R>)
  // Cast: Schema.NullOr produces Schema<A | null, I | null, R> but TS struggles with the union inference

/** Recursive schema — breaks cycles for self-referencing types */
export const lazy: typeof Schema.suspend = Schema.suspend

// ============================================================
// Primitive Re-exports
// ============================================================

/** Plutus ByteArray — Uint8Array encoded as raw CBOR bytes */
export const ByteArray: TSchema.ByteArray = TSchema.ByteArray

/** Plutus Integer — bigint encoded as CBOR integer */
export const Integer: TSchema.Integer = TSchema.Integer

/** Plutus Boolean — boolean encoded as Constr(0/1, []) */
// eslint-disable-next-line @typescript-eslint/no-shadow
export const Boolean: TSchema.Boolean = TSchema.Boolean

/** Opaque PlutusData — passes through encoding unchanged */
// eslint-disable-next-line @typescript-eslint/no-shadow
export const PlutusData: TSchema.PlutusData = TSchema.PlutusData

/** Plutus Map — Map<K,V> encoded as CBOR map */
// eslint-disable-next-line @typescript-eslint/no-shadow
export const Map: typeof TSchema.Map = TSchema.Map

/** Plutus List — Array<T> encoded as CBOR array */
export const List: typeof TSchema.Array = TSchema.Array

/** Plutus Tuple — fixed-length array */
export const Tuple: typeof TSchema.Tuple = TSchema.Tuple

/** String/number enum values encoded as Constr(index, []) */
export const Literal: typeof TSchema.Literal = TSchema.Literal

/** Aiken-style named sum types — delegates to TSchema.Variant */
export const Variant: typeof TSchema.Variant = TSchema.Variant

// ============================================================
// Codec
// ============================================================

/**
 * Derive codec object (toData/fromData/toCBORHex/fromCBORHex) from a Plutus schema.
 *
 * Works with both `Plutus.data()` schemas and existing TSchema schemas.
 *
 * @since 2.0.0
 */
export const codec: typeof Data.withSchema = Data.withSchema

// ============================================================
// Annotation Re-exports
// ============================================================

export {
  ConstrIndexId,
  EncodingId,
  FlatFieldsId,
  FlatInUnionId,
  TagFieldId,
  constrIndex,
  encoding,
  flatFields,
  flatInUnion,
  tagField
} from "./PlutusAnnotation.js"

// ============================================================
// Internal: Apply Options as Annotations
// ============================================================

/**
 * Apply DataOptions as Plutus annotations to an AST node.
 * Delegates to SchemaAST.annotations() which handles the clone.
 */
const applyAnnotations = (ast: SchemaAST.AST, options: DataOptions): SchemaAST.AST => {
  const overrides: Record<symbol, unknown> = {}

  if (options.index !== undefined) overrides[PA.ConstrIndexId] = options.index
  if (options.flatInUnion !== undefined) overrides[PA.FlatInUnionId] = options.flatInUnion
  if (options.flatFields !== undefined) overrides[PA.FlatFieldsId] = options.flatFields
  if (options.tagField !== undefined) overrides[PA.TagFieldId] = options.tagField

  if (Object.getOwnPropertySymbols(overrides).length === 0) return ast

  return SchemaAST.annotations(ast, overrides)
}
