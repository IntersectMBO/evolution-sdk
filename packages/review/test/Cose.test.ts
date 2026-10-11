import { Bip32PrivateKey, Bip32PublicKey, KeyHash, PrivateKey, VKey } from "@evolution-sdk/evolution"
import * as COSE from "@evolution-sdk/evolution/cose"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import * as Cose from "../src/Cose.js"

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex")
const raw = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"))
const run = <A, E>(e: Effect.Effect<A, E>): A => Effect.runSync(e)

/** A deterministic Icarus root, and a second key derived from it as a "foreign" signer. */
const ROOT = Bip32PrivateKey.fromHex(`10${"11".repeat(30)}51${"11".repeat(64)}`)
const FOREIGN = Bip32PrivateKey.derive(ROOT, [0, 1])

const vkeyOf = (root: Bip32PrivateKey.Bip32PrivateKey) =>
  // The xpub's first 32 bytes are the Ed25519 public key; the rest is the chain code.
  VKey.fromBytes(Bip32PublicKey.toRawBytes(Bip32PrivateKey.toPublicKey(root)).slice(0, 32))
const keyHashOf = (root: Bip32PrivateKey.Bip32PrivateKey) => KeyHash.toHex(KeyHash.fromVKey(vkeyOf(root)))

/** A testnet enterprise address over a key hash: header `0x60` then the 28-byte credential. */
const enterprise = (keyHashHex: string) => `60${keyHashHex}`

const OWN_KEY_HASH = keyHashOf(ROOT)
const OWN_ADDRESS = enterprise(OWN_KEY_HASH)
const FOREIGN_ADDRESS = enterprise(keyHashOf(FOREIGN))

const PAYLOAD = Buffer.from("prove you control this address", "utf8").toString("hex")

/** Sign through the reference `SignData.signData`, the same path a software wallet takes. */
const sign = (root: Bip32PrivateKey.Bip32PrivateKey, addressHex: string, payloadHex = PAYLOAD): Cose.DataSignature => {
  const out = COSE.SignData.signData(addressHex, raw(payloadHex), Bip32PrivateKey.toPrivateKey(root), {
    includeKeyId: false
  })
  return { signature: hex(out.signature), key: hex(out.key) }
}

describe("verifyDataForAddress binds the proof to the address the CALLER names", () => {
  it("accepts a proof over the address the caller asked about", () => {
    expect(run(Cose.verifyDataForAddress(sign(ROOT, OWN_ADDRESS), OWN_ADDRESS as never))).toBe(true)
  })

  it("accepts the 28-byte credential claim a device embeds, against the full address", () => {
    // The device claims only the credential; the caller authenticates the address. Requiring the
    // two to be literally equal would reject every hardware login.
    expect(run(Cose.verifyDataForAddress(sign(ROOT, OWN_KEY_HASH), OWN_ADDRESS as never))).toBe(true)
  })

  it("REFUSES a self-consistent proof about a DIFFERENT address than the caller named", () => {
    // ⚠️ The forgery this function exists for. The signature is valid and the claim matches the
    // signing key, so a P2-only verifier returns true — but the caller is authenticating
    // OWN_ADDRESS, and the message proves control of the attacker's address instead.
    expect(run(Cose.verifyDataForAddress(sign(FOREIGN, FOREIGN_ADDRESS), OWN_ADDRESS as never))).toBe(false)
  })

  it("REFUSES the caller's OWN key signing over a claim that names a different address", () => {
    // ⚠️ The vector that separates the two checks. Every other refusal here is caught by "does
    // the key own the caller's address" alone; this one passes that and must still fail, because
    // the message proves control of some OTHER address. A replayed envelope looks exactly so.
    expect(run(Cose.verifyDataForAddress(sign(ROOT, enterprise("ab".repeat(28))), OWN_ADDRESS as never))).toBe(false)
  })

  it("REFUSES a valid signature by a foreign key even when the claim names the victim", () => {
    expect(run(Cose.verifyDataForAddress(sign(FOREIGN, OWN_ADDRESS), OWN_ADDRESS as never))).toBe(false)
  })

  it("REFUSES a signature with NO address claim", () => {
    // "No claim" is legitimate for P2-only verification and proves control of nothing. Built the
    // way a device builds one: assemble to learn the Sig_structure the omitted claim produces,
    // sign exactly those bytes, re-assemble. Reusing a claim-bearing signature does not work —
    // the protected header is part of what is signed.
    const vkeyHex = hex(vkeyOf(ROOT).bytes)
    const shape = run(Cose.assembleData(undefined, PAYLOAD, false, vkeyHex, "00".repeat(64)))
    const toSign = COSE.COSESign1.coseSign1FromCBORHex(shape.signature).signedData()
    const signature = hex(PrivateKey.sign(Bip32PrivateKey.toPrivateKey(ROOT), toSign).bytes)
    const bare = run(Cose.assembleData(undefined, PAYLOAD, false, vkeyHex, signature))
    // Genuinely valid: the signature verifies over these exact bytes, so the refusal is P1's.
    expect(VKey.verify(vkeyOf(ROOT), toSign, raw(signature))).toBe(true)
    expect(run(Cose.verifyDataForAddress(bare, OWN_ADDRESS as never))).toBe(false)
  })

  it("REFUSES a script address even when its hash equals the signing key's", () => {
    // ⚠️ The script hash is deliberately the KEY hash. A script address with unrelated bytes is
    // refused by the hash comparison alone, so it cannot tell whether script-ness is checked at
    // all; this one passes every byte comparison and must still fail, because no single Ed25519
    // key can prove control of a script.
    const scriptAddress = `70${OWN_KEY_HASH}`
    expect(run(Cose.verifyDataForAddress(sign(ROOT, scriptAddress), scriptAddress as never))).toBe(false)
  })

  it("REFUSES malformed bytes rather than throwing", () => {
    expect(run(Cose.verifyDataForAddress({ signature: "00zz", key: "00zz" }, OWN_ADDRESS as never))).toBe(false)
  })

  it("REFUSES an envelope whose signature bytes were altered", () => {
    const sig = sign(ROOT, OWN_ADDRESS)
    // Flip the last byte rather than overwrite it: a fixed replacement is a no-op whenever the
    // byte already held that value, which is a test that passes without testing anything.
    const last = Number.parseInt(sig.signature.slice(-2), 16)
    const flipped = (last ^ 0xff).toString(16).padStart(2, "0")
    const tampered = { ...sig, signature: `${sig.signature.slice(0, -2)}${flipped}` }
    expect(tampered.signature).not.toBe(sig.signature)
    expect(run(Cose.verifyDataForAddress(tampered, OWN_ADDRESS as never))).toBe(false)
  })
})

