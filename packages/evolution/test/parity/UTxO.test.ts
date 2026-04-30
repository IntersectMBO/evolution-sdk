import * as CML from "@dcspark/cardano-multiplatform-lib-nodejs"
import { describe, it } from "@effect/vitest"
import { FastCheck } from "effect"

import * as Address from "../../src/Address.js"
import * as Assets from "../../src/Assets.js"
import * as TransactionHash from "../../src/TransactionHash.js"
import * as UTxO from "../../src/UTxO.js"
import { CborReader } from "../../src/v2/CborReader.js"
import * as Equal from "../../src/v2/Equal.js"

/**
 * Arbitrary UTxO generator — ADA-only, no datum/scriptRef.
 * Keeps it simple so CML comparison is straightforward.
 */
const utxoArbitrary = FastCheck.record({
  transactionId: TransactionHash.arbitrary,
  index: FastCheck.integer({ min: 0, max: 65535 }),
  address: Address.arbitrary,
  lovelace: FastCheck.bigInt({ min: 1_000_000n, max: 100_000_000_000n })
}).map(({ address, index, lovelace, transactionId }) =>
  new UTxO.UTxO({
    transactionId,
    index: BigInt(index),
    address,
    assets: new Assets.Assets({ lovelace }, { disableValidation: true })
  })
)

describe("UTxO.toMapCBORBytes", () => {
  it("property: produces valid CBOR map decodable by CborReader", () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.array(utxoArbitrary, { minLength: 0, maxLength: 5 }),
        (utxos) => {
          const bytes = UTxO.toMapCBORBytes(utxos)
          const r = new CborReader(bytes)

          // Should decode as a map with correct entry count
          const count = r.readMapHeader()
          if (count !== utxos.length) return false

          // Each entry should have a 2-element array key (TransactionInput)
          // and a valid TransactionOutput value
          for (let i = 0; i < count; i++) {
            // TransactionInput = [hash, index]
            const inputLen = r.readArrayHeader()
            if (inputLen !== 2) return false
            const hash = r.readBytes()
            if (hash.length !== 32) return false
            r.readUint() // index

            // TransactionOutput = [address, amount] or [address, amount, ...]
            const outputLen = r.readArrayHeader()
            if (outputLen < 2) return false
            // skip remaining output fields
            for (let j = 0; j < outputLen; j++) {
              r.skip()
            }
          }

          return true
        }
      ),
      { numRuns: 200 }
    )
  })

  it("property: CML can decode every entry in the map", () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.array(utxoArbitrary, { minLength: 1, maxLength: 3 }),
        (utxos) => {
          const bytes = UTxO.toMapCBORBytes(utxos)
          const r = new CborReader(bytes)
          const count = r.readMapHeader()

          for (let i = 0; i < count; i++) {
            // Read raw CBOR for TransactionInput
            const inputStart = r.offset
            r.skip()
            const inputBytes = bytes.slice(inputStart, r.offset)

            // CML should parse it
            const cmlInput = CML.TransactionInput.from_cbor_bytes(inputBytes)
            const expectedHash = utxos[i]!.transactionId.hash
            if (!Equal.equals(cmlInput.transaction_id().to_raw_bytes(), expectedHash)) return false
            if (BigInt(cmlInput.index()) !== utxos[i]!.index) return false

            // Read raw CBOR for TransactionOutput
            const outputStart = r.offset
            r.skip()
            const outputBytes = bytes.slice(outputStart, r.offset)

            // CML should parse it
            const cmlOutput = CML.TransactionOutput.from_cbor_bytes(outputBytes)
            if (cmlOutput.amount().coin() !== utxos[i]!.assets.lovelace) return false
          }

          return true
        }
      ),
      { numRuns: 200 }
    )
  })

  it("empty UTxO list produces empty CBOR map", () => {
    const bytes = UTxO.toMapCBORBytes([])
    const r = new CborReader(bytes)
    const count = r.readMapHeader()
    if (count !== 0) throw new Error(`expected 0 entries, got ${count}`)
    // Should be exactly 1 byte: 0xa0 (empty definite map)
    if (bytes.length !== 1 || bytes[0] !== 0xa0) {
      throw new Error(`expected 0xa0, got ${Array.from(bytes).map(b => b.toString(16)).join(" ")}`)
    }
  })
})
