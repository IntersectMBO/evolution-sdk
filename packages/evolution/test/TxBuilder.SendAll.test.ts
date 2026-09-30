import { describe, expect, it } from "@effect/vitest"

import * as Address from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import type * as CoreUTxO from "../src/UTxO.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const SOURCE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
const DESTINATION_ADDRESS =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

// Policy IDs for test tokens (56 hex chars)
const FUNGIBLE_POLICY = "a".repeat(56)
const NFT_POLICY = "c".repeat(56)

// Asset name in hex
const HOSKY_NAME_HEX = "484f534b59" // "HOSKY" in hex
const NFT_NAME_HEX = "4e4654303031" // "NFT001" in hex

const baseConfig: TxBuilderConfig = { chain: mainnet }

describe("TxBuilder SendAll", () => {
  describe("Basic SendAll Operation", () => {
    it("should send all ADA from wallet to recipient", async () => {
      const utxos: Array<CoreUTxO.UTxO> = [
        createCoreTestUtxo({
          transactionId: "a".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 200_000_000n
        }),
        createCoreTestUtxo({
          transactionId: "b".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 150_000_000n
        })
      ]
      const totalLovelace = 350_000_000n

      const signBuilder = await makeTxBuilder(baseConfig)
        .sendAll({ to: Address.fromBech32(DESTINATION_ADDRESS) })
        .build({
          changeAddress: Address.fromBech32(SOURCE_ADDRESS),
          availableUtxos: utxos,
          protocolParameters: PROTOCOL_PARAMS
        })

      const tx = await signBuilder.toTransaction()

      // Should have all UTxOs as inputs
      expect(tx.body.inputs.length).toBe(2)

      // Should have exactly one output (to recipient)
      expect(tx.body.outputs.length).toBe(1)
      expect(Address.toBech32(tx.body.outputs[0].address)).toBe(DESTINATION_ADDRESS)

      // Output should contain total ADA minus fee
      const outputLovelace = tx.body.outputs[0].assets.lovelace
      const fee = tx.body.fee
      expect(outputLovelace + fee).toBe(totalLovelace)
    })

    it("should send all assets including tokens from multi-asset wallet", async () => {
      // Unit format: policyId + assetNameHex (no separator)
      const hoskyUnit = `${FUNGIBLE_POLICY}${HOSKY_NAME_HEX}`
      const nftUnit = `${NFT_POLICY}${NFT_NAME_HEX}`

      const utxos: Array<CoreUTxO.UTxO> = [
        createCoreTestUtxo({
          transactionId: "1".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 100_000_000n,
          nativeAssets: { [hoskyUnit]: 500_000n }
        }),
        createCoreTestUtxo({
          transactionId: "2".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 50_000_000n,
          nativeAssets: { [nftUnit]: 1n }
        }),
        createCoreTestUtxo({
          transactionId: "3".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 25_000_000n
        })
      ]
      const totalLovelace = 175_000_000n

      const signBuilder = await makeTxBuilder(baseConfig)
        .sendAll({ to: Address.fromBech32(DESTINATION_ADDRESS) })
        .build({
          changeAddress: Address.fromBech32(SOURCE_ADDRESS),
          availableUtxos: utxos,
          protocolParameters: PROTOCOL_PARAMS
        })

      const tx = await signBuilder.toTransaction()

      // Should have all UTxOs as inputs
      expect(tx.body.inputs.length).toBe(3)

      // Should have exactly one output
      expect(tx.body.outputs.length).toBe(1)

      const output = tx.body.outputs[0]
      expect(Address.toBech32(output.address)).toBe(DESTINATION_ADDRESS)

      // Output should contain all tokens
      expect(CoreAssets.getByUnit(output.assets, hoskyUnit)).toBe(500_000n)
      expect(CoreAssets.getByUnit(output.assets, nftUnit)).toBe(1n)

      // Output should contain total ADA minus fee
      const outputLovelace = output.assets.lovelace
      const fee = tx.body.fee
      expect(outputLovelace + fee).toBe(totalLovelace)
    })
  })

  describe("Mutual Exclusivity Validation", () => {
    it("should fail when used with payToAddress", async () => {
      const utxos: Array<CoreUTxO.UTxO> = [
        createCoreTestUtxo({
          transactionId: "a".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 100_000_000n
        })
      ]

      await expect(
        makeTxBuilder(baseConfig)
          .payToAddress({
            address: Address.fromBech32(DESTINATION_ADDRESS),
            assets: CoreAssets.fromLovelace(1_000_000n)
          })
          .sendAll({ to: Address.fromBech32(DESTINATION_ADDRESS) })
          .build({
            changeAddress: Address.fromBech32(SOURCE_ADDRESS),
            availableUtxos: utxos,
            protocolParameters: PROTOCOL_PARAMS
          })
      ).rejects.toThrow("sendAll() cannot be used with payToAddress()")
    })

    it("should fail when used with collectFrom", async () => {
      const utxos: Array<CoreUTxO.UTxO> = [
        createCoreTestUtxo({
          transactionId: "a".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 100_000_000n
        })
      ]

      await expect(
        makeTxBuilder(baseConfig)
          .collectFrom({ inputs: [utxos[0]] })
          .sendAll({ to: Address.fromBech32(DESTINATION_ADDRESS) })
          .build({
            changeAddress: Address.fromBech32(SOURCE_ADDRESS),
            availableUtxos: utxos,
            protocolParameters: PROTOCOL_PARAMS
          })
      ).rejects.toThrow("sendAll() cannot be used with collectFrom()")
    })
  })

  describe("Insufficient Funds Handling", () => {
    it("should fail when wallet is empty", async () => {
      await expect(
        makeTxBuilder(baseConfig)
          .sendAll({ to: Address.fromBech32(DESTINATION_ADDRESS) })
          .build({
            changeAddress: Address.fromBech32(SOURCE_ADDRESS),
            availableUtxos: [],
            protocolParameters: PROTOCOL_PARAMS
          })
      ).rejects.toThrow("sendAll() failed: Wallet has no UTxOs to send.")
    })
  })

  describe("Fee Calculation", () => {
    it("should calculate fee correctly based on transaction size", async () => {
      const utxos: Array<CoreUTxO.UTxO> = [
        createCoreTestUtxo({
          transactionId: "a".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 200_000_000n
        }),
        createCoreTestUtxo({
          transactionId: "b".repeat(64),
          index: 0,
          address: SOURCE_ADDRESS,
          lovelace: 150_000_000n
        })
      ]

      const signBuilder = await makeTxBuilder(baseConfig)
        .sendAll({ to: Address.fromBech32(DESTINATION_ADDRESS) })
        .build({
          changeAddress: Address.fromBech32(SOURCE_ADDRESS),
          availableUtxos: utxos,
          protocolParameters: PROTOCOL_PARAMS
        })

      const tx = await signBuilder.toTransaction()

      // Fee is deterministic for a 2-input, 1-output transaction
      expect(tx.body.fee).toBe(166_865n)
    })
  })
})
