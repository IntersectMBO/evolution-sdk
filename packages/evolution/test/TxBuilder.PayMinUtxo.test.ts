import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as Address from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import { calculateMinimumUtxoLovelace } from "../src/sdk/builders/internal/txBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"
const RECEIVER_ADDRESS =
  "addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7"

const expectedMinLovelace = (assets: CoreAssets.Assets) =>
  Effect.runPromise(
    calculateMinimumUtxoLovelace({
      address: Address.fromBech32(RECEIVER_ADDRESS),
      assets,
      coinsPerUtxoByte: PROTOCOL_PARAMS.coinsPerUtxoByte
    })
  )

const buildAndGetFirstOutput = async (
  receiverAssets: CoreAssets.Assets,
  walletLovelace = 10_000_000n,
  walletNativeAssets?: Record<string, bigint>
) => {
  const signBuilder = await makeTxBuilder({ chain: mainnet })
    .payToAddress({
      address: Address.fromBech32(RECEIVER_ADDRESS),
      assets: receiverAssets
    })
    .build({
      changeAddress: Address.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [
        createCoreTestUtxo({
          transactionId: "a".repeat(64),
          index: 0n,
          address: CHANGE_ADDRESS,
          lovelace: walletLovelace,
          nativeAssets: walletNativeAssets
        })
      ],
      protocolParameters: PROTOCOL_PARAMS
    })

  const tx = await signBuilder.toTransaction()
  return tx.body.outputs[0]
}

describe("TxBuilder – payToAddress auto min-ADA enforcement", () => {
  it("bumps zero lovelace up to the protocol minimum", async () => {
    const requested = CoreAssets.fromLovelace(0n)
    const minLovelace = await expectedMinLovelace(requested)

    const output = await buildAndGetFirstOutput(requested)

    expect(output.assets.lovelace).toBe(minLovelace)
    expect(minLovelace).toBeGreaterThan(0n)
  })

  it("bumps sub-minimum lovelace up to the protocol minimum", async () => {
    const requested = CoreAssets.fromLovelace(100n)
    const minLovelace = await expectedMinLovelace(requested)

    const output = await buildAndGetFirstOutput(requested)

    expect(output.assets.lovelace).toBe(minLovelace)
    expect(output.assets.lovelace).toBeGreaterThan(100n)
  })

  it("leaves sufficient lovelace unchanged", async () => {
    const SUFFICIENT = 2_000_000n
    const requested = CoreAssets.fromLovelace(SUFFICIENT)
    const minLovelace = await expectedMinLovelace(requested)
    expect(SUFFICIENT).toBeGreaterThanOrEqual(minLovelace)

    const output = await buildAndGetFirstOutput(requested)

    expect(output.assets.lovelace).toBe(SUFFICIENT)
  })

  it("leaves generous lovelace unchanged", async () => {
    const output = await buildAndGetFirstOutput(CoreAssets.fromLovelace(5_000_000n))

    expect(output.assets.lovelace).toBe(5_000_000n)
  })

  it("bumps native-token output with zero lovelace to the token-aware minimum", async () => {
    const POLICY_HEX = "aa".repeat(28)
    const ASSET_NAME_HEX = "546f6b656e41"
    const TOKEN_UNIT = `${POLICY_HEX}${ASSET_NAME_HEX}`

    const requestedAssets = CoreAssets.fromHexStrings(POLICY_HEX, ASSET_NAME_HEX, 500n, 0n)
    const minLovelace = await expectedMinLovelace(requestedAssets)
    const adaOnlyMin = await expectedMinLovelace(CoreAssets.fromLovelace(0n))

    const output = await buildAndGetFirstOutput(requestedAssets, 10_000_000n, {
      [TOKEN_UNIT]: 1_000n
    })

    expect(output.assets.lovelace).toBe(minLovelace)
    expect(minLovelace).toBeGreaterThan(adaOnlyMin)
  })
})
