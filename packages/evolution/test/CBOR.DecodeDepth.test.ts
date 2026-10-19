import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Either } from "effect"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import { evalSample1, evalSample2, evalSample3, evalSample4 } from "./provider/fixtures/evaluateTx.js"

// The decoder recurses for the first 64 levels and decodes anything deeper with an
// explicit stack, so any depth the input can hold decodes. Deep values are walked
// with loops here, since a recursive equality check would overflow on them.

const DEPTH = 16_384

// Format mode keeps each map key's bytes, so keys nested n deep keep about n^2 bytes
const KEY_FORMAT_DEPTH = 4_096

// Deep enough that the inner item is decoded entirely by the iterative decoder
const WRAP_DEPTH = 200

const unexpected = (what: string, value: unknown): never => {
  throw new Error(`expected ${what}, got ${String(value)}`)
}

type Wrapper = {
  readonly name: string
  readonly open: string
  readonly close: string
  readonly isMap: boolean
  readonly inner: (value: CBOR.CBOR) => CBOR.CBOR
  readonly innerFormat: (format: CBOR.CBORFormat) => CBOR.CBORFormat
}

const onlyItem = (value: CBOR.CBOR): CBOR.CBOR =>
  Array.isArray(value) && value.length === 1 ? value[0] : unexpected("a one-item array", value)

const valueAtZero = (value: CBOR.CBOR): CBOR.CBOR =>
  value instanceof Map && value.size === 1 && value.has(0n) ? value.get(0n) : unexpected("a map {0: x}", value)

const onlyKey = (value: CBOR.CBOR): CBOR.CBOR => {
  if (!(value instanceof Map) || value.size !== 1) return unexpected("a map {x: 0}", value)
  const [[key, mapped]] = value
  return mapped === 0n ? key : unexpected("a map {x: 0}", value)
}

const tagged =
  (tag: number) =>
  (value: CBOR.CBOR): CBOR.CBOR =>
    typeof value === "object" && value !== null && "_tag" in value && value._tag === "Tag" && "tag" in value && value.tag === tag && "value" in value
      ? value.value
      : unexpected(`tag ${tag}`, value)

const onlyChild =
  (indefinite: boolean) =>
  (format: CBOR.CBORFormat): CBOR.CBORFormat =>
    format._tag === "array" && format.children.length === 1 && (format.length?.tag === "indefinite") === indefinite
      ? format.children[0]
      : unexpected("a one-item array format", format._tag)

const onlyEntry =
  (indefinite: boolean, side: 0 | 1) =>
  (format: CBOR.CBORFormat): CBOR.CBORFormat =>
    format._tag === "map" && format.entries.length === 1 && (format.length?.tag === "indefinite") === indefinite
      ? format.entries[0][side]
      : unexpected("a one-entry map format", format._tag)

const tagChild = (format: CBOR.CBORFormat): CBOR.CBORFormat =>
  format._tag === "tag" ? format.child : unexpected("a tag format", format._tag)

const WRAPPERS: ReadonlyArray<Wrapper> = [
  { name: "definite arrays", open: "81", close: "", isMap: false, inner: onlyItem, innerFormat: onlyChild(false) },
  { name: "indefinite arrays", open: "9f", close: "ff", isMap: false, inner: onlyItem, innerFormat: onlyChild(true) },
  { name: "map values", open: "a100", close: "", isMap: true, inner: valueAtZero, innerFormat: onlyEntry(false, 1) },
  {
    name: "indefinite map values",
    open: "bf00",
    close: "ff",
    isMap: true,
    inner: valueAtZero,
    innerFormat: onlyEntry(true, 1)
  },
  { name: "map keys", open: "a1", close: "00", isMap: true, inner: onlyKey, innerFormat: onlyEntry(false, 0) },
  { name: "tag 121", open: "d879", close: "", isMap: false, inner: tagged(121), innerFormat: tagChild },
  { name: "tag 1280", open: "d90500", close: "", isMap: false, inner: tagged(1280), innerFormat: tagChild },
  { name: "tag 102", open: "d866", close: "", isMap: false, inner: tagged(102), innerFormat: tagChild }
]

// Wrappers that only open, so cutting the inner item cuts the whole input
const PREFIXES = WRAPPERS.filter((wrapper) => wrapper.close === "")

