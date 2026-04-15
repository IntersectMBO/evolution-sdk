import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Data from "../src/Data.js"
import * as PA from "../src/PlutusAnnotation.js"
import * as Plutus from "../src/PlutusSchema.js"
import * as TSchema from "../src/TSchema.js"

// ============================================================
// Plutus.data(Schema.Struct(...)) — product types
// ============================================================

describe("Plutus.data(Schema.Struct(...))", () => {
  it("encodes a struct as Constr(0, [fields])", () => {
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

    // CBOR roundtrip
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

    const codec = Plutus.codec(MyAction)
    const data = codec.toData({ value: 100n })
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

    // Roundtrip
    const cbor = codec.toCBORHex({ amount: 42n, active: true })
    expect(codec.fromCBORHex(cbor)).toEqual({ amount: 42n, active: true })
  })

  it("handles NullOr fields", () => {
    const MyStruct = Plutus.data(Schema.Struct({
      value: Schema.BigIntFromSelf,
      optional: Schema.NullOr(Schema.BigIntFromSelf)
    }))

    const codec = Plutus.codec(MyStruct)

    // With value
    const withVal = codec.toData({ value: 1n, optional: 42n })
    const optField = (withVal as Data.Constr).fields[1] as Data.Constr
    expect(optField.index).toBe(0n) // Just
    expect(optField.fields[0]).toBe(42n)

    // Without value
    const withNull = codec.toData({ value: 1n, optional: null })
    const nullField = (withNull as Data.Constr).fields[1] as Data.Constr
    expect(nullField.index).toBe(1n) // Nothing

    // Roundtrip
    expect(codec.fromCBORHex(codec.toCBORHex({ value: 1n, optional: 42n }))).toEqual({
      value: 1n, optional: 42n
    })
    expect(codec.fromCBORHex(codec.toCBORHex({ value: 1n, optional: null }))).toEqual({
      value: 1n, optional: null
    })
  })
})

// ============================================================
// Plutus.data(Schema.Union(...)) — sum types
// ============================================================

describe("Plutus.data(Schema.Union(...)) with annotations", () => {
  it("creates a flat tagged union with explicit indices", () => {
    const Credential = Plutus.data(Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("PubKeyCredential"), hash: Schema.Uint8ArrayFromSelf })
        .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
      Schema.Struct({ _tag: Schema.Literal("ScriptCredential"), hash: Schema.Uint8ArrayFromSelf })
        .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
    ))

    const codec = Plutus.codec(Credential)

    // PubKeyCredential
    const pubKey = codec.toData({ _tag: "PubKeyCredential", hash: new Uint8Array([1, 2, 3]) })
    expect((pubKey as Data.Constr).index).toBe(0n)
    expect((pubKey as Data.Constr).fields[0]).toEqual(new Uint8Array([1, 2, 3]))

    // ScriptCredential
    const script = codec.toData({ _tag: "ScriptCredential", hash: new Uint8Array([4, 5, 6]) })
    expect((script as Data.Constr).index).toBe(1n)
    expect((script as Data.Constr).fields[0]).toEqual(new Uint8Array([4, 5, 6]))

    // Roundtrip
    const cbor1 = codec.toCBORHex({ _tag: "PubKeyCredential", hash: new Uint8Array([1, 2, 3]) })
    const decoded1 = codec.fromCBORHex(cbor1)
    expect(decoded1._tag).toBe("PubKeyCredential")
    expect(decoded1.hash).toEqual(new Uint8Array([1, 2, 3]))
  })

  it("supports multi-field constructors", () => {
    const OutputDatum = Plutus.data(Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("NoDatum") })
        .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
      Schema.Struct({ _tag: Schema.Literal("DatumHash"), hash: Schema.Uint8ArrayFromSelf })
        .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true }),
      Schema.Struct({ _tag: Schema.Literal("InlineDatum"), datum: Schema.BigIntFromSelf })
        .annotations({ [PA.ConstrIndexId]: 2, [PA.FlatInUnionId]: true })
    ))

    const codec = Plutus.codec(OutputDatum)

    // NoDatum — empty constructor
    const noDatum = codec.toData({ _tag: "NoDatum" })
    expect((noDatum as Data.Constr).index).toBe(0n)
    expect((noDatum as Data.Constr).fields).toHaveLength(0)

    // DatumHash — one field
    const datumHash = codec.toData({ _tag: "DatumHash", hash: new Uint8Array([0xab, 0xcd]) })
    expect((datumHash as Data.Constr).index).toBe(1n)
    expect((datumHash as Data.Constr).fields).toHaveLength(1)

    // Roundtrip
    const cbor = codec.toCBORHex({ _tag: "NoDatum" })
    expect(codec.fromCBORHex(cbor)._tag).toBe("NoDatum")
  })
})

// ============================================================
// data() / fromSchema — auto-derivation
// ============================================================

