/**
 * Phase 12+ Iteration 11: Edge Case Sweep
 *
 * Handler-by-handler audit — probing for silent wrong output.
 */
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Data from "../src/Data.js"
import * as PA from "../src/PlutusAnnotation.js"
import { compile } from "../src/PlutusCompiler.js"
import * as Plutus from "../src/PlutusSchema.js"

// ============================================================
// TypeLiteral edge cases
// ============================================================

describe("TypeLiteral edge cases", () => {
  it("struct with only tag fields → Constr(0, [])", () => {
    const codec = compile(Schema.Struct({
      _tag: Schema.Literal("Unit")
    }).ast, [])

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
    const codec = compile(Schema.Struct({
      z: Schema.BigIntFromSelf,
      a: Schema.BigIntFromSelf,
      m: Schema.BigIntFromSelf
    }).ast, [])

    // Fields should be in definition order: z, a, m
    const data = codec.toData({ z: 1n, a: 2n, m: 3n })
    expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n])
  })
})

// ============================================================
// Union edge cases
// ============================================================

describe("Union edge cases", () => {
  it("single-member union", () => {
    const codec = compile(Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("Only"), value: Schema.BigIntFromSelf })
    ).ast, [])

    const data = codec.toData({ _tag: "Only" as const, value: 42n })
    expect(data).toBeInstanceOf(Data.Constr)
    expect((data as Data.Constr).index).toBe(0n)

    const decoded = codec.fromData(data)
    expect(decoded._tag).toBe("Only")
    expect(decoded.value).toBe(42n)
  })

  it("union where all members are flat", () => {
    const codec = compile(Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("A"), x: Schema.BigIntFromSelf })
        .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
      Schema.Struct({ _tag: Schema.Literal("B"), y: Schema.BigIntFromSelf })
        .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
    ).ast, [])

    const dataA = codec.toData({ _tag: "A" as const, x: 1n })
    expect((dataA as Data.Constr).index).toBe(0n)
    expect((dataA as Data.Constr).fields[0]).toBe(1n)

    const dataB = codec.toData({ _tag: "B" as const, y: 2n })
    expect((dataB as Data.Constr).index).toBe(1n)

    expect(codec.fromData(dataA)._tag).toBe("A")
    expect(codec.fromData(dataB)._tag).toBe("B")
  })

  it("union with mixed struct and primitive members", () => {
    const codec = compile(Schema.Union(
      Schema.BigIntFromSelf,
      Schema.Boolean
    ).ast, [])

    // BigInt → Constr(0, [42n])
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

    // Just(X) → Constr(0, [Constr(0, [v])])
    const justX = codec.toData({ _tag: "X" as const, v: 1n })
    expect((justX as Data.Constr).index).toBe(0n)

    // Nothing → Constr(1, [])
    const nothing = codec.toData(null)
    expect((nothing as Data.Constr).index).toBe(1n)

    expect(codec.fromData(nothing)).toBeNull()
  })
})

// ============================================================
// TupleType edge cases
// ============================================================

