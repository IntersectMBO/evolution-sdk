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
 * Mirrors Haskell's PlutusTx.makeIsData / PlutusTx.makeIsDataIndexed
 *
 * @since 2.0.0
 */
import { Schema } from "effect"

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

/** Alias for `data()` */
export const fromSchema = data

// ============================================================
// Haskell-equivalent Functions
// ============================================================

/**
 * Derive Plutus Data encoding for a product type.
 * Equivalent to Haskell's `PlutusTx.unstableMakeIsData`.
 *
 * @example
 * ```typescript
 * const MyDatum = Plutus.makeIsData({
 *   owner: Schema.Uint8ArrayFromSelf,
 *   amount: Schema.BigIntFromSelf
 * })
 * // Encodes as: Constr(0, [ownerBytes, amountInt])
 * ```
 *
 * @since 2.0.0
 */
export const makeIsData = <Fields extends Schema.Struct.Fields>(
  fields: Fields,
  options?: DataOptions
): Schema.Schema<Schema.Struct.Type<Fields>, Data.Data> => {
  return data(Schema.Struct(fields), options) as Schema.Schema<Schema.Struct.Type<Fields>, Data.Data>
  // Cast: data() returns Schema<Struct.Type<Fields>, Data.Data> but TS can't infer this through Struct's generics
}

/**
 * Derive Plutus Data encoding for a sum type with explicit constructor indices.
 * Equivalent to Haskell's `PlutusTx.makeIsDataIndexed`.
 *
 * @example
 * ```typescript
 * const Credential = Plutus.makeIsDataIndexed(
 *   {
 *     PubKeyCredential: { hash: Schema.Uint8ArrayFromSelf },
 *     ScriptCredential: { hash: Schema.Uint8ArrayFromSelf }
 *   },
 *   { PubKeyCredential: 0, ScriptCredential: 1 }
 * )
 * ```
 *
 * @since 2.0.0
 */
export const makeIsDataIndexed = <
  const Variants extends Record<string, Schema.Struct.Fields>,
  Indices extends { readonly [K in keyof Variants]: number }
>(
  variants: Variants,
  indices: Indices
) => {
  const members = Object.entries(variants).map(([name, fields]) => {
    const index = (indices as Record<string, number>)[name]
    return Schema.Struct({
      _tag: Schema.Literal(name),
      ...(fields as Schema.Struct.Fields)
    }).annotations({
      [PA.ConstrIndexId]: index,
      [PA.FlatInUnionId]: true
    })
  })
  // Cast: members is Array<Schema.Struct> but Schema.Union expects a specific tuple spread.
  // The dynamic Object.entries mapping can't produce a static tuple type.
  return data(Schema.Union(...members as ReadonlyArray<Schema.Schema.Any>) as Schema.Schema<any>)
}

// ============================================================
// Convenience Combinators
// ============================================================

/**
 * Enum shorthand — nullary constructors with auto-assigned indices.
 * Equivalent to Haskell's `makeIsData` on a sum type with no fields.
 *
 * @example
 * ```typescript
 * const Color = Plutus.enum("Red", "Green", "Blue")
 * // Red → Constr(0, []), Green → Constr(1, []), Blue → Constr(2, [])
 *
 * const codec = Plutus.codec(Color)
 * codec.toData({ _tag: "Red" })  // Constr(0n, [])
 * ```
 *
 * @since 2.0.0
 */
export const makeEnum = <const Names extends readonly [string, ...string[]]>(
  ...names: Names
) => {
  const variants: Record<string, Schema.Struct.Fields> = {}
  const indices: Record<string, number> = {}
  for (let i = 0; i < names.length; i++) {
    variants[names[i]] = {}
    indices[names[i]] = i
  }
  return makeIsDataIndexed(variants, indices as { readonly [K in Names[number]]: number })
}

/** Maybe/Option encoding — Constr(0,[value]) for Just, Constr(1,[]) for Nothing */
export const option = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  data(Schema.NullOr(schema) as Schema.Schema<A | null, I | null, R>)
  // Cast: Schema.NullOr produces Schema<A | null, I | null, R> but TS struggles with the union inference

/** Aiken-style named sum types — delegates to TSchema.Variant */
export const variant: typeof TSchema.Variant = TSchema.Variant

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

/** Variant re-export */
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
 */
const applyAnnotations = (ast: any, options: DataOptions): any => {
  const annotations: Record<symbol, any> = {}

  if (options.index !== undefined) annotations[PA.ConstrIndexId] = options.index
  if (options.flatInUnion !== undefined) annotations[PA.FlatInUnionId] = options.flatInUnion
  if (options.flatFields !== undefined) annotations[PA.FlatFieldsId] = options.flatFields
  if (options.tagField !== undefined) annotations[PA.TagFieldId] = options.tagField

  if (Object.getOwnPropertySymbols(annotations).length === 0) return ast

  // Clone AST with merged annotations (same technique as SchemaAST.annotations)
  const d = Object.getOwnPropertyDescriptors(ast)
  d.annotations = {
    ...d.annotations,
    value: { ...ast.annotations, ...annotations }
  }
  return Object.create(Object.getPrototypeOf(ast), d)
}
