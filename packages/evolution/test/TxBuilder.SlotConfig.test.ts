import { describe, expect, it } from "vitest"

import * as Address from "../src/Address.js"
import * as CoreAssets from "../src/Assets/index.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import * as Time from "../src/Time/index.js"
import { SLOT_CONFIG_NETWORK } from "../src/Time/SlotConfig.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const CHANGE_ADDRESS_BECH32 =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
const RECEIVER_ADDRESS_BECH32 =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

const CHANGE_ADDRESS = Address.fromBech32(CHANGE_ADDRESS_BECH32)
const RECEIVER_ADDRESS = Address.fromBech32(RECEIVER_ADDRESS_BECH32)

const utxos = [
  createCoreTestUtxo({ transactionId: "a".repeat(64), index: 0n, address: CHANGE_ADDRESS_BECH32, lovelace: 50_000_000n })
]

// A fixed timestamp for deterministic slot computation
const FIXED_TIME = 1710300000000n // March 13, 2024

describe("TxBuilder slot config resolution", () => {
  it("uses Preview slot config when network is Preview", async () => {
    const builder = makeTxBuilder({ network: "Preview" })

    const result = await builder
      .payToAddress({ address: RECEIVER_ADDRESS, assets: CoreAssets.fromLovelace(2_000_000n) })
      .setValidity({ from: FIXED_TIME, to: FIXED_TIME + 300_000n })
      .build({
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await result.toTransaction()
    const expectedStart = Time.unixTimeToSlot(FIXED_TIME, SLOT_CONFIG_NETWORK.Preview)
    const expectedTTL = Time.unixTimeToSlot(FIXED_TIME + 300_000n, SLOT_CONFIG_NETWORK.Preview)

    expect(tx.body.validityIntervalStart).toBe(expectedStart)
    expect(tx.body.ttl).toBe(expectedTTL)
  })

  it("uses Preprod slot config when network is Preprod", async () => {
    const builder = makeTxBuilder({ network: "Preprod" })

    const result = await builder
      .payToAddress({ address: RECEIVER_ADDRESS, assets: CoreAssets.fromLovelace(2_000_000n) })
      .setValidity({ from: FIXED_TIME, to: FIXED_TIME + 300_000n })
      .build({
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await result.toTransaction()
    const expectedStart = Time.unixTimeToSlot(FIXED_TIME, SLOT_CONFIG_NETWORK.Preprod)
    const expectedTTL = Time.unixTimeToSlot(FIXED_TIME + 300_000n, SLOT_CONFIG_NETWORK.Preprod)

    expect(tx.body.validityIntervalStart).toBe(expectedStart)
    expect(tx.body.ttl).toBe(expectedTTL)
  })

  it("uses Mainnet slot config when network is Mainnet", async () => {
    const builder = makeTxBuilder({ network: "Mainnet" })

    const result = await builder
      .payToAddress({ address: RECEIVER_ADDRESS, assets: CoreAssets.fromLovelace(2_000_000n) })
      .setValidity({ from: FIXED_TIME, to: FIXED_TIME + 300_000n })
      .build({
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await result.toTransaction()
    const expectedStart = Time.unixTimeToSlot(FIXED_TIME, SLOT_CONFIG_NETWORK.Mainnet)
    const expectedTTL = Time.unixTimeToSlot(FIXED_TIME + 300_000n, SLOT_CONFIG_NETWORK.Mainnet)

    expect(tx.body.validityIntervalStart).toBe(expectedStart)
    expect(tx.body.ttl).toBe(expectedTTL)
  })

  it("defaults to Mainnet when network is unset", async () => {
    const builder = makeTxBuilder({})

    const result = await builder
      .payToAddress({ address: RECEIVER_ADDRESS, assets: CoreAssets.fromLovelace(2_000_000n) })
      .setValidity({ from: FIXED_TIME, to: FIXED_TIME + 300_000n })
      .build({
        changeAddress: CHANGE_ADDRESS,
        availableUtxos: utxos,
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await result.toTransaction()
    const expectedStart = Time.unixTimeToSlot(FIXED_TIME, SLOT_CONFIG_NETWORK.Mainnet)
    expect(tx.body.validityIntervalStart).toBe(expectedStart)
  })

  it("Preview and Mainnet produce different slots for the same timestamp", () => {
    const previewSlot = Time.unixTimeToSlot(FIXED_TIME, SLOT_CONFIG_NETWORK.Preview)
    const mainnetSlot = Time.unixTimeToSlot(FIXED_TIME, SLOT_CONFIG_NETWORK.Mainnet)

    // These must differ — if they were equal, the bug would be invisible
    expect(previewSlot).not.toBe(mainnetSlot)
    // Preview zeroTime is later than Mainnet, so Preview slot should be smaller
    expect(previewSlot).toBeLessThan(mainnetSlot)
  })
})
