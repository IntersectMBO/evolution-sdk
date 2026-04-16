/**
 * PlutusCompiler — AST compiler that derives Plutus Data codecs from annotated Effect Schemas
 *
 * Uses Effect's canonical `Match<A>` + `getCompiler` pattern (same as Pretty.ts, Arbitrary.ts)
 * to walk Schema AST nodes and produce bidirectional Plutus Data transformations.
 *
 * Each handler checks for Plutus annotations first, then falls back to structural inference.
 *
 * @since 2.0.0
 * @internal
 */
import { Option, Schema, SchemaAST } from "effect"

import * as Data from "./Data.js"
import * as PA from "./PlutusAnnotation.js"

// ============================================================
// Codec Type
// ============================================================

/**
 * Bidirectional codec between TypeScript values and Plutus Data.
 *
 * - `toData`: encode a TS value → Data.Data
 * - `fromData`: decode Data.Data → TS value
 *
 * @since 2.0.0
 */
export interface PlutusCodec {
  readonly toData: (a: any) => Data.Data
  readonly fromData: (d: Data.Data) => any
}

// ============================================================
// Well-known annotation symbols
// ============================================================

const IdentifierAnnotationId = Symbol.for("effect/annotation/Identifier")
const DescriptionAnnotationId = Symbol.for("effect/annotation/Description")

// ============================================================
// Known tag field names for auto-detection
// ============================================================

const KNOWN_TAG_FIELDS = ["_tag", "type", "kind", "variant"] as const

// ============================================================
// Declaration type detection via Description annotation
// ============================================================

/** Description prefixes for Map-like types (2 type parameters: key, value) */
const MAP_LIKE_PREFIXES = ["Map<", "HashMap<", "ReadonlyMap<"]

/** Description prefixes for Set-like types (1 type parameter, decoded to Set) */
const SET_LIKE_PREFIXES = ["Set<", "HashSet<", "ReadonlySet<"]

/** Description prefixes for Array-like types (1 type parameter, decoded to Array) */
const ARRAY_LIKE_PREFIXES = ["List<", "Chunk<"]

// ============================================================
// Helpers
// ============================================================

/**
 * Simple memoize-thunk, same pattern as effect/internal/schema/util.ts
 */
const memoizeThunk = <A>(f: () => A): (() => A) => {
  let done = false
  let a: A
  return () => {
    if (done) return a
    a = f()
    done = true
    return a
  }
}

/**
 * Get the identifier annotation from an AST node.
 */
const getIdentifier = (ast: SchemaAST.Annotated): string | undefined =>
  ast.annotations?.[IdentifierAnnotationId] as string | undefined

/**
 * Detect if a property signature is a Literal tag field (for stripping).
 */
const isLiteralTag = (ps: SchemaAST.PropertySignature, tagFieldOverride: string | false | undefined): boolean => {
  const name = ps.name as string

  // Explicit disable
  if (tagFieldOverride === false) return false

  // Explicit name match
  if (typeof tagFieldOverride === "string") return name === tagFieldOverride

  // Auto-detect from known tag fields
  if (!(KNOWN_TAG_FIELDS as ReadonlyArray<string>).includes(name)) return false

  // Check if the type is a Literal
  const type = ps.type
  if (type._tag === "Literal") return true
  if (type._tag === "Transformation") {
    return type.to._tag === "Literal"
  }
  return false
}

/**
 * Extract the literal value from a property signature's type AST.
 */
const getLiteralValue = (ps: SchemaAST.PropertySignature): SchemaAST.LiteralValue | undefined => {
  const type = ps.type
  if (type._tag === "Literal") return type.literal
  if (type._tag === "Transformation") {
    const to = type.to
    if (to._tag === "Literal") return to.literal
  }
  return undefined
}

/**
 * Check if an AST node has TSchema annotations (already Plutus-encoded).
 */
const hasTSchemaAnnotations = (ast: SchemaAST.Annotated): boolean => {
  const ann = ast.annotations
  return (
    ann?.["TSchema.customIndex"] !== undefined ||
    ann?.["TSchema.flatInUnion"] !== undefined ||
    ann?.["TSchema.flatFields"] !== undefined ||
    (typeof getIdentifier(ast) === "string" && (getIdentifier(ast) as string).startsWith("TSchema."))
  )
}

