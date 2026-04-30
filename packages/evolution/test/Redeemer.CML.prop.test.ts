import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { FastCheck } from "effect"
import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as Redeemer from "../src/Redeemer.js"
import * as Redeemers from "../src/Redeemers.js"

describe("Redeemer CML Compatibility (property)", () => {
  it("Array of Redeemers encoded via Evolution is parseable by CML.Redeemers and roundtrips", () => {
    const redeemersArr = FastCheck.array(Redeemer.arbitrary, { minLength: 1, maxLength: 5 })
    FastCheck.assert(
      FastCheck.property(redeemersArr, (redeemers) => {
        const ra = new Redeemers.RedeemerArray({ value: redeemers })
        const evoHex = Bytes.toHex(Redeemers.toCBORBytes(ra))

        const cmlRedeemers = CML.Redeemers.from_cbor_hex(evoHex)
        const cmlHex = cmlRedeemers.to_cbor_hex()
        expect(cmlHex).toBe(evoHex)
      })
    )
  })
})
