import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as COSEKey from "../src/cose/Key.js"
import { labelFromInt } from "../src/cose/Label.js"
import * as SignData from "../src/cose/SignData.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PrivateKey from "../src/PrivateKey.js"
import * as VKey from "../src/VKey.js"

/**
 * `COSEKey` keeps the public key in an UNTYPED header map at label -2, so without an accessor
 * every consumer that reads a key hand-walks that map — which is what `verifyData` used to do
 * inline.
 */
describe("COSEKey.publicKey", () => {
  const privateKey = PrivateKey.fromBytes(PrivateKey.generate())
  const vkey = VKey.fromPrivateKey(privateKey)
  const coseKey = new COSEKey.EdDSA25519Key({ privateKey: undefined, publicKey: vkey }, {
    disableValidation: true
  }).build()

  it("reads back the key a COSE_Key was built around", () => {
    const decoded = Schema.decodeSync(COSEKey.COSEKeyFromCBORBytes())(
      Schema.encodeSync(COSEKey.COSEKeyFromCBORBytes())(coseKey)
    )
    expect(COSEKey.publicKey(decoded)?.bytes).toEqual(vkey.bytes)
  })

  // These arrive from a counterparty. A verifier an attacker can crash is a verifier an
  // attacker controls, so every malformed shape is `undefined` rather than a throw.
  it("answers undefined for a key that carries no public key", () => {
    const bare = new COSEKey.COSEKey({
      keyType: undefined,
      keyId: undefined,
      algorithmId: undefined,
      keyOps: undefined,
      baseInitVector: undefined,
      headers: coseKey.headers.setHeader(labelFromInt(-2n), new Uint8Array(0))
    }, { disableValidation: true })
    expect(COSEKey.publicKey(bare)).toBeUndefined()
  })

  it("answers undefined for a label -2 that is not 32 bytes, and for one that is not bytes", () => {
    const short = new COSEKey.COSEKey({ ...coseKey, headers: coseKey.headers.setHeader(labelFromInt(-2n), Bytes.fromHex("aa".repeat(31))) }, {
      disableValidation: true
    })
    expect(COSEKey.publicKey(short)).toBeUndefined()
    const notBytes = new COSEKey.COSEKey({ ...coseKey, headers: coseKey.headers.setHeader(labelFromInt(-2n), 7n) }, {
      disableValidation: true
    })
    expect(COSEKey.publicKey(notBytes)).toBeUndefined()
  })

  // The accessor replaced an inline walk in verifyData; this is the end-to-end path that walk
  // served, so a regression in one shows up in the other.
  it("is the key verifyData binds the address to", () => {
    const keyHash = KeyHash.fromPrivateKey(privateKey)
    const addressHex = `60${Bytes.toHex(keyHash.hash)}`
    const payload = Bytes.fromHex("aa".repeat(32))
    const signed = SignData.signData(addressHex, payload, privateKey)
    expect(SignData.verifyData(addressHex, KeyHash.toHex(keyHash), payload, signed)).toBe(true)
    const decoded = Schema.decodeSync(COSEKey.COSEKeyFromCBORBytes())(signed.key)
    expect(COSEKey.publicKey(decoded)?.bytes).toEqual(vkey.bytes)
  })
})
