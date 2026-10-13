import { describe, expect, it } from "@effect/vitest"

import * as CBOR from "../src/CBOR.js"
import * as CBORBuilder from "../src/CBORBuilder.js"

const { Deserializer, INDEFINITE, Serializer, Special, len } = CBORBuilder

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")

describe("Serializer builds the bytes the call sequence describes", () => {
  it("encodes a definite array of mixed items", () => {
    const out = Serializer.newVec()
      .writeArray(len(4))
      .writeUnsignedInteger(1)
      .writeNegativeInteger(-5)
      .writeText("hi")
      .writeBytes(Uint8Array.from([0xde, 0xad]))
      .finalize()
    expect(hex(out)).toBe("840124626869" + "42dead")
  })

  it("nests containers by their declared lengths", () => {
    const out = Serializer.newVec()
      .writeArray(len(2))
      .writeArray(len(2))
      .writeUnsignedInteger(1)
      .writeUnsignedInteger(2)
      .writeMap(len(1))
      .writeUnsignedInteger(3)
      .writeUnsignedInteger(4)
      .finalize()
    expect(hex(out)).toBe("8282010" + "2a10304")
  })

  it("treats the item after a tag as the tag's content", () => {
    const out = Serializer.newVec()
      .writeTag(24)
      .writeBytes(Uint8Array.from([0x01]))
      .finalize()
    expect(hex(out)).toBe("d8184101")
  })

  it("writes map entries in the order given, without sorting", () => {
    const out = Serializer.newVec()
      .writeMap(len(2))
      .writeUnsignedInteger(100)
      .writeUnsignedInteger(0)
      .writeUnsignedInteger(1)
      .writeUnsignedInteger(0)
      .finalize()
    expect(hex(out)).toBe("a2186400" + "0100")
  })

  it("concatenates items written at the top level", () => {
    expect(hex(Serializer.newVec().writeUnsignedInteger(1).writeUnsignedInteger(2).finalize())).toBe("0102")
  })

  it("encodes an empty document as no bytes", () => {
    expect(Serializer.newVec().finalize()).toHaveLength(0)
  })
})

describe("a declared length that is never satisfied is an error, not malformed bytes", () => {
  it("refuses to finalize an unfinished array", () => {
    const s = Serializer.newVec().writeArray(len(3)).writeUnsignedInteger(1)
    expect(() => s.finalize()).toThrow(/unclosed container/)
  })

  it("refuses to finalize a map missing its last value", () => {
    const s = Serializer.newVec().writeMap(len(1)).writeUnsignedInteger(1)
    expect(() => s.finalize()).toThrow(/unclosed container/)
  })

  it("refuses a tag with no content", () => {
    expect(() => Serializer.newVec().writeTag(2).finalize()).toThrow(/unclosed container/)
  })

  it("refuses a break with no open indefinite container", () => {
    expect(() => Serializer.newVec().writeSpecial(Special.Break)).toThrow(/indefinite container/)
  })

  it("rejects a negative passed as unsigned, naming the call", () => {
    expect(() => Serializer.newVec().writeUnsignedInteger(-1)).toThrow(/unsigned integer/)
  })
})

describe("indefinite framing survives encoding", () => {
  // ⚠️ The empty cases are the regression test for a fast path in `CBOR.encodeArraySync` /
  // `encodeMapSync` that returned 0x80 / 0xa0 before consulting the format, silently rewriting
  // `9fff` to `80`. An empty container has exactly one thing left to say and it was dropped.
  it("keeps an EMPTY indefinite array indefinite", () => {
    const out = Serializer.newVec().writeArray(INDEFINITE).writeSpecial(Special.Break).finalize()
    expect(hex(out)).toBe("9fff")
  })

  it("keeps an EMPTY indefinite map indefinite", () => {
    const out = Serializer.newVec().writeMap(INDEFINITE).writeSpecial(Special.Break).finalize()
    expect(hex(out)).toBe("bfff")
  })

  it("keeps a populated indefinite array indefinite", () => {
    const out = Serializer.newVec()
      .writeArray(INDEFINITE)
      .writeUnsignedInteger(1)
      .writeSpecial(Special.Break)
      .finalize()
    expect(hex(out)).toBe("9f01ff")
  })

  it("leaves an empty DEFINITE array definite", () => {
    expect(hex(Serializer.newVec().writeArray(len(0)).finalize())).toBe("80")
    expect(hex(Serializer.newVec().writeMap(len(0)).finalize())).toBe("a0")
  })
})

