import { Option, Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Data from "../src/Data.js"
import * as PA from "../src/PlutusAnnotation.js"
import { compile } from "../src/PlutusCompiler.js"
import * as Plutus from "../src/PlutusSchema.js"
import * as TSchema from "../src/TSchema.js"

// Existing TSchema modules for byte-for-byte comparison
import * as ExistingAddress from "../src/plutus/Address.js"
import * as ExistingCIP68 from "../src/plutus/CIP68Metadata.js"
import * as ExistingCredential from "../src/plutus/Credential.js"
import * as ExistingOutputRef from "../src/plutus/OutputReference.js"
import * as ExistingValue from "../src/plutus/Value.js"

// Helper: compile a schema into a PlutusCodec
const codecFor = <A, I, R>(schema: Schema.Schema<A, I, R>) => compile(schema.ast, [])

// ===================================================================
// 1. Annotations
// ===================================================================

describe("Annotations", () => {
  describe("annotation symbols", () => {
    it("symbols are globally unique via Symbol.for", () => {
      expect(PA.ConstrIndexId).toBe(Symbol.for("plutus/annotation/ConstrIndex"))
      expect(PA.EncodingId).toBe(Symbol.for("plutus/annotation/Encoding"))
      expect(PA.FlatInUnionId).toBe(Symbol.for("plutus/annotation/FlatInUnion"))
      expect(PA.FlatFieldsId).toBe(Symbol.for("plutus/annotation/FlatFields"))
      expect(PA.TagFieldId).toBe(Symbol.for("plutus/annotation/TagField"))
    })
  })

  describe("attach and read annotations", () => {
    it("ConstrIndex -- attach to struct, read back", () => {
      const MyStruct = Schema.Struct({
        amount: Schema.BigIntFromSelf
      }).annotations({ [PA.ConstrIndexId]: 3 })

      const result = PA.getConstrIndex(MyStruct.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe(3)
    })

    it("ConstrIndex -- missing returns None", () => {
      const MyStruct = Schema.Struct({
        amount: Schema.BigIntFromSelf
      })

      expect(Option.isNone(PA.getConstrIndex(MyStruct.ast))).toBe(true)
    })

    it("Encoding -- attach strategy override", () => {
      const MySchema = Schema.BigIntFromSelf.annotations({
        [PA.EncodingId]: "integer" as const
      })

      const result = PA.getEncoding(MySchema.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe("integer")
    })

    it("FlatInUnion -- mark union member as flat", () => {
      const Member = Schema.Struct({
        _tag: Schema.Literal("Mint"),
        amount: Schema.BigIntFromSelf
      }).annotations({ [PA.FlatInUnionId]: true })

      const result = PA.getFlatInUnion(Member.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe(true)
    })

    it("FlatFields -- mark struct field as flat", () => {
      const Inner = Schema.Struct({
        x: Schema.BigIntFromSelf
      }).annotations({ [PA.FlatFieldsId]: true })

      const result = PA.getFlatFields(Inner.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe(true)
    })

    it("TagField -- set custom tag field name", () => {
      const MyStruct = Schema.Struct({
        kind: Schema.Literal("Mint"),
        amount: Schema.BigIntFromSelf
      }).annotations({ [PA.TagFieldId]: "kind" })

      const result = PA.getTagField(MyStruct.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe("kind")
    })

    it("TagField -- explicitly disable with false", () => {
      const MyStruct = Schema.Struct({
        _tag: Schema.Literal("Mint"),
        amount: Schema.BigIntFromSelf
      }).annotations({ [PA.TagFieldId]: false })

      const result = PA.getTagField(MyStruct.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe(false)
    })
  })

  describe("multiple annotations on same node", () => {
    it("combines ConstrIndex + FlatInUnion + TagField", () => {
      const Member = Schema.Struct({
        _tag: Schema.Literal("PubKey"),
        hash: Schema.Uint8ArrayFromSelf
      }).annotations({
        [PA.ConstrIndexId]: 0,
        [PA.FlatInUnionId]: true,
        [PA.TagFieldId]: "_tag"
      })

      expect(Option.getOrThrow(PA.getConstrIndex(Member.ast))).toBe(0)
      expect(Option.getOrThrow(PA.getFlatInUnion(Member.ast))).toBe(true)
      expect(Option.getOrThrow(PA.getTagField(Member.ast))).toBe("_tag")
    })
  })

  describe("convenience helpers", () => {
    it("constrIndex() produces annotation object", () => {
      const ann = PA.constrIndex(5)
      expect(ann[PA.ConstrIndexId]).toBe(5)
    })

    it("encoding() produces annotation object", () => {
      const ann = PA.encoding("bytes")
      expect(ann[PA.EncodingId]).toBe("bytes")
    })

    it("flatInUnion() produces annotation object", () => {
      const ann = PA.flatInUnion()
      expect(ann[PA.FlatInUnionId]).toBe(true)
    })

    it("flatFields() produces annotation object", () => {
      const ann = PA.flatFields()
      expect(ann[PA.FlatFieldsId]).toBe(true)
    })

    it("tagField() produces annotation object", () => {
      const ann = PA.tagField("kind")
      expect(ann[PA.TagFieldId]).toBe("kind")
    })

    it("convenience helpers work with .annotations()", () => {
      const MyStruct = Schema.Struct({
        amount: Schema.BigIntFromSelf
      }).annotations({
        ...PA.constrIndex(2),
        ...PA.flatInUnion(),
        ...PA.tagField("_tag")
      })

      expect(Option.getOrThrow(PA.getConstrIndex(MyStruct.ast))).toBe(2)
      expect(Option.getOrThrow(PA.getFlatInUnion(MyStruct.ast))).toBe(true)
      expect(Option.getOrThrow(PA.getTagField(MyStruct.ast))).toBe("_tag")
    })
  })

  describe("module augmentation", () => {
    it("annotations with symbol keys flow through to AST", () => {
      const MyStruct = Schema.Struct({
        amount: Schema.BigIntFromSelf
      }).annotations({
        [PA.ConstrIndexId]: 42,
        [PA.FlatInUnionId]: true,
        [PA.EncodingId]: "constr" as PA.PlutusEncoding,
        [PA.FlatFieldsId]: false,
        [PA.TagFieldId]: "_tag"
      })

      expect(Option.getOrThrow(PA.getConstrIndex(MyStruct.ast))).toBe(42)
      expect(Option.getOrThrow(PA.getFlatInUnion(MyStruct.ast))).toBe(true)
      expect(Option.getOrThrow(PA.getEncoding(MyStruct.ast))).toBe("constr")
      expect(Option.getOrThrow(PA.getFlatFields(MyStruct.ast))).toBe(false)
      expect(Option.getOrThrow(PA.getTagField(MyStruct.ast))).toBe("_tag")
    })
  })
})

// ===================================================================
// 2. Compiler
// ===================================================================

describe("Compiler", () => {
  // --- BigIntKeyword ---

  describe("BigIntKeyword", () => {
    it("bigint passes through as integer", () => {
      const codec = codecFor(Schema.BigIntFromSelf)
      expect(codec.toData(42n)).toBe(42n)
      expect(codec.fromData(42n)).toBe(42n)
    })
  })

  // --- BooleanKeyword ---

  describe("BooleanKeyword", () => {
    it("true -> Constr(1, []), false -> Constr(0, [])", () => {
      const codec = codecFor(Schema.Boolean)

      const trueData = codec.toData(true)
      expect(trueData).toBeInstanceOf(Data.Constr)
      expect((trueData as Data.Constr).index).toBe(1n)
      expect((trueData as Data.Constr).fields).toEqual([])

      const falseData = codec.toData(false)
      expect((falseData as Data.Constr).index).toBe(0n)
    })

    it("roundtrips", () => {
      const codec = codecFor(Schema.Boolean)
      expect(codec.fromData(codec.toData(true))).toBe(true)
      expect(codec.fromData(codec.toData(false))).toBe(false)
    })
  })

  // --- Literal ---

  describe("Literal", () => {
    it("string literal encodes as Constr(0, [])", () => {
      const codec = codecFor(Schema.Literal("Mint"))
      const data = codec.toData("Mint")
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).index).toBe(0n)
      expect((data as Data.Constr).fields).toEqual([])
    })

    it("bigint literal passes through as integer", () => {
      const codec = codecFor(Schema.Literal(42n))
      expect(codec.toData(42n)).toBe(42n)
    })

    it("null literal throws", () => {
      expect(() => codecFor(Schema.Literal(null))).toThrow("null cannot be encoded standalone")
    })

    it("bigint literal 0n", () => {
      const codec = compile(Schema.Literal(0n).ast, [])
      expect(codec.toData(0n)).toBe(0n)
    })

    it("negative bigint literal", () => {
      const codec = compile(Schema.Literal(-42n).ast, [])
      expect(codec.toData(-42n)).toBe(-42n)
    })

    it("boolean literal true", () => {
      const codec = compile(Schema.Literal(true).ast, [])
      const data = codec.toData(true)
      expect(data).toBeInstanceOf(Data.Constr)
      expect(codec.fromData(data)).toBe(true)
    })

    it("boolean literal false", () => {
      const codec = compile(Schema.Literal(false).ast, [])
      const data = codec.toData(false)
      expect(data).toBeInstanceOf(Data.Constr)
      expect(codec.fromData(data)).toBe(false)
    })

    it("number literal", () => {
      const codec = compile(Schema.Literal(42).ast, [])
      const data = codec.toData(42)
      expect(data).toBeInstanceOf(Data.Constr)
      expect(codec.fromData(data)).toBe(42)
    })

    it("long string literal", () => {
      const longStr = "a".repeat(1000)
      const codec = compile(Schema.Literal(longStr).ast, [])
      const data = codec.toData(longStr)
      expect(data).toBeInstanceOf(Data.Constr)
      expect(codec.fromData(data)).toBe(longStr)
    })
  })

  // --- Declaration ---

  describe("Declaration", () => {
    it("Uint8ArrayFromSelf passes through as ByteArray", () => {
      const codec = codecFor(Schema.Uint8ArrayFromSelf)
      const bytes = new Uint8Array([1, 2, 3])
      expect(codec.toData(bytes)).toEqual(bytes)
      expect(codec.fromData(bytes)).toEqual(bytes)
    })

    it("MapFromSelf encodes as Plutus Map", () => {
      const ast = Schema.MapFromSelf({
        key: Schema.BigIntFromSelf,
        value: Schema.BigIntFromSelf
      }).ast
      const codec = compile(ast, [])

      const input = new Map<bigint, bigint>([[1n, 100n], [2n, 200n]])
      const data = codec.toData(input) as Map<Data.Data, Data.Data>
      expect([...data.entries()]).toEqual([[1n, 100n], [2n, 200n]])
    })

    it("ReadonlyMapFromSelf encodes as Plutus Map", () => {
      const ast = Schema.ReadonlyMapFromSelf({
        key: Schema.BigIntFromSelf,
        value: Schema.BigIntFromSelf
      }).ast
      const codec = compile(ast, [])

      const input = new Map([[1n, 100n], [2n, 200n]])
      const data = codec.toData(input) as Map<Data.Data, Data.Data>
      expect([...data.entries()]).toEqual([[1n, 100n], [2n, 200n]])
    })

    it("SetFromSelf encodes as list", () => {
      const ast = Schema.SetFromSelf(Schema.BigIntFromSelf).ast
      const codec = compile(ast, [])
      const data = codec.toData(new Set([10n, 20n]))
      expect(Array.isArray(data)).toBe(true)
      expect(data).toEqual([10n, 20n])
    })

    it("unknown/unsupported Declaration -- DateFromSelf throws", () => {
      expect(() => compile(Schema.DateFromSelf.ast, [])).toThrow(/unsupported Declaration/)
    })

    it("unknown/unsupported Declaration -- DurationFromSelf throws", () => {
      expect(() => compile(Schema.DurationFromSelf.ast, [])).toThrow(/unsupported Declaration/)
    })

    it("unknown/unsupported Declaration -- OptionFromSelf throws", () => {
      expect(() => compile(Schema.OptionFromSelf(Schema.BigIntFromSelf).ast, [])).toThrow(/unsupported Declaration/)
    })

    it("error message includes path", () => {
      try {
        compile(
          Schema.Struct({ timestamp: Schema.DateFromSelf }).ast,
          []
        )
        expect.unreachable()
      } catch (e: unknown) {
        expect((e as Error).message).toContain("timestamp")
      }
    })
  })

  // --- TypeLiteral (Struct) ---

  describe("TypeLiteral (Struct)", () => {
    it("encodes struct as Constr(0, [fields])", () => {
      const codec = codecFor(Schema.Struct({
        amount: Schema.BigIntFromSelf,
        owner: Schema.Uint8ArrayFromSelf
      }))

      const data = codec.toData({ amount: 42n, owner: new Uint8Array([1, 2, 3]) })
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).index).toBe(0n)
      expect((data as Data.Constr).fields[0]).toBe(42n)
      expect((data as Data.Constr).fields[1]).toEqual(new Uint8Array([1, 2, 3]))
    })

    it("roundtrips", () => {
      const codec = codecFor(Schema.Struct({
        amount: Schema.BigIntFromSelf,
        owner: Schema.Uint8ArrayFromSelf
      }))

      const input = { amount: 42n, owner: new Uint8Array([1, 2, 3]) }
      const decoded = codec.fromData(codec.toData(input))
      expect(decoded.amount).toBe(42n)
      expect(decoded.owner).toEqual(new Uint8Array([1, 2, 3]))
    })

    it("respects ConstrIndex annotation", () => {
      const codec = codecFor(
        Schema.Struct({ value: Schema.BigIntFromSelf })
          .annotations({ [PA.ConstrIndexId]: 5 })
      )

      const data = codec.toData({ value: 100n })
      expect((data as Data.Constr).index).toBe(5n)
    })

    it("auto-detects _tag field and strips it", () => {
      const codec = codecFor(Schema.Struct({
        _tag: Schema.Literal("Mint"),
        amount: Schema.BigIntFromSelf
      }))

      const data = codec.toData({ _tag: "Mint" as const, amount: 100n })
      expect((data as Data.Constr).fields).toHaveLength(1)
      expect((data as Data.Constr).fields[0]).toBe(100n)

      const decoded = codec.fromData(data)
      expect(decoded._tag).toBe("Mint")
      expect(decoded.amount).toBe(100n)
    })

    it("handles nested struct", () => {
      const outerCodec = codecFor(Schema.Struct({
        inner: Schema.Struct({
          x: Schema.BigIntFromSelf,
          y: Schema.BigIntFromSelf
        }),
        z: Schema.BigIntFromSelf
      }))

      const input = { inner: { x: 1n, y: 2n }, z: 3n }
      const data = outerCodec.toData(input)

      const innerConstr = (data as Data.Constr).fields[0] as Data.Constr
      expect(innerConstr).toBeInstanceOf(Data.Constr)
      expect(innerConstr.fields).toEqual([1n, 2n])
      expect((data as Data.Constr).fields[1]).toBe(3n)

      expect(outerCodec.fromData(data)).toEqual(input)
    })

    it("handles Boolean fields", () => {
      const codec = codecFor(Schema.Struct({
        amount: Schema.BigIntFromSelf,
        active: Schema.Boolean
      }))

      const data = codec.toData({ amount: 42n, active: true })
      const boolField = (data as Data.Constr).fields[1] as Data.Constr
      expect(boolField.index).toBe(1n)

      expect(codec.fromData(data)).toEqual({ amount: 42n, active: true })
    })

    it("struct with only tag fields -> Constr(0, [])", () => {
      const codec = compile(
        Schema.Struct({ _tag: Schema.Literal("Unit") }).ast,
        []
      )

      const data = codec.toData({ _tag: "Unit" })
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).fields).toHaveLength(0)

      const decoded = codec.fromData(data)
      expect(decoded._tag).toBe("Unit")
    })

    it("struct where all fields are flat", () => {
      const A = Schema.Struct({ x: Schema.BigIntFromSelf }).annotations({ [PA.FlatFieldsId]: true })
      const B = Schema.Struct({ y: Schema.BigIntFromSelf }).annotations({ [PA.FlatFieldsId]: true })

      const codec = compile(Schema.Struct({ a: A, b: B }).ast, [])
      const data = codec.toData({ a: { x: 1n }, b: { y: 2n } })
      expect((data as Data.Constr).fields).toEqual([1n, 2n])

      const decoded = codec.fromData(data)
      expect(decoded).toEqual({ a: { x: 1n }, b: { y: 2n } })
    })

    it("struct field order matches schema definition order", () => {
      const codec = compile(
        Schema.Struct({
          z: Schema.BigIntFromSelf,
          a: Schema.BigIntFromSelf,
          m: Schema.BigIntFromSelf
        }).ast,
        []
      )

      const data = codec.toData({ z: 1n, a: 2n, m: 3n })
      expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n])
    })

    it("index signatures (Schema.Record) throw instead of silently ignoring", () => {
      const RecordSchema = Schema.Record({
        key: Schema.String,
        value: Schema.BigIntFromSelf
      })
      expect(() => compile(RecordSchema.ast, [])).toThrow(/index signatures.*not supported/)
    })
  })

  // --- Union ---

  describe("Union", () => {
    it("detects NullOr pattern", () => {
      const codec = codecFor(Schema.NullOr(Schema.BigIntFromSelf))

      const justData = codec.toData(42n)
      expect((justData as Data.Constr).index).toBe(0n)
      expect((justData as Data.Constr).fields).toEqual([42n])

      const nothingData = codec.toData(null)
      expect((nothingData as Data.Constr).index).toBe(1n)
      expect((nothingData as Data.Constr).fields).toEqual([])

      expect(codec.fromData(codec.toData(42n))).toBe(42n)
      expect(codec.fromData(codec.toData(null))).toBeNull()
    })

    it("detects UndefinedOr pattern", () => {
      const codec = codecFor(Schema.UndefinedOr(Schema.BigIntFromSelf))

      const justData = codec.toData(42n)
      expect((justData as Data.Constr).index).toBe(0n)

      const nothingData = codec.toData(undefined)
      expect((nothingData as Data.Constr).index).toBe(1n)

      expect(codec.fromData(codec.toData(42n))).toBe(42n)
      expect(codec.fromData(codec.toData(undefined))).toBeUndefined()
    })

    it("handles tagged union with auto-indexing", () => {
      const codec = codecFor(Schema.Union(
        Schema.Struct({
          _tag: Schema.Literal("Mint"),
          amount: Schema.BigIntFromSelf
        }),
        Schema.Struct({
          _tag: Schema.Literal("Burn"),
          amount: Schema.BigIntFromSelf
        })
      ))

      const mintData = codec.toData({ _tag: "Mint" as const, amount: 100n })
      expect((mintData as Data.Constr).index).toBe(0n)

      const burnData = codec.toData({ _tag: "Burn" as const, amount: 50n })
      expect((burnData as Data.Constr).index).toBe(1n)

      const mintDecoded = codec.fromData(mintData)
      expect(mintDecoded._tag).toBe("Mint")
      expect(mintDecoded.amount).toBe(100n)
    })

    it("handles flat union with ConstrIndex annotations", () => {
      const codec = codecFor(Schema.Union(
        Schema.Struct({
          _tag: Schema.Literal("PubKey"),
          hash: Schema.Uint8ArrayFromSelf
        }).annotations({
          [PA.ConstrIndexId]: 0,
          [PA.FlatInUnionId]: true
        }),
        Schema.Struct({
          _tag: Schema.Literal("Script"),
          hash: Schema.Uint8ArrayFromSelf
        }).annotations({
          [PA.ConstrIndexId]: 1,
          [PA.FlatInUnionId]: true
        })
      ))

      const pubKeyData = codec.toData({ _tag: "PubKey" as const, hash: new Uint8Array([1, 2, 3]) })
      expect((pubKeyData as Data.Constr).index).toBe(0n)
      expect((pubKeyData as Data.Constr).fields[0]).toEqual(new Uint8Array([1, 2, 3]))

      const scriptData = codec.toData({ _tag: "Script" as const, hash: new Uint8Array([4, 5, 6]) })
      expect((scriptData as Data.Constr).index).toBe(1n)

      const pubKeyDecoded = codec.fromData(pubKeyData)
      expect(pubKeyDecoded._tag).toBe("PubKey")
      expect(pubKeyDecoded.hash).toEqual(new Uint8Array([1, 2, 3]))
    })

    it("single-member union", () => {
      const codec = compile(
        Schema.Union(Schema.Struct({ _tag: Schema.Literal("Only"), value: Schema.BigIntFromSelf })).ast,
        []
      )

      const data = codec.toData({ _tag: "Only" as const, value: 42n })
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).index).toBe(0n)

      const decoded = codec.fromData(data)
      expect(decoded._tag).toBe("Only")
      expect(decoded.value).toBe(42n)
    })

    it("union where all members are flat", () => {
      const codec = compile(
        Schema.Union(
          Schema.Struct({ _tag: Schema.Literal("A"), x: Schema.BigIntFromSelf }).annotations({
            [PA.ConstrIndexId]: 0,
            [PA.FlatInUnionId]: true
          }),
          Schema.Struct({ _tag: Schema.Literal("B"), y: Schema.BigIntFromSelf }).annotations({
            [PA.ConstrIndexId]: 1,
            [PA.FlatInUnionId]: true
          })
        ).ast,
        []
      )

      const dataA = codec.toData({ _tag: "A" as const, x: 1n })
      expect((dataA as Data.Constr).index).toBe(0n)
      expect((dataA as Data.Constr).fields[0]).toBe(1n)

      const dataB = codec.toData({ _tag: "B" as const, y: 2n })
      expect((dataB as Data.Constr).index).toBe(1n)

      expect(codec.fromData(dataA)._tag).toBe("A")
      expect(codec.fromData(dataB)._tag).toBe("B")
    })

    it("union with mixed struct and primitive members", () => {
      const codec = compile(Schema.Union(Schema.BigIntFromSelf, Schema.Boolean).ast, [])

      const intData = codec.toData(42n)
      expect((intData as Data.Constr).index).toBe(0n)
      expect((intData as Data.Constr).fields[0]).toBe(42n)
    })

    it("NullOr where inner is itself a union", () => {
      const InnerUnion = Schema.Union(
        Schema.Struct({ _tag: Schema.Literal("X"), v: Schema.BigIntFromSelf }),
        Schema.Struct({ _tag: Schema.Literal("Y"), v: Schema.BigIntFromSelf })
      )
      const codec = compile(Schema.NullOr(InnerUnion).ast, [])

      const justX = codec.toData({ _tag: "X" as const, v: 1n })
      expect((justX as Data.Constr).index).toBe(0n)

      const nothing = codec.toData(null)
      expect((nothing as Data.Constr).index).toBe(1n)

      expect(codec.fromData(nothing)).toBeNull()
    })
  })

  // --- TupleType (Array / Tuple) ---

  describe("TupleType", () => {
    it("Schema.Array encodes as list", () => {
      const codec = codecFor(Schema.Array(Schema.BigIntFromSelf))

      const data = codec.toData([1n, 2n, 3n])
      expect(data).toEqual([1n, 2n, 3n])
      expect(codec.fromData(data)).toEqual([1n, 2n, 3n])
    })

    it("Schema.Tuple encodes as fixed-size array", () => {
      const codec = codecFor(Schema.Tuple(Schema.BigIntFromSelf, Schema.Uint8ArrayFromSelf))

      const input: [bigint, Uint8Array] = [42n, new Uint8Array([1, 2])]
      const data = codec.toData(input)
      expect(data).toEqual([42n, new Uint8Array([1, 2])])

      const decoded = codec.fromData(data)
      expect(decoded[0]).toBe(42n)
      expect(decoded[1]).toEqual(new Uint8Array([1, 2]))
    })

    it("empty tuple", () => {
      const codec = compile(Schema.Tuple().ast, [])
      const data = codec.toData([])
      expect(data).toEqual([])
      expect(codec.fromData(data)).toEqual([])
    })

    it("tuple with 1 element", () => {
      const codec = compile(Schema.Tuple(Schema.BigIntFromSelf).ast, [])
      const data = codec.toData([42n])
      expect(data).toEqual([42n])
      expect(codec.fromData(data)).toEqual([42n])
    })

    it("tuple where elements are themselves tuples", () => {
      const codec = compile(
        Schema.Tuple(Schema.Tuple(Schema.BigIntFromSelf, Schema.BigIntFromSelf), Schema.Tuple(Schema.BigIntFromSelf)).ast,
        []
      )

      const data = codec.toData([[1n, 2n], [3n]])
      expect(data).toEqual([[1n, 2n], [3n]])
      expect(codec.fromData(data)).toEqual([[1n, 2n], [3n]])
    })

    it("tuple with mixed primitives and structs", () => {
      const codec = compile(Schema.Tuple(Schema.BigIntFromSelf, Schema.Struct({ x: Schema.BigIntFromSelf })).ast, [])

      const data = codec.toData([42n, { x: 1n }])
      expect((data as Data.Data[])[0]).toBe(42n)
      expect(((data as Data.Data[])[1] as Data.Constr).fields[0]).toBe(1n)
    })

    it("empty array", () => {
      const codec = compile(Schema.Array(Schema.BigIntFromSelf).ast, [])
      const data = codec.toData([])
      expect(data).toEqual([])
      expect(codec.fromData(data)).toEqual([])
    })
  })

  // --- Suspend (Recursive) ---

  describe("Suspend", () => {
    it("handles recursive linked list", () => {
      interface LinkedList {
        readonly value: bigint
        readonly next: LinkedList | null
      }

      const LinkedListSchema: Schema.Schema<LinkedList> = Schema.Struct({
        value: Schema.BigIntFromSelf,
        next: Schema.NullOr(Schema.suspend((): Schema.Schema<LinkedList> => LinkedListSchema))
      })

      const codec = codecFor(LinkedListSchema)

      const list: LinkedList = {
        value: 1n,
        next: { value: 2n, next: { value: 3n, next: null } }
      }

      const data = codec.toData(list)
      expect(data).toBeInstanceOf(Data.Constr)

      const decoded = codec.fromData(data) as LinkedList
      expect(decoded.value).toBe(1n)
      expect(decoded.next!.value).toBe(2n)
      expect(decoded.next!.next!.value).toBe(3n)
      expect(decoded.next!.next!.next).toBeNull()
    })

    it("suspend that resolves to a primitive", () => {
      const Lazy = Schema.suspend(() => Schema.BigIntFromSelf)
      const codec = compile(Lazy.ast, [])
      expect(codec.toData(42n)).toBe(42n)
      expect(codec.fromData(42n)).toBe(42n)
    })

    it("double-wrapped suspend", () => {
      const Inner = Schema.suspend(() => Schema.BigIntFromSelf)
      const Outer = Schema.suspend(() => Inner)
      const codec = compile(Outer.ast, [])
      expect(codec.toData(42n)).toBe(42n)
      expect(codec.fromData(42n)).toBe(42n)
    })
  })

  // --- Transformation (look-through) ---

  describe("Transformation", () => {
    it("looks through non-TSchema transformations", () => {
      const codec = codecFor(Schema.BigInt)
      expect(codec.toData(42n)).toBe(42n)
    })

    it("Schema.Class -- compiles via from-side TypeLiteral", () => {
      class MyClass extends Schema.Class<MyClass>("MyClass")({
        value: Schema.BigIntFromSelf
      }) {}

      const codec = compile(MyClass.ast, [])

      const instance = new MyClass({ value: 42n })
      const result = codec.toData(instance)
      expect(result).toBeInstanceOf(Data.Constr)
      expect((result as Data.Constr).index).toBe(0n)
      expect((result as Data.Constr).fields[0]).toBe(42n)

      const decoded = codec.fromData(result)
      expect(decoded.value).toBe(42n)
    })

    it("Schema.TaggedClass -- compiles with _tag stripping", () => {
      class Tagged extends Schema.TaggedClass<Tagged>()("Tagged", {
        x: Schema.BigIntFromSelf
      }) {}

      const codec = compile(Tagged.ast, [])
      const instance = new Tagged({ x: 1n })
      const result = codec.toData(instance)
      expect(result).toBeInstanceOf(Data.Constr)
      expect((result as Data.Constr).fields).toHaveLength(1)
      expect((result as Data.Constr).fields[0]).toBe(1n)

      const decoded = codec.fromData(result)
      expect(decoded._tag).toBe("Tagged")
      expect(decoded.x).toBe(1n)
    })

    it("TSchema passthrough", () => {
      // TSchema types are already Transformation(A, Data.Data)
      // The compiler recognizes this and uses Schema.encodeSync/decodeSync directly
      const codec = compile(TSchema.Boolean.ast, [])
      const data = codec.toData(true)
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).index).toBe(1n)
    })
  })

  // --- Refinement (look-through) ---

  describe("Refinement", () => {
    it("looks through refinement to base type", () => {
      const PositiveBigInt = Schema.BigIntFromSelf.pipe(
        Schema.filter((n) => n > 0n)
      )
      const codec = codecFor(PositiveBigInt)
      expect(codec.toData(42n)).toBe(42n)
    })

    it("branded type looks through", () => {
      const Lovelace = Schema.BigIntFromSelf.pipe(Schema.brand("Lovelace"))
      const codec = compile(Lovelace.ast, [])
      expect(codec.toData(42n)).toBe(42n)
      expect(codec.fromData(42n)).toBe(42n)
    })

    it("chained refinements look through all the way", () => {
      const Refined = Schema.BigIntFromSelf.pipe(
        Schema.filter((n) => n > 0n),
        Schema.filter((n) => n < 1000n)
      )
      const codec = compile(Refined.ast, [])
      expect(codec.toData(42n)).toBe(42n)
    })
  })

  // --- Unsupported types ---

  describe("unsupported types", () => {
    it("string throws descriptive error", () => {
      expect(() => codecFor(Schema.String)).toThrow("string has no Plutus Data encoding")
    })

    it("number throws descriptive error", () => {
      expect(() => codecFor(Schema.Number)).toThrow("number has no Plutus Data encoding")
    })

    it("undefined standalone throws", () => {
      expect(() => codecFor(Schema.Undefined)).toThrow("undefined cannot be encoded standalone")
    })

    it("void keyword throws", () => {
      expect(() => compile(Schema.Void.ast, [])).toThrow(/void/)
    })

    it("symbol keyword throws", () => {
      expect(() => compile(Schema.SymbolFromSelf.ast, [])).toThrow(/symbol/)
    })

    it("template literal throws", () => {
      expect(() => compile(Schema.TemplateLiteral(Schema.Literal("hello"), Schema.Number).ast, [])).toThrow(/template literal/)
    })
  })
})