const wrap = (wrapper: Wrapper, hex: string, depth: number): string =>
  wrapper.open.repeat(depth) + hex + wrapper.close.repeat(depth)

const unwrap = (wrapper: Wrapper, value: CBOR.CBOR, depth: number): CBOR.CBOR => {
  let current = value
  for (let i = 0; i < depth; i++) current = wrapper.inner(current)
  return current
}

const unwrapFormat = (wrapper: Wrapper, format: CBOR.CBORFormat, depth: number): CBOR.CBORFormat => {
  let current = format
  for (let i = 0; i < depth; i++) current = wrapper.innerFormat(current)
  return current
}

const errorMessage = (decode: () => unknown): string => {
  try {
    decode()
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
  return "decoded"
}

const GOLDEN = ["data", "list", "map", "constr", "integer", "byteArray"].flatMap((name) => {
  const entries: ReadonlyArray<{ readonly cborHex: string }> = JSON.parse(
    readFileSync(join(__dirname, "golden", `${name}.golden.json`), "utf8")
  )
  return entries.slice(0, 50).map((entry) => entry.cborHex)
})

const TRANSACTIONS = [evalSample1, evalSample2, evalSample3, evalSample4].map((sample) => sample.transaction.toLowerCase())

const OPTIONS = [CBOR.CML_DEFAULT_OPTIONS, CBOR.PLUTUS_DATA_OPTIONS, CBOR.STRUCT_FRIENDLY_OPTIONS]

const mapsAsObjects = (options: CBOR.CodecOptions): boolean => options.mode === "custom" && options.mapsAsObjects === true

describe("CBOR decoding of deeply nested items", () => {
  it.each(WRAPPERS)(`decodes ${DEPTH} levels of $name through every entry point`, (wrapper) => {
    const hex = wrap(wrapper, "00", DEPTH)
    const bytes = Bytes.fromHex(hex)
    const offsetResult = CBOR.decodeItemWithOffset(bytes, 0)
    expect(offsetResult.newOffset).toBe(bytes.length)
    const values = [
      CBOR.fromCBORHex(hex),
      CBOR.fromCBORBytes(bytes),
      Either.getOrThrow(CBOR.Either.fromCBORHex(hex)),
      offsetResult.item
    ]
    for (const value of values) expect(unwrap(wrapper, value, DEPTH)).toBe(0n)

    const formatDepth = wrapper.name === "map keys" ? KEY_FORMAT_DEPTH : DEPTH
    const formatHex = wrap(wrapper, "00", formatDepth)
    for (const decoded of [CBOR.fromCBORHexWithFormat(formatHex), CBOR.fromCBORBytesWithFormat(Bytes.fromHex(formatHex))]) {
      expect(unwrap(wrapper, decoded.value, formatDepth)).toBe(0n)
      expect(unwrapFormat(wrapper, decoded.format, formatDepth)).toEqual({ _tag: "uint" })
    }
  })

  it("keeps the bytes of every nested map key", () => {
    const hex = wrap(WRAPPERS[4], "00", KEY_FORMAT_DEPTH)
    const bytes = Bytes.fromHex(hex)
    let format = CBOR.fromCBORHexWithFormat(hex).format
    for (let level = 0; level < KEY_FORMAT_DEPTH; level++) {
      if (format._tag !== "map" || format.keyOrder === undefined) return unexpected("a map format with key order", format._tag)
      // The key of the map at `level` spans the input between the next header and its own value
      expect(Bytes.toHex(format.keyOrder[0])).toBe(Bytes.toHex(bytes.subarray(level + 1, bytes.length - level - 1)))
      format = format.entries[0][0]
    }
  })

  it(`decodes a bignum under ${DEPTH} arrays`, () => {
    expect(unwrap(WRAPPERS[0], CBOR.fromCBORHex(wrap(WRAPPERS[0], "c24101", DEPTH)), DEPTH)).toBe(1n)
  })

  it("needs little stack: 16,384 levels decode on a 200 KB stack", () => {
    const script = `
      const CBOR = await import(${JSON.stringify(new URL("../src/CBOR.ts", import.meta.url).href)})
      CBOR.fromCBORHex("81".repeat(${DEPTH}) + "00")
      CBOR.fromCBORHexWithFormat("a100".repeat(${DEPTH}) + "00")
      CBOR.fromCBORHexWithFormat("a1".repeat(${KEY_FORMAT_DEPTH}) + "00".repeat(${KEY_FORMAT_DEPTH + 1}))
      console.log("decoded")
    `
    const run = spawnSync(process.execPath, ["--stack-size=200", "--import", "tsx", "--input-type=module", "-e", script], {
      encoding: "utf8"
    })
    expect(run.stderr).toBe("")
    expect(run.stdout.trim()).toBe("decoded")
  }, 30_000)
})

describe("the iterative decoder against the recursive one", () => {
  const items = [...GOLDEN, ...TRANSACTIONS]

  it.each(WRAPPERS)(`decodes items wrapped ${WRAP_DEPTH} levels in $name as it decodes them bare`, (wrapper) => {
    for (const item of items) {
      for (const options of OPTIONS) {
        if (wrapper.isMap && mapsAsObjects(options)) continue
        const wrapped = CBOR.fromCBORHex(wrap(wrapper, item, WRAP_DEPTH), options)
        expect(unwrap(wrapper, wrapped, WRAP_DEPTH)).toEqual(CBOR.fromCBORHex(item, options))
      }
      const bare = CBOR.fromCBORHexWithFormat(item)
      const wrapped = CBOR.fromCBORHexWithFormat(wrap(wrapper, item, WRAP_DEPTH))
      expect(unwrap(wrapper, wrapped.value, WRAP_DEPTH)).toEqual(bare.value)
      expect(unwrapFormat(wrapper, wrapped.format, WRAP_DEPTH)).toEqual(bare.format)
    }
  })

  it.each(WRAPPERS)("hands over to the iterative decoder at the same result for $name", (wrapper) => {
    for (let depth = 58; depth <= 70; depth++) {
      for (const item of GOLDEN.slice(0, 20)) {
        const bare = CBOR.fromCBORHexWithFormat(item)
        const wrapped = CBOR.fromCBORHexWithFormat(wrap(wrapper, item, depth))
        expect(unwrap(wrapper, CBOR.fromCBORHex(wrap(wrapper, item, depth)), depth)).toEqual(CBOR.fromCBORHex(item))
        expect(unwrap(wrapper, wrapped.value, depth)).toEqual(bare.value)
        expect(unwrapFormat(wrapper, wrapped.format, depth)).toEqual(bare.format)
      }
    }
  })

  it("throws the bare error for every truncation of a wrapped transaction", () => {
    for (const tx of TRANSACTIONS) {
      for (let cut = 2; cut < tx.length; cut += 2) {
        const truncated = tx.slice(0, cut)
        const bare = errorMessage(() => CBOR.fromCBORHex(truncated))
        const bareFormat = errorMessage(() => CBOR.fromCBORHexWithFormat(truncated))
        for (const wrapper of PREFIXES) {
          const hex = wrapper.open.repeat(WRAP_DEPTH) + truncated
          expect(errorMessage(() => CBOR.fromCBORHex(hex))).toBe(bare)
          expect(errorMessage(() => CBOR.fromCBORHexWithFormat(hex))).toBe(bareFormat)
        }
      }
    }
  }, 30_000)

  it("throws the bare error for declared lengths the input cannot hold", () => {
    const cases = ["9a7fffffff", "ba7fffffff", "9a80000000", "ba80000000", "8201", "a101", "d818", "5affffffff", "9f7afffffffbff", "9f01", "bf0102"]
    for (const hex of cases) {
      for (const wrapper of PREFIXES) {
        const wrapped = wrapper.open.repeat(WRAP_DEPTH) + hex
        expect(errorMessage(() => CBOR.fromCBORHex(wrapped))).toBe(errorMessage(() => CBOR.fromCBORHex(hex)))
      }
    }
  })

  it("re-encodes wrapped transactions byte for byte from their formats", () => {
    for (const tx of TRANSACTIONS) {
      for (const wrapper of WRAPPERS.filter((w) => w.name !== "map keys")) {
        const hex = wrap(wrapper, tx, 100)
        const { format, value } = CBOR.fromCBORHexWithFormat(hex)
        expect(CBOR.toCBORHexWithFormat(value, format)).toBe(hex)
      }
    }
  })
})
