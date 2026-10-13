import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import * as Cip27 from "../src/Cip27.js"

const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runSync(e)
const attempt = <A, E>(e: Effect.Effect<A, E>) => Effect.runSync(Effect.either(e))
const utf8Len = (s: string) => new TextEncoder().encode(s).length

/** The CIP-27 document's own example: `{"777": {"rate": "0.2", "addr": "addr1v9ne…"}}`. */
const SPEC_ADDR = "addr1v9nevxg9wunfck0gt7hpxuy0elnqygglme3u6l3nn5q5gnq5dc9un"

/**
 * ⚠️ Hex verified against `cardano-multiplatform-lib` 6.2: it decodes to the spec's JSON and
 * re-encodes to these exact bytes. The bytes are the requirement, not a detail — the metadatum is
 * hashed into `auxiliary_data_hash`, so a map that re-serializes differently breaks every witness
 * over it.
 *
 * Byte for byte: `a2` map(2) · `64 61646472` text(4) "addr" · `78 3a` text(58) the address ·
 * `64 72617465` text(4) "rate" · `63 302e32` text(3) "0.2".
 */
const SPEC_METADATUM =
  "a26461646472783a616464723176396e657678673977756e66636b30677437687078757930656c6e717967676c6d65337536" +
  "6c336e6e357135676e7135646339756e647261746563302e32"

describe("Cip27.royalty", () => {
  it("encodes the spec's example to the bytes CML agrees on", () => {
    expect(run(Cip27.royalty("0.2", SPEC_ADDR)).metadatumHex).toBe(SPEC_METADATUM)
  })

  it("wraps it under label 777, which is `190309`", () => {
    const { metadataHex, metadatumHex } = run(Cip27.royalty("0.2", SPEC_ADDR))
    // `a1` map(1) · `19 0309` uint16 777 · the metadatum verbatim.
    expect(metadataHex).toBe(`a1190309${metadatumHex}`)
    expect(Cip27.ROYALTY_LABEL).toBe(777n)
  })

  it("writes `addr` before `rate`, which is canonical order", () => {
    const hex = run(Cip27.royalty("0.2", SPEC_ADDR)).metadatumHex
    const addrKey = hex.indexOf("6461646472")
    const rateKey = hex.indexOf("6472617465")
    expect(addrKey).toBeGreaterThan(-1)
    expect(rateKey).toBeGreaterThan(addrKey)
  })

  describe("the 64-byte metadatum limit", () => {
    const LONG =
      "addr1q8g3dv6ptkgsafh7k5muggrvfde2szzmc2mqkcxpxn7c63l9znc9e3xa82hpf39scc37tcu9ggy0l89gy2f9r2lf7husfvu8wh"

    /** Hand-built expectation: `a2` map(2), the `addr` key, the value, the `rate` key, `"0.2"`. */
    const metadatum = (addrValueHex: string) => `a26461646472${addrValueHex}647261746563302e32`
    const utf8Hex = (s: string) => Buffer.from(s, "utf8").toString("hex")

    it("leaves an address that fits as a single text metadatum", () => {
      expect(utf8Len(SPEC_ADDR)).toBeLessThanOrEqual(64)
      // `783a` is text(58) directly after the key — no `81` array header.
      expect(run(Cip27.royalty("0.2", SPEC_ADDR)).metadatumHex).toBe(metadatum(`783a${utf8Hex(SPEC_ADDR)}`))
    })

    it("chunks a longer address at 64 bytes, in order", () => {
      expect(LONG.length).toBe(103)
      // `82` array(2) · `7840` text(64) · `7827` text(39).
      expect(run(Cip27.royalty("0.2", LONG)).metadatumHex).toBe(
        metadatum(`827840${utf8Hex(LONG.slice(0, 64))}7827${utf8Hex(LONG.slice(64))}`)
      )
    })

    it("passes an already-chunked array through verbatim, so a caller can reproduce another split", () => {
      // The spec's own example splits this address 62/41, which the automatic chunker would not.
      const parts = [LONG.slice(0, 62), LONG.slice(62)] as const
      expect(run(Cip27.royalty("0.2", parts)).metadatumHex).toBe(
        metadatum(`82783e${utf8Hex(parts[0])}7829${utf8Hex(parts[1])}`)
      )
    })

    it("never splits a surrogate pair in half", () => {
      // Iterating by code point rather than UTF-16 unit is the whole reason `chunkString` does not
      // use `slice`: the 4-byte emoji straddles byte 64 and would otherwise become two halves,
      // each an invalid UTF-8 fragment. The break lands before it instead: 62 bytes, then 14.
      const straddling = `${"a".repeat(62)}😀${"b".repeat(10)}`
      expect(utf8Len(straddling)).toBe(76)
      expect(run(Cip27.royalty("0.2", straddling)).metadatumHex).toBe(
        metadatum(`82783e${utf8Hex("a".repeat(62))}6e${utf8Hex(`😀${"b".repeat(10)}`)}`)
      )
    })

    it("refuses a caller's own chunk that is over the limit", () => {
      const r = attempt(Cip27.royalty("0.2", ["a".repeat(65)]))
      expect(Either.isLeft(r)).toBe(true)
      if (Either.isLeft(r)) expect(r.left.reason).toContain("exceeds 64 bytes")
    })

    it("measures the limit in bytes, not characters", () => {
      // 16 emoji are 16 characters and 64 bytes — the last input that still fits in one chunk.
      expect(run(Cip27.royalty("0.2", "😀".repeat(16))).metadatumHex).toBe(metadatum(`7840${utf8Hex("😀".repeat(16))}`))
      // 17 are 68 bytes, so they chunk 64 + 4 even though 17 characters is far under any limit.
      expect(run(Cip27.royalty("0.2", "😀".repeat(17))).metadatumHex).toBe(
        metadatum(`827840${utf8Hex("😀".repeat(16))}64${utf8Hex("😀")}`)
      )
    })
  })

  describe("the rate", () => {
    for (const rate of ["0", "1", "0.2", ".5", "0.000001"]) {
      it(`accepts "${rate}"`, () => {
        expect(Either.isRight(attempt(Cip27.royalty(rate, SPEC_ADDR)))).toBe(true)
      })
    }

    for (const rate of ["1.5", "-0.1", "", ".", "abc", "1e-1", "0,5", " 0.5"]) {
      it(`refuses ${JSON.stringify(rate)} as a Cip27Error rather than throwing`, () => {
        const r = attempt(Cip27.royalty(rate, SPEC_ADDR))
        expect(Either.isLeft(r)).toBe(true)
        if (Either.isLeft(r)) {
          expect(r.left._tag).toBe("Cip27Error")
          expect(r.left.reason).toContain("must be a decimal string in [0, 1]")
        }
      })
    }

    it("writes the rate string verbatim, not a reparsed number", () => {
      // `"0.20"` and `"0.2"` are the same rate and different bytes; the caller's string is what
      // the marketplace reads and what the hash covers.
      expect(run(Cip27.royalty("0.20", SPEC_ADDR)).metadatumHex).toContain(Buffer.from("0.20", "utf8").toString("hex"))
    })
  })
})