// ===================================================================
// 3. Public API
// ===================================================================

describe("Public API", () => {
  describe("Plutus.data() with structs", () => {
    it("encodes a struct as Constr(0, [fields]) with CBOR roundtrip", () => {
      const MyDatum = Plutus.data(Schema.Struct({
        owner: Schema.Uint8ArrayFromSelf,
        amount: Schema.BigIntFromSelf
      }))

      const codec = Plutus.codec(MyDatum)
      const input = { owner: new Uint8Array([1, 2, 3]), amount: 42n }

      const data = codec.toData(input)
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).index).toBe(0n)
      expect((data as Data.Constr).fields[0]).toEqual(new Uint8Array([1, 2, 3]))
      expect((data as Data.Constr).fields[1]).toBe(42n)

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded.owner).toEqual(new Uint8Array([1, 2, 3]))
      expect(decoded.amount).toBe(42n)
    })

    it("supports custom constructor index", () => {
      const MyAction = Plutus.data(
        Schema.Struct({ value: Schema.BigIntFromSelf }),
        { index: 5 }
      )

      const data = Plutus.codec(MyAction).toData({ value: 100n })
      expect((data as Data.Constr).index).toBe(5n)
    })

    it("handles Boolean fields", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        amount: Schema.BigIntFromSelf,
        active: Schema.Boolean
      }))

      const codec = Plutus.codec(MyStruct)

      const trueData = codec.toData({ amount: 42n, active: true })
      expect(((trueData as Data.Constr).fields[1] as Data.Constr).index).toBe(1n)

      const falseData = codec.toData({ amount: 42n, active: false })
      expect(((falseData as Data.Constr).fields[1] as Data.Constr).index).toBe(0n)

      const cbor = codec.toCBORHex({ amount: 42n, active: true })
      expect(codec.fromCBORHex(cbor)).toEqual({ amount: 42n, active: true })
    })

    it("handles tag fields with Schema.Literal", () => {
      const Tagged = Plutus.data(Schema.Struct({
        _tag: Schema.Literal("Mint"),
        amount: Schema.BigIntFromSelf
      }))

      const codec = Plutus.codec(Tagged)
      const data = codec.toData({ _tag: "Mint" as const, amount: 100n })

      expect((data as Data.Constr).fields).toHaveLength(1)
      expect((data as Data.Constr).fields[0]).toBe(100n)

      const cbor = codec.toCBORHex({ _tag: "Mint" as const, amount: 100n })
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded._tag).toBe("Mint")
      expect(decoded.amount).toBe(100n)
    })

    it("nested structs produce nested Constrs", () => {
      const Outer = Plutus.data(Schema.Struct({
        inner: Schema.Struct({
          x: Schema.BigIntFromSelf,
          y: Schema.BigIntFromSelf
        }),
        z: Schema.BigIntFromSelf
      }))

      const codec = Plutus.codec(Outer)
      const input = { inner: { x: 1n, y: 2n }, z: 3n }

      const data = codec.toData(input)
      const innerConstr = (data as Data.Constr).fields[0] as Data.Constr
      expect(innerConstr).toBeInstanceOf(Data.Constr)
      expect(innerConstr.fields).toEqual([1n, 2n])
      expect((data as Data.Constr).fields[1]).toBe(3n)

      const cbor = codec.toCBORHex(input)
      expect(codec.fromCBORHex(cbor)).toEqual(input)
    })

    it("struct with many fields preserves order", () => {
      const ManyFields = Plutus.data(Schema.Struct({
        a: Schema.BigIntFromSelf,
        b: Schema.BigIntFromSelf,
        c: Schema.BigIntFromSelf,
        d: Schema.BigIntFromSelf,
        e: Schema.BigIntFromSelf
      }))
      const codec = Plutus.codec(ManyFields)

      const input = { a: 1n, b: 2n, c: 3n, d: 4n, e: 5n }
      const data = codec.toData(input)
      expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n, 4n, 5n])

      const decoded = codec.fromData(data)
      expect(decoded).toEqual(input)
    })

    it("Schema.Class as input to Plutus.data()", () => {
      class MyClass extends Schema.Class<MyClass>("MyClass")({
        amount: Schema.BigIntFromSelf
      }) {}

      const plutusSchema = Plutus.data(MyClass)
      const codec = Plutus.codec(plutusSchema)
      const data = codec.toData(new MyClass({ amount: 42n }))
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).fields[0]).toBe(42n)
    })
  })

  describe("Plutus.data() with unions", () => {
    it("tagged union with auto-indexing", () => {
      const MyUnion = Plutus.data(Schema.Union(
        Schema.Struct({
          _tag: Schema.Literal("Mint"),
          amount: Schema.BigIntFromSelf
        }),
        Schema.Struct({
          _tag: Schema.Literal("Burn"),
          amount: Schema.BigIntFromSelf
        })
      ))

      const codec = Plutus.codec(MyUnion)

      const mintCBOR = codec.toCBORHex({ _tag: "Mint" as const, amount: 100n })
      const mintDecoded = codec.fromCBORHex(mintCBOR)
      expect(mintDecoded._tag).toBe("Mint")
      expect(mintDecoded.amount).toBe(100n)

      const burnCBOR = codec.toCBORHex({ _tag: "Burn" as const, amount: 50n })
      const burnDecoded = codec.fromCBORHex(burnCBOR)
      expect(burnDecoded._tag).toBe("Burn")
      expect(burnDecoded.amount).toBe(50n)
    })

    it("flat tagged union with explicit indices via annotations", () => {
      const Credential = Plutus.data(Schema.Union(
        Schema.Struct({ _tag: Schema.Literal("PubKey"), hash: Schema.Uint8ArrayFromSelf })
          .annotations({ [Plutus.ConstrIndexId]: 0, [Plutus.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("Script"), hash: Schema.Uint8ArrayFromSelf })
          .annotations({ [Plutus.ConstrIndexId]: 1, [Plutus.FlatInUnionId]: true })
      ))

      const codec = Plutus.codec(Credential)

      const pubKey = codec.toData({ _tag: "PubKey" as const, hash: new Uint8Array([1, 2, 3]) })
      expect((pubKey as Data.Constr).index).toBe(0n)
      expect((pubKey as Data.Constr).fields[0]).toEqual(new Uint8Array([1, 2, 3]))

      const script = codec.toData({ _tag: "Script" as const, hash: new Uint8Array([4, 5, 6]) })
      expect((script as Data.Constr).index).toBe(1n)

      const cbor = codec.toCBORHex({ _tag: "PubKey" as const, hash: new Uint8Array([1, 2, 3]) })
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded._tag).toBe("PubKey")
      expect(decoded.hash).toEqual(new Uint8Array([1, 2, 3]))
    })

    it("multi-field constructors", () => {
      const OutputDatum = Plutus.data(Schema.Union(
        Schema.Struct({ _tag: Schema.Literal("NoDatum") })
          .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("DatumHash"), hash: Schema.Uint8ArrayFromSelf })
          .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("InlineDatum"), datum: Schema.BigIntFromSelf })
          .annotations({ [PA.ConstrIndexId]: 2, [PA.FlatInUnionId]: true })
      ))

      const codec = Plutus.codec(OutputDatum)

      const noDatum = codec.toData({ _tag: "NoDatum" })
      expect((noDatum as Data.Constr).index).toBe(0n)
      expect((noDatum as Data.Constr).fields).toHaveLength(0)

      const datumHash = codec.toData({ _tag: "DatumHash", hash: new Uint8Array([0xab, 0xcd]) })
      expect((datumHash as Data.Constr).index).toBe(1n)
      expect((datumHash as Data.Constr).fields).toHaveLength(1)

      expect(codec.fromCBORHex(codec.toCBORHex({ _tag: "NoDatum" }))._tag).toBe("NoDatum")
    })

    it("10+ variant enum", () => {
      const BigEnum = Plutus.data(
        Schema.Union(
          Schema.Struct({ _tag: Schema.Literal("V0") }).annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V1") }).annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V2") }).annotations({ [PA.ConstrIndexId]: 2, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V3") }).annotations({ [PA.ConstrIndexId]: 3, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V4") }).annotations({ [PA.ConstrIndexId]: 4, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V5") }).annotations({ [PA.ConstrIndexId]: 5, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V6") }).annotations({ [PA.ConstrIndexId]: 6, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V7") }).annotations({ [PA.ConstrIndexId]: 7, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V8") }).annotations({ [PA.ConstrIndexId]: 8, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V9") }).annotations({ [PA.ConstrIndexId]: 9, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("V10") }).annotations({ [PA.ConstrIndexId]: 10, [PA.FlatInUnionId]: true })
        )
      )
      const codec = Plutus.codec(BigEnum)

      for (let i = 0; i <= 10; i++) {
        const tag = `V${i}`
        const data = codec.toData({ _tag: tag })
        expect((data as Data.Constr).index).toBe(BigInt(i))

        const decoded = codec.fromCBORHex(codec.toCBORHex({ _tag: tag }))
        expect(decoded._tag).toBe(tag)
      }
    })

    it("enum as field type inside Plutus.data()", () => {
      const Direction = Plutus.data(
        Schema.Union(
          Schema.Struct({ _tag: Schema.Literal("Up") }).annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("Down") }).annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("Left") }).annotations({ [PA.ConstrIndexId]: 2, [PA.FlatInUnionId]: true }),
          Schema.Struct({ _tag: Schema.Literal("Right") }).annotations({ [PA.ConstrIndexId]: 3, [PA.FlatInUnionId]: true })
        )
      )
      const Move = Plutus.data(
        Schema.Struct({
          direction: Direction,
          distance: Schema.BigIntFromSelf
        })
      )
      const codec = Plutus.codec(Move)

      const input = { direction: { _tag: "Left" as const }, distance: 5n }
      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded.direction._tag).toBe("Left")
      expect(decoded.distance).toBe(5n)
    })
  })

  describe("Plutus.data() with options", () => {
    it("NullOr auto-detection", () => {
      const OptionalInt = Plutus.data(Schema.NullOr(Schema.BigIntFromSelf))
      const codec = Plutus.codec(OptionalInt)

      const justData = codec.toData(42n)
      expect((justData as Data.Constr).index).toBe(0n)
      expect((justData as Data.Constr).fields).toEqual([42n])

      const nothingData = codec.toData(null)
      expect((nothingData as Data.Constr).index).toBe(1n)

      expect(codec.fromCBORHex(codec.toCBORHex(42n))).toBe(42n)
      expect(codec.fromCBORHex(codec.toCBORHex(null))).toBeNull()
    })

    it("NullOr fields in struct", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        value: Schema.BigIntFromSelf,
        optional: Schema.NullOr(Schema.BigIntFromSelf)
      }))

      const codec = Plutus.codec(MyStruct)

      const withVal = codec.toData({ value: 1n, optional: 42n })
      const optField = (withVal as Data.Constr).fields[1] as Data.Constr
      expect(optField.index).toBe(0n)
      expect(optField.fields[0]).toBe(42n)

      const withNull = codec.toData({ value: 1n, optional: null })
      const nullField = (withNull as Data.Constr).fields[1] as Data.Constr
      expect(nullField.index).toBe(1n)

      expect(codec.fromCBORHex(codec.toCBORHex({ value: 1n, optional: 42n }))).toEqual({
        value: 1n, optional: 42n
      })
      expect(codec.fromCBORHex(codec.toCBORHex({ value: 1n, optional: null }))).toEqual({
        value: 1n, optional: null
      })
    })
  })

  describe("Plutus.data() with arrays", () => {
    it("derives from Schema.Array", () => {
      const IntList = Plutus.data(Schema.Array(Schema.BigIntFromSelf))
      const codec = Plutus.codec(IntList)

      const cbor = codec.toCBORHex([1n, 2n, 3n])
      expect(codec.fromCBORHex(cbor)).toEqual([1n, 2n, 3n])
    })

    it("array of structs", () => {
      const Item = Schema.Struct({
        id: Schema.BigIntFromSelf,
        data: Schema.Uint8ArrayFromSelf
      })

      const Items = Plutus.data(Schema.Array(Item))
      const codec = Plutus.codec(Items)

      const input = [
        { id: 1n, data: new Uint8Array([1]) },
        { id: 2n, data: new Uint8Array([2]) },
        { id: 3n, data: new Uint8Array([3]) }
      ]

      const cbor = codec.toCBORHex(input)
      expect(codec.fromCBORHex(cbor)).toEqual(input)
    })

    it("struct with array field", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        values: Schema.Array(Schema.BigIntFromSelf),
        count: Schema.BigIntFromSelf
      }))
      const codec = Plutus.codec(MyStruct)

      const input = { values: [1n, 2n, 3n], count: 3n }
      expect(codec.fromCBORHex(codec.toCBORHex(input))).toEqual(input)
    })

    it("tuple of heterogeneous types", () => {
      const MyTuple = Plutus.data(Schema.Tuple(
        Schema.BigIntFromSelf,
        Schema.Uint8ArrayFromSelf,
        Schema.Boolean
      ))
      const codec = Plutus.codec(MyTuple)

      const input: [bigint, Uint8Array, boolean] = [42n, new Uint8Array([1, 2]), true]
      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded[0]).toBe(42n)
      expect(decoded[1]).toEqual(new Uint8Array([1, 2]))
      expect(decoded[2]).toBe(true)
    })
  })

  describe("Plutus.data() with maps", () => {
    it("MapFromSelf auto-derivation", () => {
      const MyMap = Plutus.data(
        Schema.MapFromSelf({ key: Schema.BigIntFromSelf, value: Schema.Uint8ArrayFromSelf })
      )
      const codec = Plutus.codec(MyMap)

      const input = new Map<bigint, Uint8Array>([
        [1n, new Uint8Array([0x01])],
        [2n, new Uint8Array([0x02, 0x03])]
      ])

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect([...decoded.entries()]).toEqual([...input.entries()])
    })

    it("Schema.Map auto-derivation", () => {
      const MyMap = Plutus.data(
        Schema.Map({ key: Schema.BigIntFromSelf, value: Schema.BigIntFromSelf })
      )
      const codec = Plutus.codec(MyMap)

      const input = new Map<bigint, bigint>([[10n, 100n], [20n, 200n]])

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect([...decoded.entries()]).toEqual([...input.entries()])
    })

    it("Map auto-derivation matches TSchema.Map CBOR", () => {
      const tschemaMap = TSchema.Map(TSchema.ByteArray, TSchema.Integer)
      const plutusMap = Plutus.data(
        Schema.MapFromSelf({ key: Schema.Uint8ArrayFromSelf, value: Schema.BigIntFromSelf })
      )

      const input = new Map<Uint8Array, bigint>([
        [new Uint8Array([0xaa]), 42n],
        [new Uint8Array([0xbb]), 99n]
      ])

      const tchemaCbor = Plutus.codec(tschemaMap).toCBORHex(input)
      const plutusCbor = Plutus.codec(plutusMap).toCBORHex(input)
      expect(plutusCbor).toBe(tchemaCbor)
    })

    it("nested Map (Value pattern)", () => {
      const Value = Plutus.data(
        Schema.MapFromSelf({
          key: Schema.Uint8ArrayFromSelf,
          value: Schema.MapFromSelf({
            key: Schema.Uint8ArrayFromSelf,
            value: Schema.BigIntFromSelf
          })
        })
      )
      const codec = Plutus.codec(Value)

      const policyId = new Uint8Array(28).fill(0xaa)
      const assetName = new Uint8Array([0x41, 0x42])
      const input = new Map([[policyId, new Map([[assetName, 1000n]])]])

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      const entries = [...decoded.entries()]
      expect(entries).toHaveLength(1)
      const innerEntries = [...(entries[0][1] as Map<any, any>).entries()]
      expect(innerEntries[0][1]).toBe(1000n)
    })

    it("Map in struct field", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        name: Schema.Uint8ArrayFromSelf,
        balances: Schema.MapFromSelf({
          key: Schema.Uint8ArrayFromSelf,
          value: Schema.BigIntFromSelf
        })
      }))
      const codec = Plutus.codec(MyStruct)

      const input = {
        name: new Uint8Array([0x01]),
        balances: new Map([[new Uint8Array([0xaa]), 100n]])
      }

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded.name).toEqual(new Uint8Array([0x01]))
      expect([...decoded.balances.entries()]).toEqual([...input.balances.entries()])
    })
  })

  describe("Plutus.data() with recursive types", () => {
    it("handles recursive linked list via Schema.suspend", () => {
      interface LinkedList {
        readonly value: bigint
        readonly next: LinkedList | null
      }

      const LinkedList: Schema.Schema<LinkedList, Data.Data> = Plutus.data(
        Schema.Struct({
          value: Schema.BigIntFromSelf,
          next: Schema.NullOr(Schema.suspend((): Schema.Schema<LinkedList, Data.Data> => LinkedList))
        })
      )

      const codec = Plutus.codec(LinkedList)

      const list: LinkedList = {
        value: 1n,
        next: { value: 2n, next: { value: 3n, next: null } }
      }

      const cbor = codec.toCBORHex(list)
      const decoded = codec.fromCBORHex(cbor) as LinkedList
      expect(decoded.value).toBe(1n)
      expect(decoded.next!.value).toBe(2n)
      expect(decoded.next!.next!.value).toBe(3n)
      expect(decoded.next!.next!.next).toBeNull()
    })
  })

  describe("TSchema field mixing", () => {
    it("TSchema.Boolean in data() struct", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        native: Schema.BigIntFromSelf,
        plutusBool: TSchema.Boolean
      }))
      const codec = Plutus.codec(MyStruct)

      const cbor = codec.toCBORHex({ native: 42n, plutusBool: true })
      expect(codec.fromCBORHex(cbor)).toEqual({ native: 42n, plutusBool: true })
    })

    it("TSchema.Integer in data() struct", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        tschemaInt: TSchema.Integer,
        nativeInt: Schema.BigIntFromSelf
      }))
      const codec = Plutus.codec(MyStruct)

      const cbor = codec.toCBORHex({ tschemaInt: 1n, nativeInt: 2n })
      expect(codec.fromCBORHex(cbor)).toEqual({ tschemaInt: 1n, nativeInt: 2n })
    })

    it("TSchema.ByteArray in data() struct", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        hash: TSchema.ByteArray,
        amount: Schema.BigIntFromSelf
      }))
      const codec = Plutus.codec(MyStruct)

      const input = { hash: new Uint8Array([0xde, 0xad]), amount: 42n }
      const cbor = codec.toCBORHex(input)
      expect(codec.fromCBORHex(cbor)).toEqual(input)
    })

    it("TSchema.NullOr in data() struct", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        value: Schema.BigIntFromSelf,
        optional: TSchema.NullOr(TSchema.Integer)
      }))
      const codec = Plutus.codec(MyStruct)

      expect(codec.fromCBORHex(codec.toCBORHex({ value: 1n, optional: 42n }))).toEqual({
        value: 1n, optional: 42n
      })
      expect(codec.fromCBORHex(codec.toCBORHex({ value: 1n, optional: null }))).toEqual({
        value: 1n, optional: null
      })
    })
  })

  describe("combinator re-exports", () => {
    it("Plutus.codec is Data.withSchema", () => {
      expect(Plutus.codec).toBe(Data.withSchema)
    })

    it("Plutus.Variant works (TSchema passthrough)", () => {
      const Credential = Plutus.Variant({
        PubKey: { hash: Plutus.ByteArray },
        Script: { hash: Plutus.ByteArray }
      })

      const codec = Plutus.codec(Credential)
      const input = { PubKey: { hash: new Uint8Array([1, 2, 3]) } }

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded).toEqual(input)
    })

    it("Plutus.List works (TSchema passthrough)", () => {
      const codec = Plutus.codec(Plutus.List(Plutus.Integer))
      expect(codec.fromCBORHex(codec.toCBORHex([1n, 2n, 3n]))).toEqual([1n, 2n, 3n])
    })

    it("Plutus.Map works (TSchema passthrough)", () => {
      const codec = Plutus.codec(Plutus.Map(Plutus.ByteArray, Plutus.Integer))
      const input = new globalThis.Map([[new Uint8Array([1]), 100n]])

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect([...decoded.entries()]).toEqual([...input.entries()])
    })

    it("Plutus.Tuple works (TSchema passthrough)", () => {
      const codec = Plutus.codec(Plutus.Tuple([Plutus.Integer, Plutus.ByteArray]))
      const input: [bigint, Uint8Array] = [42n, new Uint8Array([1, 2])]

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded[0]).toBe(42n)
      expect(decoded[1]).toEqual(new Uint8Array([1, 2]))
    })
  })

  describe("compatibility with Data.withSchema", () => {
    it("data() result works with Data.withSchema directly", () => {
      const MyDatum = Plutus.data(Schema.Struct({ amount: Schema.BigIntFromSelf }))

      const codec = Data.withSchema(MyDatum)
      const data = codec.toData({ amount: 42n })
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).fields[0]).toBe(42n)
    })

    it("Plutus.data() return type is Schema<A, Data.Data>", () => {
      const MyDatum = Plutus.data(Schema.Struct({
        amount: Schema.BigIntFromSelf
      }))

      const encode = Schema.encodeSync(MyDatum)
      const decode = Schema.decodeSync(MyDatum)

      const data = encode({ amount: 42n })
      expect(data).toBeInstanceOf(Data.Constr)

      const value = decode(data)
      expect(value.amount).toBe(42n)
    })
  })

  describe("error messages", () => {
    it("string field gives helpful error with path", () => {
      try {
        Plutus.data(Schema.Struct({ name: Schema.String }))
        expect.unreachable()
      } catch (e: any) {
        expect(e.message).toContain("string")
        expect(e.message).toContain("Plutus")
        expect(e.message).toContain("name")
      }
    })

    it("number field gives helpful error with path", () => {
      try {
        Plutus.data(Schema.Struct({ count: Schema.Number }))
        expect.unreachable()
      } catch (e: any) {
        expect(e.message).toContain("number")
        expect(e.message).toContain("count")
      }
    })

    it("null literal standalone gives helpful error", () => {
      try {
        Plutus.data(Schema.Literal(null))
        expect.unreachable()
      } catch (e: any) {
        expect(e.message).toContain("null")
        expect(e.message).toContain("NullOr")
      }
    })

    it("undefined standalone error is clear", () => {
      try {
        compile(Schema.Undefined.ast, ["root"])
        expect.unreachable()
      } catch (e: any) {
        expect(e.message).toContain("undefined")
        expect(e.message).toContain("UndefinedOr")
      }
    })

    it("encoding with wrong type throws", () => {
      const codec = Plutus.codec(Plutus.data(Schema.Struct({
        amount: Schema.BigIntFromSelf
      })))
      expect(() => codec.toData({ amount: "not a bigint" as any })).toThrow()
    })

    it("fromData with wrong Data shape throws", () => {
      const codec = Plutus.codec(Plutus.data(Schema.Struct({
        amount: Schema.BigIntFromSelf
      })))
      expect(() => codec.fromData(42n)).toThrow()
    })
  })
})

