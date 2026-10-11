import { Bip32PrivateKey } from "@evolution-sdk/evolution"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import * as Cip88 from "../src/Cip88.js"

const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runSync(e)
const attempt = <A, E>(e: Effect.Effect<A, E>) => Effect.runSync(Effect.either(e))
const utf8Hex = (s: string) => Buffer.from(s, "utf8").toString("hex")
const keyFrom = (fill: number) => Bip32PrivateKey.toHex(Bip32PrivateKey.fromBip39Entropy(new Uint8Array(16).fill(fill)))

/** Deterministic across runs, and the fixture shape the rest of this repo's key tests use. */
const XPRV = keyFrom(0)

const POLICY_ID = "1e".repeat(28)
const SCRIPT = `82008200581c${"ab".repeat(28)}`

const OPTIONS: Cip88.RegistrationOptions = {
  policyIdHex: POLICY_ID,
  nativeScriptHex: SCRIPT,
  featureSet: [25, 27],
  validation: { method: 0 },
  nonce: 123456789
}

/**
 * The scope, feature set and nonce of OPTIONS, as the keys appear in the map.
 *
 * `01` `83 00 581c<policy> 81 5822<script>` scope, `02` `82 1819 181b` [25, 27],
 * `04` `1a075bcd15` nonce 123456789. Key `03` is the validation method and varies per test.
 */
const SCOPE = `018300581c${POLICY_ID}815822${SCRIPT}02821819181b`
const NONCE = "041a075bcd15"

/**
 * The full payload for OPTIONS: a 4-entry map, validation method `[0]`.
 *
 * Verified against `cardano-multiplatform-lib` 6.2, which parses this and re-encodes it to the
 * same bytes, so the map is canonical by a second implementation's reckoning and not only by
 * ours. The payload is both hashed into `auxiliary_data_hash` and the signing preimage, so a byte
 * that moves invalidates every witness over it.
 */
const PAYLOAD = `a4${SCOPE}038100${NONCE}`

describe("Cip88.payload", () => {
  it("encodes the scope-details map to the bytes CML agrees on", () => {
    expect(run(Cip88.payload(OPTIONS))).toBe(PAYLOAD)
  })

  it("carries a beacon-token validation method as `[1, [policyId, assetId]]`", () => {
    const validation = { method: 1, policyIdHex: "cd".repeat(28), assetIdHex: "beef" } as const
    expect(run(Cip88.payload({ ...OPTIONS, validation }))).toBe(
      `a4${SCOPE}03820182581c${validation.policyIdHex}42beef${NONCE}`
    )
  })

  it("adds the oracle URI as key 5, after the nonce", () => {
    const uri = ["https", "//oracle.example.com/policy"]
    expect(run(Cip88.payload({ ...OPTIONS, oracleUri: uri }))).toBe(
      `a5${SCOPE}038100${NONCE}058265${utf8Hex(uri[0]!)}781b${utf8Hex(uri[1]!)}`
    )
  })

  it("treats an empty oracle URI array as no oracle URI", () => {
    expect(run(Cip88.payload({ ...OPTIONS, oracleUri: [] }))).toBe(PAYLOAD)
  })

  it("refuses an oracle URI part over the 64-byte metadatum limit", () => {
    const r = attempt(Cip88.payload({ ...OPTIONS, oracleUri: ["https", "a".repeat(65)] }))
    expect(Either.isLeft(r)).toBe(true)
    if (Either.isLeft(r)) {
      expect(r.left._tag).toBe("Cip88Error")
      expect(r.left.reason).toContain("exceeds 64 bytes")
    }
  })

  it("chunks the native script into 64-byte byte strings", () => {
    const script = "ab".repeat(100)
    // `82` array(2) · `5840` bytes(64) · `5824` bytes(36).
    expect(run(Cip88.payload({ ...OPTIONS, nativeScriptHex: script }))).toContain(
      `825840${"ab".repeat(64)}5824${"ab".repeat(36)}`
    )
  })

  it("keeps a script that fits as a single chunk", () => {
    expect(run(Cip88.payload({ ...OPTIONS, nativeScriptHex: "ab".repeat(64) }))).toContain(`815840${"ab".repeat(64)}`)
  })

  it("accepts the nonce as a number or a bigint", () => {
    expect(run(Cip88.payload({ ...OPTIONS, nonce: 123456789n }))).toBe(PAYLOAD)
  })

  it("writes an empty feature set as an empty array rather than omitting the key", () => {
    // A policy that declares no CIPs is a different statement from one that declares nothing.
    expect(run(Cip88.payload({ ...OPTIONS, featureSet: [] }))).toContain("0280")
  })

  it("reports non-hex input as a Cip88Error rather than throwing", () => {
    for (const bad of [{ policyIdHex: "zz" }, { nativeScriptHex: "abc" }]) {
      const r = attempt(Cip88.payload({ ...OPTIONS, ...bad }))
      expect(Either.isLeft(r)).toBe(true)
      if (Either.isLeft(r)) expect(r.left._tag).toBe("Cip88Error")
    }
  })
})

