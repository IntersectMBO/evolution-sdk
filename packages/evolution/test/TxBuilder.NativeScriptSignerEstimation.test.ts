import { describe, expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as Certificate from "../src/Certificate.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as ScriptHash from "../src/ScriptHash.js"
import * as BuilderState from "../src/sdk/builders/internal/state.js"
import { buildFakeWitnessSet } from "../src/sdk/builders/internal/txBuilder.js"
import { makeTxBuilder, type TxBuilderConfig, type TxBuilderState,TxContext } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as CoreUTxO from "../src/UTxO.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

const baseConfig = { chain: mainnet } satisfies TxBuilderConfig

const unusedNativeScript = NativeScripts.makeScriptPubKey(new Uint8Array(28).fill(0xcc))

const scriptCarrier = (hash: string, scriptRef = unusedNativeScript) =>
  new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex(hash),
    index: 0n,
    address: CoreAddress.fromBech32(CHANGE_ADDRESS),
    assets: CoreAssets.fromLovelace(20_000_000n),
    scriptRef
  })

const buildOptions = {
  changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
  availableUtxos: [
    createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })
  ],
  protocolParameters: PROTOCOL_PARAMS
}

describe("TxBuilder native script signer estimation (#596)", () => {
  it("does not count signers for an unrelated native script carried by a spent input", async () => {
    const builder = await makeTxBuilder(baseConfig)
      .collectFrom({ inputs: [scriptCarrier("b".repeat(64))] })
      .build(buildOptions)

    const fakeTx = await builder.toTransactionWithFakeWitnesses()
    expect(fakeTx.witnessSet.vkeyWitnesses?.length ?? 0).toBe(1)
  })

  it("does not count signers for an unrelated native script carried by a reference input", async () => {
    const builder = await makeTxBuilder(baseConfig)
      .readFrom({ referenceInputs: [scriptCarrier("c".repeat(64))] })
      .build(buildOptions)

    const fakeTx = await builder.toTransactionWithFakeWitnesses()
    expect(fakeTx.witnessSet.vkeyWitnesses?.length ?? 0).toBe(1)
  })

  it("counts signers for a native-script stake registration credential", async () => {
    const requiredNativeScript = NativeScripts.makeScriptPubKey(new Uint8Array(28).fill(0xdd))
    const scriptHash = ScriptHash.fromScript(requiredNativeScript)
    const state: TxBuilderState = {
      ...BuilderState.makeInitialTxBuilderState(),
      certificates: [new Certificate.StakeRegistration({ stakeCredential: scriptHash })],
      referenceInputs: [scriptCarrier("e".repeat(64), requiredNativeScript)]
    }
    const stateRef = await Effect.runPromise(Ref.make(state))
    const input = buildOptions.availableUtxos[0]!

    const fakeWitnessSet = await Effect.runPromise(
      buildFakeWitnessSet([input]).pipe(Effect.provideService(TxContext, stateRef))
    )

    // One payment-key witness for the input and one signer for the stake credential.
    expect(fakeWitnessSet.vkeyWitnesses?.length ?? 0).toBe(2)
  })
})
