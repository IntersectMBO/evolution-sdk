import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as Address from "../src/Address.js"
import * as Credential from "../src/Credential.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import type { ProtocolParameters, Provider } from "../src/sdk/provider/Provider.js"
import type * as CoreUTxO from "../src/UTxO.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

const FULL_PROTOCOL_PARAMS = {
  minFeeA: 44,
  minFeeB: 155_381,
  maxTxSize: 16_384,
  maxValSize: 5_000,
  keyDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  govActionDeposit: 100_000_000_000n,
  priceMem: 0.0577,
  priceStep: 0.0000721,
  maxTxExMem: 14_000_000n,
  maxTxExSteps: 10_000_000_000n,
  coinsPerUtxoByte: 4_310n,
  collateralPercentage: 150,
  maxCollateralInputs: 3,
  minFeeRefScriptCostPerByte: 15,
  costModels: {
    PlutusV1: {} as Record<string, number>,
    PlutusV2: {} as Record<string, number>,
    PlutusV3: {} as Record<string, number>
  }
} satisfies ProtocolParameters

const PROTOCOL_PARAMS_FOR_FEE = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const makeStakeCredential = () => Credential.makeKeyHash(new Uint8Array(28).fill(0xab))
const makeDRepCredential = () => Credential.makeKeyHash(new Uint8Array(28).fill(0xcd))

const makeFundedUtxos = (lovelace: bigint): Array<CoreUTxO.UTxO> => [
  createCoreTestUtxo({
    transactionId: "a".repeat(64),
    index: 0n,
    address: CHANGE_ADDRESS,
    lovelace
  })
]

const makeSpyProvider = () => {
  let callCount = 0

  const notImpl = (name: string) => () => {
    throw new Error(`SpyProvider.${name}: not implemented`)
  }

  const effect = {
    getProtocolParameters: () => {
      callCount++
      return Effect.succeed(FULL_PROTOCOL_PARAMS)
    },
    getUtxos: notImpl("getUtxos"),
    getUtxosWithUnit: notImpl("getUtxosWithUnit"),
    getUtxoByUnit: notImpl("getUtxoByUnit"),
    getUtxosByOutRef: notImpl("getUtxosByOutRef"),
    getDelegation: notImpl("getDelegation"),
    getDatum: notImpl("getDatum"),
    awaitTx: notImpl("awaitTx"),
    submitTx: notImpl("submitTx"),
    evaluateTx: notImpl("evaluateTx")
  }

  const provider = { effect } as unknown as Provider

  return { provider, getCallCount: () => callCount }
}

const baseConfig = { chain: mainnet }

describe("fullProtocolParameters override — registerStake", () => {
  it("succeeds without a provider when fullProtocolParameters is supplied", async () => {
    const utxos = makeFundedUtxos(5_000_000n) // covers keyDeposit(2M) + fee

    await expect(
      makeTxBuilder(baseConfig)
        .registerStake({ stakeCredential: makeStakeCredential() })
        .build({
          changeAddress: Address.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          fullProtocolParameters: FULL_PROTOCOL_PARAMS
        })
    ).resolves.toBeDefined()
  })

  it("does not call provider.getProtocolParameters when fullProtocolParameters is supplied", async () => {
    const spy = makeSpyProvider()
    const utxos = makeFundedUtxos(5_000_000n)

    await makeTxBuilder({ chain: mainnet, provider: spy.provider })
      .registerStake({ stakeCredential: makeStakeCredential() })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        fullProtocolParameters: FULL_PROTOCOL_PARAMS
      })

    expect(spy.getCallCount()).toBe(0)
  })

  it("calls provider.getProtocolParameters when fullProtocolParameters is absent", async () => {
    const spy = makeSpyProvider()
    const utxos = makeFundedUtxos(5_000_000n)

    await makeTxBuilder({ chain: mainnet, provider: spy.provider })
      .registerStake({ stakeCredential: makeStakeCredential() })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos
        // fullProtocolParameters deliberately omitted
      })

    expect(spy.getCallCount()).toBeGreaterThan(0)
  })

  it("fails with a descriptive error when fullProtocolParameters absent and no provider", async () => {
    const utxos = makeFundedUtxos(5_000_000n)

    await expect(
      makeTxBuilder(baseConfig)
        .registerStake({ stakeCredential: makeStakeCredential() })
        .build({
          changeAddress: Address.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          protocolParameters: PROTOCOL_PARAMS_FOR_FEE
        })
    ).rejects.toThrow(/Provider required to fetch protocol parameters for stake registration/)
  })
})

