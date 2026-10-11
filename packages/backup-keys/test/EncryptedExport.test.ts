import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"

import * as EncryptedExport from "../src/EncryptedExport.js"

/**
 * Encrypted wallet export.
 *
 * A tiny Argon2id profile throughout: the real one is 256 MiB per call, which makes a suite that
 * exercises the round trip unrunnable. Cost is the only thing that differs, so nothing under test
 * here depends on it.
 *
 * `parse`/`parseLink` are the import validators and pin the real profile exactly, so the tests
 * that drive them build their envelope at `KDF_V1` by hand rather than encrypting one: they
 * validate structure and never decrypt, so no derivation is needed. Each of those tests asserts
 * the unmutated envelope is ACCEPTED first, so a mutation case cannot pass vacuously.
 */
const params = { id: "argon2id", m: 8, t: 1, p: 1, dkLen: 32 } as const

const MNEMONIC_PAYLOAD = {
  type: "mnemonic",
  entropyHex: "00000000000000000000000000000000",
  label: "abandon wallet"
} as const

const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e)
const fails = async <A, E>(e: Effect.Effect<A, E>): Promise<boolean> =>
  Exit.isFailure(await Effect.runPromiseExit(e))

/** A structurally valid envelope at the real v1 profile. Not decryptable; for the validators. */
const validEnvelope = {
  v: 1,
  kdf: EncryptedExport.KDF_V1,
  cipher: "xchacha20poly1305",
  salt: "AAECAwQFBgcICQoLDA0ODw",
  nonce: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX",
  payloadType: "mnemonic",
  ct: "AAAAAAAAAAAAAAAAAAAAAAAA"
} as const satisfies EncryptedExport.EncryptedEnvelope

describe("an envelope round-trips under the password that made it", () => {
  it("returns the payload it was given", async () => {
    const { envelope } = await run(
      EncryptedExport.encrypt(MNEMONIC_PAYLOAD, "correct horse battery staple", { params })
    )
    expect(await run(EncryptedExport.decrypt(envelope, "correct horse battery staple"))).toEqual(MNEMONIC_PAYLOAD)
  })

  it("carries a cardano-root payload as faithfully as a mnemonic one", async () => {
    const payload = { type: "cardano-root", rootXskHex: "ab".repeat(96), hrp: "root_xsk" } as const
    const { envelope } = await run(EncryptedExport.encrypt(payload, "pw", { params }))
    expect(await run(EncryptedExport.decrypt(envelope, "pw"))).toEqual(payload)
  })

  it("produces a different envelope every time, for the same secret and password", async () => {
    // Salt and nonce are random per call. Identical envelopes would mean a reused nonce, which
    // for XChaCha20-Poly1305 leaks the keystream across two backups of the same wallet.
    const a = (await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, "pw", { params }))).envelope
    const b = (await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, "pw", { params }))).envelope
    expect(a.ct).not.toBe(b.ct)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.salt).not.toBe(b.salt)
  })
})

describe("a password is bytes, not a trimmed or normalised string", () => {
  // ⚠️ The whole point of the no-trim rule. A backup encrypted under a padded password cannot be
  // opened by deriving from the trimmed form, so any caller that trims on the way in locks the
  // user out of a password they typed correctly.
  const padded = "  myP@ss123  "

  it("opens under the exact bytes", async () => {
    const { envelope } = await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, padded, { params }))
    expect(await run(EncryptedExport.decrypt(envelope, padded))).toEqual(MNEMONIC_PAYLOAD)
  })

  it("REFUSES the trimmed form of the same password", async () => {
    const { envelope } = await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, padded, { params }))
    expect(await fails(EncryptedExport.decrypt(envelope, padded.trim()))).toBe(true)
  })

  it("REFUSES the NFC form of a password given in NFD", async () => {
    const nfd = "cafe\u0301-301"
    const nfc = "caf\u00e9-301"
    expect(nfd.normalize("NFC")).toBe(nfc)
    const { envelope } = await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, nfd, { params }))
    expect(await run(EncryptedExport.decrypt(envelope, nfd))).toEqual(MNEMONIC_PAYLOAD)
    expect(await fails(EncryptedExport.decrypt(envelope, nfc))).toBe(true)
  })

  it("treats an all-whitespace password as content", async () => {
    const { envelope } = await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, "   ", { params }))
    expect(await run(EncryptedExport.decrypt(envelope, "   "))).toEqual(MNEMONIC_PAYLOAD)
    expect(await fails(EncryptedExport.decrypt(envelope, ""))).toBe(true)
  })
})