describe("Cip88 witnesses", () => {
  /**
   * Verified with CML 6.2's `PublicKey.verify` over the payload bytes, and the same call refuses
   * it over a payload with one byte changed. Pinning the hex is what carries that check forward: a
   * signing path that changed silently would still satisfy its own `verify`.
   */
  const PUBKEY = "37fdfdbe9ac856469f8d83c66c57880246cd8bf7f852bf5b94336fe535c0efc8"
  const SIG =
    "de8982ca0f584ccfd104b5253225d0e0efc548c8dc0be5e0c08ac0864562c90c7176437068d0de7e0dd41fe5c4ccc14d3b2c11306091f46857e146246a924400"

  it("signs the payload with the policy key", () => {
    expect(run(Cip88.sign(PAYLOAD, XPRV))).toEqual({ pubkeyHex: PUBKEY, sigHex: SIG })
  })

  it("publishes the 32-byte key the signature verifies against, not the 64-byte extended one", () => {
    expect(PUBKEY.length / 2).toBe(32)
  })

  it("verifies its own witness", () => {
    expect(run(Cip88.verify(PAYLOAD, { pubkeyHex: PUBKEY, sigHex: SIG }))).toBe(true)
  })

  it("refuses the witness over a payload with one byte changed", () => {
    const mutated = `${PAYLOAD.slice(0, -2)}16`
    expect(mutated).not.toBe(PAYLOAD)
    expect(run(Cip88.verify(mutated, { pubkeyHex: PUBKEY, sigHex: SIG }))).toBe(false)
  })

  it("refuses a signature made by another key", () => {
    const other = run(Cip88.sign(PAYLOAD, keyFrom(1)))
    expect(other.pubkeyHex).not.toBe(PUBKEY)
    expect(run(Cip88.verify(PAYLOAD, { pubkeyHex: PUBKEY, sigHex: other.sigHex }))).toBe(false)
  })

  it("refuses a tampered signature", () => {
    expect(run(Cip88.verify(PAYLOAD, { pubkeyHex: PUBKEY, sigHex: `${SIG.slice(0, -2)}01` }))).toBe(false)
  })

  it("signs the payload bytes themselves", () => {
    // `signingPayload` is a named seam, not a transform: the preimage IS the payload CBOR.
    expect(Cip88.signingPayload(PAYLOAD)).toBe(PAYLOAD)
  })

  it("reports a malformed key as a Cip88Error rather than throwing", () => {
    const r = attempt(Cip88.sign(PAYLOAD, "nothex"))
    expect(Either.isLeft(r)).toBe(true)
    if (Either.isLeft(r)) expect(r.left._tag).toBe("Cip88Error")
  })
})

describe("Cip88.registration", () => {
  it("assembles label 867 as version, payload, witnesses", () => {
    const w = run(Cip88.sign(PAYLOAD, XPRV))
    // `a1` map(1) · `190363` 867 · `a3` map(3) · `0001` version 1 · `01<payload>` ·
    // `02 81 82 5820<pubkey> 5840<sig>` witnesses.
    expect(run(Cip88.registration(PAYLOAD, [w]))).toBe(
      `a1190363a3000101${PAYLOAD}0281825820${w.pubkeyHex}5840${w.sigHex}`
    )
    expect(Cip88.REGISTRATION_LABEL).toBe(867n)
  })

  it("honours a registration version other than the default 1", () => {
    const w = run(Cip88.sign(PAYLOAD, XPRV))
    expect(run(Cip88.registration(PAYLOAD, [w], 2))).toContain("a3000201")
  })

  it("carries every witness, in the order given", () => {
    const a = run(Cip88.sign(PAYLOAD, XPRV))
    const b = run(Cip88.sign(PAYLOAD, keyFrom(2)))
    const hex = run(Cip88.registration(PAYLOAD, [a, b]))
    expect(hex).toContain("0282")
    expect(hex.indexOf(a.pubkeyHex)).toBeLessThan(hex.indexOf(b.pubkeyHex))
  })

  it("writes no witnesses as an empty array, which is a declaration nobody signed", () => {
    expect(run(Cip88.registration(PAYLOAD, []))).toContain("0280")
  })
})

describe("Cip88.build", () => {
  it("is payload, sign and registration composed", () => {
    const built = run(Cip88.build(OPTIONS, [XPRV]))
    const payloadHex = run(Cip88.payload(OPTIONS))
    const w = run(Cip88.sign(payloadHex, XPRV))
    expect(built.payloadHex).toBe(payloadHex)
    expect(built.metadataHex).toBe(run(Cip88.registration(payloadHex, [w])))
  })

  it("signs with every key given", () => {
    const second = keyFrom(3)
    const built = run(Cip88.build(OPTIONS, [XPRV, second]))
    expect(built.metadataHex).toContain("0282")
    for (const xprv of [XPRV, second]) {
      expect(built.metadataHex).toContain(run(Cip88.sign(built.payloadHex, xprv)).pubkeyHex)
    }
  })

  it("passes the version through to the metadata", () => {
    expect(run(Cip88.build({ ...OPTIONS, version: 3 }, [XPRV])).metadataHex).toContain("a3000301")
  })
})