// ===================================================================
// 4. Real-world types
// ===================================================================

describe("Real-world types", () => {
  // --- Re-implementations using Plutus.data() ---

  const OutputReference_v2 = Plutus.data(Schema.Struct({
    transaction_id: Schema.Uint8ArrayFromSelf,
    output_index: Schema.BigIntFromSelf
  }))

  const Credential_v2 = Plutus.data(Schema.Union(
    Schema.Struct({ _tag: Schema.Literal("VerificationKey"), hash: Schema.Uint8ArrayFromSelf })
      .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
    Schema.Struct({ _tag: Schema.Literal("Script"), hash: Schema.Uint8ArrayFromSelf })
      .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
  ))

  const PaymentCredential_v2 = Plutus.data(Schema.Union(
    Schema.Struct({ _tag: Schema.Literal("VerificationKey"), hash: Schema.Uint8ArrayFromSelf })
      .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
    Schema.Struct({ _tag: Schema.Literal("Script"), hash: Schema.Uint8ArrayFromSelf })
      .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
  ))

  const StakeCredential_v2 = Plutus.data(Schema.Union(
    Schema.Struct({ _tag: Schema.Literal("Inline"), credential: Credential_v2 })
      .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
    Schema.Struct({
      _tag: Schema.Literal("Pointer"),
      slot_number: Schema.BigIntFromSelf,
      transaction_index: Schema.BigIntFromSelf,
      certificate_index: Schema.BigIntFromSelf
    })
      .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
  ))

  const Address_v2 = Plutus.data(Schema.Struct({
    payment_credential: PaymentCredential_v2,
    stake_credential: Schema.UndefinedOr(StakeCredential_v2)
  }))

  // --- OutputReference ---

  describe("OutputReference", () => {
    const txId = new Uint8Array(32).fill(0xab)

    it("matches TSchema CBOR for basic output reference", () => {
      const input = { transaction_id: txId, output_index: 0n }
      const existingCbor = ExistingOutputRef.Codec.toCBORHex(input)
      const v2Cbor = Plutus.codec(OutputReference_v2).toCBORHex(input)
      expect(v2Cbor).toBe(existingCbor)
    })

    it("matches TSchema CBOR for output reference with large index", () => {
      const input = { transaction_id: txId, output_index: 999n }
      const existingCbor = ExistingOutputRef.Codec.toCBORHex(input)
      const v2Cbor = Plutus.codec(OutputReference_v2).toCBORHex(input)
      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips correctly", () => {
      const input = { transaction_id: txId, output_index: 42n }
      const codec = Plutus.codec(OutputReference_v2)
      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded.transaction_id).toEqual(txId)
      expect(decoded.output_index).toBe(42n)
    })
  })

  // --- Credential ---

  describe("Credential", () => {
    const hash28 = new Uint8Array(28).fill(0xcd)

    it("matches TSchema CBOR for VerificationKey credential", () => {
      const tschemaInput = { VerificationKey: { hash: hash28 } }
      const v2Input = { _tag: "VerificationKey" as const, hash: hash28 }

      const existingCbor = ExistingCredential.CredentialCodec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(Credential_v2).toCBORHex(v2Input)
      expect(v2Cbor).toBe(existingCbor)
    })

    it("matches TSchema CBOR for Script credential", () => {
      const tschemaInput = { Script: { hash: hash28 } }
      const v2Input = { _tag: "Script" as const, hash: hash28 }

      const existingCbor = ExistingCredential.CredentialCodec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(Credential_v2).toCBORHex(v2Input)
      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips VerificationKey correctly", () => {
      const codec = Plutus.codec(Credential_v2)
      const input = { _tag: "VerificationKey" as const, hash: hash28 }
      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded._tag).toBe("VerificationKey")
      expect(decoded.hash).toEqual(hash28)
    })

    it("roundtrips Script correctly", () => {
      const codec = Plutus.codec(Credential_v2)
      const input = { _tag: "Script" as const, hash: hash28 }
      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded._tag).toBe("Script")
      expect(decoded.hash).toEqual(hash28)
    })
  })

  // --- StakeCredential ---

  describe("StakeCredential", () => {
    const hash28 = new Uint8Array(28).fill(0xef)

    it("matches TSchema CBOR for Inline stake credential", () => {
      const tschemaInput = {
        Inline: { credential: { VerificationKey: { hash: hash28 } } }
      }
      const v2Input = {
        _tag: "Inline" as const,
        credential: { _tag: "VerificationKey" as const, hash: hash28 }
      }

      const existingCbor = ExistingCredential.StakeCredentialCodec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(StakeCredential_v2).toCBORHex(v2Input)
      expect(v2Cbor).toBe(existingCbor)
    })

    it("matches TSchema CBOR for Pointer stake credential", () => {
      const tschemaInput = {
        Pointer: { slot_number: 100n, transaction_index: 5n, certificate_index: 2n }
      }
      const v2Input = {
        _tag: "Pointer" as const,
        slot_number: 100n,
        transaction_index: 5n,
        certificate_index: 2n
      }

      const existingCbor = ExistingCredential.StakeCredentialCodec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(StakeCredential_v2).toCBORHex(v2Input)
      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips Pointer correctly", () => {
      const codec = Plutus.codec(StakeCredential_v2)
      const input = {
        _tag: "Pointer" as const,
        slot_number: 100n,
        transaction_index: 5n,
        certificate_index: 2n
      }
      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded._tag).toBe("Pointer")
      expect(decoded.slot_number).toBe(100n)
      expect(decoded.transaction_index).toBe(5n)
      expect(decoded.certificate_index).toBe(2n)
    })
  })

  // --- Address ---

  describe("Address", () => {
    const payHash = new Uint8Array(28).fill(0x11)
    const stakeHash = new Uint8Array(28).fill(0x22)

    it("matches TSchema CBOR for address without stake credential", () => {
      const tschemaInput = {
        payment_credential: { VerificationKey: { hash: payHash } },
        stake_credential: undefined
      }
      const v2Input = {
        payment_credential: { _tag: "VerificationKey" as const, hash: payHash },
        stake_credential: undefined
      }

      const existingCbor = ExistingAddress.Codec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(Address_v2).toCBORHex(v2Input)
      expect(v2Cbor).toBe(existingCbor)
    })

    it("matches TSchema CBOR for address with inline stake credential", () => {
      const tschemaInput = {
        payment_credential: { VerificationKey: { hash: payHash } },
        stake_credential: {
          Inline: { credential: { VerificationKey: { hash: stakeHash } } }
        }
      }
      const v2Input = {
        payment_credential: { _tag: "VerificationKey" as const, hash: payHash },
        stake_credential: {
          _tag: "Inline" as const,
          credential: { _tag: "VerificationKey" as const, hash: stakeHash }
        }
      }

      const existingCbor = ExistingAddress.Codec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(Address_v2).toCBORHex(v2Input)
      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips address with stake credential", () => {
      const codec = Plutus.codec(Address_v2)
      const input = {
        payment_credential: { _tag: "Script" as const, hash: payHash },
        stake_credential: {
          _tag: "Pointer" as const,
          slot_number: 10n,
          transaction_index: 1n,
          certificate_index: 0n
        }
      }

      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded.payment_credential._tag).toBe("Script")
      expect(decoded.payment_credential.hash).toEqual(payHash)
      expect(decoded.stake_credential!._tag).toBe("Pointer")
      expect(decoded.stake_credential!.slot_number).toBe(10n)
    })
  })

  // --- Value ---

  describe("Value", () => {
    it("Value uses Plutus.Map combinator", () => {
      const Value = Plutus.Map(Plutus.ByteArray, Plutus.Map(Plutus.ByteArray, Plutus.Integer))
      const codec = Plutus.codec(Value)

      const policyId = new Uint8Array(28).fill(0xaa)
      const assetName = new Uint8Array([0x41, 0x42, 0x43])

      const input = new Map([[policyId, new Map([[assetName, 1000n]])]])

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)

      const entries = [...decoded.entries()]
      expect(entries).toHaveLength(1)
      const innerEntries = [...(entries[0][1] as Map<any, any>).entries()]
      expect(innerEntries[0][1]).toBe(1000n)
    })

    it("Value CBOR matches existing TSchema version", () => {
      const policyId = new Uint8Array(28).fill(0xbb)
      const assetName = new Uint8Array([0x44])

      const input = new Map([[policyId, new Map([[assetName, 500n]])]])

      const existingCbor = ExistingValue.Codec.toCBORHex(input)
      const v2Value = Plutus.Map(Plutus.ByteArray, Plutus.Map(Plutus.ByteArray, Plutus.Integer))
      const v2Cbor = Plutus.codec(v2Value).toCBORHex(input)
      expect(v2Cbor).toBe(existingCbor)
    })
  })

  // --- CIP68 Metadata ---

  describe("CIP68Metadata", () => {
    it("matches TSchema CBOR for simple CIP68 datum", () => {
      const CIP68_v2 = Plutus.data(Schema.Struct({
        metadata: Schema.Unknown,
        version: Schema.BigIntFromSelf,
        extra: Schema.Array(Schema.Unknown)
      }))

      const input = { metadata: 42n, version: 1n, extra: [] as unknown[] }

      const existingCbor = ExistingCIP68.Codec.toCBORHex(input)
      const v2Cbor = Plutus.codec(CIP68_v2).toCBORHex(input)
      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips CIP68 datum with metadata", () => {
      const CIP68_v2 = Plutus.data(Schema.Struct({
        metadata: Schema.Unknown,
        version: Schema.BigIntFromSelf,
        extra: Schema.Array(Schema.Unknown)
      }))

      const codec = Plutus.codec(CIP68_v2)
      const input = { metadata: 100n, version: 2n, extra: [1n, 2n] }
      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded.version).toBe(2n)
    })
  })

  // --- Complex contract types ---

  describe("complex contract types", () => {
    it("TxInfo-like type (nested structs + unions + options)", () => {
      const OutputDatum = Plutus.data(Schema.Union(
        Schema.Struct({ _tag: Schema.Literal("NoDatum") })
          .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("DatumHash"), hash: Schema.Uint8ArrayFromSelf })
          .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("InlineDatum"), datum: Schema.BigIntFromSelf })
          .annotations({ [PA.ConstrIndexId]: 2, [PA.FlatInUnionId]: true })
      ))

      const TxOut = Plutus.data(Schema.Struct({
        address: Schema.Uint8ArrayFromSelf,
        value: Schema.BigIntFromSelf,
        datum: OutputDatum
      }))

      const TxInInfo = Plutus.data(Schema.Struct({
        out_ref: Schema.Struct({
          tx_id: Schema.Uint8ArrayFromSelf,
          idx: Schema.BigIntFromSelf
        }),
        resolved: TxOut
      }))

      const codec = Plutus.codec(TxInInfo)

      const input = {
        out_ref: { tx_id: new Uint8Array(32).fill(0xab), idx: 0n },
        resolved: {
          address: new Uint8Array(28).fill(0xcd),
          value: 2000000n,
          datum: { _tag: "InlineDatum" as const, datum: 42n }
        }
      }

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded.out_ref.idx).toBe(0n)
      expect(decoded.resolved.value).toBe(2000000n)
      expect(decoded.resolved.datum._tag).toBe("InlineDatum")
      expect(decoded.resolved.datum.datum).toBe(42n)
    })

    it("ScriptPurpose-like type (4-variant sum)", () => {
      const ScriptPurpose = Plutus.data(Schema.Union(
        Schema.Struct({ _tag: Schema.Literal("Minting"), policy_id: Schema.Uint8ArrayFromSelf })
          .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("Spending"), tx_out_ref: Schema.Struct({
          tx_id: Schema.Uint8ArrayFromSelf,
          idx: Schema.BigIntFromSelf
        }) })
          .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("Rewarding"), stake_cred: Schema.Uint8ArrayFromSelf })
          .annotations({ [PA.ConstrIndexId]: 2, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("Certifying"), cert_idx: Schema.BigIntFromSelf })
          .annotations({ [PA.ConstrIndexId]: 3, [PA.FlatInUnionId]: true })
      ))

      const codec = Plutus.codec(ScriptPurpose)

      const minting = codec.toData({
        _tag: "Minting",
        policy_id: new Uint8Array(28).fill(0x01)
      })
      expect((minting as Data.Constr).index).toBe(0n)

      const spending = codec.toData({
        _tag: "Spending",
        tx_out_ref: { tx_id: new Uint8Array(32).fill(0x02), idx: 5n }
      })
      expect((spending as Data.Constr).index).toBe(1n)

      const spendingDecoded = codec.fromCBORHex(codec.toCBORHex({
        _tag: "Spending",
        tx_out_ref: { tx_id: new Uint8Array(32).fill(0x02), idx: 5n }
      }))
      expect(spendingDecoded._tag).toBe("Spending")
      expect(spendingDecoded.tx_out_ref.idx).toBe(5n)
    })

    it("recursive NativeScript (6-variant sum with recursive arrays)", () => {
      interface NativeScript {
        readonly _tag: "ScriptPubkey" | "ScriptAll" | "ScriptAny" | "ScriptNOfK" | "TimelockStart" | "TimelockExpiry"
        readonly [key: string]: any
      }

      const NativeScript: Schema.Schema<NativeScript, Data.Data> = Plutus.data(Schema.Union(
        Schema.Struct({ _tag: Schema.Literal("ScriptPubkey"), key_hash: Schema.Uint8ArrayFromSelf })
          .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("ScriptAll"), scripts: Schema.Array(Schema.suspend((): Schema.Schema<NativeScript, Data.Data> => NativeScript)) })
          .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("ScriptAny"), scripts: Schema.Array(Schema.suspend((): Schema.Schema<NativeScript, Data.Data> => NativeScript)) })
          .annotations({ [PA.ConstrIndexId]: 2, [PA.FlatInUnionId]: true }),
        Schema.Struct({
          _tag: Schema.Literal("ScriptNOfK"),
          n: Schema.BigIntFromSelf,
          scripts: Schema.Array(Schema.suspend((): Schema.Schema<NativeScript, Data.Data> => NativeScript))
        })
          .annotations({ [PA.ConstrIndexId]: 3, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("TimelockStart"), time: Schema.BigIntFromSelf })
          .annotations({ [PA.ConstrIndexId]: 4, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("TimelockExpiry"), time: Schema.BigIntFromSelf })
          .annotations({ [PA.ConstrIndexId]: 5, [PA.FlatInUnionId]: true })
      ))

      const codec = Plutus.codec(NativeScript)

      const script = {
        _tag: "ScriptAll" as const,
        scripts: [
          { _tag: "ScriptPubkey" as const, key_hash: new Uint8Array(28).fill(0x01) },
          {
            _tag: "ScriptAny" as const,
            scripts: [
              { _tag: "ScriptPubkey" as const, key_hash: new Uint8Array(28).fill(0x02) },
              { _tag: "TimelockStart" as const, time: 1000000n }
            ]
          }
        ]
      }

      const cbor = codec.toCBORHex(script)
      const decoded = codec.fromCBORHex(cbor)

      expect(decoded._tag).toBe("ScriptAll")
      expect(decoded.scripts).toHaveLength(2)
      expect(decoded.scripts[0]._tag).toBe("ScriptPubkey")
      expect(decoded.scripts[1]._tag).toBe("ScriptAny")
      expect(decoded.scripts[1].scripts[1]._tag).toBe("TimelockStart")
      expect(decoded.scripts[1].scripts[1].time).toBe(1000000n)
    })
  })
})