describe("data() / fromSchema", () => {
  describe("struct", () => {
    it("derives from Schema.Struct with BigInt and Uint8Array fields", () => {
      const MyDatum = Plutus.data(Schema.Struct({
        amount: Schema.BigIntFromSelf,
        owner: Schema.Uint8ArrayFromSelf
      }))

      const codec = Plutus.codec(MyDatum)
      const input = { amount: 42n, owner: new Uint8Array([1, 2, 3]) }

      const data = codec.toData(input)
      expect(data).toBeInstanceOf(Data.Constr)
      expect((data as Data.Constr).index).toBe(0n)
      expect((data as Data.Constr).fields[0]).toBe(42n)
      expect((data as Data.Constr).fields[1]).toEqual(new Uint8Array([1, 2, 3]))

      // CBOR roundtrip
      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded.amount).toBe(42n)
      expect(decoded.owner).toEqual(new Uint8Array([1, 2, 3]))
    })

    it("supports custom constructor index via options", () => {
      const MyAction = Plutus.data(
        Schema.Struct({ value: Schema.BigIntFromSelf }),
        { index: 5 }
      )

      const data = Plutus.codec(MyAction).toData({ value: 100n })
      expect((data as Data.Constr).index).toBe(5n)
    })

    it("handles Schema.Boolean fields", () => {
      const MyStruct = Plutus.data(Schema.Struct({
        amount: Schema.BigIntFromSelf,
        active: Schema.Boolean
      }))

      const codec = Plutus.codec(MyStruct)

      const trueData = codec.toData({ amount: 42n, active: true })
      expect(((trueData as Data.Constr).fields[1] as Data.Constr).index).toBe(1n)

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

      // _tag stripped
      expect((data as Data.Constr).fields).toHaveLength(1)
      expect((data as Data.Constr).fields[0]).toBe(100n)

      // Roundtrip — _tag injected back
      const cbor = codec.toCBORHex({ _tag: "Mint" as const, amount: 100n })
      const decoded = codec.fromCBORHex(cbor)
      expect(decoded._tag).toBe("Mint")
      expect(decoded.amount).toBe(100n)
    })
  })

  describe("nested struct", () => {
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
  })

  describe("NullOr auto-detection", () => {
    it("detects Schema.NullOr pattern", () => {
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
  })

  describe("array", () => {
    it("derives from Schema.Array", () => {
      const IntList = Plutus.data(Schema.Array(Schema.BigIntFromSelf))
      const codec = Plutus.codec(IntList)

      const cbor = codec.toCBORHex([1n, 2n, 3n])
      expect(codec.fromCBORHex(cbor)).toEqual([1n, 2n, 3n])
    })
  })

  describe("union", () => {
    it("derives a union with tag field auto-detection", () => {
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
  })

  describe("recursive types", () => {
    it("handles recursive linked list via Schema.suspend", () => {
      interface LinkedList {
        readonly value: bigint
        readonly next: LinkedList | null
      }

      // Recursive schemas: annotate the thunk return type with Data.Data to match
      // the Plutus.data() wrapped type. Same pattern as TSchema recursive tests.
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
})

// ============================================================
// Annotation-based union with explicit indices
// ============================================================

describe("annotation-based unions", () => {
  it("ConstrIndex + FlatInUnion via .annotations()", () => {
    const Credential = Plutus.data(Schema.Union(
      Schema.Struct({
        _tag: Schema.Literal("PubKey"),
        hash: Schema.Uint8ArrayFromSelf
      }).annotations({
        [Plutus.ConstrIndexId]: 0,
        [Plutus.FlatInUnionId]: true
      }),
      Schema.Struct({
        _tag: Schema.Literal("Script"),
        hash: Schema.Uint8ArrayFromSelf
      }).annotations({
        [Plutus.ConstrIndexId]: 1,
        [Plutus.FlatInUnionId]: true
      })
    ))

    const codec = Plutus.codec(Credential)

    const pubKey = codec.toData({ _tag: "PubKey" as const, hash: new Uint8Array([1, 2, 3]) })
    expect((pubKey as Data.Constr).index).toBe(0n)
    expect((pubKey as Data.Constr).fields[0]).toEqual(new Uint8Array([1, 2, 3]))

    const script = codec.toData({ _tag: "Script" as const, hash: new Uint8Array([4, 5, 6]) })
    expect((script as Data.Constr).index).toBe(1n)

    // CBOR roundtrip
    const cbor = codec.toCBORHex({ _tag: "PubKey" as const, hash: new Uint8Array([1, 2, 3]) })
    const decoded = codec.fromCBORHex(cbor)
    expect(decoded._tag).toBe("PubKey")
    expect(decoded.hash).toEqual(new Uint8Array([1, 2, 3]))
  })
})

// ============================================================
// Combinator re-exports
// ============================================================

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

// ============================================================
// Compatibility with Data.withSchema
// ============================================================

describe("compatibility", () => {
  it("data() result works with Data.withSchema directly", () => {
    const MyDatum = Plutus.data(Schema.Struct({ amount: Schema.BigIntFromSelf }))

    const codec = Data.withSchema(MyDatum)
    const data = codec.toData({ amount: 42n })
    expect(data).toBeInstanceOf(Data.Constr)
    expect((data as Data.Constr).fields[0]).toBe(42n)
  })

  it("fromSchema is an alias for data", () => {
    expect(Plutus.fromSchema).toBe(Plutus.data)
  })

  it("TSchema types work as fields inside data()", () => {
    const Mixed = Plutus.data(Schema.Struct({
      native: Schema.BigIntFromSelf,
      plutus: TSchema.Boolean
    }))

    const codec = Plutus.codec(Mixed)
    const cbor = codec.toCBORHex({ native: 42n, plutus: true })
    expect(codec.fromCBORHex(cbor)).toEqual({ native: 42n, plutus: true })
  })
})
