import { CBOR, Data } from "@evolution-sdk/evolution"
import { describe, expect, it } from "vitest"

import * as Cip14 from "../src/Cip14.js"
import * as Cip16 from "../src/Cip16.js"
import * as Cip67 from "../src/Cip67.js"
import * as Cip68 from "../src/Cip68.js"
import * as Cip102 from "../src/Cip102.js"
import * as Cip105 from "../src/Cip105.js"
import * as Cip129 from "../src/Cip129.js"
import * as Cip1855 from "../src/Cip1855.js"
import { encode as bech32Encode } from "../src/internal/Bech32.js"

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")

describe("Cip14.assetFingerprint", () => {
  // The CIP-14 spec's own test vectors. They are the oracle: a fingerprint is a user-facing
  // identifier, so agreeing with the spec is the whole requirement.
  // ⚠️ The CIP-14 spec's eight vectors, verbatim. They ARE the oracle — a fingerprint is a
  // user-facing identifier, so agreeing with the spec is the whole requirement, and a vector
  // written from memory is not a vector.
  const VECTORS: ReadonlyArray<readonly [string, string, string]> = [
    ["7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373", "", "asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3"],
    ["7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc37e", "", "asset1nl0puwxmhas8fawxp8nx4e2q3wekg969n2auw3"],
    ["1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209", "", "asset1uyuxku60yqe57nusqzjx38aan3f2wq6s93f6ea"],
    [
      "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373",
      "504154415445",
      "asset13n25uv0yaf5kus35fm2k86cqy60z58d9xmde92"
    ],
    [
      "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209",
      "504154415445",
      "asset1hv4p5tv2a837mzqrst04d0dcptdjmluqvdx9k3"
    ],
    [
      "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209",
      "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373",
      "asset1aqrdypg669jgazruv5ah07nuyqe0wxjhe2el6f"
    ],
    [
      "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373",
      "1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209",
      "asset17jd78wukhtrnmjh3fngzasxm8rck0l2r4hhyyt"
    ],
    [
      "7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373",
      "0000000000000000000000000000000000000000000000000000000000000000",
      "asset1pkpwyknlvul7az0xx8czhl60pyel45rpje4z8w"
    ]
  ]

  for (const [policy, name, expected] of VECTORS) {
    it(`matches the spec vector for ${policy.slice(0, 8)}…/${name.slice(0, 8) || "(empty)"}`, () => {
      const p = Uint8Array.from(Buffer.from(policy, "hex"))
      const n = Uint8Array.from(Buffer.from(name, "hex"))
      expect(Cip14.assetFingerprint(p, n)).toBe(expected)
    })
  }
})

describe("Cip67", () => {
  it("matches the CIP-67 spec vector (222 → 000de140)", () => {
    expect(hex(Cip67.toLabel(222))).toBe("000de140")
  })

  it("round-trips every label through an asset name", () => {
    const content = new TextEncoder().encode("MyToken")
    for (const label of [0, 100, 222, 333, 444, 500, 777, 65535]) {
      expect(Cip67.fromLabel(Cip67.toAssetName(label, content))).toBe(label)
    }
  })

  // ⚠️ An asset name is untrusted input and "not a labelled name" is the common case, not an
  // error. A reader that guessed a label out of arbitrary bytes would mis-classify real assets.
  it("reports an unlabelled or malformed name as unlabelled", () => {
    expect(Cip67.fromLabel(new TextEncoder().encode("MyToken"))).toBeUndefined()
    expect(Cip67.fromLabel(bytes(3, 0))).toBeUndefined()
    expect(Cip67.fromLabel(new Uint8Array(0))).toBeUndefined()
    expect(Cip67.fromLabel(Uint8Array.from([0x10, 0x00, 0xde, 0x14]))).toBeUndefined() // bracket set
    expect(Cip67.fromLabel(Uint8Array.from([0x00, 0x0d, 0xe1, 0x41]))).toBeUndefined() // bad crc
  })
})

