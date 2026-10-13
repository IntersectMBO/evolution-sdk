import { describe, expect, it } from "vitest"

import * as Cip4 from "../src/Cip4.js"

/**
 * ⚠️ The oracle is `@emurgo/cip4-js` 1.x — the CIP-4 reference implementation. Every vector below
 * was produced by running `walletChecksum` from that package, not transcribed from a document:
 * the checksum is a user-facing identifier, so agreeing with the implementation other wallets
 * ship is the whole requirement. `ImagePart` is the `seed` field here and `TextPart` the `plate`.
 *
 * To re-derive: `npm i @emurgo/cip4-js` in a scratch directory and call
 * `require("@emurgo/cip4-js").walletChecksum(<input>)`.
 */
const REFERENCE: ReadonlyArray<readonly [string, string, string]> = [
  [
    "deadbeef",
    "JKPB-6967",
    "e4b684206a5c68ea3b7db1a2f9824be0f4003509aea31af7ab9e3b5535735b0b1740fdfaeb9f10c4b84251e560752fc938163adc6a5bf7b90b4c61cbd162cf2f"
  ],
  [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "ACLB-4115",
    "7387470b7628dc47d700cef601fd3b754e001b713f8fc0642fdcf329043a69441550c03cb0d8fe98b62b75254489639bd875a477e8ab4136075fe6903da133f7"
  ],
  [
    "1234567890abcdef",
    "OBOZ-2987",
    "dc25a71913467cfdc10f9ea11ced7c704c8fa61239206e18e0a6312a1458233db5ab78376d2759acdec3555f43713b6885943cb1cd961ec5af6ae951687bc896"
  ],
  [
    "",
    "BABP-5248",
    "98b37c51d0de5154d2b5a454cd6f1cb9c934f92a22399982e4369b1c53e8992a9c0b093007d410856335a3e9e9b3cc9f1e73761d21f7d7302e3cfb145dfdc819"
  ],
  [
    "DEADBEEF",
    "KEAE-5687",
    "ce8d2ff3f08345465d72046abe165adeba58d83e2ffa8e17efe0d2d56229111715c4092b0f826a0acd61a2c050c13504d895d6fe09d4cda01321d2dc4487d541"
  ],
  [
    // A 64-byte xpub (32-byte public key + 32-byte chain code), the input CIP-4 is written for.
    "cd9b4d5a5e32b5a2c0c4c0b2c1d6a0f9e8d7c6b5a4938271605f4e3d2c1b0a99" +
      "1122334455667788990011223344556677889900112233445566778899001122",
    "PXZB-6737",
    "42896ffda360b776d2fcc552baddf409b65d9b2df2b0b9eebf90b051b85cf3c8519b2a970b9287b0a82385d7cf6172e2191fa81cbf7cf455c829776a8845fb9c"
  ]
]

describe("Cip4.walletChecksum", () => {
  for (const [input, plate, seed] of REFERENCE) {
    it(`matches the reference for ${input.slice(0, 16) || "(empty)"}`, () => {
      const result = Cip4.walletChecksum(input)
      expect(result.plate).toBe(plate)
      expect(result.seed).toBe(seed)
    })
  }

  it("hashes the hex STRING, so case changes the plate", () => {
    // Not a quirk to fix: the reference hashes the characters, so `deadbeef` and `DEADBEEF` are
    // different inputs even though they are the same key. A caller must settle on lowercase.
    expect(Cip4.walletChecksum("deadbeef").plate).toBe("JKPB-6967")
    expect(Cip4.walletChecksum("DEADBEEF").plate).toBe("KEAE-5687")
  })

  it("strips a `0x` prefix, which the reference does NOT", () => {
    // ⚠️ A divergence, and the only one. The reference hashes `"0xdeadbeef"` literally and
    // returns `HOXO-2481`; this strips the prefix and returns the plate of the bare hex. So a
    // wallet that passes `0x`-prefixed hex to a reference-based implementation shows a different
    // plate for the same key — pass bare hex if the plate has to match another wallet's.
    expect(Cip4.walletChecksum("0xdeadbeef").plate).toBe("JKPB-6967")
    expect(Cip4.walletChecksum("0xdeadbeef").plate).not.toBe("HOXO-2481")
  })

  it("draws the plate from the 16 unambiguous letters only", () => {
    const alpha = "ABCDEJHKLNOPSTXZ"
    for (let i = 0; i < 64; i++) {
      const { plate } = Cip4.walletChecksum(i.toString(16).padStart(2, "0").repeat(32))
      expect(plate).toMatch(/^[A-Z]{4}-\d{4}$/)
      for (const ch of plate.slice(0, 4)) expect(alpha).toContain(ch)
    }
  })

  it("returns a 128-hex blake2b-512 digest as the seed", () => {
    for (const [input] of REFERENCE) expect(Cip4.walletChecksum(input).seed).toMatch(/^[0-9a-f]{128}$/)
  })
})
