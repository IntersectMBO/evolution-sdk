/**
 * Encrypted wallet export: a password-encrypted, authenticated envelope for moving a wallet
 * secret between applications, with a JSON-file, `web+cardano:` link and QR binding.
 *
 * Argon2id over the password, then XChaCha20-Poly1305 over the payload. v1 fixes one parameter
 * set: an importer has to support it to read anything, so a second weaker profile would not
 * reduce what an implementation must provide, only what it accepts.
 *
 * This is NOT a ratified CIP. It implements a draft submitted for a number; until one is
 * assigned, nothing here names a CIP it does not hold.
 *
 * @since 0.1.0
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2idAsync } from "@noble/hashes/argon2.js"
import { hexToBytes, randomBytes } from "@noble/hashes/utils.js"
import { Data, Effect } from "effect"

export class EncryptedExportError extends Data.TaggedError("EncryptedExportError")<{ readonly reason: string }> {}

/** Argon2id parameters (m = memory in KiB, t = iterations, p = parallelism, dkLen = 32). */
export interface Argon2idParams {
  readonly id: "argon2id"
  readonly m: number
  readonly t: number
  readonly p: number
  readonly dkLen: 32
}
/** The one profile v1 defines, and therefore also the format's floor. */
export const KDF_V1: Argon2idParams = { id: "argon2id", m: 262144, t: 3, p: 1, dkLen: 32 }

export type BackupPayload =
  | { readonly type: "mnemonic"; readonly entropyHex: string; readonly label?: string }
  | { readonly type: "cardano-root"; readonly rootXskHex: string; readonly hrp: "root_xsk"; readonly label?: string }