describe("tag widths run to the whole CBOR range", () => {
  // Encoding stopped at 65536 and threw, which refused a legal document.
  it.each([
    [0, "c0"],
    [23, "d7"],
    [24, "d818"],
    [255, "d8ff"],
    [256, "d90100"],
    [65535, "d9ffff"],
    [65536, "da00010000"],
    [0xffffffff, "daffffffff"],
    [0x100000000, "db0000000100000000"]
  ])("encodes tag %i", (tag, head) => {
    const out = Serializer.newVec().writeTag(tag).writeUnsignedInteger(0).finalize()
    expect(hex(out)).toBe(`${head}00`)
  })

  it("round-trips a wide tag through CBOR's own decoder", () => {
    const out = Serializer.newVec().writeTag(65536).writeUnsignedInteger(7).finalize()
    expect(CBOR.fromCBORBytes(out)).toEqual({ _tag: "Tag", tag: 65536, value: 7n })
  })
})

describe("writeRaw splices encoded bytes in without re-shaping them", () => {
  it("accepts a complete item", () => {
    expect(
      hex(
        Serializer.newVec()
          .writeRaw(Uint8Array.from([0x83, 1, 2, 3]))
          .finalize()
      )
    ).toBe("83010203")
  })

  it("counts as one child of the container it lands in", () => {
    const out = Serializer.newVec()
      .writeArray(len(2))
      .writeRaw(Uint8Array.from([0x83, 1, 2, 3]))
      .writeUnsignedInteger(9)
      .finalize()
    expect(hex(out)).toBe("8283010203" + "09")
  })

  it("preserves indefinite framing in the raw payload", () => {
    expect(
      hex(
        Serializer.newVec()
          .writeRaw(Uint8Array.from([0x9f, 0x01, 0xff]))
          .finalize()
      )
    ).toBe("9f01ff")
  })
})

describe("Deserializer reads what Serializer wrote", () => {
  it("reads a sequence of typed items", () => {
    const buf = Serializer.newVec()
      .writeArray(len(3))
      .writeUnsignedInteger(7)
      .writeText("ok")
      .writeBytes(Uint8Array.from([0xaa]))
      .finalize()
    const d = Deserializer.from(buf)
    expect(d.cborType()).toBe(CBORBuilder.CborType.Array)
    expect(d.array()).toEqual({ definite: 3 })
    expect(d.unsignedInteger()).toBe(7n)
    expect(d.text()).toBe("ok")
    expect(hex(d.bytes())).toBe("aa")
    expect(d.position()).toBe(buf.length)
  })

  it("is lenient about non-minimal heads it did not write", () => {
    expect(Deserializer.from(Uint8Array.from([0x18, 0x05])).unsignedInteger()).toBe(5n)
  })

  it("reassembles indefinite byte and text chunks", () => {
    expect(hex(Deserializer.from(Uint8Array.from([0x5f, 0x42, 1, 2, 0x41, 3, 0xff])).bytes())).toBe("010203")
    expect(Deserializer.from(Uint8Array.from([0x7f, 0x62, 0x68, 0x69, 0x61, 0x21, 0xff])).text()).toBe("hi!")
  })

  it("reads a negative integer back as its value", () => {
    const buf = Serializer.newVec().writeNegativeInteger(-500).finalize()
    expect(Deserializer.from(buf).negativeInteger()).toBe(-500n)
  })

  it("skips a whole nested item", () => {
    const buf = Serializer.newVec()
      .writeArray(len(2))
      .writeArray(len(2))
      .writeUnsignedInteger(1)
      .writeUnsignedInteger(2)
      .writeUnsignedInteger(9)
      .finalize()
    const d = Deserializer.from(buf)
    d.array()
    d.skipValue()
    expect(d.unsignedInteger()).toBe(9n)
  })

  it("reports the specials it finds", () => {
    const buf = Serializer.newVec()
      .writeSpecial(Special.Bool, true)
      .writeSpecial(Special.Null)
      .writeSpecial(Special.Undefined)
      .finalize()
    expect(hex(buf)).toBe("f5f6f7")
    const d = Deserializer.from(buf)
    expect(d.bool()).toBe(true)
    expect(d.special()).toBe(Special.Null)
    expect(d.special()).toBe(Special.Undefined)
  })

  it("refuses to read past the end of the buffer", () => {
    // A 2-byte-string header with no payload behind it.
    expect(() => Deserializer.from(Uint8Array.from([0x42])).bytes()).toThrow()
    // A head that claims an 8-byte argument the buffer does not hold.
    expect(() => Deserializer.from(Uint8Array.from([0x1b, 0x00])).unsignedInteger()).toThrow()
  })
})