describe("Cip68", () => {
  // ⚠️ The reference NFT is found by its datum hash, so the encoding is the contract: a datum
  // that encodes differently hashes differently and the pair stops matching.
  it("encodes the datum as Constr 0 of [metadata, version, extra]", () => {
    // ⚠️ `PLUTUS_DATA_OPTIONS` by name, not the library default. The default is CML's layout,
    // which frames a non-empty Plutus map indefinite; the node's layout writes it definite, and
    // this datum is found by its HASH — so the preset whose hashes match cardano-cli is the one
    // that defines the contract here.
    const d = Cip68.datumFromMetadata([[Data.bytearray("6e616d65"), Data.bytearray("546f6b656e")]], 1n)
    expect(hex(Data.toCBORBytes(d, CBOR.PLUTUS_DATA_OPTIONS))).toBe("d8799fa1446e616d6545546f6b656e01d87980ff")
  })

  it("uses Unit for the minimal extra", () => {
    expect(hex(Data.toCBORBytes(Cip68.unitExtra()))).toBe("d87980")
  })

  it("links the reference NFT and the user token by the content after the label", () => {
    const content = new TextEncoder().encode("MyToken")
    const ref = Cip68.referenceNftName(content)
    const user = Cip68.userNftName(content)
    expect(Cip67.fromLabel(ref)).toBe(100)
    expect(Cip67.fromLabel(user)).toBe(222)
    expect(hex(ref.subarray(4))).toBe(hex(user.subarray(4)))
  })
})

describe("Cip102", () => {
  it("encodes Some as Constr 0 and None as Constr 1", () => {
    expect(hex(Data.toCBORBytes(Cip102.optionalInt(5n)))).toBe("d8799f05ff")
    expect(hex(Data.toCBORBytes(Cip102.optionalInt(undefined)))).toBe("d87a80")
  })

  it("names the (500)Royalty asset, with and without a postfix", () => {
    expect(Buffer.from(Cip102.royaltyAssetName().subarray(4)).toString()).toBe("Royalty")
    expect(Buffer.from(Cip102.royaltyAssetName(2).subarray(4)).toString()).toBe("Royalty2")
    expect(Cip67.fromLabel(Cip102.royaltyAssetName())).toBe(500)
  })
})

describe("Cip129", () => {
  const H28 = bytes(28, 0x99)

  it("round-trips every credential kind, key and script", () => {
    for (const keyType of ["drep", "cc_hot", "cc_cold"] as const) {
      for (const isScript of [false, true]) {
        const id = Cip129.credentialBech32(keyType, isScript, H28)
        expect(id.startsWith(`${keyType}1`)).toBe(true)
        expect(Cip129.parseCredential(id)).toEqual({ keyType, isScript, hash: H28 })
      }
    }
  })

  // ⚠️ The prefix and the header byte both state the key type. A value where they disagree is a
  // credential of neither kind, and reading it as either names the wrong key.
  //
  // The mismatch has to be built through a real bech32 encode: string-replacing the prefix
  // invalidates the checksum, so it would be rejected there and never reach this check.
  it("refuses an id whose prefix disagrees with its header byte", () => {
    const drepPayload = new Uint8Array(29)
    drepPayload[0] = (0x2 << 4) | 0x2 // drep, key-hash
    drepPayload.set(H28, 1)
    const asCcHot = bech32Encode("cc_hot", drepPayload)
    expect(Cip129.parseCredential(asCcHot)).toBeUndefined()
    // The same payload under its own prefix is fine, so the refusal is about the disagreement.
    expect(Cip129.parseCredential(bech32Encode("drep", drepPayload))?.keyType).toBe("drep")
  })

  // ⚠️ Without the prefix check this is accepted: the payload is the right LENGTH for a gov
  // action, so only the prefix distinguishes it. The credential case above is masked by its own
  // length check, so this is the fixture that actually reaches it.
  it("will not read a 33-byte payload under another prefix as a gov_action", () => {
    const payload = new Uint8Array(33).fill(0xbb)
    expect(Cip129.parseGovAction(bech32Encode("drep", payload))).toBeUndefined()
    expect(Cip129.parseGovAction(bech32Encode("addr", payload))).toBeUndefined()
    // The same payload under its own prefix is read, so the refusal is about the prefix.
    expect(Cip129.parseGovAction(bech32Encode("gov_action", payload))).not.toBeUndefined()
  })

  it("will not read a gov_action id as a credential, or the reverse", () => {
    const txid = bytes(32, 0xaa)
    const gov = Cip129.govActionBech32(txid, 3)
    const drep = Cip129.credentialBech32("drep", false, H28)
    expect(Cip129.parseCredential(gov)).toBeUndefined()
    expect(Cip129.parseGovAction(drep)).toBeUndefined()
  })

  it("round-trips a gov_action id, including index 0 and multi-byte indices", () => {
    const txid = bytes(32, 0xaa)
    for (const index of [0, 1, 255, 256, 65535, 16777216]) {
      const [gotTxid, gotIndex] = Cip129.parseGovAction(Cip129.govActionBech32(txid, index))!
      expect(hex(gotTxid)).toBe(hex(txid))
      expect(gotIndex).toBe(index)
    }
  })

  it("returns undefined on garbage rather than throwing", () => {
    for (const s of ["", "not-an-id", "drep1qqqq"]) {
      expect(() => Cip129.parseCredential(s)).not.toThrow()
      expect(Cip129.parseCredential(s)).toBeUndefined()
    }
  })
})

