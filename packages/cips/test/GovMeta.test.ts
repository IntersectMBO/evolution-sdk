import { describe, expect, it } from "vitest"

import * as GovMeta from "../src/GovMeta.js"

/**
 * ⚠️ The hashes below were verified with coreutils `b2sum -l 256` over the exact `json` bytes,
 * which is an implementation of BLAKE2b with no Cardano code in it. The hash is what an on-chain
 * `anchor` commits to, so agreeing with a plain BLAKE2b-256 of the hosted bytes is the whole
 * requirement.
 *
 * To re-derive: write `doc.json` to a file and run `b2sum -l 256 <file>`.
 */
const EXPECTED = {
  governanceAction: "5aa3098f7e103338568a1b8bd2114c28f00ddbde5073a5f6a1fcbf7f6536f3f1",
  drep: "3e4bdb26a21680aa07e5ac677d7d2e8e2c6340d25e6f1c629ab58383e34ad454",
  committeeVote: "12599a762d8eb356fa13b99c6ba47ceb7d7a4e61a79280c52413cbdfd897d53f"
} as const

const ACTION = GovMeta.governanceAction({ title: "T", abstract: "A", motivation: "M", rationale: "R" })
const DREP = GovMeta.drep({ givenName: "Alice" })
const VOTE = GovMeta.committeeVote({
  summary: "S",
  rationaleStatement: "RS",
  internalVote: { constitutional: 1, abstain: 0 }
})

describe("the anchor hash", () => {
  it("matches a plain BLAKE2b-256 of the CIP-108 document bytes", () => {
    expect(ACTION.hashHex).toBe(EXPECTED.governanceAction)
  })

  it("matches a plain BLAKE2b-256 of the CIP-119 document bytes", () => {
    expect(DREP.hashHex).toBe(EXPECTED.drep)
  })

  it("matches a plain BLAKE2b-256 of the CIP-136 document bytes", () => {
    expect(VOTE.hashHex).toBe(EXPECTED.committeeVote)
  })

  it("is taken over the serialization the document carries", () => {
    for (const doc of [ACTION, DREP, VOTE]) {
      expect(GovMeta.anchorHash(doc.json)).toBe(doc.hashHex)
      expect(GovMeta.hashDocument(doc.json)).toBe(doc.hashHex)
      expect(doc.hashHex).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it("is the hash of THOSE bytes, so a document re-serialized elsewhere does not match", () => {
    // ⚠️ Not a defect to fix here, and the reason `json` says host it unchanged: CIP-100 wants
    // RDF-Dataset canonicalization (URDNA2015), which this does not implement. Until it does, a
    // consumer that re-serializes the JSON before hashing gets a different anchor.
    const prettified = JSON.stringify(JSON.parse(ACTION.json), null, 2)
    expect(JSON.parse(prettified)).toEqual(JSON.parse(ACTION.json))
    expect(GovMeta.anchorHash(prettified)).not.toBe(ACTION.hashHex)
  })

  it("covers the whole document, body included", () => {
    const other = GovMeta.governanceAction({ title: "T", abstract: "A", motivation: "M", rationale: "R2" })
    expect(other.hashHex).not.toBe(ACTION.hashHex)
  })
})

describe("the document body", () => {
  const body = (doc: GovMeta.BuiltDocument) => JSON.parse(doc.json).body as Record<string, unknown>

  it("omits an absent optional field rather than emitting null", () => {
    // A DRep who gave no payment address and one who gave an empty one are different claims; a
    // `null` in the hosted document would say the second.
    expect(Object.keys(body(DREP))).toEqual(["givenName"])
    expect(DREP.json).not.toContain("null")
  })

  it("keeps a zero in the internal vote, which is a count and not an absence", () => {
    expect(body(VOTE).internalVote).toEqual({ constitutional: 1, abstain: 0 })
  })

  it("omits the internal vote entirely when there is none", () => {
    const noVote = GovMeta.committeeVote({ summary: "S", rationaleStatement: "RS" })
    expect(Object.keys(body(noVote))).toEqual(["summary", "rationaleStatement"])
  })

  it("carries every CIP-108 field a governance action declares", () => {
    expect(body(ACTION)).toEqual({ title: "T", abstract: "A", motivation: "M", rationale: "R" })
  })

  it("carries the optional CIP-119 fields when given", () => {
    const full = GovMeta.drep({
      givenName: "Alice",
      paymentAddress: "addr1xyz",
      image: { "@type": "ImageObject", contentUrl: "https://example.com/a.png", sha256: "ab" },
      objectives: "O",
      motivations: "M",
      qualifications: "Q"
    })
    expect(Object.keys(body(full))).toEqual([
      "givenName",
      "paymentAddress",
      "image",
      "objectives",
      "motivations",
      "qualifications"
    ])
  })
})

describe("references", () => {
  const refs = (doc: GovMeta.BuiltDocument) =>
    (JSON.parse(doc.json).body as { references?: ReadonlyArray<Record<string, unknown>> }).references

  it("emits the JSON-LD `@type` key, not the input's `type`", () => {
    const doc = GovMeta.governanceAction({
      title: "T",
      abstract: "A",
      motivation: "M",
      rationale: "R",
      references: [{ type: "Other", label: "L", uri: "https://example.com" }]
    })
    expect(refs(doc)).toEqual([{ "@type": "Other", label: "L", uri: "https://example.com" }])
  })

  it("keeps a reference hash when one is given", () => {
    const referenceHash = { hashDigest: "ab".repeat(32), hashAlgorithm: "blake2b-256" } as const
    const doc = GovMeta.governanceAction({
      title: "T",
      abstract: "A",
      motivation: "M",
      rationale: "R",
      references: [{ type: "GovernanceMetadata", label: "L", uri: "ipfs://x", referenceHash }]
    })
    expect(refs(doc)?.[0]?.referenceHash).toEqual(referenceHash)
  })

  it("omits the key for an empty list, so no document carries an empty `references`", () => {
    for (const doc of [
      GovMeta.governanceAction({ title: "T", abstract: "A", motivation: "M", rationale: "R", references: [] }),
      GovMeta.drep({ givenName: "A", references: [] }),
      GovMeta.committeeVote({ summary: "S", rationaleStatement: "RS", references: [] })
    ]) {
      expect(refs(doc)).toBeUndefined()
    }
  })
})

describe("the @context and authors", () => {
  const doc = (d: GovMeta.BuiltDocument) => JSON.parse(d.json) as Record<string, any>

  it("declares the hash algorithm the anchor uses", () => {
    for (const d of [ACTION, DREP, VOTE]) expect(doc(d).hashAlgorithm).toBe("blake2b-256")
  })

  it("points each document at its own CIP's context", () => {
    expect(doc(ACTION)["@context"].body["@id"]).toBe("CIP108:body")
    expect(doc(DREP)["@context"].body["@id"]).toBe("CIP119:body")
    expect(doc(VOTE)["@context"].body["@id"]).toBe("CIP136:body")
  })

  it("keeps the CIP-136 context's language tag", () => {
    expect(doc(VOTE)["@context"]["@language"]).toBe("en-us")
  })

  it("emits an empty author list where the CIP has one, and no key where it does not", () => {
    // CIP-119 has no authors: a DRep metadata document is not witnessed.
    expect(doc(ACTION).authors).toEqual([])
    expect(doc(VOTE).authors).toEqual([])
    expect("authors" in doc(DREP)).toBe(false)
  })
})
