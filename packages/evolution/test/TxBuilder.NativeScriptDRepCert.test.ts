import { describe, expect, it } from "@effect/vitest"

import * as CoreAddress from "../src/Address.js"
import * as Data from "../src/Data.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as ScriptHash from "../src/ScriptHash.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import type { ProtocolParameters } from "../src/sdk/provider/Provider.js"
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

const baseConfig = { chain: mainnet }

const makeFundedUtxos = (lovelace: bigint): Array<CoreUTxO.UTxO> => [
  createCoreTestUtxo({
    transactionId: "a".repeat(64),
    index: 0n,
    address: CHANGE_ADDRESS,
    lovelace
  })
]

// A 2-of-3 native (multisig) script and the DRep credential it controls.
const makeMultisigDRep = () => {
  const keyHashes = [0xaa, 0xbb, 0xcc].map((b) => new Uint8Array(28).fill(b))
  const script = NativeScripts.makeScriptNOfK(
    2n,
    keyHashes.map((kh) => NativeScripts.makeScriptPubKey(kh).script)
  )
  const scriptHash = ScriptHash.fromScript(script)
  return { script, scriptHash, drepCredential: scriptHash }
}

describe("TxBuilder NativeScript DRep certificate (native-script DRep credential)", () => {
  it("registers a native-script DRep with no redeemer", async () => {
    const { drepCredential, script } = makeMultisigDRep()

    const signBuilder = await makeTxBuilder(baseConfig)
      .registerDRep({ drepCredential })
      .attachScript({ script })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: makeFundedUtxos(503_000_000n),
        fullProtocolParameters: FULL_PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()

    expect(tx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)
    expect(tx.witnessSet.redeemers).toBeUndefined()
    expect(tx.body.scriptDataHash).toBeUndefined()
    expect(tx.body.certificates?.length ?? 0).toBeGreaterThan(0)
  })

  it("classifies the native DRep when .attachScript() is called before .registerDRep() (order-independent)", async () => {
    const { drepCredential, script } = makeMultisigDRep()

    const signBuilder = await makeTxBuilder(baseConfig)
      .attachScript({ script })
      .registerDRep({ drepCredential })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: makeFundedUtxos(503_000_000n),
        fullProtocolParameters: FULL_PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)
    expect(tx.witnessSet.redeemers).toBeUndefined()
  })

  it("ignores a redeemer supplied for a native-script DRep registration (no redeemer emitted)", async () => {
    const { drepCredential, script } = makeMultisigDRep()

    const signBuilder = await makeTxBuilder(baseConfig)
      .registerDRep({
        drepCredential,
        redeemer: new Data.Constr({ index: 0n, fields: [] })
      })
      .attachScript({ script })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: makeFundedUtxos(503_000_000n),
        fullProtocolParameters: FULL_PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)
    expect(tx.witnessSet.redeemers).toBeUndefined()
    expect(tx.body.scriptDataHash).toBeUndefined()
  })

  it("deregisters a native-script DRep with no redeemer", async () => {
    const { drepCredential, script } = makeMultisigDRep()

    const signBuilder = await makeTxBuilder(baseConfig)
      .deregisterDRep({ drepCredential })
      .attachScript({ script })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: makeFundedUtxos(2_000_000n),
        fullProtocolParameters: FULL_PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)
    expect(tx.witnessSet.redeemers).toBeUndefined()
  })

  it("still rejects a Plutus-script DRep registration when no redeemer is provided", async () => {
    const drepCredential = ScriptHash.fromHex("11".repeat(28))

    await expect(
      makeTxBuilder(baseConfig)
        .registerDRep({ drepCredential })
        .build({
          changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
          availableUtxos: makeFundedUtxos(503_000_000n),
          fullProtocolParameters: FULL_PROTOCOL_PARAMS
        })
    ).rejects.toThrow(/[Rr]edeemer required/)
  })
})