describe("Cip16", () => {
  // ⚠️ A key of the wrong length encodes to a perfectly valid bech32 string of the wrong kind,
  // which travels a long way before anything notices.
  it("refuses a key that is not its declared length", () => {
    expect(() => Cip16.vkBech32("addr_vk", bytes(31, 1))).toThrow(/expected 32 bytes/)
    expect(() => Cip16.xvkBech32("addr_xvk", bytes(65, 1))).toThrow(/expected 64 bytes/)
    expect(() => Cip16.xskBech32("acct_xsk", bytes(95, 1))).toThrow(/expected 96 bytes/)
    expect(() => Cip16.xvkFromParts(bytes(32, 1), bytes(31, 1))).toThrow(/32 bytes each/)
    expect(() => Cip16.xvkFromXsk(bytes(95, 1), bytes(32, 1))).toThrow(/96 bytes/)
  })

  it("splices the chain code out of an xsk", () => {
    const xsk = bytes(96, 0)
    xsk.set(bytes(32, 0xcc), 64)
    expect(hex(Cip16.xvkFromXsk(xsk, bytes(32, 0xaa)).subarray(32))).toBe(hex(bytes(32, 0xcc)))
  })

  it("reports the prefix it decoded", () => {
    const s = Cip16.vkBech32("addr_vk", bytes(32, 7))
    expect(Cip16.decode(s)).toEqual({ prefix: "addr_vk", bytes: bytes(32, 7) })
  })
})

describe("Cip105 / Cip1855 paths", () => {
  const H = 0x80000000
  it("derives the Conway role paths", () => {
    expect([...Cip105.drepKeyPath(0, 0)]).toEqual([H + 1852, H + 1815, H, 3, 0])
    expect([...Cip105.ccColdKeyPath(1, 2)]).toEqual([H + 1852, H + 1815, H + 1, 4, 2])
    expect([...Cip105.ccHotKeyPath(0, 5)]).toEqual([H + 1852, H + 1815, H, 5, 5])
  })

  it("derives the forging-policy path, all hardened", () => {
    expect([...Cip1855.policyKeyPath(0)]).toEqual([H + 1855, H + 1815, H])
    expect([...Cip1855.policyKeyPath(7)]).toEqual([H + 1855, H + 1815, H + 7])
  })

  it("encodes CIP-5 prefixes", () => {
    expect(Cip105.drepVkBech32(bytes(32, 1)).startsWith("drep_vk1")).toBe(true)
    expect(Cip105.ccHotVkhBech32(bytes(32, 1)).startsWith("cc_hot_vkh1")).toBe(true)
    expect(Cip1855.policyVkhBech32(bytes(32, 1)).startsWith("policy_vkh1")).toBe(true)
  })
})
