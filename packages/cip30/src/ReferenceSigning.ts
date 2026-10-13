/**
 * The CIP-30 signing WIRE ENCODINGS, produced from an in-process software key.
 *
 * ⚠️ **A format reference, not a wallet signing path.** It signs whatever bytes it is handed with
 * the account's payment key: no transaction review, no user approval, no origin check, no
 * `partialSign` coverage check. Exposing it to a dApp is equivalent to handing over the key.
 *
 * It is separate from {@link Connector} on purpose, and public only so the encodings can be
 * tested. A production wallet answers signing requests with a sentinel its host catches, then
 * decodes the body, shows it to the user, and signs with keys held behind the platform's secure
 * storage or on a device. For the hardware path, where the key never reaches this process, see
 * `cose/SignData.assembleSignData`.
 *
 * @since 0.1.0
 */
import * as Address from "@evolution-sdk/evolution/Address"
import * as Bip32PrivateKey from "@evolution-sdk/evolution/Bip32PrivateKey"
import { SignData } from "@evolution-sdk/evolution/cose"
import * as Ed25519Signature from "@evolution-sdk/evolution/Ed25519Signature"
import * as PrivateKey from "@evolution-sdk/evolution/PrivateKey"
import * as Transaction from "@evolution-sdk/evolution/Transaction"
import * as TransactionBody from "@evolution-sdk/evolution/TransactionBody"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as TransactionWitnessSet from "@evolution-sdk/evolution/TransactionWitnessSet"
import * as VKey from "@evolution-sdk/evolution/VKey"

import type { Account } from "./Account.js"

/**
 * @since 0.1.0
 * @category model
 */
export interface ReferenceSigning {
  /** Sign a full transaction, returning a `TransactionWitnessSet` hex with one vkey witness. */
  readonly signTx: (txHex: string) => string
  /** CIP-103: one witness-set hex per input transaction, in order. */
  readonly signTxs: (txHexes: ReadonlyArray<string>) => ReadonlyArray<string>
  /** CIP-8 / CIP-30 `signData`, returning a `DataSignature`. */
  readonly signData: (
    addressHex: string,
    payloadHex: string
  ) => { readonly signature: string; readonly key: string }
}

const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new Error(`not hex: ${hex.slice(0, 32)}`)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * ⚠️ UNSAFE: see the module documentation. A wire-format reference, not a signing product.
 *
 * @since 0.1.0
 * @category constructors
 */
export const unsafeReferenceSigning = (account: Account): ReferenceSigning => {
  const witnessSetFor = (txHex: string): string => {
    const node = account.paymentKey()
    const key = Bip32PrivateKey.toPrivateKey(node)
    // The transaction id is the hash of the BODY, and it is what a vkey witness signs.
    const body = Transaction.fromCBORHex(txHex).body
    const hash = TransactionBody.toHash(body)
    const signature = PrivateKey.sign(key, TransactionHash.toBytes(hash))
    return TransactionWitnessSet.toCBORHex(
      new TransactionWitnessSet.TransactionWitnessSet({
        vkeyWitnesses: [
          new TransactionWitnessSet.VKeyWitness({
            vkey: VKey.fromPrivateKey(key),
            signature: Ed25519Signature.fromBytes(Ed25519Signature.toBytes(signature))
          })
        ],
        nativeScripts: [],
        bootstrapWitnesses: []
      })
    )
  }

  return {
    signTx: witnessSetFor,
    signTxs: (txHexes) => txHexes.map(witnessSetFor),
    signData: (addressHex, payloadHex) => {
      const key = Bip32PrivateKey.toPrivateKey(account.paymentKey())
      const signed = SignData.signData(Address.toHex(Address.fromHex(addressHex)), hexToBytes(payloadHex), key)
      const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
      return { signature: hex(signed.signature), key: hex(signed.key) }
    }
  }
}