describe("span scanning agrees with the decoder about where an item ends", () => {
  const h = (s: string) => Uint8Array.from(Buffer.from(s, "hex"))

  it("readHead reports the head's own width, its argument and its major type", () => {
    expect(CBORBuilder.readHead(h("01"), 0)).toEqual([1, 1n, 0])
    expect(CBORBuilder.readHead(h("1818"), 0)).toEqual([2, 24n, 0])
    expect(CBORBuilder.readHead(h("190100"), 0)).toEqual([3, 256n, 0])
    expect(CBORBuilder.readHead(h("1a00010000"), 0)).toEqual([5, 65536n, 0])
    expect(CBORBuilder.readHead(h("1bffffffffffffffff"), 0)).toEqual([9, 18446744073709551615n, 0])
    // Major type travels with it: a map head, and a head read at an offset inside the buffer.
    expect(CBORBuilder.readHead(h("a101"), 0)).toEqual([1, 1n, 5])
    expect(CBORBuilder.readHead(h("820142dead"), 2)).toEqual([1, 2n, 2])
  })

  it("readHead refuses an indefinite head", () => {
    // A caller asking for an argument has no use for a container whose length is not stated.
    expect(() => CBORBuilder.readHead(h("9f"), 0)).toThrow(/definite-length head/)
    expect(() => CBORBuilder.readHead(h("bf"), 0)).toThrow(/definite-length head/)
  })

  it("readHead refuses a head whose argument bytes the buffer does not hold", () => {
    expect(() => CBORBuilder.readHead(h("1b00"), 0)).toThrow(/argument bytes the buffer does not hold/)
    expect(() => CBORBuilder.readHead(h("1a0001"), 0)).toThrow(/argument bytes the buffer does not hold/)
  })

  it("readHead refuses a read past the end of the buffer", () => {
    expect(() => CBORBuilder.readHead(h("01"), 1)).toThrow(/past end of buffer/)
    expect(() => CBORBuilder.readHead(new Uint8Array(0), 0)).toThrow(/past end of buffer/)
  })

  it("itemLen measures one whole item, nested containers included", () => {
    expect(CBORBuilder.itemLen(h("01"), 0)).toBe(1)
    expect(CBORBuilder.itemLen(h("42dead"), 0)).toBe(3)
    expect(CBORBuilder.itemLen(h("a101820203"), 0)).toBe(5)
    // From an offset: the inner array of `[1, [2, 3]]`, not the rest of the buffer.
    expect(CBORBuilder.itemLen(h("8201820203"), 2)).toBe(3)
    // Trailing bytes beyond the item are not counted.
    expect(CBORBuilder.itemLen(h("0102"), 0)).toBe(1)
  })

  it("itemLen refuses what the decoder refuses, rather than guessing a span", () => {
    // ⚠️ A span scanner of its own is a second opinion about where an item ends, and the span is
    // what slices a body that then gets hashed and signed.
    expect(() => CBORBuilder.itemLen(h("8301"), 0)).toThrow()
    expect(() => CBORBuilder.itemLen(h("42de"), 0)).toThrow()
    expect(() => CBORBuilder.itemLen(h("01"), 1)).toThrow()
  })
})