// ===================================================================
// 5. Edge cases
// ===================================================================

describe("Edge cases", () => {
  describe("deeply nested recursion", () => {
    it("binary tree with recursive left/right branches", () => {
      interface Tree {
        readonly value: bigint
        readonly left: Tree | null
        readonly right: Tree | null
      }

      const TreeSchema: Schema.Schema<Tree, Data.Data> = Plutus.data(
        Schema.Struct({
          value: Schema.BigIntFromSelf,
          left: Schema.NullOr(Schema.suspend((): Schema.Schema<Tree, Data.Data> => TreeSchema)),
          right: Schema.NullOr(Schema.suspend((): Schema.Schema<Tree, Data.Data> => TreeSchema))
        })
      )

      const codec = Plutus.codec(TreeSchema)

      const tree: Tree = {
        value: 1n,
        left: {
          value: 2n,
          left: { value: 4n, left: null, right: null },
          right: { value: 5n, left: null, right: null }
        },
        right: {
          value: 3n,
          left: null,
          right: { value: 6n, left: null, right: null }
        }
      }

      const cbor = codec.toCBORHex(tree)
      const decoded = codec.fromCBORHex(cbor) as Tree
      expect(decoded.value).toBe(1n)
      expect(decoded.left!.value).toBe(2n)
      expect(decoded.left!.left!.value).toBe(4n)
      expect(decoded.left!.right!.value).toBe(5n)
      expect(decoded.right!.value).toBe(3n)
      expect(decoded.right!.left).toBeNull()
      expect(decoded.right!.right!.value).toBe(6n)
    })

    it("deeply nested linked list (10 levels)", () => {
      interface LinkedList {
        readonly value: bigint
        readonly next: LinkedList | null
      }

      const LinkedListSchema: Schema.Schema<LinkedList, Data.Data> = Plutus.data(
        Schema.Struct({
          value: Schema.BigIntFromSelf,
          next: Schema.NullOr(Schema.suspend((): Schema.Schema<LinkedList, Data.Data> => LinkedListSchema))
        })
      )

      const codec = Plutus.codec(LinkedListSchema)

      let list: LinkedList = { value: 10n, next: null }
      for (let i = 9n; i >= 1n; i--) {
        list = { value: i, next: list }
      }

      const cbor = codec.toCBORHex(list)
      const decoded = codec.fromCBORHex(cbor) as LinkedList

      let current: LinkedList | null = decoded
      for (let i = 1n; i <= 10n; i++) {
        expect(current).not.toBeNull()
        expect(current!.value).toBe(i)
        current = current!.next
      }
      expect(current).toBeNull()
    })
  })

  describe("mutual recursion", () => {
    it("Expr/BinOp mutual recursion via Schema.suspend", () => {
      type Expr = Lit | BinOp
      interface Lit { readonly _tag: "Lit"; readonly value: bigint }
      interface BinOp { readonly _tag: "BinOp"; readonly left: Expr; readonly right: Expr }

      const Expr: Schema.Schema<Expr, Data.Data> = Plutus.data(
        Schema.Union(
          Schema.Struct({ _tag: Schema.Literal("Lit"), value: Schema.BigIntFromSelf }),
          Schema.Struct({
            _tag: Schema.Literal("BinOp"),
            left: Schema.suspend((): Schema.Schema<Expr, Data.Data> => Expr),
            right: Schema.suspend((): Schema.Schema<Expr, Data.Data> => Expr)
          })
        )
      )

      const codec = Plutus.codec(Expr)

      const expr: Expr = {
        _tag: "BinOp",
        left: { _tag: "Lit", value: 1n },
        right: {
          _tag: "BinOp",
          left: { _tag: "Lit", value: 2n },
          right: { _tag: "Lit", value: 3n }
        }
      }

      const cbor = codec.toCBORHex(expr)
      const decoded = codec.fromCBORHex(cbor) as BinOp
      expect(decoded._tag).toBe("BinOp")
      expect((decoded.left as Lit)._tag).toBe("Lit")
      expect((decoded.left as Lit).value).toBe(1n)
      expect((decoded.right as BinOp)._tag).toBe("BinOp")
      expect(((decoded.right as BinOp).right as Lit).value).toBe(3n)
    })

    it("A -> B -> A mutual recursion (separate schemas)", () => {
      interface A { readonly value: bigint; readonly b: B }
      interface B { readonly label: bigint; readonly a: A | null }

      const ASchema: Schema.Schema<A, Data.Data> = Plutus.data(
        Schema.Struct({
          value: Schema.BigIntFromSelf,
          b: Schema.suspend((): Schema.Schema<B, Data.Data> => BSchema)
        })
      )

      const BSchema: Schema.Schema<B, Data.Data> = Plutus.data(
        Schema.Struct({
          label: Schema.BigIntFromSelf,
          a: Schema.NullOr(Schema.suspend((): Schema.Schema<A, Data.Data> => ASchema))
        })
      )

      const codec = Plutus.codec(ASchema)

      const input: A = {
        value: 1n,
        b: {
          label: 2n,
          a: {
            value: 3n,
            b: { label: 4n, a: null }
          }
        }
      }

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor) as A
      expect(decoded.value).toBe(1n)
      expect(decoded.b.label).toBe(2n)
      expect(decoded.b.a!.value).toBe(3n)
      expect(decoded.b.a!.b.label).toBe(4n)
      expect(decoded.b.a!.b.a).toBeNull()
    })
  })

  describe("nested options", () => {
    it("nested options: NullOr(NullOr(Integer))", () => {
      const NestedOpt = Plutus.data(
        Schema.NullOr(Schema.NullOr(Schema.BigIntFromSelf))
      )
      const codec = Plutus.codec(NestedOpt)

      const jj = codec.toData(42n)
      expect((jj as Data.Constr).index).toBe(0n)
      const inner = (jj as Data.Constr).fields[0] as Data.Constr
      expect(inner.index).toBe(0n)
      expect(inner.fields[0]).toBe(42n)

      const jn = codec.toData(null)
      expect((jn as Data.Constr).index).toBe(1n)

      expect(codec.fromCBORHex(codec.toCBORHex(42n))).toBe(42n)
      expect(codec.fromCBORHex(codec.toCBORHex(null))).toBeNull()
    })

    it("option in struct field", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        required: Schema.BigIntFromSelf,
        optional: Schema.NullOr(Schema.Uint8ArrayFromSelf)
      }))
      const codec = Plutus.codec(MyStruct)

      const withValue = { required: 1n, optional: new Uint8Array([1, 2, 3]) }
      const withNull = { required: 1n, optional: null }

      expect(codec.fromCBORHex(codec.toCBORHex(withValue))).toEqual(withValue)
      expect(codec.fromCBORHex(codec.toCBORHex(withNull))).toEqual(withNull)
    })

    it("UndefinedOr in struct field", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        value: Schema.BigIntFromSelf,
        maybe: Schema.UndefinedOr(Schema.BigIntFromSelf)
      }))
      const codec = Plutus.codec(MyStruct)

      const withValue = { value: 1n, maybe: 42n }
      const withUndef = { value: 1n, maybe: undefined }

      expect(codec.fromCBORHex(codec.toCBORHex(withValue))).toEqual(withValue)
      expect(codec.fromCBORHex(codec.toCBORHex(withUndef))).toEqual(withUndef)
    })

    it("option of boolean", () => {
      const OptBool = Plutus.data(Schema.NullOr(Schema.Boolean))
      const codec = Plutus.codec(OptBool)

      const jt = codec.toData(true)
      expect((jt as Data.Constr).index).toBe(0n)
      expect(((jt as Data.Constr).fields[0] as Data.Constr).index).toBe(1n)

      const jf = codec.toData(false)
      expect(((jf as Data.Constr).fields[0] as Data.Constr).index).toBe(0n)

      const n = codec.toData(null)
      expect((n as Data.Constr).index).toBe(1n)

      expect(codec.fromCBORHex(codec.toCBORHex(true))).toBe(true)
      expect(codec.fromCBORHex(codec.toCBORHex(false))).toBe(false)
      expect(codec.fromCBORHex(codec.toCBORHex(null))).toBeNull()
    })

    it("option of array", () => {
      const OptList = Plutus.data(Schema.NullOr(Schema.Array(Schema.BigIntFromSelf)))
      const codec = Plutus.codec(OptList)

      expect(codec.fromCBORHex(codec.toCBORHex([1n, 2n]))).toEqual([1n, 2n])
      expect(codec.fromCBORHex(codec.toCBORHex(null))).toBeNull()
    })

    it("null at every level of nested structs", () => {
      const DeepNull = Plutus.data(
        Schema.Struct({
          a: Schema.NullOr(
            Schema.Struct({
              b: Schema.NullOr(
                Schema.Struct({
                  c: Schema.NullOr(Schema.BigIntFromSelf)
                })
              )
            })
          )
        })
      )
      const codec = Plutus.codec(DeepNull)

      const full = { a: { b: { c: 42n } } }
      expect(codec.fromCBORHex(codec.toCBORHex(full))).toEqual(full)

      expect(codec.fromCBORHex(codec.toCBORHex({ a: null }))).toEqual({ a: null })
      expect(codec.fromCBORHex(codec.toCBORHex({ a: { b: null } }))).toEqual({ a: { b: null } })
      expect(codec.fromCBORHex(codec.toCBORHex({ a: { b: { c: null } } }))).toEqual({ a: { b: { c: null } } })
    })
  })

  describe("non-sequential indices", () => {
    it("indices 0, 5, 10", () => {
      const Action = Plutus.data(Schema.Union(
        Schema.Struct({ _tag: Schema.Literal("Mint"), amount: Schema.BigIntFromSelf })
          .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("Burn"), amount: Schema.BigIntFromSelf })
          .annotations({ [PA.ConstrIndexId]: 5, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("Transfer"), from: Schema.Uint8ArrayFromSelf, to: Schema.Uint8ArrayFromSelf })
          .annotations({ [PA.ConstrIndexId]: 10, [PA.FlatInUnionId]: true })
      ))

      const codec = Plutus.codec(Action)

      const mint = codec.toData({ _tag: "Mint", amount: 100n })
      expect((mint as Data.Constr).index).toBe(0n)

      const burn = codec.toData({ _tag: "Burn", amount: 50n })
      expect((burn as Data.Constr).index).toBe(5n)

      const transfer = codec.toData({
        _tag: "Transfer",
        from: new Uint8Array([1]),
        to: new Uint8Array([2])
      })
      expect((transfer as Data.Constr).index).toBe(10n)
      expect((transfer as Data.Constr).fields).toHaveLength(2)

      const cbor = codec.toCBORHex({ _tag: "Transfer", from: new Uint8Array([1]), to: new Uint8Array([2]) })
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded._tag).toBe("Transfer")
      expect(decoded.from).toEqual(new Uint8Array([1]))
      expect(decoded.to).toEqual(new Uint8Array([2]))
    })
  })

  describe("tag field control", () => {
    it("auto-detects _tag field", () => {
      const codec = Plutus.codec(Plutus.data(Schema.Struct({
        _tag: Schema.Literal("Mint"),
        amount: Schema.BigIntFromSelf
      })))

      const data = codec.toData({ _tag: "Mint" as const, amount: 100n })
      expect((data as Data.Constr).fields).toHaveLength(1)
      expect(codec.fromCBORHex(codec.toCBORHex({ _tag: "Mint" as const, amount: 100n }))._tag).toBe("Mint")
    })

    it("auto-detects 'type' field", () => {
      const codec = Plutus.codec(Plutus.data(Schema.Struct({
        type: Schema.Literal("Transfer"),
        value: Schema.BigIntFromSelf
      })))

      const data = codec.toData({ type: "Transfer" as const, value: 100n })
      expect((data as Data.Constr).fields).toHaveLength(1)
      expect(codec.fromCBORHex(codec.toCBORHex({ type: "Transfer" as const, value: 100n })).type).toBe("Transfer")
    })

    it("disables tag field with tagField: false annotation", () => {
      const codec = Plutus.codec(Plutus.data(
        Schema.Struct({
          _tag: Schema.Literal("Mint"),
          amount: Schema.BigIntFromSelf
        }),
        { tagField: false }
      ))

      const data = codec.toData({ _tag: "Mint" as const, amount: 100n })
      expect((data as Data.Constr).fields).toHaveLength(2)
    })

    it("struct without tag field has no stripping", () => {
      const codec = Plutus.codec(Plutus.data(Schema.Struct({
        foo: Schema.BigIntFromSelf,
        bar: Schema.Uint8ArrayFromSelf
      })))

      const data = codec.toData({ foo: 1n, bar: new Uint8Array([2]) })
      expect((data as Data.Constr).fields).toHaveLength(2)
    })
  })

  describe("empty structs", () => {
    it("empty struct encodes as Constr(0, [])", () => {
      const Empty = Plutus.data(Schema.Struct({}))
      const codec = Plutus.codec(Empty)

      const data = codec.toData({})
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).index).toBe(0n)
      expect((data as Data.Constr).fields).toHaveLength(0)

      const decoded = codec.fromData(data)
      expect(decoded).toEqual({})
    })
  })

  describe("Set/Map edge cases", () => {
    it("SetFromSelf encodes as list with CBOR roundtrip", () => {
      const MySet = Plutus.data(Schema.SetFromSelf(Schema.BigIntFromSelf))
      const codec = Plutus.codec(MySet)

      const input = new Set([1n, 2n, 3n])
      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect([...decoded]).toEqual([1n, 2n, 3n])
    })

    it("empty set encodes as empty list", () => {
      const MySet = Plutus.data(Schema.SetFromSelf(Schema.BigIntFromSelf))
      const codec = Plutus.codec(MySet)

      const cbor = codec.toCBORHex(new Set())
      const decoded = codec.fromCBORHex(cbor)
      expect([...decoded]).toEqual([])
    })

    it("empty map", () => {
      const MyMap = Plutus.data(
        Schema.MapFromSelf({ key: Schema.BigIntFromSelf, value: Schema.BigIntFromSelf })
      )
      const codec = Plutus.codec(MyMap)

      const input = new Map<bigint, bigint>()
      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect([...decoded.entries()]).toEqual([])
    })

    it("map with single entry", () => {
      const MyMap = Plutus.data(
        Schema.MapFromSelf({ key: Schema.BigIntFromSelf, value: Schema.Uint8ArrayFromSelf })
      )
      const codec = Plutus.codec(MyMap)

      const input = new Map<bigint, Uint8Array>([[1n, new Uint8Array([0xff])]])
      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect([...decoded.entries()]).toEqual([...input.entries()])
    })

    it("map where values are maps (nested)", () => {
      const MyMap = Plutus.data(
        Schema.MapFromSelf({
          key: Schema.BigIntFromSelf,
          value: Schema.MapFromSelf({
            key: Schema.BigIntFromSelf,
            value: Schema.BigIntFromSelf
          })
        })
      )
      const codec = Plutus.codec(MyMap)

      const inner = new Map([[10n, 100n]])
      const input = new Map([[1n, inner]])
      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      const outerEntries = [...decoded.entries()]
      expect(outerEntries).toHaveLength(1)
      expect([...(outerEntries[0][1] as Map<bigint, bigint>).entries()]).toEqual([[10n, 100n]])
    })
  })

  describe("flatFields edge cases", () => {
    it("flat inner struct fields inlined into parent Constr", () => {
      const Inner = Schema.Struct({
        x: Schema.BigIntFromSelf,
        y: Schema.BigIntFromSelf
      }).annotations({ [PA.FlatFieldsId]: true })

      const Outer = Plutus.data(Schema.Struct({
        inner: Inner,
        z: Schema.BigIntFromSelf
      }))

      const codec = Plutus.codec(Outer)
      const input = { inner: { x: 1n, y: 2n }, z: 3n }

      const data = codec.toData(input)
      expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n])
      expect((data as Data.Constr).fields).toHaveLength(3)

      const decoded = codec.fromData(data)
      expect(decoded).toEqual(input)
    })

    it("multiple flat structs in parent", () => {
      const Point = Schema.Struct({
        x: Schema.BigIntFromSelf,
        y: Schema.BigIntFromSelf
      }).annotations({ [PA.FlatFieldsId]: true })

      const Line = Plutus.data(Schema.Struct({
        start: Point,
        end: Point
      }))

      const codec = Plutus.codec(Line)
      const input = { start: { x: 1n, y: 2n }, end: { x: 3n, y: 4n } }

      const data = codec.toData(input)
      expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n, 4n])

      const decoded = codec.fromData(data)
      expect(decoded).toEqual(input)
    })

    it("mixed flat and non-flat fields", () => {
      const FlatPart = Schema.Struct({
        a: Schema.BigIntFromSelf,
        b: Schema.BigIntFromSelf
      }).annotations({ [PA.FlatFieldsId]: true })

      const NonFlatPart = Schema.Struct({ c: Schema.BigIntFromSelf })

      const Mixed = Plutus.data(Schema.Struct({
        flat: FlatPart,
        nested: NonFlatPart,
        z: Schema.BigIntFromSelf
      }))

      const codec = Plutus.codec(Mixed)
      const input = { flat: { a: 1n, b: 2n }, nested: { c: 3n }, z: 4n }

      const data = codec.toData(input)
      expect((data as Data.Constr).fields).toHaveLength(4)
      expect((data as Data.Constr).fields[0]).toBe(1n)
      expect((data as Data.Constr).fields[1]).toBe(2n)
      expect((data as Data.Constr).fields[2]).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).fields[3]).toBe(4n)

      const decoded = codec.fromData(data)
      expect(decoded).toEqual(input)
    })

    it("flat field with 0 sub-fields (empty struct)", () => {
      const Empty = Schema.Struct({}).annotations({ [PA.FlatFieldsId]: true })
      const Outer = Plutus.data(
        Schema.Struct({
          empty: Empty,
          value: Schema.BigIntFromSelf
        })
      )
      const codec = Plutus.codec(Outer)

      const data = codec.toData({ empty: {}, value: 42n })
      expect((data as Data.Constr).fields).toEqual([42n])

      const decoded = codec.fromData(data)
      expect(decoded.value).toBe(42n)
      expect(decoded.empty).toEqual({})
    })

    it("nested flatFields (flat within flat)", () => {
      const Inner = Schema.Struct({
        a: Schema.BigIntFromSelf
      }).annotations({ [PA.FlatFieldsId]: true })

      const Middle = Schema.Struct({
        inner: Inner,
        b: Schema.BigIntFromSelf
      }).annotations({ [PA.FlatFieldsId]: true })

      const Outer = Plutus.data(
        Schema.Struct({
          middle: Middle,
          c: Schema.BigIntFromSelf
        })
      )
      const codec = Plutus.codec(Outer)

      const input = { middle: { inner: { a: 1n }, b: 2n }, c: 3n }
      const data = codec.toData(input)
      expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n])

      const decoded = codec.fromData(data)
      expect(decoded).toEqual(input)
    })

    it("flatFields with TSchema.flatFields annotation (backward compat)", () => {
      const Inner = TSchema.Struct(
        { x: TSchema.Integer, y: TSchema.Integer },
        { flatFields: true }
      )

      const Outer = Plutus.data(Schema.Struct({
        inner: Inner,
        z: Schema.BigIntFromSelf
      }))

      const codec = Plutus.codec(Outer)
      const input = { inner: { x: 1n, y: 2n }, z: 3n }

      const data = codec.toData(input)
      expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n])

      const decoded = codec.fromData(data)
      expect(decoded).toEqual(input)
    })
  })

  describe("roundtrip stress: deeply nested heterogeneous structure", () => {
    it("complex nested struct with arrays, maps, options, booleans", () => {
      const DeepStruct = Plutus.data(
        Schema.Struct({
          a: Schema.BigIntFromSelf,
          b: Schema.Struct({
            c: Schema.Uint8ArrayFromSelf,
            d: Schema.NullOr(Schema.BigIntFromSelf),
            e: Schema.Array(
              Schema.Struct({
                f: Schema.BigIntFromSelf,
                g: Schema.Boolean
              })
            )
          }),
          h: Schema.MapFromSelf({
            key: Schema.Uint8ArrayFromSelf,
            value: Schema.BigIntFromSelf
          })
        })
      )
      const codec = Plutus.codec(DeepStruct)

      const input = {
        a: 1n,
        b: {
          c: new Uint8Array([1, 2, 3]),
          d: 42n,
          e: [
            { f: 10n, g: true },
            { f: 20n, g: false }
          ]
        },
        h: new Map([[new Uint8Array([0xaa]), 100n]])
      }

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)

      expect(decoded.a).toBe(1n)
      expect(decoded.b.c).toEqual(new Uint8Array([1, 2, 3]))
      expect(decoded.b.d).toBe(42n)
      expect(decoded.b.e).toHaveLength(2)
      expect(decoded.b.e[0].f).toBe(10n)
      expect(decoded.b.e[0].g).toBe(true)
      expect(decoded.b.e[1].g).toBe(false)
      expect([...decoded.h.entries()]).toEqual([...input.h.entries()])
    })
  })

  describe("optional property handling", () => {
    it("Schema with optional property", () => {
      const WithOptional = Schema.Struct({
        required: Schema.BigIntFromSelf,
        optional: Schema.optional(Schema.BigIntFromSelf)
      })

      const codec = Plutus.codec(Plutus.data(WithOptional))

      const withOpt = codec.toData({ required: 1n, optional: 42n })
      expect((withOpt as Data.Constr).fields).toHaveLength(2)

      const withoutOpt = codec.toData({ required: 1n })
      expect((withoutOpt as Data.Constr).fields).toHaveLength(2)
    })
  })

  describe("branded types", () => {
    it("branded types work transparently via Refinement look-through", () => {
      const Lovelace = Schema.BigIntFromSelf.pipe(Schema.brand("Lovelace"))
      const MyStruct = Plutus.data(Schema.Struct({
        amount: Lovelace
      }))
      const codec = Plutus.codec(MyStruct)
      expect(codec.fromCBORHex(codec.toCBORHex({ amount: 42n } as never))).toEqual({ amount: 42n })
    })
  })

  describe("compile() determinism", () => {
    it("same AST produces same codec behavior", () => {
      const schema = Schema.Struct({
        a: Schema.BigIntFromSelf,
        b: Schema.Uint8ArrayFromSelf
      })

      const codec1 = compile(schema.ast, [])
      const codec2 = compile(schema.ast, [])

      const input = { a: 1n, b: new Uint8Array([2]) }
      const data1 = codec1.toData(input)
      const data2 = codec2.toData(input)

      expect((data1 as Data.Constr).index).toBe((data2 as Data.Constr).index)
      expect((data1 as Data.Constr).fields).toEqual((data2 as Data.Constr).fields)
    })
  })
})

