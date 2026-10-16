import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import * as CoreAddress from "../src/Address.js"
import * as Bytes from "../src/Bytes.js"
import * as Data from "../src/Data.js"
import * as PlutusV3 from "../src/PlutusV3.js"
import * as Redeemer from "../src/Redeemer.js"
import * as ScriptHash from "../src/ScriptHash.js"
import type { Evaluator } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import type { ProtocolParameters } from "../src/sdk/provider/Provider.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import plutusJson from "./spec/plutus.json"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

// A redeemer index of 24 or more takes one more CBOR byte than an index under
// 24. The fee must cover the transaction as it is written, with those indices.

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

const PROTOCOL_PARAMS = {
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

const EX_UNITS = { mem: 9_751n, steps: 2_836_913n }

const evaluator: Evaluator = {
  evaluate: (tx) =>
    Effect.sync(() =>
      (tx.witnessSet.redeemers?.toArray() ?? []).map((r) => ({
        redeemer_tag: r.tag,
        redeemer_index: Number(r.index),
        ex_units: new Redeemer.ExUnits(EX_UNITS)
      }))
    )
}

const script = new PlutusV3.PlutusV3({
  bytes: Bytes.fromHex(plutusJson.validators.find((v) => v.title === "always_succeed.always_succeed.spend")!.compiledCode)
})
const scriptAddress = CoreAddress.toBech32(
  new CoreAddress.Address({ networkId: 0, paymentCredential: ScriptHash.fromScript(script) })
)

// The ledger's minimum fee: the size without the trailing validity flag, and
// the script fee rounded up once over the summed ExUnits (priceMem 577/10000,
// priceStep 721/10000000)
const ledgerMinFee = (tx: Transaction.Transaction): bigint => {
  const size = BigInt(Transaction.toCBORBytes(tx).length - 1)
  const redeemers = tx.witnessSet.redeemers?.toArray() ?? []
  const mem = redeemers.reduce((sum, r) => sum + r.exUnits.mem, 0n)
  const steps = redeemers.reduce((sum, r) => sum + r.exUnits.steps, 0n)
  const numerator = mem * 577n * 1_000n + steps * 721n
  const scriptFee = (numerator + 10_000_000n - 1n) / 10_000_000n
  return 44n * size + 155_381n + scriptFee
}

const buildSpend = async (walletInputCount: number, scriptInputCount: number) => {
  // Wallet inputs sort first (transaction ids 01.., 02.., ...), script inputs
  // after them (f0.., f1..), and the UTxOs left for coin selection last (fe..)
  const walletUtxos = Array.from({ length: walletInputCount }, (_, i) =>
    createCoreTestUtxo({
      transactionId: (i + 1).toString(16).padStart(2, "0").repeat(32),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 2_000_000n
    })
  )
  const scriptUtxos = Array.from({ length: scriptInputCount }, (_, i) =>
    createCoreTestUtxo({
      transactionId: (0xf0 + i).toString(16).repeat(32),
      index: 0n,
      address: scriptAddress,
      lovelace: 10_000_000n
    })
  )

  const signBuilder = await makeTxBuilder({ chain: mainnet })
    .collectFrom({ inputs: walletUtxos })
    .collectFrom({ inputs: scriptUtxos, redeemer: Data.constr(0n, []) })
    .attachScript({ script })
    .build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [
        createCoreTestUtxo({ transactionId: "fe".repeat(32), index: 0n, address: CHANGE_ADDRESS, lovelace: 100_000_000n })
      ],
      fullProtocolParameters: PROTOCOL_PARAMS,
      evaluator
    })

  const tx = await signBuilder.toTransaction()
  const withFakeWitnesses = await signBuilder.toTransactionWithFakeWitnesses()
  // The transaction as it is submitted: its own witness set plus one vkey
  // witness per signer, each the size of a real one
  const signed = new Transaction.Transaction({
    body: tx.body,
    witnessSet: new TransactionWitnessSet.TransactionWitnessSet({
      ...tx.witnessSet,
      vkeyWitnesses: withFakeWitnesses.witnessSet.vkeyWitnesses
    }),
    isValid: tx.isValid,
    auxiliaryData: tx.auxiliaryData
  })
  return { tx, withFakeWitnesses, signed }
}

const indices = (tx: Transaction.Transaction) => (tx.witnessSet.redeemers?.toArray() ?? []).map((r) => r.index)

describe("TxBuilder fee with redeemer indices of 24 or more", () => {
  it("pays the minimum fee for two spend redeemers at indices 24 and 25", async () => {
    const { signed, tx } = await buildSpend(24, 2)

    expect(indices(tx)).toEqual([24n, 25n])
    expect(tx.body.fee).toBeGreaterThanOrEqual(ledgerMinFee(signed))
  })

  it("sizes the fee estimate with the indices the transaction is written with", async () => {
    const { tx, withFakeWitnesses } = await buildSpend(25, 1)

    expect(indices(tx)).toEqual([25n])
    expect(indices(withFakeWitnesses)).toEqual(indices(tx))
  })

  it("keeps the fee of a spend whose redeemer index is under 24", async () => {
    const { signed, tx } = await buildSpend(5, 1)

    expect(indices(tx)).toEqual([5n])
    expect(tx.body.fee).toBeGreaterThanOrEqual(ledgerMinFee(signed))
  })
})