describe("assembleData wraps an external signature into the CIP-30 envelope", () => {
  const vkeyHex = hex(vkeyOf(ROOT).bytes)

  /** The raw Ed25519 signature a device returns, taken from a real signing. */
  const deviceSignature = (addressHex: string) =>
    hex(COSE.COSESign1.coseSign1FromCBORHex(sign(ROOT, addressHex).signature).signature.bytes)

  it("reproduces byte-for-byte what the software signing path produced", () => {
    // Both paths must agree on the envelope, or the same signature verifies in one and not the
    // other. `includeKeyId: false` above is what makes them comparable — a device omits the kid.
    const want = sign(ROOT, OWN_ADDRESS)
    const got = run(Cose.assembleData(OWN_ADDRESS as never, PAYLOAD, false, vkeyHex, deviceSignature(OWN_ADDRESS)))
    expect(got.signature).toBe(want.signature)
    expect(got.key).toBe(want.key)
  })

  it("produces an envelope that verifies against the address it claims", () => {
    const sig = run(Cose.assembleData(OWN_ADDRESS as never, PAYLOAD, false, vkeyHex, deviceSignature(OWN_ADDRESS)))
    expect(run(Cose.verifyDataForAddress(sig, OWN_ADDRESS as never))).toBe(true)
  })

  it("embeds the 28-byte credential when that is what the device claimed", () => {
    const sig = run(Cose.assembleData(OWN_KEY_HASH as never, PAYLOAD, false, vkeyHex, deviceSignature(OWN_KEY_HASH)))
    expect(run(Cose.verifyDataForAddress(sig, OWN_ADDRESS as never))).toBe(true)
  })

  it("does not verify when the hashed flag disagrees with how the signature was made", () => {
    // ⚠️ The flag changes the signed bytes, so getting it wrong is not cosmetic: a verifier
    // re-derives blake2b(payload) and compares it against a signature over payload.
    const sig = run(Cose.assembleData(OWN_ADDRESS as never, PAYLOAD, true, vkeyHex, deviceSignature(OWN_ADDRESS)))
    expect(run(Cose.verifyDataForAddress(sig, OWN_ADDRESS as never))).toBe(false)
  })

  it("fails typed rather than throwing on malformed hex", () => {
    const exit = Effect.runSyncExit(Cose.assembleData(OWN_ADDRESS as never, "zz", false, vkeyHex, "00"))
    expect(exit._tag).toBe("Failure")
  })
})
