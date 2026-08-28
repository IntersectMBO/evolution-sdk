/**
 * PlutusAnnotation — Custom annotation symbols for Plutus Data encoding metadata
 *
 * These annotations attach to Effect Schema AST nodes and carry Plutus-specific
 * encoding information. The AST compiler (PlutusSchema) reads these annotations
 * to derive Plutus Data encoders/decoders.
 *
 * Follows Effect's annotation conventions:
 * - Symbol.for() namespaced keys
 * - Curried getAnnotation helpers via SchemaAST.getAnnotation
 * - Type-safe annotation values
 *
 * @since 2.0.0
 */
import type { Option } from "effect"
import { SchemaAST } from "effect"

// ============================================================
// Annotation Symbols
// ============================================================

/**
 * Constructor index for Constr encoding.
 * Attached to TypeLiteral (struct) nodes to control which Constr index is used.
 *
 * @example
 * ```typescript
 * Schema.Struct({ ... }).annotations({ [ConstrIndexId]: 5 })
 * // Encodes as Constr(5, [...fields])
 * ```
 *
 * @since 2.0.0
 */
export const ConstrIndexId: unique symbol = Symbol.for("plutus/annotation/ConstrIndex")

/**
 * @since 2.0.0
 */
export type ConstrIndexId = typeof ConstrIndexId

/**
 * Encoding strategy override.
 * When set, the compiler uses this encoding instead of inferring from the schema type.
 *
 * @since 2.0.0
 */
export const EncodingId: unique symbol = Symbol.for("plutus/annotation/Encoding")

/**
 * @since 2.0.0
 */
export type EncodingId = typeof EncodingId

/**
 * Encoding strategy values.
 *
 * @since 2.0.0
 */
export type PlutusEncoding = "constr" | "integer" | "bytes" | "list" | "map" | "bool" | "passthrough"

/**
 * Flat union encoding flag.
 * When true on a union member, its fields are encoded directly as Constr fields
 * (tag field stripped), rather than being wrapped in a nested Constr.
 *
 * @since 2.0.0
 */
export const FlatInUnionId: unique symbol = Symbol.for("plutus/annotation/FlatInUnion")

/**
 * @since 2.0.0
 */
export type FlatInUnionId = typeof FlatInUnionId

/**
 * Flat fields encoding flag.
 * When true on a struct field that is itself a struct, its fields are inlined
 * into the parent Constr rather than being nested.
 *
 * @since 2.0.0
 */
export const FlatFieldsId: unique symbol = Symbol.for("plutus/annotation/FlatFields")

/**
 * @since 2.0.0
 */
export type FlatFieldsId = typeof FlatFieldsId

/**
 * Tag field name to strip during encoding.
 * When set on a struct, the named field is treated as a discriminator tag:
 * it is stripped from Constr fields during encoding and injected back during decoding.
 *
 * Set to `false` to explicitly disable tag field auto-detection.
 *
 * @since 2.0.0
 */
export const TagFieldId: unique symbol = Symbol.for("plutus/annotation/TagField")

/**
 * @since 2.0.0
 */
export type TagFieldId = typeof TagFieldId

// ============================================================
// Annotation Getters (curried form)
// ============================================================

/**
 * Get the Constr index annotation from an AST node.
 *
 * @since 2.0.0
 */
export const getConstrIndex: (annotated: SchemaAST.Annotated) => Option.Option<number> =
  SchemaAST.getAnnotation<number>(ConstrIndexId)

/**
 * Get the encoding strategy annotation from an AST node.
 *
 * @since 2.0.0
 */
export const getEncoding: (annotated: SchemaAST.Annotated) => Option.Option<PlutusEncoding> =
  SchemaAST.getAnnotation<PlutusEncoding>(EncodingId)

/**
 * Get the flat-in-union flag from an AST node.
 *
 * @since 2.0.0
 */
export const getFlatInUnion: (annotated: SchemaAST.Annotated) => Option.Option<boolean> =
  SchemaAST.getAnnotation<boolean>(FlatInUnionId)

/**
 * Get the flat-fields flag from an AST node.
 *
 * @since 2.0.0
 */
export const getFlatFields: (annotated: SchemaAST.Annotated) => Option.Option<boolean> =
  SchemaAST.getAnnotation<boolean>(FlatFieldsId)

/**
 * Get the tag field annotation from an AST node.
 *
 * @since 2.0.0
 */
export const getTagField: (annotated: SchemaAST.Annotated) => Option.Option<string | false> =
  SchemaAST.getAnnotation<string | false>(TagFieldId)

// ============================================================
// Annotation Helpers
// ============================================================

/**
 * Convenience: attach a Constr index annotation to a schema.
 *
 * @since 2.0.0
 */
export const constrIndex = (index: number) => ({ [ConstrIndexId]: index }) as const

/**
 * Convenience: attach an encoding strategy annotation to a schema.
 *
 * @since 2.0.0
 */
export const encoding = (strategy: PlutusEncoding) => ({ [EncodingId]: strategy }) as const

/**
 * Convenience: mark a union member as flat (fields not wrapped in nested Constr).
 *
 * @since 2.0.0
 */
export const flatInUnion = () => ({ [FlatInUnionId]: true }) as const

/**
 * Convenience: mark a struct field as flat (inline its fields into parent Constr).
 *
 * @since 2.0.0
 */
export const flatFields = () => ({ [FlatFieldsId]: true }) as const

/**
 * Convenience: set the tag field name to strip during encoding.
 *
 * @since 2.0.0
 */
export const tagField = (name: string | false) => ({ [TagFieldId]: name }) as const

// ============================================================
// Module Augmentation — Type-safe annotations in .annotations()
// ============================================================

/**
 * Extends Effect Schema's annotation interfaces so that Plutus annotation
 * symbols appear in autocomplete when calling `.annotations({...})`.
 *
 * @example
 * ```typescript
 * import "@evolution-sdk/evolution/PlutusAnnotation"
 *
 * Schema.Struct({ ... }).annotations({
 *   [ConstrIndexId]: 5,        // ← autocompletes with type: number
 *   [FlatInUnionId]: true,     // ← autocompletes with type: boolean
 * })
 * ```
 *
 * @since 2.0.0
 */
declare module "effect/SchemaAST" {
  interface Annotations {
    readonly [ConstrIndexId]?: number
    readonly [EncodingId]?: PlutusEncoding
    readonly [FlatInUnionId]?: boolean
    readonly [FlatFieldsId]?: boolean
    readonly [TagFieldId]?: string | false
  }
}
