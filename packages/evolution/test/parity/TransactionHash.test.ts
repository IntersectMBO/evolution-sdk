import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { describe, it } from "@effect/vitest"
import { FastCheck, Hash, Schema } from "effect"

import * as TxHash from "../../src/TransactionHash.js"
import { CborReader } from "../../src/v2/CborReader.js"
import { CborWriter } from "../../src/v2/CborWriter.js"
import * as Equal from "../../src/v2/Equal.js"

describe("TransactionHash CML parity", () => {
  it("property: write/read roundtrip + CML raw bytes + Equal + Hash + fromHex/toHex", () => {
    FastCheck.assert(
      FastCheck.property(TxHash.arbitrary, (th) => {
        // write/read roundtrip
        const w = new CborWriter()
        TxHash.write(w, th)
        const cbor = w.finishView()
        const decoded = TxHash.read(new CborReader(cbor))
        if (!Equal.equals(decoded.hash, th.hash)) return false

        // CBOR structure: 0x5820 + 32 bytes
        if (cbor[0] !== 0x58 || cbor[1] !== 0x20 || cbor.length !== 34) return false

        // CML raw bytes match
        const cml = CML.TransactionHash.from_raw_bytes(th.hash)
        if (!Equal.equals(cml.to_raw_bytes(), decoded.hash)) return false

        // fromBytes / toBytes roundtrip
        const fromBytesResult = TxHash.fromBytes(th.hash)
        if (!Equal.equals(fromBytesResult.hash, th.hash)) return false
        if (!Equal.equals(TxHash.toBytes(fromBytesResult), th.hash)) return false

        // fromHex / toHex roundtrip + CML hex parity
        const hex = TxHash.toHex(th)
        const fromHexResult = TxHash.fromHex(hex)
        if (!Equal.equals(fromHexResult.hash, th.hash)) return false
        if (cml.to_hex() !== hex) return false

        // Equal + Hash
        if (!Equal.equals(th, decoded)) return false
        if (Hash.hash(th) !== Hash.hash(decoded)) return false

        // Schema.is + instanceof
        if (!TxHash.isTransactionHash(decoded)) return false
        if (!(decoded instanceof TxHash.TransactionHash)) return false

        // Schema.decodeEither(FromBytes)
        const result = Schema.decodeEither(TxHash.FromBytes)(th.hash)
        if (result._tag !== "Right") return false
        if (!Equal.equals(result.right.hash, th.hash)) return false

        return true
      }),
      { numRuns: 500 }
    )
  })

  it("property: rejects wrong byte lengths", () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 64 }).filter((n) => n !== 32),
        (len) => {
          try { new TxHash.TransactionHash({ hash: new Uint8Array(len) }); return false }
          catch { return true }
        }
      ),
      { numRuns: 100 }
    )
  })

  it("property: Schema.decodeEither(FromBytes) rejects wrong lengths", () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 64 }).filter((n) => n !== 32),
        (len) => Schema.decodeEither(TxHash.FromBytes)(new Uint8Array(len))._tag === "Left"
      ),
      { numRuns: 100 }
    )
  })
})