// ============================================================
// Primitive codecs (stateless singletons)
// ============================================================

const integerCodec: PlutusCodec = {
  toData: (a: bigint) => a,
  fromData: (d: Data.Data) => d as bigint
}

const byteArrayCodec: PlutusCodec = {
  toData: (a: Uint8Array) => a,
  fromData: (d: Data.Data) => d as Uint8Array
}

const booleanCodec: PlutusCodec = {
  toData: (a: boolean) =>
    a ? new Data.Constr({ index: 1n, fields: [] }) : new Data.Constr({ index: 0n, fields: [] }),
  fromData: (d: Data.Data) => (d as Data.Constr).index === 1n
}

const passthroughCodec: PlutusCodec = {
  toData: (a: Data.Data) => a,
  fromData: (d: Data.Data) => d
}

/**
 * Count the number of non-tag struct fields in an AST node.
 * Used to know how many parent Constr fields to slice when decoding a flat struct.
 */
const countStructFields = (ast: SchemaAST.AST): number => {
  // Look through Transformation to find TypeLiteral
  let typeLiteral: SchemaAST.TypeLiteral | undefined
  if (ast._tag === "TypeLiteral") {
    typeLiteral = ast
  } else if (ast._tag === "Transformation" && ast.to._tag === "TypeLiteral") {
    typeLiteral = ast.to
  }

  if (!typeLiteral) return 1 // fallback: treat as single field

  const ps = typeLiteral.propertySignatures
  // Count non-tag fields (same logic as the TypeLiteral handler)
  let count = 0
  for (const p of ps) {
    const name = p.name as string
    if ((KNOWN_TAG_FIELDS as ReadonlyArray<string>).includes(name)) {
      // Check if it's actually a literal tag
      if (p.type._tag === "Literal") continue
      if (p.type._tag === "Transformation" && p.type.to._tag === "Literal") continue
    }
    count++
  }
  return count
}

// ============================================================
// TSchema fast-path codecs
// ============================================================

/**
 * Recognize known TSchema identifiers and return a direct codec
 * that avoids the Schema.encodeSync/decodeSync overhead.
 * Returns undefined if the TSchema type is not recognized (falls back to slow path).
 */
const tschemaFastCodec = (
  id: string | undefined,
  ast: SchemaAST.Transformation,
  go: SchemaAST.Compiler<PlutusCodec>,
  path: ReadonlyArray<PropertyKey>
): PlutusCodec | undefined => {
  switch (id) {
    case "TSchema.BooleanFromConstr":
      return booleanCodec

    case "TSchema.Struct": {
      // TSchema.Struct is a Transformation from Constr → Struct
      // The "to" side is a TypeLiteral with the struct fields
      // But the encode/decode logic is in the transformation itself
      // Use the slow path for structs — they have tag detection, flatFields, etc.
      return undefined
    }

    case "TSchema.Union":
      // Complex logic — use slow path
      return undefined

    default:
      // Check for NullOr / UndefinedOr by looking at the "to" side
      if (ast.to._tag === "Union" && ast.to.types.length === 2) {
        const types = ast.to.types
        const nullIdx = types.findIndex((t) => t._tag === "Literal" && t.literal === null)
        if (nullIdx >= 0) {
          // NullOr — compile the inner type
          const innerCodec = go(types[1 - nullIdx], path)
          return {
            toData: (a: any) =>
              a === null
                ? new Data.Constr({ index: 1n, fields: [] })
                : new Data.Constr({ index: 0n, fields: [innerCodec.toData(a)] }),
            fromData: (d: Data.Data) => {
              const constr = d as Data.Constr
              return constr.index === 1n ? null : innerCodec.fromData(constr.fields[0])
            }
          }
        }
        const undefIdx = types.findIndex((t) => t._tag === "UndefinedKeyword")
        if (undefIdx >= 0) {
          const innerCodec = go(types[1 - undefIdx], path)
          return {
            toData: (a: any) =>
              a === undefined
                ? new Data.Constr({ index: 1n, fields: [] })
                : new Data.Constr({ index: 0n, fields: [innerCodec.toData(a)] }),
            fromData: (d: Data.Data) => {
              const constr = d as Data.Constr
              return constr.index === 1n ? undefined : innerCodec.fromData(constr.fields[0])
            }
          }
        }
      }

      return undefined
  }
}

