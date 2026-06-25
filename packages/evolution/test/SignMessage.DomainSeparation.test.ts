import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import { COSESign1 } from "../src/cose/index.js"
import * as PrivateKey from "../src/PrivateKey.js"
import { preprod } from "../src/sdk/client/Chain.js"
import { seedWallet } from "../src/sdk/client/internal/Wallets.js"
import { keysFromSeed } from "../src/sdk/wallet/Derivation.js"
import * as VKey from "../src/VKey.js"

const mnemonic =
  "zebra short room flavor rival capital fortune hip profit trust melody office depend adapt visa cycle february link tornado whisper physical kiwi film voyage"

describe("signMessage domain separation (#389)", () => {
  it("produces a COSE_Sign1, not a bare witness over the raw payload", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const address = await wallet.address()
    const paymentVKey = VKey.fromPrivateKey(PrivateKey.fromBech32(keysFromSeed(mnemonic).paymentKey))

    // A 32-byte value that looks like a transaction body hash
    const txBodyHash = new Uint8Array(32).fill(0xab)

    const result = await wallet.signMessage(address, txBodyHash)
    const signatureBytes = Bytes.fromHex(result.signature)

    // The signed output is a COSE_Sign1 (domain-separated), not a 64-byte signature
    const cose = COSESign1.coseSign1FromCBORBytes(signatureBytes)
    expect(cose.payload !== undefined && Bytes.equals(cose.payload, txBodyHash)).toBe(true)

    // Oracle closed: the signature does NOT verify as a witness over the raw hash
    expect(VKey.verify(paymentVKey, txBodyHash, cose.signature.bytes)).toBe(false)

    // But it IS a valid signature over the COSE Sig_structure
    expect(VKey.verify(paymentVKey, cose.signedData(), cose.signature.bytes)).toBe(true)
  })
})