describe("fullProtocolParameters override — deregisterStake", () => {
  it("succeeds without a provider when fullProtocolParameters is supplied", async () => {
    const utxos = makeFundedUtxos(2_000_000n) // only fee needed; deposit is refunded

    await expect(
      makeTxBuilder(baseConfig)
        .deregisterStake({ stakeCredential: makeStakeCredential() })
        .build({
          changeAddress: Address.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          fullProtocolParameters: FULL_PROTOCOL_PARAMS
        })
    ).resolves.toBeDefined()
  })

  it("does not call provider.getProtocolParameters when fullProtocolParameters is supplied", async () => {
    const spy = makeSpyProvider()
    const utxos = makeFundedUtxos(2_000_000n)

    await makeTxBuilder({ chain: mainnet, provider: spy.provider })
      .deregisterStake({ stakeCredential: makeStakeCredential() })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        fullProtocolParameters: FULL_PROTOCOL_PARAMS
      })

    expect(spy.getCallCount()).toBe(0)
  })

  it("fails with a descriptive error when fullProtocolParameters absent and no provider", async () => {
    const utxos = makeFundedUtxos(2_000_000n)

    await expect(
      makeTxBuilder(baseConfig)
        .deregisterStake({ stakeCredential: makeStakeCredential() })
        .build({
          changeAddress: Address.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          protocolParameters: PROTOCOL_PARAMS_FOR_FEE
        })
    ).rejects.toThrow(/Provider required to fetch protocol parameters for stake deregistration/)
  })
})

describe("fullProtocolParameters override — registerDRep", () => {
  it("succeeds without a provider when fullProtocolParameters is supplied", async () => {
    const utxos = makeFundedUtxos(503_000_000n) // drepDeposit(500M) + fee

    await expect(
      makeTxBuilder(baseConfig)
        .registerDRep({ drepCredential: makeDRepCredential() })
        .build({
          changeAddress: Address.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          fullProtocolParameters: FULL_PROTOCOL_PARAMS
        })
    ).resolves.toBeDefined()
  })

  it("does not call provider.getProtocolParameters when fullProtocolParameters is supplied", async () => {
    const spy = makeSpyProvider()
    const utxos = makeFundedUtxos(503_000_000n)

    await makeTxBuilder({ chain: mainnet, provider: spy.provider })
      .registerDRep({ drepCredential: makeDRepCredential() })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        fullProtocolParameters: FULL_PROTOCOL_PARAMS
      })

    expect(spy.getCallCount()).toBe(0)
  })

  it("calls provider.getProtocolParameters when fullProtocolParameters is absent", async () => {
    const spy = makeSpyProvider()
    const utxos = makeFundedUtxos(503_000_000n)

    await makeTxBuilder({ chain: mainnet, provider: spy.provider })
      .registerDRep({ drepCredential: makeDRepCredential() })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos
        // fullProtocolParameters deliberately omitted
      })

    expect(spy.getCallCount()).toBeGreaterThan(0)
  })

  it("fails with a descriptive error when fullProtocolParameters absent and no provider", async () => {
    const utxos = makeFundedUtxos(503_000_000n)

    await expect(
      makeTxBuilder(baseConfig)
        .registerDRep({ drepCredential: makeDRepCredential() })
        .build({
          changeAddress: Address.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          protocolParameters: PROTOCOL_PARAMS_FOR_FEE
        })
    ).rejects.toThrow(/Provider required to fetch protocol parameters for DRep registration/)
  })
})

describe("fullProtocolParameters override — deregisterDRep", () => {
  it("succeeds without a provider when fullProtocolParameters is supplied", async () => {
    const utxos = makeFundedUtxos(2_000_000n) // only fee needed; deposit is refunded

    await expect(
      makeTxBuilder(baseConfig)
        .deregisterDRep({ drepCredential: makeDRepCredential() })
        .build({
          changeAddress: Address.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          fullProtocolParameters: FULL_PROTOCOL_PARAMS
        })
    ).resolves.toBeDefined()
  })

  it("does not call provider.getProtocolParameters when fullProtocolParameters is supplied", async () => {
    const spy = makeSpyProvider()
    const utxos = makeFundedUtxos(2_000_000n)

    await makeTxBuilder({ chain: mainnet, provider: spy.provider })
      .deregisterDRep({ drepCredential: makeDRepCredential() })
      .build({
        changeAddress: Address.fromBech32(CHANGE_ADDRESS),
        availableUtxos: utxos,
        fullProtocolParameters: FULL_PROTOCOL_PARAMS
      })

    expect(spy.getCallCount()).toBe(0)
  })

  it("fails with a descriptive error when fullProtocolParameters absent and no provider", async () => {
    const utxos = makeFundedUtxos(2_000_000n)

    await expect(
      makeTxBuilder(baseConfig)
        .deregisterDRep({ drepCredential: makeDRepCredential() })
        .build({
          changeAddress: Address.fromBech32(CHANGE_ADDRESS),
          availableUtxos: utxos,
          protocolParameters: PROTOCOL_PARAMS_FOR_FEE
        })
    ).rejects.toThrow(/Provider required to fetch protocol parameters for DRep deregistration/)
  })
})
