import { readFileSync } from "node:fs"
import { join } from "node:path"

import { ParseResult, Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as Data from "../src/Data.js"
import * as InlineDatum from "../src/InlineDatum.js"
import * as TransactionOutput from "../src/TransactionOutput.js"

// Plutus data can nest as deep as a transaction allows. Each shape below is about the
// deepest value of its kind that fits in 16 kB. Deep values are walked with loops,
// since a recursive equality check would overflow on them.

const unexpected = (what: string, value: unknown): never => {
  throw new Error(`expected ${what}, got ${String(value)}`)
}

const onlyField =
  (index: bigint) =>
  (data: Data.Data): Data.Data =>
    data instanceof Data.Constr && data.index === index && data.fields.length === 1
      ? data.fields[0]
      : unexpected(`constructor ${index} with one field`, data)

type Shape = {
  readonly name: string
  readonly open: string
  readonly depth: number
  readonly inner: (data: Data.Data) => Data.Data
}

const SHAPES: ReadonlyArray<Shape> = [
  {
    name: "lists",
    open: "81",
    depth: 16_384,
    inner: (data) => (Array.isArray(data) && data.length === 1 ? data[0] : unexpected("a one-item list", data))
  },
  { name: "constructors under tag 121", open: "d87981", depth: 5_400, inner: onlyField(0n) },
  { name: "constructors under tag 1280", open: "d9050081", depth: 4_000, inner: onlyField(7n) },
  { name: "constructors under tag 102", open: "d866821903e881", depth: 2_200, inner: onlyField(1000n) },
  {
    name: "maps",
    open: "a100",
    depth: 8_000,
    inner: (data) => (data instanceof Map && data.size === 1 ? data.get(0n) : undefined) ?? unexpected("a map {0: x}", data)
  }
]

const unwrap = (shape: Shape, data: Data.Data, depth = shape.depth): Data.Data => {
  let current = data
  for (let i = 0; i < depth; i++) current = shape.inner(current)
  return current
}

const OPTIONS = [CBOR.PLUTUS_DATA_OPTIONS, CBOR.CML_DATA_DEFAULT_OPTIONS, CBOR.CANONICAL_OPTIONS]

describe("Plutus data decoding of deeply nested values", () => {
  it.each(SHAPES)("decodes $depth levels of $name", (shape) => {
    const hex = shape.open.repeat(shape.depth) + "00"
    for (const options of OPTIONS) {
      expect(unwrap(shape, Data.fromCBORHex(hex, options))).toBe(0n)
      expect(unwrap(shape, Data.fromCBORBytes(Bytes.fromHex(hex), options))).toBe(0n)
      expect(unwrap(shape, Data.cborValueToPlutusData(CBOR.fromCBORHex(hex, options)))).toBe(0n)
    }
  })

  it("decodes a transaction output whose inline datum nests 15,000 levels and writes the same bytes", () => {
    const datum = "81".repeat(15_000) + "00"
    const datumLength = (datum.length / 2).toString(16).padStart(4, "0")
    // {0: enterprise testnet address, 1: 1,000 ADA, 2: [1, 24(datum bytes)]}
    const hex = `a300581d60${"11".repeat(28)}011a3b9aca00028201d81859${datumLength}${datum}`

    const output = TransactionOutput.fromCBORHex(hex)

    if (!(output instanceof TransactionOutput.BabbageTransactionOutput)) return unexpected("a Babbage output", output)
    if (!(output.datumOption instanceof InlineDatum.InlineDatum)) return unexpected("an inline datum", output.datumOption)
    expect(unwrap(SHAPES[0], output.datumOption.data, 15_000)).toBe(0n)
    expect(TransactionOutput.toCBORHex(output)).toBe(hex)
  })
})

describe("Plutus data decoding without the schema pipeline", () => {
  const golden = ["data", "list", "map", "constr", "integer", "byteArray"].flatMap((name) => {
    const entries: ReadonlyArray<{ readonly cborHex: string }> = JSON.parse(
      readFileSync(join(__dirname, "golden", `${name}.golden.json`), "utf8")
    )
    return entries.slice(0, 300).map((entry) => entry.cborHex)
  })

  it("decodes the golden data to the values the schema decodes", () => {
    for (const hex of golden) {
      for (const options of OPTIONS) {
        expect(Data.fromCBORHex(hex, options)).toEqual(Schema.decodeSync(Data.FromCBORHex(options))(hex))
      }
    }
  })

  // Each line of the schema's message tree, without its indentation
  const lines = (message: string): ReadonlyArray<string> => message.split("\n").map((line) => line.replace(/^[\s└├│─]*/, ""))

  const parseError = (decode: () => unknown): ParseResult.ParseError => {
    try {
      decode()
    } catch (error) {
      if (error instanceof ParseResult.ParseError) return error
      return unexpected("a ParseError", error)
    }
    return unexpected("a ParseError", "a decoded value")
  }

  it.each([
    { name: "truncated CBOR", hex: "d8" },
    { name: "an incomplete tagged value", hex: "d87900" },
    { name: "a constructor over an integer", hex: "d87a01" },
    { name: "a general constructor over an integer", hex: "d86601" },
    { name: "a general constructor with a text index", hex: "d866826080" },
    { name: "a general constructor over an integer field list", hex: "d866820000" },
    { name: "a general constructor of three items", hex: "d86683000080" },
    { name: "a general constructor whose index is negative", hex: "d866822080" },
    { name: "a general constructor whose index is 2^64", hex: "d86682c24901" + "00".repeat(8) + "80" },
    { name: "a negative index after a bad field", hex: "d86682208160" },
    { name: "a bignum over an integer", hex: "c301" },
    { name: "an unsupported tag", hex: "d8ff00" },
    { name: "text", hex: "63616263" },
    { name: "a boolean", hex: "f5" },
    { name: "a float", hex: "f93c00" },
    { name: "a bad leaf 100 levels down", hex: "81".repeat(100) + "f6" },
    { name: "a declared length the input cannot hold", hex: "9a80000000" },
    { name: "trailing bytes", hex: "0000" },
    { name: "an odd-length hex string", hex: "abc" },
    { name: "a hex string that is not hex", hex: "zz" }
  ])("throws ParseError ending in the schema's message for $name", ({ hex }) => {
    const direct = parseError(() => Data.fromCBORHex(hex))
    const schema = parseError(() => Schema.decodeSync(Data.FromCBORHex())(hex))
    const directLines = lines(direct.message)
    expect(lines(schema.message).slice(-directLines.length)).toEqual(directLines)
  })

  it("throws ParseError for input that is not bytes", () => {
    const notBytes: unknown = [0]
    // The cast stands for a caller outside the type system
    const direct = parseError(() => Data.fromCBORBytes(notBytes as Uint8Array))
    const schema = parseError(() => Schema.decodeUnknownSync(Data.FromCBORBytes())(notBytes))
    expect(lines(schema.message).at(-1)).toBe(lines(direct.message).at(-1))
  })
})