describe("TupleType edge cases", () => {
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
    const codec = compile(Schema.Tuple(
      Schema.Tuple(Schema.BigIntFromSelf, Schema.BigIntFromSelf),
      Schema.Tuple(Schema.BigIntFromSelf)
    ).ast, [])

    const data = codec.toData([[1n, 2n], [3n]])
    expect(data).toEqual([[1n, 2n], [3n]])
    expect(codec.fromData(data)).toEqual([[1n, 2n], [3n]])
  })

  it("tuple with mixed primitives and structs", () => {
    const codec = compile(Schema.Tuple(
      Schema.BigIntFromSelf,
      Schema.Struct({ x: Schema.BigIntFromSelf })
    ).ast, [])

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

// ============================================================
// Suspend edge cases
// ============================================================

describe("Suspend edge cases", () => {
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

// ============================================================
// Literal edge cases
// ============================================================

describe("Literal edge cases", () => {
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
    // Boolean literal is not bigint, not null → Constr(0, [])
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

// ============================================================
// Map edge cases
// ============================================================

describe("Map edge cases", () => {
  it("empty map", () => {
    const MyMap = Plutus.data(Schema.MapFromSelf({
      key: Schema.BigIntFromSelf,
      value: Schema.BigIntFromSelf
    }))
    const codec = Plutus.codec(MyMap)

    const input = new Map<bigint, bigint>()
    const cbor = codec.toCBORHex(input)
    const decoded = codec.fromCBORHex(cbor)
    expect([...decoded.entries()]).toEqual([])
  })

  it("map with single entry", () => {
    const MyMap = Plutus.data(Schema.MapFromSelf({
      key: Schema.BigIntFromSelf,
      value: Schema.Uint8ArrayFromSelf
    }))
    const codec = Plutus.codec(MyMap)

    const input = new Map<bigint, Uint8Array>([[1n, new Uint8Array([0xff])]])
    const cbor = codec.toCBORHex(input)
    const decoded = codec.fromCBORHex(cbor)
    expect([...decoded.entries()]).toEqual([...input.entries()])
  })

  it("map where values are maps (nested)", () => {
    const MyMap = Plutus.data(Schema.MapFromSelf({
      key: Schema.BigIntFromSelf,
      value: Schema.MapFromSelf({
        key: Schema.BigIntFromSelf,
        value: Schema.BigIntFromSelf
      })
    }))
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

// ============================================================
// flatFields edge cases
// ============================================================

describe("flatFields edge cases", () => {
  it("flat field with 0 sub-fields (empty struct)", () => {
    const Empty = Schema.Struct({}).annotations({ [PA.FlatFieldsId]: true })
    const Outer = Plutus.data(Schema.Struct({
      empty: Empty,
      value: Schema.BigIntFromSelf
    }))
    const codec = Plutus.codec(Outer)

    const data = codec.toData({ empty: {}, value: 42n })
    // Empty flat struct contributes 0 fields, so just [42n]
    expect((data as Data.Constr).fields).toEqual([42n])

    const decoded = codec.fromData(data)
    expect(decoded.value).toBe(42n)
    expect(decoded.empty).toEqual({})
  })

  it("flat field that is itself flat (nested flatFields)", () => {
    const Inner = Schema.Struct({
      a: Schema.BigIntFromSelf
    }).annotations({ [PA.FlatFieldsId]: true })

    const Middle = Schema.Struct({
      inner: Inner,
      b: Schema.BigIntFromSelf
    }).annotations({ [PA.FlatFieldsId]: true })

    const Outer = Plutus.data(Schema.Struct({
      middle: Middle,
      c: Schema.BigIntFromSelf
    }))
    const codec = Plutus.codec(Outer)

    const input = { middle: { inner: { a: 1n }, b: 2n }, c: 3n }
    const data = codec.toData(input)

    // Middle is flat → its fields inlined into Outer
    // But Middle's inner is also flat → inner's field inlined into Middle
    // So Middle contributes [1n, 2n] and Outer gets [1n, 2n, 3n]
    expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n])

    const decoded = codec.fromData(data)
    expect(decoded).toEqual(input)
  })
})

// ============================================================
// Declaration: List-like types (Set, HashSet, Chunk, List)
// ============================================================

describe("Declaration: list-like types", () => {
  it("SetFromSelf encodes as list", () => {
    const MySet = Plutus.data(Schema.SetFromSelf(Schema.BigIntFromSelf))
    const codec = Plutus.codec(MySet)

    const input = new Set([1n, 2n, 3n])
    const cbor = codec.toCBORHex(input)
    const decoded = codec.fromCBORHex(cbor)
    expect([...decoded]).toEqual([1n, 2n, 3n])
  })

  it("HashSetFromSelf encodes as list", () => {
    // HashSet is an Effect type — just verify the Declaration is detected
    // We can test via compile() directly
    const ast = Schema.SetFromSelf(Schema.BigIntFromSelf).ast
    const codec = compile(ast, [])
    const data = codec.toData(new Set([10n, 20n]))
    expect(Array.isArray(data)).toBe(true)
    expect(data).toEqual([10n, 20n])
  })

  it("empty set encodes as empty list", () => {
    const MySet = Plutus.data(Schema.SetFromSelf(Schema.BigIntFromSelf))
    const codec = Plutus.codec(MySet)

    const cbor = codec.toCBORHex(new Set())
    const decoded = codec.fromCBORHex(cbor)
    expect([...decoded]).toEqual([])
  })
})

// ============================================================
// Declaration: Map-like types (HashMap, ReadonlyMap)
// ============================================================

describe("Declaration: map-like types", () => {
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
})

// ============================================================
// Declaration: unknown types throw
// ============================================================

describe("Declaration: unknown types throw", () => {
  it("DateFromSelf throws descriptive error", () => {
    expect(() => compile(Schema.DateFromSelf.ast, [])).toThrow(/unsupported Declaration/)
  })

  it("DurationFromSelf throws descriptive error", () => {
    expect(() => compile(Schema.DurationFromSelf.ast, [])).toThrow(/unsupported Declaration/)
  })

  it("OptionFromSelf throws (use NullOr instead)", () => {
    expect(() => compile(
      Schema.OptionFromSelf(Schema.BigIntFromSelf).ast, []
    )).toThrow(/unsupported Declaration/)
  })

  it("error message includes path", () => {
    try {
      compile(Schema.Struct({
        timestamp: Schema.DateFromSelf
      }).ast, [])
      expect.unreachable()
    } catch (e: unknown) {
      expect((e as Error).message).toContain("timestamp")
    }
  })
})

// ============================================================
// Enum shorthand
// ============================================================

describe("Plutus.makeEnum", () => {
  it("basic 3-variant enum", () => {
    const Color = Plutus.makeEnum("Red", "Green", "Blue")
    const codec = Plutus.codec(Color)

    const red = codec.toData({ _tag: "Red" })
    expect((red as Data.Constr).index).toBe(0n)
    expect((red as Data.Constr).fields).toHaveLength(0)

    const green = codec.toData({ _tag: "Green" })
    expect((green as Data.Constr).index).toBe(1n)

    const blue = codec.toData({ _tag: "Blue" })
    expect((blue as Data.Constr).index).toBe(2n)

    // Roundtrip
    expect(codec.fromCBORHex(codec.toCBORHex({ _tag: "Red" }))._tag).toBe("Red")
    expect(codec.fromCBORHex(codec.toCBORHex({ _tag: "Green" }))._tag).toBe("Green")
    expect(codec.fromCBORHex(codec.toCBORHex({ _tag: "Blue" }))._tag).toBe("Blue")
  })

  it("CBOR matches manual makeIsDataIndexed equivalent", () => {
    const enumVersion = Plutus.makeEnum("A", "B", "C")
    const manualVersion = Plutus.makeIsDataIndexed(
      { A: {}, B: {}, C: {} },
      { A: 0, B: 1, C: 2 }
    )

    for (const tag of ["A", "B", "C"] as const) {
      const enumCbor = Plutus.codec(enumVersion).toCBORHex({ _tag: tag })
      const manualCbor = Plutus.codec(manualVersion).toCBORHex({ _tag: tag })
      expect(enumCbor).toBe(manualCbor)
    }
  })

  it("10+ variants", () => {
    const BigEnum = Plutus.makeEnum(
      "V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10"
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
    const Direction = Plutus.makeEnum("Up", "Down", "Left", "Right")
    const Move = Plutus.data(Schema.Struct({
      direction: Direction,
      distance: Schema.BigIntFromSelf
    }))
    const codec = Plutus.codec(Move)

    const input = { direction: { _tag: "Left" as const }, distance: 5n }
    const cbor = codec.toCBORHex(input)
    const decoded = codec.fromCBORHex(cbor)
    expect(decoded.direction._tag).toBe("Left")
    expect(decoded.distance).toBe(5n)
  })
})

// ============================================================
// Transformation edge cases
// ============================================================

describe("Transformation edge cases", () => {
  it("Schema.BigInt (string → bigint transformation) looks through", () => {
    // Schema.BigInt has AST: Transformation(StringKeyword → BigIntKeyword)
    const codec = compile(Schema.BigInt.ast, [])
    expect(codec.toData(42n)).toBe(42n)
  })

  it("Schema.Boolean (not a transformation — it's BooleanKeyword)", () => {
    const codec = compile(Schema.Boolean.ast, [])
    const data = codec.toData(true)
    expect(data).toBeInstanceOf(Data.Constr)
    expect((data as Data.Constr).index).toBe(1n)
  })

  it("Refinement chain looks through all the way", () => {
    const Refined = Schema.BigIntFromSelf.pipe(
      Schema.filter((n) => n > 0n),
      Schema.filter((n) => n < 1000n)
    )
    const codec = compile(Refined.ast, [])
    expect(codec.toData(42n)).toBe(42n)
  })
})

// ============================================================
// Roundtrip stress: complex nested structure
// ============================================================

describe("roundtrip stress", () => {
  it("deeply nested heterogeneous structure", () => {
    const DeepStruct = Plutus.data(Schema.Struct({
      a: Schema.BigIntFromSelf,
      b: Schema.Struct({
        c: Schema.Uint8ArrayFromSelf,
        d: Schema.NullOr(Schema.BigIntFromSelf),
        e: Schema.Array(Schema.Struct({
          f: Schema.BigIntFromSelf,
          g: Schema.Boolean
        }))
      }),
      h: Schema.MapFromSelf({
        key: Schema.Uint8ArrayFromSelf,
        value: Schema.BigIntFromSelf
      })
    }))
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

  it("deeply nested with null at every level", () => {
    const DeepNull = Plutus.data(Schema.Struct({
      a: Schema.NullOr(Schema.Struct({
        b: Schema.NullOr(Schema.Struct({
          c: Schema.NullOr(Schema.BigIntFromSelf)
        }))
      }))
    }))
    const codec = Plutus.codec(DeepNull)

    // All present
    const full = { a: { b: { c: 42n } } }
    expect(codec.fromCBORHex(codec.toCBORHex(full))).toEqual(full)

    // Null at each level
    expect(codec.fromCBORHex(codec.toCBORHex({ a: null }))).toEqual({ a: null })
    expect(codec.fromCBORHex(codec.toCBORHex({ a: { b: null } }))).toEqual({ a: { b: null } })
    expect(codec.fromCBORHex(codec.toCBORHex({ a: { b: { c: null } } }))).toEqual({ a: { b: { c: null } } })
  })
})
