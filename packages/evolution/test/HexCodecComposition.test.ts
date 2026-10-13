import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Anchor from "../src/Anchor.js"
import * as Constitution from "../src/Constitution.js"
import * as Metadata from "../src/Metadata.js"
import * as TransactionMetadatum from "../src/TransactionMetadatum.js"
import * as Url from "../src/Url.js"

/**
 * A module's hex codec must be its bytes codec with a hex step in front, nothing more.
 *
 * Both modules here had composed `CBOR.FromHex` (hex -> CBOR *value*) in front of a schema
 * whose input is *bytes*. The two failure modes it produced are different and the quiet one is
 * worse: Metadata could not decode anything it had written, while Constitution wrote the whole
 * encoding wrapped in a CBOR byte string (`5841...`) and then round-tripped its own wrong
 * output, so nothing looked broken until the bytes were compared with the bytes codec.
 */
describe("hex codecs agree with bytes codecs", () => {
  it("Metadata.fromCBORHex decodes what Metadata.toCBORHex writes", () => {
    const metadata = Metadata.fromEntries([[674n, TransactionMetadatum.text("hi")]])
    const hex = Metadata.toCBORHex()(metadata)
    expect(hex).toBe("a11902a2626869")
    expect(Metadata.fromCBORHex()(hex)).toStrictEqual(metadata)
    expect(hex).toBe(Buffer.from(Metadata.toCBORBytes()(metadata)).toString("hex"))
  })

  it("Constitution's hex form is its bytes form, not a byte string wrapping it", () => {
    const constitution = new Constitution.Constitution({
      anchor: new Anchor.Anchor({
        anchorUrl: new Url.Url({ href: "https://example.com/c.json" }),
        anchorDataHash: new Uint8Array(Buffer.from("ab".repeat(32), "hex"))
      }),
      scriptHash: null
    })
    const hex = Schema.encodeSync(Constitution.FromCBORHex())(constitution)
    const bytes = Schema.encodeSync(Constitution.FromCBORBytes())(constitution)
    expect(hex).toBe(Buffer.from(bytes).toString("hex"))
    expect(hex.startsWith("82")).toBe(true)
    expect(Schema.decodeSync(Constitution.FromCBORHex())(hex)).toStrictEqual(constitution)
  })
})