// ===================================================================
// 6. Benchmarks
// ===================================================================

describe("Benchmarks", () => {
  const N = 5000

  const bench = (name: string, fn: () => void): number => {
    // Warmup
    for (let i = 0; i < 100; i++) fn()

    const start = performance.now()
    for (let i = 0; i < N; i++) fn()
    const elapsed = performance.now() - start
    const msPerOp = elapsed / N

    console.log(`  [bench] ${name}: ${msPerOp.toFixed(4)} ms/op (${N} iterations, ${elapsed.toFixed(1)}ms total)`)
    return msPerOp
  }

  describe("hot path profile", () => {
    it("AST compile vs codec.toData vs Data.Constr construction", () => {
      const schema = Schema.Struct({
        owner: Schema.Uint8ArrayFromSelf,
        amount: Schema.BigIntFromSelf
      })
      const input = { owner: new Uint8Array([1, 2, 3]), amount: 42n }

      const compileMs = bench("AST compile", () => {
        compile(schema.ast, [])
      })

      const codec = compile(schema.ast, [])
      const toDataMs = bench("codec.toData", () => {
        codec.toData(input)
      })

      const constrMs = bench("new Data.Constr", () => {
        new Data.Constr({ index: 0n, fields: [new Uint8Array([1, 2, 3]), 42n] })
      })

      const plutusSchema = Plutus.data(schema)
      const plutusCodec = Plutus.codec(plutusSchema)
      const fullMs = bench("full pipeline (Plutus.codec.toData)", () => {
        plutusCodec.toData(input)
      })

      expect(compileMs).toBeGreaterThan(0)
      expect(toDataMs).toBeGreaterThan(0)
      expect(constrMs).toBeGreaterThan(0)
      expect(fullMs).toBeGreaterThan(0)
    })
  })

  describe("realistic workloads", () => {
    it("simple struct (2 fields)", () => {
      const tschemaCodec = Data.withSchema(TSchema.Struct({
        owner: TSchema.ByteArray,
        amount: TSchema.Integer
      }))
      const plutusCodec = Plutus.codec(Plutus.data(Schema.Struct({
        owner: Schema.Uint8ArrayFromSelf,
        amount: Schema.BigIntFromSelf
      })))
      const input = { owner: new Uint8Array([1, 2, 3]), amount: 42n }

      const tMs = bench("TSchema 2-field encode", () => { tschemaCodec.toData(input) })
      const pMs = bench("Plutus  2-field encode", () => { plutusCodec.toData(input) })
      console.log(`  [ratio] ${(pMs / tMs).toFixed(1)}x`)
      expect(pMs).toBeLessThan(tMs * 5)
    })

    it("10-field struct", () => {
      const tschemaCodec = Data.withSchema(TSchema.Struct({
        a: TSchema.Integer, b: TSchema.Integer, c: TSchema.Integer,
        d: TSchema.Integer, e: TSchema.Integer, f: TSchema.ByteArray,
        g: TSchema.ByteArray, h: TSchema.Boolean, i: TSchema.Integer,
        j: TSchema.Integer
      }))
      const plutusCodec = Plutus.codec(Plutus.data(Schema.Struct({
        a: Schema.BigIntFromSelf, b: Schema.BigIntFromSelf, c: Schema.BigIntFromSelf,
        d: Schema.BigIntFromSelf, e: Schema.BigIntFromSelf, f: Schema.Uint8ArrayFromSelf,
        g: Schema.Uint8ArrayFromSelf, h: Schema.Boolean, i: Schema.BigIntFromSelf,
        j: Schema.BigIntFromSelf
      })))
      const input = {
        a: 1n, b: 2n, c: 3n, d: 4n, e: 5n,
        f: new Uint8Array([1]), g: new Uint8Array([2]),
        h: true, i: 6n, j: 7n
      }

      const tMs = bench("TSchema 10-field encode", () => { tschemaCodec.toData(input) })
      const pMs = bench("Plutus  10-field encode", () => { plutusCodec.toData(input) })
      console.log(`  [ratio] ${(pMs / tMs).toFixed(1)}x`)
      expect(pMs).toBeLessThan(tMs * 5)
    })

    it("Address (nested unions)", () => {
      const TCredential = TSchema.Variant({
        VerificationKey: { hash: TSchema.ByteArray },
        Script: { hash: TSchema.ByteArray }
      })
      const TStakeCred = TSchema.Variant({
        Inline: { credential: TCredential },
        Pointer: { slot: TSchema.Integer, tx_idx: TSchema.Integer, cert_idx: TSchema.Integer }
      })
      const TAddress = TSchema.Struct({
        payment: TCredential,
        stake: TSchema.UndefinedOr(TStakeCred)
      })
      const tCodec = Data.withSchema(TAddress)

      const PCredential = Plutus.data(Schema.Union(
        Schema.Struct({ _tag: Schema.Literal("VerificationKey"), hash: Schema.Uint8ArrayFromSelf })
          .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
        Schema.Struct({ _tag: Schema.Literal("Script"), hash: Schema.Uint8ArrayFromSelf })
          .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
      ))
      const PStakeCred = Plutus.data(Schema.Union(
        Schema.Struct({ _tag: Schema.Literal("Inline"), credential: PCredential })
          .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
        Schema.Struct({
          _tag: Schema.Literal("Pointer"),
          slot: Schema.BigIntFromSelf,
          tx_idx: Schema.BigIntFromSelf,
          cert_idx: Schema.BigIntFromSelf
        })
          .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
      ))
      const PAddress = Plutus.data(Schema.Struct({
        payment: PCredential,
        stake: Schema.UndefinedOr(PStakeCred)
      }))
      const pCodec = Plutus.codec(PAddress)

      const hash = new Uint8Array(28).fill(0xab)
      const tInput = {
        payment: { VerificationKey: { hash } },
        stake: { Inline: { credential: { Script: { hash } } } }
      }
      const pInput = {
        payment: { _tag: "VerificationKey" as const, hash },
        stake: { _tag: "Inline" as const, credential: { _tag: "Script" as const, hash } }
      }

      const tMs = bench("TSchema Address encode", () => { tCodec.toData(tInput) })
      const pMs = bench("Plutus  Address encode", () => { pCodec.toData(pInput) })
      console.log(`  [ratio] ${(pMs / tMs).toFixed(1)}x`)
      expect(pMs).toBeLessThan(tMs * 5)
    })

    it("decode throughput -- simple struct", () => {
      const tschemaCodec = Data.withSchema(TSchema.Struct({
        owner: TSchema.ByteArray,
        amount: TSchema.Integer
      }))
      const plutusCodec = Plutus.codec(Plutus.data(Schema.Struct({
        owner: Schema.Uint8ArrayFromSelf,
        amount: Schema.BigIntFromSelf
      })))

      const data = new Data.Constr({ index: 0n, fields: [new Uint8Array([1, 2, 3]), 42n] })

      const tMs = bench("TSchema 2-field decode", () => { tschemaCodec.fromData(data) })
      const pMs = bench("Plutus  2-field decode", () => { plutusCodec.fromData(data) })
      console.log(`  [ratio] ${(pMs / tMs).toFixed(1)}x`)
      expect(pMs).toBeLessThan(tMs * 5)
    })

    it("CBOR roundtrip -- simple struct", () => {
      const tschemaCodec = Data.withSchema(TSchema.Struct({
        owner: TSchema.ByteArray,
        amount: TSchema.Integer
      }))
      const plutusCodec = Plutus.codec(Plutus.data(Schema.Struct({
        owner: Schema.Uint8ArrayFromSelf,
        amount: Schema.BigIntFromSelf
      })))
      const input = { owner: new Uint8Array([1, 2, 3]), amount: 42n }

      const tMs = bench("TSchema CBOR roundtrip", () => {
        tschemaCodec.fromCBORHex(tschemaCodec.toCBORHex(input))
      })
      const pMs = bench("Plutus  CBOR roundtrip", () => {
        plutusCodec.fromCBORHex(plutusCodec.toCBORHex(input))
      })
      console.log(`  [ratio] ${(pMs / tMs).toFixed(1)}x`)
      expect(pMs).toBeLessThan(tMs * 3)
    })
  })
})