// ============================================================
// Match<PlutusCodec>
// ============================================================

/**
 * The core AST compiler match object.
 * Each handler checks for Plutus annotation override first, then falls back to structural inference.
 *
 * @since 2.0.0
 */
export const match: SchemaAST.Match<PlutusCodec> = {
  // --- Primitives ---

  "BigIntKeyword": () => integerCodec,

  "BooleanKeyword": () => booleanCodec,

  "Literal": (ast) => {
    const literal = ast.literal
    if (literal === null) {
      throw new Error(
        "PlutusCompiler: null cannot be encoded standalone. Use Schema.NullOr() for optional values."
      )
    }
    if (typeof literal === "bigint") {
      return integerCodec
    }
    // String/number literal → Constr(0, []) by default (used as enum/tag value)
    return {
      toData: () => new Data.Constr({ index: 0n, fields: [] }),
      fromData: () => literal
    }
  },

  "Declaration": (ast, go, path) => {
    const id = getIdentifier(ast)
    if (id === "Uint8ArrayFromSelf" || id === "Uint8Array") {
      return byteArrayCodec
    }

    const desc = ast.annotations?.[DescriptionAnnotationId] as string | undefined

    // --- Map types: Map<K,V>, HashMap<K,V>, ReadonlyMap<K,V> ---
    if (desc && MAP_LIKE_PREFIXES.some((p) => desc.startsWith(p)) && ast.typeParameters.length === 2) {
      const keyCodec = go(ast.typeParameters[0], [...path, "key"])
      const valueCodec = go(ast.typeParameters[1], [...path, "value"])
      return {
        toData: (a: globalThis.Map<any, any>) => {
          const result = new globalThis.Map<Data.Data, Data.Data>()
          for (const [k, v] of a) {
            result.set(keyCodec.toData(k), valueCodec.toData(v))
          }
          return result
        },
        fromData: (d: Data.Data) => {
          const result = new globalThis.Map<any, any>()
          for (const [k, v] of d as globalThis.Map<Data.Data, Data.Data>) {
            result.set(keyCodec.fromData(k), valueCodec.fromData(v))
          }
          return result
        }
      }
    }

    // --- Set-like types: Set<T>, HashSet<T>, ReadonlySet<T> ---
    const isSetLike = desc && SET_LIKE_PREFIXES.some((p) => desc.startsWith(p))
    if (isSetLike && ast.typeParameters.length >= 1) {
      const itemCodec = go(ast.typeParameters[0], [...path, "item"])
      return {
        toData: (a: Iterable<any>) => {
          const result: Array<Data.Data> = []
          for (const item of a) {
            result.push(itemCodec.toData(item))
          }
          return result
        },
        fromData: (d: Data.Data) => new globalThis.Set((d as Array<Data.Data>).map((item) => itemCodec.fromData(item)))
      }
    }

    // --- Array-like types: List<T>, Chunk<T> ---
    const isArrayLike = desc && ARRAY_LIKE_PREFIXES.some((p) => desc.startsWith(p))
    if (isArrayLike && ast.typeParameters.length >= 1) {
      const itemCodec = go(ast.typeParameters[0], [...path, "item"])
      return {
        toData: (a: Iterable<any>) => {
          const result: Array<Data.Data> = []
          for (const item of a) {
            result.push(itemCodec.toData(item))
          }
          return result
        },
        fromData: (d: Data.Data) => (d as Array<Data.Data>).map((item) => itemCodec.fromData(item))
      }
    }

    // --- Unknown Declaration: throw instead of silently passing through ---
    // Following JSON Schema's approach: unknown types must be explicitly annotated.
    const typeName = desc || id || "<unknown declaration>"
    throw new Error(
      `PlutusCompiler: unsupported Declaration type "${typeName}" at path [${path.join(".")}]. ` +
      `Use Plutus primitives (ByteArray, Integer, Boolean) or annotate with a Plutus encoding.`
    )
  },

  // --- Struct (TypeLiteral) ---

  "TypeLiteral": (ast, go, path) => {
    // Reject index signatures — Plutus Data has no concept of string-keyed records
    if (ast.indexSignatures.length > 0) {
      throw new Error(
        `PlutusCompiler: index signatures (Record<K, V>) are not supported at path [${path.join(".")}]. Use Plutus.Map() for key-value data.`
      )
    }

    // Read Plutus annotations
    const constrIndex = Option.getOrElse(PA.getConstrIndex(ast), () => 0)
    const tagFieldOverride = Option.getOrUndefined(PA.getTagField(ast))

    // Compile each field
    const propertySignatures = ast.propertySignatures
    const fieldCodecs: Array<{
      name: string
      codec: PlutusCodec
      isTag: boolean
      tagValue: any
      isFlat: boolean
      flatFieldCount: number // number of sub-fields when flat (for decoding)
    }> = []

    for (const ps of propertySignatures) {
      const name = ps.name as string
      const isTag = isLiteralTag(ps, tagFieldOverride)
      const tagValue = isTag ? getLiteralValue(ps) : undefined

      // Check for flatFields annotation on the field's type
      const isFlat = Option.getOrElse(PA.getFlatFields(ps.type), () => false)
        || (ps.type.annotations?.["TSchema.flatFields"] === true)

      // Count sub-fields for flat structs (needed during decoding)
      let flatFieldCount = 0
      if (isFlat) {
        flatFieldCount = countStructFields(ps.type)
      }

      fieldCodecs.push({
        name,
        codec: go(ps.type, [...path, ps.name]),
        isTag,
        tagValue,
        isFlat,
        flatFieldCount
      })
    }

    return {
      toData: (a: Record<string, any>) => {
        const fields: Array<Data.Data> = []
        for (const fc of fieldCodecs) {
          if (fc.isTag) continue // Strip tag field
          const encoded = fc.codec.toData(a[fc.name])
          if (fc.isFlat && encoded instanceof Data.Constr) {
            // Spread inner Constr fields into parent
            fields.push(...encoded.fields)
          } else {
            fields.push(encoded)
          }
        }
        return new Data.Constr({ index: BigInt(constrIndex), fields })
      },
      fromData: (d: Data.Data) => {
        const constr = d as Data.Constr
        const result: Record<string, any> = {}
        let fieldIdx = 0
        for (const fc of fieldCodecs) {
          if (fc.isTag) {
            result[fc.name] = fc.tagValue
          } else if (fc.isFlat) {
            // Reconstruct inner Constr from sliced parent fields
            const nestedFields = constr.fields.slice(fieldIdx, fieldIdx + fc.flatFieldCount)
            const nestedConstr = new Data.Constr({ index: 0n, fields: nestedFields })
            result[fc.name] = fc.codec.fromData(nestedConstr)
            fieldIdx += fc.flatFieldCount
          } else {
            result[fc.name] = fc.codec.fromData(constr.fields[fieldIdx])
            fieldIdx++
          }
        }
        return result
      }
    }
  },

  // --- Union ---

  "Union": (ast, go, path) => {
    const types = ast.types

    // Detect NullOr pattern: Union(T, null)
    const nullIdx = types.findIndex((t) => t._tag === "Literal" && t.literal === null)
    if (nullIdx >= 0 && types.length === 2) {
      const innerCodec = go(types[1 - nullIdx], path)
      return {
        toData: (a: any) =>
          a === null
            ? new Data.Constr({ index: 1n, fields: [] })
            : new Data.Constr({ index: 0n, fields: [innerCodec.toData(a)] }),
        fromData: (d: Data.Data) => {
          const constr = d as Data.Constr
          return constr.index === 1n ? null : innerCodec.fromData(constr.fields[0])
        }
      }
    }

    // Detect UndefinedOr pattern: Union(T, undefined)
    const undefIdx = types.findIndex((t) => t._tag === "UndefinedKeyword")
    if (undefIdx >= 0 && types.length === 2) {
      const innerCodec = go(types[1 - undefIdx], path)
      return {
        toData: (a: any) =>
          a === undefined
            ? new Data.Constr({ index: 1n, fields: [] })
            : new Data.Constr({ index: 0n, fields: [innerCodec.toData(a)] }),
        fromData: (d: Data.Data) => {
          const constr = d as Data.Constr
          return constr.index === 1n ? undefined : innerCodec.fromData(constr.fields[0])
        }
      }
    }

    // General union — compile each member with its index
    const memberCodecs = types.map((t, i) => {
      const memberIndex = Option.getOrElse(PA.getConstrIndex(t), () => i)
      const isFlat = Option.getOrElse(PA.getFlatInUnion(t), () => false)
      return {
        codec: go(t, [...path, i]),
        index: memberIndex,
        isFlat,
        ast: t
      }
    })

    // Build tag → member index map for discriminated unions
    let tagField: string | undefined
    let tagMap: globalThis.Map<string, number> | undefined

    // Auto-detect tag field
    for (const name of KNOWN_TAG_FIELDS) {
      const values = new globalThis.Map<string, number>()
      let allHave = true

      for (let i = 0; i < types.length; i++) {
        const t = types[i]
        if (t._tag !== "TypeLiteral") { allHave = false; break }
        const ps = t.propertySignatures.find((p) => p.name === name)
        if (!ps || ps.type._tag !== "Literal") { allHave = false; break }
        values.set(String(ps.type.literal), i)
      }

      if (allHave && values.size === types.length) {
        tagField = name
        tagMap = values
        break
      }
    }

    return {
      toData: (a: any) => {
        // Find matching member via tag field or trial
        let memberIdx: number
        if (tagField && tagMap && typeof a === "object" && a !== null) {
          memberIdx = tagMap.get(String(a[tagField])) ?? 0
        } else {
          // Fallback: try each member's codec (first match wins)
          memberIdx = 0
        }

        const member = memberCodecs[memberIdx]
        const encoded = member.codec.toData(a)

        if (member.isFlat && encoded instanceof Data.Constr) {
          return new Data.Constr({ index: BigInt(member.index), fields: encoded.fields })
        }

        return new Data.Constr({ index: BigInt(member.index), fields: [encoded] })
      },
      fromData: (d: Data.Data) => {
        const constr = d as Data.Constr
        const idx = Number(constr.index)

        // Find matching member by index
        const flatMember = memberCodecs.find((m) => m.isFlat && m.index === idx)
        if (flatMember) {
          return flatMember.codec.fromData(d) // Flat: decode directly from Constr
        }

        // Non-flat: member at position idx, unwrap one level
        const member = memberCodecs[idx]
        if (!member) {
          throw new Error(`PlutusCompiler: invalid union index ${idx}, expected 0..${memberCodecs.length - 1}`)
        }
        return member.codec.fromData(constr.fields[0])
      }
    }
  },

  // --- Array / Tuple ---

  "TupleType": (ast, go, path) => {
    const elements = ast.elements
    const rest = ast.rest

    // Schema.Array(T) → TupleType with rest=[T], no elements
    if (rest.length > 0 && elements.length === 0) {
      const itemCodec = go(rest[0].type, path)
      return {
        toData: (a: Array<any>) => a.map((item) => itemCodec.toData(item)),
        fromData: (d: Data.Data) => (d as Array<Data.Data>).map((item) => itemCodec.fromData(item))
      }
    }

    // Fixed-size tuple
    if (elements.length > 0) {
      const elementCodecs = elements.map((e, i) => go(e.type, [...path, i]))
      return {
        toData: (a: Array<any>) => a.map((item, i) => elementCodecs[i].toData(item)),
        fromData: (d: Data.Data) => (d as Array<Data.Data>).map((item, i) => elementCodecs[i].fromData(item))
      }
    }

    // Empty array
    return {
      toData: () => [] as Array<Data.Data>,
      fromData: () => []
    }
  },

  // --- Recursive ---

  "Suspend": (ast, go, path) => {
    const get = memoizeThunk(() => go(ast.f(), path))
    return {
      toData: (a: any) => get().toData(a),
      fromData: (d: Data.Data) => get().fromData(d)
    }
  },

  // --- Look-through types ---

  "Transformation": (ast, go, path) => {
    // If this is already a TSchema transformation, try fast-path first
    if (hasTSchemaAnnotations(ast)) {
      const id = getIdentifier(ast)

      // Fast-path: known TSchema types → direct codec (no Schema.encodeSync overhead)
      const fastCodec = tschemaFastCodec(id, ast, go, path)
      if (fastCodec) return fastCodec

      // Slow fallback: use Schema.encodeSync/decodeSync for unknown TSchema transforms
      const tschemaSchema = { ast } as Schema.Schema<any, any>
      const encode = Schema.encodeSync(tschemaSchema)
      const decode = Schema.decodeSync(tschemaSchema)
      return {
        toData: (a: any) => encode(a),
        fromData: (d: Data.Data) => decode(d)
      }
    }

    // Schema.Class / Schema.TaggedClass: Transformation(from: TypeLiteral, to: Declaration)
    // Compile the "from" side (TypeLiteral with struct fields), not the "to" (class Declaration)
    if (ast.to._tag === "Declaration" && ast.from._tag === "TypeLiteral") {
      return go(ast.from, path)
    }

    // Otherwise look through to the decoded ("to") side
    if (ast.to) {
      return go(ast.to, path)
    }

    const id = getIdentifier(ast)
    throw new Error(
      `PlutusCompiler: unsupported Transformation${id ? ` (${id})` : ""} at path [${path.join(".")}]. Use Plutus combinators directly.`
    )
  },

  "Refinement": (ast, go, path) => {
    // Look through refinement to the base type
    return go(ast.from, path)
  },

  // --- Unsupported types (throw descriptive errors) ---

  "StringKeyword": (_ast, _go, path) => {
    throw new Error(
      `PlutusCompiler: string has no Plutus Data encoding at path [${path.join(".")}]. Use Schema.Literal for enum values or Uint8Array for raw bytes.`
    )
  },

  "NumberKeyword": (_ast, _go, path) => {
    throw new Error(
      `PlutusCompiler: number has no Plutus Data encoding at path [${path.join(".")}]. Use Schema.BigIntFromSelf for integers.`
    )
  },

  "UndefinedKeyword": (_ast, _go, path) => {
    throw new Error(
      `PlutusCompiler: undefined cannot be encoded standalone at path [${path.join(".")}]. Use Schema.UndefinedOr() for optional values.`
    )
  },

  "VoidKeyword": (_ast, _go, path) => {
    throw new Error(`PlutusCompiler: void has no Plutus Data encoding at path [${path.join(".")}].`)
  },

  "NeverKeyword": (_ast, _go, path) => {
    throw new Error(`PlutusCompiler: never has no Plutus Data encoding at path [${path.join(".")}].`)
  },

  "UnknownKeyword": () => passthroughCodec,

  "AnyKeyword": () => passthroughCodec,

  "ObjectKeyword": (_ast, _go, path) => {
    throw new Error(`PlutusCompiler: object has no Plutus Data encoding at path [${path.join(".")}].`)
  },

  "SymbolKeyword": (_ast, _go, path) => {
    throw new Error(`PlutusCompiler: symbol has no Plutus Data encoding at path [${path.join(".")}].`)
  },

  "UniqueSymbol": (_ast, _go, path) => {
    throw new Error(`PlutusCompiler: unique symbol has no Plutus Data encoding at path [${path.join(".")}].`)
  },

  "TemplateLiteral": (_ast, _go, path) => {
    throw new Error(
      `PlutusCompiler: template literal has no Plutus Data encoding at path [${path.join(".")}]. Use Schema.Literal for enum values.`
    )
  },

  "Enums": (_ast, _go, path) => {
    throw new Error(
      `PlutusCompiler: TypeScript enums are not supported at path [${path.join(".")}]. Use Schema.Literal instead.`
    )
  }
}

// ============================================================
// Compile
// ============================================================

/**
 * The compiled Plutus codec compiler.
 * Takes an AST node and returns a PlutusCodec for it.
 *
 * @since 2.0.0
 */
export const compile: SchemaAST.Compiler<PlutusCodec> = SchemaAST.getCompiler(match)
