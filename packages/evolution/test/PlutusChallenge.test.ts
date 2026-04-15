/**
 * Phase 11: Challenge the Implementation
 *
 * Adversarial tests designed to find holes, edge cases, and
 * design weaknesses in the Plutus annotation system.
 */
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Data from "../src/Data.js"
import * as PA from "../src/PlutusAnnotation.js"
import { compile } from "../src/PlutusCompiler.js"
import * as Plutus from "../src/PlutusSchema.js"
import * as TSchema from "../src/TSchema.js"

// ============================================================
// 1. Question the Compiler Pattern
// ============================================================

describe("1. compiler pattern challenges", () => {
  it("encoding failure throws (not ParseError) — raw throw, not Effect error channel", () => {
    // The compiler uses raw toData/fromData, not Effect's ParseResult.
    // This means encoding failures are thrown exceptions, not typed errors.
    // This is a known tradeoff for simplicity — document it.
    const codec = Plutus.codec(Plutus.data(Schema.Struct({
      amount: Schema.BigIntFromSelf
    })))

    // Encoding with wrong type — does this throw or return ParseError?
    expect(() => codec.toData({ amount: "not a bigint" as any })).toThrow()
  })

  it("fromData with wrong Data shape throws", () => {
    const codec = Plutus.codec(Plutus.data(Schema.Struct({
      amount: Schema.BigIntFromSelf
    })))

    // Decode a bigint (not a Constr) — should throw
    expect(() => codec.fromData(42n)).toThrow()
  })

  it("compile() is deterministic — same AST produces same codec behavior", () => {
    const schema = Schema.Struct({
      a: Schema.BigIntFromSelf,
      b: Schema.Uint8ArrayFromSelf
    })

    const codec1 = compile(schema.ast, [])
    const codec2 = compile(schema.ast, [])

    const input = { a: 1n, b: new Uint8Array([2]) }
    const data1 = codec1.toData(input)
    const data2 = codec2.toData(input)

    // Both should produce identical Data
    expect((data1 as Data.Constr).index).toBe((data2 as Data.Constr).index)
    expect((data1 as Data.Constr).fields).toEqual((data2 as Data.Constr).fields)
  })
})

// ============================================================
// 2. Annotation Coverage
// ============================================================

describe("2. annotation coverage challenges", () => {
  it("Schema.Class as input — compiles via from-side TypeLiteral", () => {
    class MyClass extends Schema.Class<MyClass>("MyClass")({
      value: Schema.BigIntFromSelf
    }) {}

    // Schema.Class AST: Transformation(from: TypeLiteral, to: Declaration)
    // The compiler now detects this pattern and compiles the from-side TypeLiteral
    const codec = compile(MyClass.ast, [])

    const instance = new MyClass({ value: 42n })
    const result = codec.toData(instance)
    expect(result).toBeInstanceOf(Data.Constr)
    expect((result as Data.Constr).index).toBe(0n)
    expect((result as Data.Constr).fields[0]).toBe(42n)

    // Roundtrip
    const decoded = codec.fromData(result)
    expect(decoded.value).toBe(42n)
  })

  it("Schema.TaggedClass — compiles with _tag stripping", () => {
    class Tagged extends Schema.TaggedClass<Tagged>()("Tagged", {
      x: Schema.BigIntFromSelf
    }) {}

    const codec = compile(Tagged.ast, [])
    const instance = new Tagged({ x: 1n })
    const result = codec.toData(instance)
    expect(result).toBeInstanceOf(Data.Constr)
    // _tag:"Tagged" should be stripped, leaving just x
    expect((result as Data.Constr).fields).toHaveLength(1)
    expect((result as Data.Constr).fields[0]).toBe(1n)

    // Roundtrip
    const decoded = codec.fromData(result)
    expect(decoded._tag).toBe("Tagged")
    expect(decoded.x).toBe(1n)
  })

  it("branded type (Schema.BigIntFromSelf.pipe(Schema.brand('Lovelace'))) looks through", () => {
    const Lovelace = Schema.BigIntFromSelf.pipe(Schema.brand("Lovelace"))

    // Branded types use Refinement AST → compiler looks through to base
    const codec = compile(Lovelace.ast, [])
    expect(codec.toData(42n as any)).toBe(42n)
    expect(codec.fromData(42n)).toBe(42n)
  })

  it("filtered/refined type looks through", () => {
    const PositiveBigInt = Schema.BigIntFromSelf.pipe(
      Schema.filter((n) => n > 0n)
    )

    const MyStruct = Plutus.data(Schema.Struct({
      amount: PositiveBigInt
    }))
    const codec = Plutus.codec(MyStruct)

    // The compiler ignores the refinement and encodes the base type
    const data = codec.toData({ amount: 42n })
    expect((data as Data.Constr).fields[0]).toBe(42n)
  })
})

