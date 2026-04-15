import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Data from "../src/Data.js"
import * as PA from "../src/PlutusAnnotation.js"
import { compile } from "../src/PlutusCompiler.js"

// Helper: compile a schema into a PlutusCodec
const codecFor = <A, I, R>(schema: Schema.Schema<A, I, R>) => compile(schema.ast, [])

describe("PlutusCompiler", () => {
  // ============================================================
  // BigIntKeyword
  // ============================================================

  describe("BigIntKeyword", () => {
    it("bigint passes through as integer", () => {
      const codec = codecFor(Schema.BigIntFromSelf)
      expect(codec.toData(42n)).toBe(42n)
      expect(codec.fromData(42n)).toBe(42n)
    })
  })

  // ============================================================
  // BooleanKeyword
  // ============================================================

  describe("BooleanKeyword", () => {
    it("true → Constr(1, []), false → Constr(0, [])", () => {
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

  // ============================================================
  // Declaration (Uint8ArrayFromSelf)
  // ============================================================

  describe("Declaration", () => {
    it("Uint8ArrayFromSelf passes through as ByteArray", () => {
      const codec = codecFor(Schema.Uint8ArrayFromSelf)
      const bytes = new Uint8Array([1, 2, 3])
      expect(codec.toData(bytes)).toEqual(bytes)
      expect(codec.fromData(bytes)).toEqual(bytes)
    })
  })

  // ============================================================
  // Literal
  // ============================================================

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
  })

  // ============================================================
  // TypeLiteral (Struct)
  // ============================================================

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

      // Roundtrip — tag injected back
      const decoded = codec.fromData(data)
      expect(decoded._tag).toBe("Mint")
      expect(decoded.amount).toBe(100n)
    })

    it("handles nested struct", () => {
      const innerCodec = codecFor(Schema.Struct({
        x: Schema.BigIntFromSelf,
        y: Schema.BigIntFromSelf
      }))

      const outerCodec = codecFor(Schema.Struct({
        inner: Schema.Struct({
          x: Schema.BigIntFromSelf,
          y: Schema.BigIntFromSelf
        }),
        z: Schema.BigIntFromSelf
      }))

      const input = { inner: { x: 1n, y: 2n }, z: 3n }
      const data = outerCodec.toData(input)

      // Inner should be a nested Constr
      const innerConstr = (data as Data.Constr).fields[0] as Data.Constr
      expect(innerConstr).toBeInstanceOf(Data.Constr)
      expect(innerConstr.fields).toEqual([1n, 2n])
      expect((data as Data.Constr).fields[1]).toBe(3n)

      // Roundtrip
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
  })

  // ============================================================
  // Union
  // ============================================================

  describe("Union", () => {
    it("detects NullOr pattern", () => {
      const codec = codecFor(Schema.NullOr(Schema.BigIntFromSelf))

      const justData = codec.toData(42n)
      expect((justData as Data.Constr).index).toBe(0n)
      expect((justData as Data.Constr).fields).toEqual([42n])

      const nothingData = codec.toData(null)
      expect((nothingData as Data.Constr).index).toBe(1n)
      expect((nothingData as Data.Constr).fields).toEqual([])

      // Roundtrip
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

      // Mint → index 0
      const mintData = codec.toData({ _tag: "Mint" as const, amount: 100n })
      expect((mintData as Data.Constr).index).toBe(0n)

      // Burn → index 1
      const burnData = codec.toData({ _tag: "Burn" as const, amount: 50n })
      expect((burnData as Data.Constr).index).toBe(1n)

      // Roundtrip
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

      // PubKey → flat Constr(0, [hash])
      const pubKeyData = codec.toData({ _tag: "PubKey" as const, hash: new Uint8Array([1, 2, 3]) })
      expect((pubKeyData as Data.Constr).index).toBe(0n)
      expect((pubKeyData as Data.Constr).fields[0]).toEqual(new Uint8Array([1, 2, 3]))

      // Script → flat Constr(1, [hash])
      const scriptData = codec.toData({ _tag: "Script" as const, hash: new Uint8Array([4, 5, 6]) })
      expect((scriptData as Data.Constr).index).toBe(1n)

      // Roundtrip
      const pubKeyDecoded = codec.fromData(pubKeyData)
      expect(pubKeyDecoded._tag).toBe("PubKey")
      expect(pubKeyDecoded.hash).toEqual(new Uint8Array([1, 2, 3]))
    })
  })

  // ============================================================
  // TupleType (Array / Tuple)
  // ============================================================

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
  })

  // ============================================================
  // Suspend (Recursive)
  // ============================================================

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

      // Roundtrip
      const decoded = codec.fromData(data) as LinkedList
      expect(decoded.value).toBe(1n)
      expect(decoded.next!.value).toBe(2n)
      expect(decoded.next!.next!.value).toBe(3n)
      expect(decoded.next!.next!.next).toBeNull()
    })
  })

  // ============================================================
  // Transformation (look-through)
  // ============================================================

  describe("Transformation", () => {
    it("looks through non-TSchema transformations", () => {
      // Schema.BigInt is a Transformation from string → bigint
      // The compiler should look through to BigIntKeyword
      const codec = codecFor(Schema.BigInt)
      expect(codec.toData(42n)).toBe(42n)
    })
  })

  // ============================================================
  // Refinement (look-through)
  // ============================================================

  describe("Refinement", () => {
    it("looks through refinement to base type", () => {
      const PositiveBigInt = Schema.BigIntFromSelf.pipe(
        Schema.filter((n) => n > 0n)
      )
      const codec = codecFor(PositiveBigInt)
      expect(codec.toData(42n)).toBe(42n)
    })
  })

  // ============================================================
  // Unsupported types (error messages)
  // ============================================================

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
  })
})
