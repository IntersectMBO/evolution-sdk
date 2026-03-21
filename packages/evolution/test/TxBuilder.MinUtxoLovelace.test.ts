import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as Address from "../src/Address.js"
import * as CoreAssets from "../src/Assets/index.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import { calculateMinimumUtxoLovelace } from "../src/sdk/builders/TxBuilderImpl.js"

const TEST_ADDRESS = Address.fromBech32(
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"
)

// Mainnet coinsPerUtxoByte as of Babbage/Conway
const COINS_PER_UTXO_BYTE = 4310n

// Create a PlutusV3 script of ~400 bytes (realistic minting policy)
const LARGE_SCRIPT_BYTES = new Uint8Array(400).fill(0xab)
const PLUTUS_V3_SCRIPT = new PlutusV3.PlutusV3({ bytes: LARGE_SCRIPT_BYTES })

describe.concurrent("calculateMinimumUtxoLovelace", () => {
  it("includes 160-byte UTxO entry overhead in calculation", async () => {
    // ADA-only output: small CBOR size, so the 160-byte overhead is a significant portion
    const result = await Effect.runPromise(
      calculateMinimumUtxoLovelace({
        address: TEST_ADDRESS,
        assets: CoreAssets.fromLovelace(0n),
        coinsPerUtxoByte: 1n // Use 1n to get raw byte count
      })
    )

    // With coinsPerUtxoByte=1, result = 160 + cborSize
    // An ADA-only output is 62 CBOR bytes, so result = 160 + 62 = 222
    // Without the 160-byte overhead, it would be < 100
    expect(result).toBe(222n)
  })

  it("produces stable results regardless of input lovelace", async () => {
    // With 0 lovelace
    const resultZero = await Effect.runPromise(
      calculateMinimumUtxoLovelace({
        address: TEST_ADDRESS,
        assets: CoreAssets.fromLovelace(0n),
        coinsPerUtxoByte: COINS_PER_UTXO_BYTE
      })
    )

    // With 2 ADA lovelace
    const resultWithAda = await Effect.runPromise(
      calculateMinimumUtxoLovelace({
        address: TEST_ADDRESS,
        assets: CoreAssets.fromLovelace(2_000_000n),
        coinsPerUtxoByte: COINS_PER_UTXO_BYTE
      })
    )

    // Both should produce the same result since the placeholder stabilizes CBOR size
    expect(resultZero).toBe(resultWithAda)
  })

  it("returns sufficient lovelace for scriptRef outputs", async () => {
    const result = await Effect.runPromise(
      calculateMinimumUtxoLovelace({
        address: TEST_ADDRESS,
        assets: CoreAssets.fromLovelace(0n),
        scriptRef: PLUTUS_V3_SCRIPT,
        coinsPerUtxoByte: COINS_PER_UTXO_BYTE
      })
    )

    // A ~400 byte script + address CBOR + 160 overhead
    // Exact: (160 + ~478) * 4310 = 2,749,780
    expect(result).toBe(2_749_780n)

    // The result must be self-consistent: the output with this lovelace
    // should use no more CBOR bytes than estimated
    const verification = await Effect.runPromise(
      calculateMinimumUtxoLovelace({
        address: TEST_ADDRESS,
        assets: CoreAssets.fromLovelace(result),
        scriptRef: PLUTUS_V3_SCRIPT,
        coinsPerUtxoByte: COINS_PER_UTXO_BYTE
      })
    )

    // Plugging the result back should give the same value (fixed-point)
    expect(result).toBe(verification)
  })

  it("uses fixed-point minUTxO and avoids under-estimation from raw-size scaling", async () => {
    // Use coinsPerUtxoByte=1 to get a raw fixed-point byte count baseline
    const rawSize = await Effect.runPromise(
      calculateMinimumUtxoLovelace({
        address: TEST_ADDRESS,
        assets: CoreAssets.fromLovelace(0n),
        scriptRef: PLUTUS_V3_SCRIPT,
        coinsPerUtxoByte: 1n
      })
    )

    const actualMinLovelace = await Effect.runPromise(
      calculateMinimumUtxoLovelace({
        address: TEST_ADDRESS,
        assets: CoreAssets.fromLovelace(0n),
        scriptRef: PLUTUS_V3_SCRIPT,
        coinsPerUtxoByte: COINS_PER_UTXO_BYTE
      })
    )

    // Fixed-point result must equal exact computed values
    expect(rawSize).toBe(636n)
    expect(actualMinLovelace).toBe(2_749_780n)
  })
})