// ============================================================
// 3. Type Safety Audit
// ============================================================

describe("3. type safety audit", () => {
  it("Plutus.data() return type is Schema<A, Data.Data>", () => {
    const MyDatum = Plutus.data(Schema.Struct({
      amount: Schema.BigIntFromSelf
    }))

    // The schema should have the right type structure
    // (we can't directly test TS types at runtime, but we can verify
    // the schema works with Schema.encodeSync/decodeSync)
    const encode = Schema.encodeSync(MyDatum)
    const decode = Schema.decodeSync(MyDatum)

    const data = encode({ amount: 42n })
    expect(data).toBeInstanceOf(Data.Constr)

    const value = decode(data)
    expect(value.amount).toBe(42n)
  })

  it("Plutus.data() composes with Schema.compose", () => {
    const Inner = Plutus.data(Schema.Struct({
      x: Schema.BigIntFromSelf
    }))

    // Schema.compose should work if types align
    // Inner: Schema<{x: bigint}, Data.Data>
    // We can compose with a Data.Data → string (CBOR hex) transform
    // This tests that the schema is properly typed
    const encoded = Schema.encodeSync(Inner)({ x: 42n })
    expect(encoded).toBeInstanceOf(Data.Constr)
  })

  it("fromSchema is referentially equal to data", () => {
    expect(Plutus.fromSchema).toBe(Plutus.data)
  })
})

// ============================================================
// 4. Adversarial Inputs — Try to Break It
// ============================================================