export interface EncryptedEnvelope {
  readonly v: 1
  readonly kdf: Argon2idParams
  readonly cipher: "xchacha20poly1305"
  readonly salt: string // base64url(16 bytes), unpadded
  readonly nonce: string // base64url(24 bytes), unpadded
  readonly payloadType: BackupPayload["type"] // cleartext hint; NOT authenticated (verified post-decrypt)
  readonly ct: string // base64url(ciphertext ‖ 16-byte Poly1305 tag), unpadded
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64urlEncode = (b: Uint8Array): string => {
  let s = ""
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const b64urlDecode = (str: string): Uint8Array => {
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"))
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return o
}
const b64url = (b: Uint8Array): string => b64urlEncode(b)
const unb64url = (s: string): Uint8Array => b64urlDecode(s)

// Serialize the payload in the draft's field order (this exact JSON is encrypted).
const serializePayload = (p: BackupPayload): string => {
  const o: Record<string, string> =
    p.type === "mnemonic"
      ? { type: "mnemonic", entropyHex: p.entropyHex }
      : { type: "cardano-root", rootXskHex: p.rootXskHex, hrp: p.hrp }
  if (p.label !== undefined) o.label = p.label
  return JSON.stringify(o)
}

// The async variant yields between blocks. At 256 MiB the synchronous one blocks a
// single-threaded JS host (React Native's Hermes, a browser main thread) for seconds.
const deriveKey = (password: string, salt: Uint8Array, k: Argon2idParams): Promise<Uint8Array> =>
  argon2idAsync(enc.encode(password), salt, { m: k.m, t: k.t, p: k.p, dkLen: k.dkLen })

/** Assemble the canonical envelope in its spec field order. */
const makeEnvelope = (
  k: Argon2idParams,
  salt: Uint8Array,
  nonce: Uint8Array,
  payloadType: BackupPayload["type"],
  ct: Uint8Array
): EncryptedEnvelope => ({
  v: 1,
  kdf: { id: "argon2id", m: k.m, t: k.t, p: k.p, dkLen: 32 },
  cipher: "xchacha20poly1305",
  salt: b64url(salt),
  nonce: b64url(nonce),
  payloadType,
  ct: b64url(ct)
})

const validateEnvelope = (e: EncryptedEnvelope): void => {
  if (e.v !== 1) throw new Error(`unsupported envelope version ${e.v}`)
  if (e.cipher !== "xchacha20poly1305") throw new Error(`unsupported cipher "${e.cipher}"`)
  if (e.kdf?.id !== "argon2id") throw new Error(`unsupported kdf "${e.kdf?.id}"`)
  if (e.kdf.dkLen !== 32) throw new Error(`kdf.dkLen must be 32 (got ${e.kdf.dkLen})`)
  // A ceiling, enforced before anything is allocated: a hostile envelope cannot drive the
  // importer out of memory ahead of the password check. `decrypt` takes an already-typed
  // envelope, so it honours a cheaper profile if a caller deliberately hands it one; the
  // profile itself is pinned at the import boundary, in `parse`/`parseLink`.
  if (!(e.kdf.m >= 8 && e.kdf.m <= KDF_V1.m)) throw new Error(`kdf.m ${e.kdf.m} above the v1 profile`)
  if (!(e.kdf.t >= 1 && e.kdf.t <= KDF_V1.t)) throw new Error(`kdf.t ${e.kdf.t} above the v1 profile`)
  if (!(e.kdf.p >= 1 && e.kdf.p <= KDF_V1.p)) throw new Error(`kdf.p ${e.kdf.p} above the v1 profile`)
  if (unb64url(e.salt).length !== 16) throw new Error("salt must be 16 bytes")
  if (unb64url(e.nonce).length !== 24) throw new Error("nonce must be 24 bytes")
  if (e.payloadType !== "mnemonic" && e.payloadType !== "cardano-root")
    throw new Error(`unknown payloadType "${e.payloadType}"`)
}

/**
 * Encrypt a wallet secret into an envelope. `salt`/`nonce` are random by default (pass them
 * only to reproduce a known vector). Argon2id at 256 MiB is CPU-heavy; the derivation is async
 * so it yields rather than blocking the host.
 */
export const encrypt = (
  payload: BackupPayload,
  password: string,
  opts: { readonly params?: Argon2idParams; readonly salt?: Uint8Array; readonly nonce?: Uint8Array } = {}
): Effect.Effect<{ readonly envelope: EncryptedEnvelope; readonly json: string; readonly link: string }, EncryptedExportError> =>
  Effect.tryPromise({
    try: async () => {
      if (password.length === 0) throw new Error("password must not be empty")
      const params = opts.params ?? KDF_V1
      const salt = opts.salt ?? randomBytes(16)
      const nonce = opts.nonce ?? randomBytes(24)
      const key = await deriveKey(password, salt, params)
      const ct = xchacha20poly1305(key, nonce).encrypt(enc.encode(serializePayload(payload)))
      const envelope = makeEnvelope(params, salt, nonce, payload.type, ct)
      const json = JSON.stringify(envelope)
      return { envelope, json, link: buildLink(envelope) }
    },
    catch: (e) => new EncryptedExportError({ reason: e instanceof Error ? e.message : String(e) })
  })

/** Decrypt an envelope with the password → the wallet secret payload. */
export const decrypt = (envelope: EncryptedEnvelope, password: string): Effect.Effect<BackupPayload, EncryptedExportError> =>
  Effect.tryPromise({
    try: async (): Promise<BackupPayload> => {
      validateEnvelope(envelope)
      const key = await deriveKey(password, unb64url(envelope.salt), envelope.kdf)
      const plaintext = xchacha20poly1305(key, unb64url(envelope.nonce)).decrypt(unb64url(envelope.ct)) // throws on wrong password / tamper
      const payload = JSON.parse(dec.decode(plaintext)) as BackupPayload
      if (payload.type !== envelope.payloadType)
        throw new Error(`payload type "${payload.type}" != envelope payloadType "${envelope.payloadType}"`)
      if (payload.type !== "mnemonic" && payload.type !== "cardano-root")
        throw new Error(`unknown payload type "${(payload as { type: string }).type}"`)
      return payload
    },
    catch: (e) => new EncryptedExportError({ reason: e instanceof Error ? e.message : String(e) })
  })

/**
 * The import boundary: v1 defines one profile, so an imported envelope must match it exactly.
 * A weaker `kdf` is refused as firmly as a hostile one — accepting it would lower the format's
 * floor to whatever an exporter felt like paying.
 */
const validateProfile = (e: EncryptedEnvelope): void => {
  if (e.kdf.m !== KDF_V1.m || e.kdf.t !== KDF_V1.t || e.kdf.p !== KDF_V1.p || e.kdf.dkLen !== KDF_V1.dkLen) {
    throw new Error(
      `unsupported kdf parameters (expected argon2id m=${KDF_V1.m} t=${KDF_V1.t} p=${KDF_V1.p} dkLen=${KDF_V1.dkLen})`
    )
  }
}

/** Parse + validate an envelope from its JSON string (or a plain object). */
export const parse = (input: string | EncryptedEnvelope): Effect.Effect<EncryptedEnvelope, EncryptedExportError> =>
  Effect.try({
    try: () => {
      const e = (typeof input === "string" ? JSON.parse(input) : input) as EncryptedEnvelope
      validateEnvelope(e)
      validateProfile(e)
      return e
    },
    catch: (err) => new EncryptedExportError({ reason: err instanceof Error ? err.message : String(err) })
  })

/** The CIP-13 `web+cardano://backup?v=1&enc=<base64url(json)>` transport link. Total. */
export const buildLink = (envelope: EncryptedEnvelope): string =>
  `web+cardano://backup?v=1&enc=${b64url(enc.encode(JSON.stringify(envelope)))}`

/** Parse a `web+cardano://backup?…` link back into a validated envelope. */
export const parseLink = (uri: string): Effect.Effect<EncryptedEnvelope, EncryptedExportError> =>
  Effect.try({
    try: () => {
      const m = /^web\+cardano:\/\/backup\?(.*)$/.exec(uri)
      if (!m) throw new Error("not a web+cardano://backup link")
      const encParam = new URLSearchParams(m[1]!).get("enc")
      if (!encParam) throw new Error("backup link has no `enc` parameter")
      const e = JSON.parse(dec.decode(unb64url(encParam))) as EncryptedEnvelope
      validateEnvelope(e)
      validateProfile(e)
      return e
    },
    catch: (err) => new EncryptedExportError({ reason: err instanceof Error ? err.message : String(err) })
  })

/** Raw 16-byte-boundary entropy bytes from a mnemonic payload's `entropyHex`. */
export const entropyBytes = (payload: Extract<BackupPayload, { type: "mnemonic" }>): Uint8Array =>
  hexToBytes(payload.entropyHex)
