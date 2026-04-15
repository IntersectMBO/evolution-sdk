/**
 * Phase 12+ Iteration 13: Benchmark Improvements
 *
 * Profile hot paths, benchmark realistic workloads, report actual numbers.
 */
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Data from "../src/Data.js"
import * as PA from "../src/PlutusAnnotation.js"
import { compile } from "../src/PlutusCompiler.js"
import * as Plutus from "../src/PlutusSchema.js"
import * as TSchema from "../src/TSchema.js"

const N = 5000

// Helper: measure ms for N iterations, return ms/op
const bench = (name: string, fn: () => void): number => {
  // Warmup
  for (let i = 0; i < 100; i++) fn()

  const start = performance.now()
  for (let i = 0; i < N; i++) fn()
  const elapsed = performance.now() - start
  const msPerOp = elapsed / N

  // Log for visibility (vitest --reporter=verbose shows these)
  console.log(`  [bench] ${name}: ${msPerOp.toFixed(4)} ms/op (${N} iterations, ${elapsed.toFixed(1)}ms total)`)
  return msPerOp
}

// ============================================================
// 1. Profile the Hot Path
// ============================================================

describe("1. profile hot path", () => {
  it("AST compile vs codec.toData vs Data.Constr construction", () => {
    const schema = Schema.Struct({
      owner: Schema.Uint8ArrayFromSelf,
      amount: Schema.BigIntFromSelf
    })
    const input = { owner: new Uint8Array([1, 2, 3]), amount: 42n }

    // Measure: AST compilation
    const compileMs = bench("AST compile", () => {
      compile(schema.ast, [])
    })

    // Measure: codec.toData (pre-compiled)
    const codec = compile(schema.ast, [])
    const toDataMs = bench("codec.toData", () => {
      codec.toData(input)
    })

    // Measure: raw Data.Constr construction (baseline)
    const constrMs = bench("new Data.Constr", () => {
      new Data.Constr({ index: 0n, fields: [new Uint8Array([1, 2, 3]), 42n] })
    })

    // Measure: full Plutus.data() + codec pipeline
    const plutusSchema = Plutus.data(schema)
    const plutusCodec = Plutus.codec(plutusSchema)
    const fullMs = bench("full pipeline (Plutus.codec.toData)", () => {
      plutusCodec.toData(input)
    })

    // The hot path breakdown:
    // - Data.Constr construction is the absolute baseline
    // - codec.toData adds field iteration + Constr creation
    // - full pipeline adds Schema.transform overhead
    expect(compileMs).toBeGreaterThan(0)
    expect(toDataMs).toBeGreaterThan(0)
    expect(constrMs).toBeGreaterThan(0)
    expect(fullMs).toBeGreaterThan(0)
  })
})

// ============================================================
// 2. Schema.transform overhead measurement
// ============================================================

describe("2. Schema.transform overhead", () => {
  it("direct codec.toData vs Plutus.codec().toData", () => {
    const schema = Schema.Struct({
      owner: Schema.Uint8ArrayFromSelf,
      amount: Schema.BigIntFromSelf
    })
    const input = { owner: new Uint8Array([1, 2, 3]), amount: 42n }

    // Direct: bypass Schema.transform, call codec directly
    const directCodec = compile(schema.ast, [])
    const directMs = bench("direct codec.toData", () => {
      directCodec.toData(input)
    })

    // Via Plutus.codec: goes through Schema.transform → Schema.encodeSync
    const plutusCodec = Plutus.codec(Plutus.data(schema))
    const pipelineMs = bench("Plutus.codec().toData", () => {
      plutusCodec.toData(input)
    })

    // TSchema baseline
    const tschemaCodec = Data.withSchema(TSchema.Struct({
      owner: TSchema.ByteArray,
      amount: TSchema.Integer
    }))
    const tschemaMs = bench("TSchema codec.toData", () => {
      tschemaCodec.toData(input)
    })

    // Report the overhead ratio
    const overheadVsDirect = pipelineMs / directMs
    const overheadVsTSchema = pipelineMs / tschemaMs
    console.log(`  [ratio] Pipeline vs direct: ${overheadVsDirect.toFixed(1)}x`)
    console.log(`  [ratio] Pipeline vs TSchema: ${overheadVsTSchema.toFixed(1)}x`)

    // Pipeline should be within 5x of direct (Schema.transform overhead)
    expect(pipelineMs).toBeLessThan(directMs * 5)
  })
})

// ============================================================
// 3. Compilation caching measurement
// ============================================================

describe("3. compilation caching", () => {
  it("repeated Plutus.data() on same schema shape", () => {
    const schema = Schema.Struct({
      owner: Schema.Uint8ArrayFromSelf,
      amount: Schema.BigIntFromSelf,
      active: Schema.Boolean
    })

    // First compilation
    const firstMs = bench("first compile", () => {
      Plutus.data(schema)
    })

    // Compilation is NOT cached — each call re-walks the AST
    // This is expected for now (schemas are cheap to compile)
    console.log(`  [note] Each Plutus.data() call recompiles — ${firstMs.toFixed(4)} ms/op`)

    // Verify it's still fast enough (< 0.5ms per compilation)
    expect(firstMs).toBeLessThan(0.5)
  })
})

// ============================================================
// 4. Realistic workloads
// ============================================================

describe("4. realistic workloads", () => {
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
    // TSchema
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

    // Plutus.data
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

  it("decode throughput — simple struct", () => {
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

  it("CBOR roundtrip — simple struct", () => {
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