describe("it fails closed", () => {
  it("refuses a wrong password instead of returning something", async () => {
    const { envelope } = await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, "right", { params }))
    expect(await fails(EncryptedExport.decrypt(envelope, "wrong"))).toBe(true)
  })

  it("refuses an empty password at encrypt time", async () => {
    expect(await fails(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, "", { params }))).toBe(true)
  })

  it("detects a tampered ciphertext rather than decrypting it", async () => {
    // Poly1305 is what makes the envelope tamper-evident; without the check a flipped byte would
    // surface as a corrupt mnemonic rather than as a rejected backup.
    const { envelope } = await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, "pw", { params }))
    const flipped = envelope.ct[0] === "A" ? `B${envelope.ct.slice(1)}` : `A${envelope.ct.slice(1)}`
    expect(await fails(EncryptedExport.decrypt({ ...envelope, ct: flipped }, "pw"))).toBe(true)
  })

  it("refuses any KDF parameters other than the one v1 profile", async () => {
    // An envelope names its own Argon2id cost, so an attacker-supplied one is a denial of service
    // on the importer unless it is refused before anything is allocated. v1 fixes one profile, so
    // this is an equality check: a weaker `m` is refused as firmly as a hostile one.
    expect(await run(EncryptedExport.parse(validEnvelope))).toEqual(validEnvelope)
    for (const kdf of [
      { ...validEnvelope.kdf, m: 1_048_576 },
      { ...validEnvelope.kdf, m: 65_536 },
      { ...validEnvelope.kdf, t: 99 },
      { ...validEnvelope.kdf, p: 99 }
    ]) {
      expect(await fails(EncryptedExport.parse({ ...validEnvelope, kdf }))).toBe(true)
    }
  })

  it("refuses an unrecognised cipher or envelope version", async () => {
    expect(await run(EncryptedExport.parse(validEnvelope))).toEqual(validEnvelope)
    expect(await fails(EncryptedExport.parse({ ...validEnvelope, cipher: "aes-256-gcm" as never }))).toBe(true)
    expect(await fails(EncryptedExport.parse({ ...validEnvelope, v: 2 as never }))).toBe(true)
  })

  it("refuses an envelope whose cleartext payloadType contradicts the payload", async () => {
    // `payloadType` is a hint outside the AEAD, so it is checked after decryption rather than
    // trusted. A reader that trusted it would route a root key through the mnemonic path.
    const { envelope } = await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, "pw", { params }))
    expect(await run(EncryptedExport.decrypt(envelope, "pw"))).toEqual(MNEMONIC_PAYLOAD)
    expect(await fails(EncryptedExport.decrypt({ ...envelope, payloadType: "cardano-root" }, "pw"))).toBe(true)
  })
})

describe("the transport link", () => {
  it("round-trips an envelope through a web+cardano://backup link", async () => {
    const link = EncryptedExport.buildLink(validEnvelope)
    expect(link.startsWith("web+cardano://backup?v=1&enc=")).toBe(true)
    expect(await run(EncryptedExport.parseLink(link))).toEqual(validEnvelope)
  })

  it("builds a link for an envelope it just encrypted", async () => {
    const { link } = await run(EncryptedExport.encrypt(MNEMONIC_PAYLOAD, "pw", { params }))
    expect(link.startsWith("web+cardano://backup?v=1&enc=")).toBe(true)
  })

  it("refuses a URI that is not a backup link, and one with no payload", async () => {
    expect(await fails(EncryptedExport.parseLink("https://example.com/backup?v=1&enc=aaaa"))).toBe(true)
    expect(await fails(EncryptedExport.parseLink("web+cardano://backup?v=1"))).toBe(true)
  })

  it("parses the same envelope from its JSON", async () => {
    expect(await run(EncryptedExport.parse(JSON.stringify(validEnvelope)))).toEqual(validEnvelope)
  })
})
