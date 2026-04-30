import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { describe, it } from "@effect/vitest"
import { FastCheck, Hash } from "effect"

import * as TxInput from "../../src/TransactionInput.js"
import { CborReader } from "../../src/v2/CborReader.js"
import { CborWriter } from "../../src/v2/CborWriter.js"
import * as Equal from "../../src/v2/Equal.js"

describe("TransactionInput CML parity", () => {
  it("property: write/read roundtrip + CML byte parity + Equal + Hash", () => {
    FastCheck.assert(
      FastCheck.property(TxInput.arbitrary, (inp) => {
        // write/read roundtrip
        const w = new CborWriter()
        TxInput.write(w, inp)
        const cbor = w.finishView()
        const decoded = TxInput.read(new CborReader(cbor))

        if (decoded.index !== inp.index) return false
        if (!Equal.equals(decoded.transactionId.hash, inp.transactionId.hash)) return false

        // CML byte parity
        const cml = CML.TransactionInput.new(
          CML.TransactionHash.from_raw_bytes(inp.transactionId.hash),
          inp.index
        )
        if (!Equal.equals(cbor, cml.to_cbor_bytes())) return false

        // toCBORBytes matches CML
        const ourBytes = TxInput.toCBORBytes(inp)
        if (!Equal.equals(ourBytes, cml.to_cbor_bytes())) return false

        // Equal + Hash
        if (!Equal.equals(inp, decoded)) return false
        if (Hash.hash(inp) !== Hash.hash(decoded)) return false

        // instanceof
        if (!(decoded instanceof TxInput.TransactionInput)) return false
        if (!TxInput.isTransactionInput(decoded)) return false

        return true
      }),
      { numRuns: 500 }
    )
  })
})
