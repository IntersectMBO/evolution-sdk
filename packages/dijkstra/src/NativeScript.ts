/**
 * `script_require_guard` — the Dijkstra native-script variant, CDDL tag 6.
 *
 * ```
 * script_require_guard = (6, credential)
 * credential           = [0, addr_keyhash] / [1, script_hash]
 * ```
 *
 * It lives here rather than in `@evolution-sdk/evolution`'s `NativeScripts` on purpose. That
 * union is a stable, published type, and this is a **draft** CDDL that has already moved once;
 * adding an arm to a settled union for a pre-fork spec would make every exhaustive `switch` on
 * it a breaking change the day the draft shifts again. A consumer on a Dijkstra chain reaches
 * for this package; everyone else is unaffected, and a decoder that meets a tag 6 it cannot name
 * says so rather than guessing.
 *
 * ⚠️⚠️ **PRE-FORK.** Re-verify against the final CDDL before relying on it.
 *
 * @since 0.1.0
 */

import { Data, Effect } from "effect"

import type { Credential, DijkstraError } from "./Body.js"
import { arrayHead, readBytes, readHead, readUint } from "./internal/Cbor.js"
import { bytesToHex, hexToBytes } from "./internal/Hex.js"

/** @since 0.1.0 */
export class NativeScriptError extends Data.TaggedError("NativeScriptError")<{ readonly reason: string }> {}

/** The tag this module owns. @since 0.1.0 */
export const REQUIRE_GUARD_TAG = 6

const uintBytes = (n: number): Uint8Array => {
  if (n < 24) return Uint8Array.from([n])
  if (n < 0x100) return Uint8Array.from([0x18, n])
  if (n < 0x10000) return Uint8Array.from([0x19, n >> 8, n & 0xff])
  throw new Error(`uint out of range for this encoder: ${n}`)
}

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const credentialBytes = (cred: Credential): Uint8Array => {
  const hash = hexToBytes(cred.hashHex)
  if (hash.length !== 28) throw new Error(`credential hash must be 28 bytes, got ${hash.length}`)
  return concat(Uint8Array.from([0x82]), uintBytes(cred.isScript ? 1 : 0), Uint8Array.from([0x58, 0x1c]), hash)
}

/**
 * Build `[6, credential]`.
 *
 * @since 0.1.0
 */
export const requireGuard = (cred: Credential): Uint8Array =>
  concat(Uint8Array.from([0x82]), uintBytes(REQUIRE_GUARD_TAG), credentialBytes(cred))

/**
 * Build it as hex.
 *
 * @since 0.1.0
 */
export const requireGuardHex = (cred: Credential): string => bytesToHex(requireGuard(cred))

/**
 * Decode a native script that is a `script_require_guard`, or report that it is not one.
 *
 * ⚠️ Returns `undefined` for any other tag rather than throwing, because the caller's own
 * decoder owns those arms — this is the one variant it could not name.
 *
 * @since 0.1.0
 */
export const decodeRequireGuard = (scriptHex: string): Credential | undefined => {
  const b = hexToBytes(scriptHex)
  const [count, p0] = arrayHead(b, 0)
  if (count !== 2) return undefined
  const [tag, p1] = readUint(b, p0)
  if (tag !== BigInt(REQUIRE_GUARD_TAG)) return undefined
  if (readHead(b, p1).major !== 4) throw new Error("script_require_guard: credential is not an array")
  const [, p2] = arrayHead(b, p1)
  const [kind, p3] = readUint(b, p2)
  if (kind !== 0n && kind !== 1n) throw new Error(`script_require_guard: credential kind ${kind}`)
  const [hash] = readBytes(b, p3)
  if (hash.length !== 28) throw new Error(`script_require_guard: credential hash is ${hash.length} bytes, not 28`)
  return { hashHex: bytesToHex(hash), isScript: kind === 1n }
}

/**
 * Whether this native script is a `script_require_guard`, in the Effect channel.
 *
 * @since 0.1.0
 */
export const requireGuardOf = (scriptHex: string): Effect.Effect<Credential | undefined, NativeScriptError> =>
  Effect.try({
    try: () => decodeRequireGuard(scriptHex),
    catch: (e) => new NativeScriptError({ reason: `requireGuardOf: ${e instanceof Error ? e.message : String(e)}` })
  })

export type { Credential, DijkstraError }
