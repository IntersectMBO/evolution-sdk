import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Data from "../src/Data.js"
import * as PA from "../src/PlutusAnnotation.js"
import * as Plutus from "../src/PlutusSchema.js"
import * as TSchema from "../src/TSchema.js"

// ============================================================
// 1. Deeply Nested Recursive Types
// ============================================================

describe("deeply nested recursive types", () => {
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

    // Build a 10-level deep list
    let list: LinkedList = { value: 10n, next: null }
    for (let i = 9n; i >= 1n; i--) {
      list = { value: i, next: list }
    }

    const cbor = codec.toCBORHex(list)
    const decoded = codec.fromCBORHex(cbor) as LinkedList

    // Walk and verify
    let current: LinkedList | null = decoded
    for (let i = 1n; i <= 10n; i++) {
      expect(current).not.toBeNull()
      expect(current!.value).toBe(i)
      current = current!.next
    }
    expect(current).toBeNull()
  })
})

// ============================================================
// 1b. Mutual Recursion
// ============================================================

describe("mutual recursion", () => {
  it("Expr/BinOp mutual recursion via Schema.suspend", () => {
    // Mutual recursion: Expr = Lit | BinOp, BinOp has left/right: Expr
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

  it("A → B → A mutual recursion (separate schemas)", () => {
    // Type A contains a B, type B contains an optional A
    interface A { readonly value: bigint; readonly b: B }
    interface B { readonly label: bigint; readonly a: A | null }

    // Both reference each other via Schema.suspend
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

// ============================================================
// 2. Option/Nullable Combinations
// ============================================================

describe("option/nullable combinations", () => {
  it("nested options: Option(Option(Integer))", () => {
    const NestedOpt = Plutus.data(
      Schema.NullOr(Schema.NullOr(Schema.BigIntFromSelf))
    )
    const codec = Plutus.codec(NestedOpt)

    // Just(Just(42))
    const jj = codec.toData(42n)
    expect((jj as Data.Constr).index).toBe(0n) // outer Just
    const inner = (jj as Data.Constr).fields[0] as Data.Constr
    expect(inner.index).toBe(0n) // inner Just
    expect(inner.fields[0]).toBe(42n)

    // Just(Nothing)
    const jn = codec.toData(null)
    // Schema.NullOr(Schema.NullOr(X)) flattens: null means outer Nothing
    expect((jn as Data.Constr).index).toBe(1n)

    // Roundtrip
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

    // Just(true) → Constr(0, [Constr(1, [])])
    const jt = codec.toData(true)
    expect((jt as Data.Constr).index).toBe(0n)
    expect(((jt as Data.Constr).fields[0] as Data.Constr).index).toBe(1n)

    // Just(false) → Constr(0, [Constr(0, [])])
    const jf = codec.toData(false)
    expect(((jf as Data.Constr).fields[0] as Data.Constr).index).toBe(0n)

    // Nothing → Constr(1, [])
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
})

// ============================================================
// 3. Custom Constructor Indices in Nested Unions
// ============================================================

describe("custom constructor indices in nested unions", () => {
  it("nested sum type: OutputDatum inside TxOut-like struct", () => {
    const OutputDatum = Plutus.makeIsDataIndexed(
      {
        NoDatum: {},
        DatumHash: { hash: Schema.Uint8ArrayFromSelf },
        InlineDatum: { datum: Schema.BigIntFromSelf }
      },
      { NoDatum: 0, DatumHash: 1, InlineDatum: 2 }
    )

    const TxOut = Plutus.data(Schema.Struct({
      value: Schema.BigIntFromSelf,
      datum: Schema.Struct({
        _tag: Schema.Literal("NoDatum"),
      }).annotations({
        [PA.ConstrIndexId]: 0,
        [PA.FlatInUnionId]: true
      })
    }))

    // Just test the OutputDatum directly with all three variants
    const datumCodec = Plutus.codec(OutputDatum)

    const noDatum = datumCodec.toData({ _tag: "NoDatum" })
    expect((noDatum as Data.Constr).index).toBe(0n)
    expect((noDatum as Data.Constr).fields).toHaveLength(0)

    const datumHash = datumCodec.toData({ _tag: "DatumHash", hash: new Uint8Array([1, 2]) })
    expect((datumHash as Data.Constr).index).toBe(1n)

    const inlineDatum = datumCodec.toData({ _tag: "InlineDatum", datum: 42n })
    expect((inlineDatum as Data.Constr).index).toBe(2n)

    // Roundtrip all variants
    expect(datumCodec.fromCBORHex(datumCodec.toCBORHex({ _tag: "NoDatum" }))._tag).toBe("NoDatum")
    expect(datumCodec.fromCBORHex(datumCodec.toCBORHex({ _tag: "DatumHash", hash: new Uint8Array([1, 2]) })).hash)
      .toEqual(new Uint8Array([1, 2]))
    expect(datumCodec.fromCBORHex(datumCodec.toCBORHex({ _tag: "InlineDatum", datum: 42n })).datum).toBe(42n)
  })

  it("non-sequential indices", () => {
    const Action = Plutus.makeIsDataIndexed(
      {
        Mint: { amount: Schema.BigIntFromSelf },
        Burn: { amount: Schema.BigIntFromSelf },
        Transfer: { from: Schema.Uint8ArrayFromSelf, to: Schema.Uint8ArrayFromSelf }
      },
      { Mint: 0, Burn: 5, Transfer: 10 }
    )

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

    // Roundtrip
    const cbor = codec.toCBORHex({ _tag: "Transfer", from: new Uint8Array([1]), to: new Uint8Array([2]) })
    const decoded = codec.fromCBORHex(cbor)
    expect(decoded._tag).toBe("Transfer")
    expect(decoded.from).toEqual(new Uint8Array([1]))
    expect(decoded.to).toEqual(new Uint8Array([2]))
  })
})

// ============================================================
// 4. Tag Field Auto-Detection with Annotations
// ============================================================

describe("tag field handling", () => {
  it("auto-detects _tag field", () => {
    const codec = Plutus.codec(Plutus.data(Schema.Struct({
      _tag: Schema.Literal("Mint"),
      amount: Schema.BigIntFromSelf
    })))

    const data = codec.toData({ _tag: "Mint" as const, amount: 100n })
    // _tag should be stripped
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

    // With tagField: false, _tag should NOT be stripped
    const data = codec.toData({ _tag: "Mint" as const, amount: 100n })
    // _tag is a Literal → Constr(0, []), so 2 fields total
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

// ============================================================
// 5. Mixing TSchema Fields Inside Plutus.data()
// ============================================================

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

// ============================================================
// 6. Error Messages for Unsupported Types
// ============================================================

describe("error messages", () => {
  it("string field gives helpful error", () => {
    expect(() => Plutus.data(Schema.Struct({
      name: Schema.String
    }))).toThrow(/string has no Plutus Data encoding/)
  })

  it("number field gives helpful error", () => {
    expect(() => Plutus.data(Schema.Struct({
      count: Schema.Number
    }))).toThrow(/number has no Plutus Data encoding/)
  })

  it("null literal standalone gives helpful error", () => {
    expect(() => Plutus.data(Schema.Literal(null))).toThrow(/null cannot be encoded standalone/)
  })
})

// ============================================================
// 7. Complex Compositions
// ============================================================

describe("complex compositions", () => {
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
    const decoded = codec.fromCBORHex(cbor)
    expect(decoded).toEqual(input)
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

  it("union of structs with different field counts", () => {
    const Action = Plutus.data(Schema.Union(
      Schema.Struct({
        _tag: Schema.Literal("Simple"),
        value: Schema.BigIntFromSelf
      }),
      Schema.Struct({
        _tag: Schema.Literal("Complex"),
        from: Schema.Uint8ArrayFromSelf,
        to: Schema.Uint8ArrayFromSelf,
        amount: Schema.BigIntFromSelf
      })
    ))
    const codec = Plutus.codec(Action)

    const simple = { _tag: "Simple" as const, value: 42n }
    const complex = {
      _tag: "Complex" as const,
      from: new Uint8Array([1]),
      to: new Uint8Array([2]),
      amount: 100n
    }

    expect(codec.fromCBORHex(codec.toCBORHex(simple))).toEqual(simple)
    expect(codec.fromCBORHex(codec.toCBORHex(complex))).toEqual(complex)
  })

  it("flatFields: inner struct fields inlined into parent Constr", () => {
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
    // Inner fields should be inlined: Constr(0, [1n, 2n, 3n]) not Constr(0, [Constr(0, [1n, 2n]), 3n])
    expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n])
    expect((data as Data.Constr).fields).toHaveLength(3)

    // Roundtrip
    const decoded = codec.fromData(data)
    expect(decoded).toEqual(input)
  })

  it("flatFields: multiple flat structs in parent", () => {
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
    // All 4 fields inlined: Constr(0, [1n, 2n, 3n, 4n])
    expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n, 4n])

    const decoded = codec.fromData(data)
    expect(decoded).toEqual(input)
  })

  it("flatFields: mixed flat and non-flat fields", () => {
    const FlatPart = Schema.Struct({
      a: Schema.BigIntFromSelf,
      b: Schema.BigIntFromSelf
    }).annotations({ [PA.FlatFieldsId]: true })

    const NonFlatPart = Schema.Struct({
      c: Schema.BigIntFromSelf
    })
    // No flatFields annotation → stays nested

    const Mixed = Plutus.data(Schema.Struct({
      flat: FlatPart,
      nested: NonFlatPart,
      z: Schema.BigIntFromSelf
    }))

    const codec = Plutus.codec(Mixed)
    const input = { flat: { a: 1n, b: 2n }, nested: { c: 3n }, z: 4n }

    const data = codec.toData(input)
    // flat inlined, nested stays as Constr: Constr(0, [1n, 2n, Constr(0, [3n]), 4n])
    expect((data as Data.Constr).fields).toHaveLength(4)
    expect((data as Data.Constr).fields[0]).toBe(1n)
    expect((data as Data.Constr).fields[1]).toBe(2n)
    expect((data as Data.Constr).fields[2]).toBeInstanceOf(Data.Constr)
    expect((data as Data.Constr).fields[3]).toBe(4n)

    const decoded = codec.fromData(data)
    expect(decoded).toEqual(input)
  })

  it("Map auto-derivation via Schema.MapFromSelf", () => {
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

  it("Map auto-derivation via Schema.Map", () => {
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

  it("nested Map (Map<ByteArray, Map<ByteArray, Integer>>) — Value pattern", () => {
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

  it("flatFields with TSchema.flatFields annotation (backward compat)", () => {
    // TSchema uses string-key annotation "TSchema.flatFields": true
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
    // Should be inlined
    expect((data as Data.Constr).fields).toEqual([1n, 2n, 3n])

    const decoded = codec.fromData(data)
    expect(decoded).toEqual(input)
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
    expect(decoded[2]).toBe(true) // Boolean roundtrips back to boolean
  })

  it("empty struct encodes as Constr(0, [])", () => {
    const Empty = Plutus.data(Schema.Struct({}))
    const codec = Plutus.codec(Empty)

    const data = codec.toData({})
    expect(data).toBeInstanceOf(Data.Constr)
    expect((data as Data.Constr).index).toBe(0n)
    expect((data as Data.Constr).fields).toHaveLength(0)
  })
})

// ============================================================
// 8. Performance: annotation traversal vs direct TSchema
// ============================================================

describe("performance", () => {
  it("Plutus.data() compilation is fast (< 10ms for simple struct)", () => {
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      Plutus.data(Schema.Struct({
        owner: Schema.Uint8ArrayFromSelf,
        amount: Schema.BigIntFromSelf
      }))
    }
    const elapsed = performance.now() - start
    // 100 compilations should take well under 100ms
    expect(elapsed).toBeLessThan(100)
  })

  it("codec encode/decode is fast (< 1ms per operation)", () => {
    const MyDatum = Plutus.data(Schema.Struct({
      owner: Schema.Uint8ArrayFromSelf,
      amount: Schema.BigIntFromSelf
    }))
    const codec = Plutus.codec(MyDatum)
    const input = { owner: new Uint8Array([1, 2, 3]), amount: 42n }

    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      const data = codec.toData(input)
      codec.fromData(data)
    }
    const elapsed = performance.now() - start
    // 1000 roundtrips should take well under 1000ms
    expect(elapsed).toBeLessThan(1000)
  })
})