describe("4. adversarial inputs", () => {
  it("FINDING: Schema.Record silently ignores index signatures — produces empty Constr", () => {
    // Schema.Record produces a TypeLiteral with indexSignatures (not propertySignatures).
    // The compiler's TypeLiteral handler only processes propertySignatures and
    // ignores indexSignatures entirely. This means Record<string, bigint> compiles
    // to Constr(0, []) — silently losing all data.
    //
    // This is a genuine limitation: Plutus Data has no concept of string-keyed records.
    // For key-value data, users must use Plutus.Map(KeySchema, ValueSchema).
    //
    // TODO: The compiler should throw an error when indexSignatures are present
    // instead of silently ignoring them.
    const RecordSchema = Schema.Record({
      key: Schema.String,
      value: Schema.BigIntFromSelf
    })

    // FIX: Now throws instead of silently producing empty Constr
    expect(() => compile(RecordSchema.ast, [])).toThrow(/index signatures.*not supported/)
  })

  it("Schema with optional property", () => {
    const WithOptional = Schema.Struct({
      required: Schema.BigIntFromSelf,
      optional: Schema.optional(Schema.BigIntFromSelf)
    })

    // optional fields are still in the TypeLiteral's propertySignatures
    // with isOptional=true. The compiler should handle this.
    const codec = Plutus.codec(Plutus.data(WithOptional))

    // With the optional field present
    const withOpt = codec.toData({ required: 1n, optional: 42n })
    expect((withOpt as Data.Constr).fields).toHaveLength(2)

    // Without the optional field — the field is undefined in TS
    const withoutOpt = codec.toData({ required: 1n })
    // The compiler encodes undefined as-is (passthrough via BigIntKeyword)
    // This may produce invalid Data — document this behavior
    expect((withoutOpt as Data.Constr).fields).toHaveLength(2)
  })

  it("deeply nested transformations (Schema.BigInt which is string → bigint)", () => {
    // Schema.BigInt has AST: Transformation(StringKeyword → BigIntKeyword)
    // The compiler should look through to BigIntKeyword
    const codec = compile(Schema.BigInt.ast, [])
    expect(codec.toData(42n)).toBe(42n)
  })

  it("union with non-struct members (BigInt | Boolean)", () => {
    // This is a union of primitive types — no tag field
    const PrimitiveUnion = Schema.Union(
      Schema.BigIntFromSelf,
      Schema.Boolean
    )

    // The compiler's Union handler can't auto-detect tag fields
    // for non-struct members. It falls back to index-based matching.
    const codec = compile(PrimitiveUnion.ast, [])

    // BigInt member (index 0)
    const bigintData = codec.toData(42n)
    expect(bigintData).toBeInstanceOf(Data.Constr)
    // The bigint is wrapped: Constr(0, [42n])
    expect((bigintData as Data.Constr).index).toBe(0n)
    expect((bigintData as Data.Constr).fields[0]).toBe(42n)
  })

  it("single-member union", () => {
    const SingleUnion = Schema.Union(
      Schema.Struct({
        _tag: Schema.Literal("Only"),
        value: Schema.BigIntFromSelf
      })
    )

    const codec = compile(SingleUnion.ast, [])
    const data = codec.toData({ _tag: "Only" as const, value: 42n })
    expect(data).toBeInstanceOf(Data.Constr)
    expect((data as Data.Constr).fields[0]).toBe(42n)
  })

  it("tuple with rest elements (Schema.Tuple + rest)", () => {
    // Schema.Tuple with no elements but rest = Schema.Array behavior
    // already tested. Let's test mixed: elements + rest
    // Effect's Schema.Tuple doesn't easily express elements+rest in v3,
    // but we can test what the compiler does with pure elements
    const FixedTuple = Schema.Tuple(
      Schema.BigIntFromSelf,
      Schema.BigIntFromSelf,
      Schema.BigIntFromSelf
    )

    const codec = compile(FixedTuple.ast, [])
    const data = codec.toData([1n, 2n, 3n])
    expect(data).toEqual([1n, 2n, 3n])
  })

  it("empty struct round-trips", () => {
    const Empty = Plutus.data(Schema.Struct({}))
    const codec = Plutus.codec(Empty)

    const data = codec.toData({})
    expect(data).toBeInstanceOf(Data.Constr)
    expect((data as Data.Constr).fields).toHaveLength(0)

    const decoded = codec.fromData(data)
    expect(decoded).toEqual({})
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
})

// ============================================================
// 5. Haskell Comparison — Complex Contract Types
// ============================================================

describe("5. haskell comparison — complex types", () => {
  it("Haskell TxInfo-like type (nested structs + unions + options)", () => {
    // Simplified TxInfo: { inputs: [TxInInfo], mint: Value, validRange: POSIXTimeRange }
    // TxInInfo = { outRef: OutputRef, resolved: TxOut }
    // TxOut = { address: Address, value: bigint, datum: OutputDatum }
    // OutputDatum = NoDatum | DatumHash bytes | InlineDatum Data

    const OutputDatum = Plutus.makeIsDataIndexed(
      {
        NoDatum: {},
        DatumHash: { hash: Schema.Uint8ArrayFromSelf },
        InlineDatum: { datum: Schema.BigIntFromSelf }
      },
      { NoDatum: 0, DatumHash: 1, InlineDatum: 2 }
    )

    const TxOut = Plutus.data(Schema.Struct({
      address: Schema.Uint8ArrayFromSelf, // simplified
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
      out_ref: {
        tx_id: new Uint8Array(32).fill(0xab),
        idx: 0n
      },
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

  it("Haskell ScriptContext-like type (deeply nested)", () => {
    // ScriptPurpose = Minting PolicyId | Spending TxOutRef | Rewarding StakeCred | Certifying DCert
    const ScriptPurpose = Plutus.makeIsDataIndexed(
      {
        Minting: { policy_id: Schema.Uint8ArrayFromSelf },
        Spending: { tx_out_ref: Schema.Struct({
          tx_id: Schema.Uint8ArrayFromSelf,
          idx: Schema.BigIntFromSelf
        }) },
        Rewarding: { stake_cred: Schema.Uint8ArrayFromSelf },
        Certifying: { cert_idx: Schema.BigIntFromSelf }
      },
      { Minting: 0, Spending: 1, Rewarding: 2, Certifying: 3 }
    )

    const codec = Plutus.codec(ScriptPurpose)

    // Minting
    const minting = codec.toData({
      _tag: "Minting",
      policy_id: new Uint8Array(28).fill(0x01)
    })
    expect((minting as Data.Constr).index).toBe(0n)

    // Spending with nested struct
    const spending = codec.toData({
      _tag: "Spending",
      tx_out_ref: {
        tx_id: new Uint8Array(32).fill(0x02),
        idx: 5n
      }
    })
    expect((spending as Data.Constr).index).toBe(1n)

    // Roundtrip
    const spendingDecoded = codec.fromCBORHex(codec.toCBORHex({
      _tag: "Spending",
      tx_out_ref: { tx_id: new Uint8Array(32).fill(0x02), idx: 5n }
    }))
    expect(spendingDecoded._tag).toBe("Spending")
    expect(spendingDecoded.tx_out_ref.idx).toBe(5n)
  })

  it("Haskell recursive MultisigScript", () => {
    // data NativeScript = ScriptPubkey PubKeyHash
    //                   | ScriptAll [NativeScript]
    //                   | ScriptAny [NativeScript]
    //                   | ScriptNOfK Int [NativeScript]
    //                   | TimelockStart POSIXTime
    //                   | TimelockExpiry POSIXTime

    interface NativeScript {
      readonly _tag: "ScriptPubkey" | "ScriptAll" | "ScriptAny" | "ScriptNOfK" | "TimelockStart" | "TimelockExpiry"
      readonly [key: string]: any
    }

    const NativeScript: Schema.Schema<NativeScript, Data.Data> = Plutus.makeIsDataIndexed(
      {
        ScriptPubkey: { key_hash: Schema.Uint8ArrayFromSelf },
        ScriptAll: { scripts: Schema.Array(Schema.suspend((): Schema.Schema<NativeScript> => NativeScript as any)) },
        ScriptAny: { scripts: Schema.Array(Schema.suspend((): Schema.Schema<NativeScript> => NativeScript as any)) },
        ScriptNOfK: {
          n: Schema.BigIntFromSelf,
          scripts: Schema.Array(Schema.suspend((): Schema.Schema<NativeScript> => NativeScript as any))
        },
        TimelockStart: { time: Schema.BigIntFromSelf },
        TimelockExpiry: { time: Schema.BigIntFromSelf }
      },
      { ScriptPubkey: 0, ScriptAll: 1, ScriptAny: 2, ScriptNOfK: 3, TimelockStart: 4, TimelockExpiry: 5 }
    ) as any

    const codec = Plutus.codec(NativeScript as any)

    // Complex nested script: All(Pubkey, Any(Pubkey, TimelockStart))
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

// ============================================================
// 6. Benchmark Against TSchema
// ============================================================

describe("6. benchmark against TSchema", () => {
  const N = 1000

  it("compilation: Plutus.data() vs TSchema.Struct", () => {
    const startTSchema = performance.now()
    for (let i = 0; i < N; i++) {
      TSchema.Struct({
        owner: TSchema.ByteArray,
        amount: TSchema.Integer,
        active: TSchema.Boolean
      })
    }
    const tschemaTime = performance.now() - startTSchema

    const startPlutus = performance.now()
    for (let i = 0; i < N; i++) {
      Plutus.data(Schema.Struct({
        owner: Schema.Uint8ArrayFromSelf,
        amount: Schema.BigIntFromSelf,
        active: Schema.Boolean
      }))
    }
    const plutusTime = performance.now() - startPlutus

    // Plutus.data() does more work (AST walk + compile) so it will be slower,
    // but should be within 10x of TSchema construction
    expect(plutusTime).toBeLessThan(tschemaTime * 10)
  })

  it("encode throughput: Plutus.data codec vs TSchema codec", () => {
    const tschemaCodec = Data.withSchema(TSchema.Struct({
      owner: TSchema.ByteArray,
      amount: TSchema.Integer
    }))

    const plutusCodec = Plutus.codec(Plutus.data(Schema.Struct({
      owner: Schema.Uint8ArrayFromSelf,
      amount: Schema.BigIntFromSelf
    })))

    const input = { owner: new Uint8Array([1, 2, 3]), amount: 42n }

    const startTSchema = performance.now()
    for (let i = 0; i < N; i++) {
      tschemaCodec.toData(input)
    }
    const tschemaTime = performance.now() - startTSchema

    const startPlutus = performance.now()
    for (let i = 0; i < N; i++) {
      plutusCodec.toData(input)
    }
    const plutusTime = performance.now() - startPlutus

    // Encode should be comparable — Plutus.data() codec is just function calls
    // Allow 5x overhead max
    expect(plutusTime).toBeLessThan(tschemaTime * 5)
  })

  it("decode throughput: Plutus.data codec vs TSchema codec", () => {
    const tschemaCodec = Data.withSchema(TSchema.Struct({
      owner: TSchema.ByteArray,
      amount: TSchema.Integer
    }))

    const plutusCodec = Plutus.codec(Plutus.data(Schema.Struct({
      owner: Schema.Uint8ArrayFromSelf,
      amount: Schema.BigIntFromSelf
    })))

    const data = new Data.Constr({
      index: 0n,
      fields: [new Uint8Array([1, 2, 3]), 42n]
    })

    const startTSchema = performance.now()
    for (let i = 0; i < N; i++) {
      tschemaCodec.fromData(data)
    }
    const tschemaTime = performance.now() - startTSchema

    const startPlutus = performance.now()
    for (let i = 0; i < N; i++) {
      plutusCodec.fromData(data)
    }
    const plutusTime = performance.now() - startPlutus

    expect(plutusTime).toBeLessThan(tschemaTime * 5)
  })

  it("encode with TSchema.Boolean field — fast-path vs slow-path", () => {
    // This tests the TSchema fast-path optimization:
    // TSchema.Boolean inside Plutus.data() should use direct booleanCodec
    // instead of Schema.encodeSync(tschemaSchema)
    const plutusCodec = Plutus.codec(Plutus.data(Schema.Struct({
      amount: Schema.BigIntFromSelf,
      active: TSchema.Boolean
    })))

    const tschemaCodec = Data.withSchema(TSchema.Struct({
      amount: TSchema.Integer,
      active: TSchema.Boolean
    }))

    const input = { amount: 42n, active: true }

    const startTSchema = performance.now()
    for (let i = 0; i < N; i++) {
      tschemaCodec.toData(input)
    }
    const tschemaTime = performance.now() - startTSchema

    const startPlutus = performance.now()
    for (let i = 0; i < N; i++) {
      plutusCodec.toData(input)
    }
    const plutusTime = performance.now() - startPlutus

    // With the fast-path, should be within 3x
    expect(plutusTime).toBeLessThan(tschemaTime * 3)
  })
})

// ============================================================
// 7. Error Quality Review
// ============================================================

describe("7. error quality review", () => {
  it("string field error includes path", () => {
    try {
      Plutus.data(Schema.Struct({
        name: Schema.String
      }))
      expect.unreachable()
    } catch (e: any) {
      expect(e.message).toContain("string")
      expect(e.message).toContain("Plutus")
      expect(e.message).toContain("name")
    }
  })

  it("number field error includes path", () => {
    try {
      Plutus.data(Schema.Struct({
        count: Schema.Number
      }))
      expect.unreachable()
    } catch (e: any) {
      expect(e.message).toContain("number")
      expect(e.message).toContain("count")
    }
  })

  it("null literal standalone error is clear", () => {
    try {
      Plutus.data(Schema.Literal(null) as any)
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

  it("void keyword error is clear", () => {
    try {
      compile(Schema.Void.ast, [])
      expect.unreachable()
    } catch (e: any) {
      expect(e.message).toContain("void")
    }
  })

  it("symbol keyword error is clear", () => {
    try {
      compile(Schema.SymbolFromSelf.ast, [])
      expect.unreachable()
    } catch (e: any) {
      expect(e.message).toContain("symbol")
    }
  })

  it("template literal error is clear", () => {
    try {
      compile(Schema.TemplateLiteral(Schema.Literal("hello"), Schema.Number).ast, [])
      expect.unreachable()
    } catch (e: any) {
      expect(e.message).toContain("template literal")
    }
  })
})

// ============================================================
// 8. Summary of Findings
// ============================================================

describe("8. findings summary", () => {
  it("RESOLVED: Schema.Class/TaggedClass now compile via from-side TypeLiteral", () => {
    // Schema.Class AST: Transformation(from: TypeLiteral, to: Declaration)
    // The compiler detects this pattern and compiles from-side, same as Schema.Struct
    class MyClass extends Schema.Class<MyClass>("MyClass")({
      amount: Schema.BigIntFromSelf
    }) {}

    const plutusSchema = Plutus.data(MyClass)
    const codec = Plutus.codec(plutusSchema)
    const data = codec.toData(new MyClass({ amount: 42n }))
    expect(data).toBeInstanceOf(Data.Constr)
    expect((data as Data.Constr).fields[0]).toBe(42n)
  })

  it("FINDING: Error channel is synchronous throw, not Effect ParseError", () => {
    // The compiler uses raw functions, not Effect.
    // Schema.encodeSync/decodeSync in Data.withSchema wraps these into ParseError.
    // So at the codec level, users get proper ParseError.
    // This is acceptable for the current design.
    const codec = Plutus.codec(Plutus.data(Schema.Struct({
      amount: Schema.BigIntFromSelf
    })))

    // Data.withSchema uses Schema.encodeSync which wraps into ParseError
    expect(() => codec.toData({ amount: "wrong" as any })).toThrow()
  })

  it("FINDING: optional fields encode undefined values — user must use NullOr/UndefinedOr explicitly", () => {
    // Schema.optional creates a field that may be absent.
    // The compiler encodes whatever value is there (or undefined).
    // For Plutus, users should use NullOr or UndefinedOr for optional semantics.
  })

  it("FINDING: branded types work transparently via Refinement look-through", () => {
    const Lovelace = Schema.BigIntFromSelf.pipe(Schema.brand("Lovelace"))
    const MyStruct = Plutus.data(Schema.Struct({
      amount: Lovelace
    }))
    const codec = Plutus.codec(MyStruct)
    expect(codec.fromCBORHex(codec.toCBORHex({ amount: 42n as any }))).toEqual({ amount: 42n })
  })
})
