import { beforeAll, expect, it } from "vitest"

import * as Address from "../../src/Address.js"
import * as Assets from "../../src/Assets/index.js"
import * as AssetsUnit from "../../src/Assets/Unit.js"
import * as PoolKeyHash from "../../src/PoolKeyHash.js"
import { type Provider } from "../../src/sdk/provider/Provider.js"
import * as Transaction from "../../src/Transaction.js"
import * as TransactionHash from "../../src/TransactionHash.js"
import {
  PREPROD_SCRIPT_ADDRESS_BECH32,
  PREPROD_UNIT,
  preprodAddress,
  preprodDatumHash,
  preprodOutRef,
  preprodScriptAddress,
  preprodStakeAddress,
  preprodTxHash,
  previewTxHash,
} from "./fixtures/constants.js"
import { evalSample1, evalSample2, evalSample3, evalSample4 } from "./fixtures/evaluateTx.js"

/**
 * Registers conformance `it()` tests for the Provider interface.
 *
 * Must be called inside a `describe` block — the caller owns the describe
 * and controls whether tests run (`describe.skip` / `describe.skipIf`).
 *
 * Each test calls a Provider method against the live preprod network.
 * Schema validation inside the provider guarantees type correctness —
 * assertions here focus on sanity (non-empty, positive, expected shape).
 */
export function registerConformanceTests(factory: () => Provider) {
  let provider: Provider
  beforeAll(() => {
    provider = factory()
  })

  it("getProtocolParameters", async () => {
    const pp = await provider.getProtocolParameters()
    expect(pp.maxTxSize).toBeGreaterThan(0)
    expect(pp.costModels.PlutusV1).toBeDefined()
    expect(pp.costModels.PlutusV2).toBeDefined()
  })

  it("getUtxos", async () => {
    const utxos = await provider.getUtxos(preprodAddress())
    expect(utxos).toBeInstanceOf(Array)
    expect(utxos.length).toBeGreaterThan(0)
  })

  it("getUtxosWithUnit", async () => {
    const utxos = await provider.getUtxosWithUnit(preprodScriptAddress(), PREPROD_UNIT)
    expect(utxos).toBeInstanceOf(Array)
    expect(utxos.length).toBeGreaterThan(0)
  })

  it("getUtxoByUnit", async () => {
    const utxo = await provider.getUtxoByUnit(PREPROD_UNIT)
    expect(utxo).toBeDefined()
    expect(utxo.assets).toBeDefined()
    // Must be at the known script address
    expect(Address.toBech32(utxo.address)).toBe(PREPROD_SCRIPT_ADDRESS_BECH32)
    // Must carry exactly 1 of the NFT unit
    const { assetName, policyId } = AssetsUnit.fromUnit(PREPROD_UNIT)
    expect(Assets.quantityOf(utxo.assets, policyId, assetName!)).toBe(1n)
    // The oracle UTxO always carries a datum — verifies providers populate datumOption correctly
    expect(utxo.datumOption).toBeDefined()
  })

  it("getUtxosByOutRef", async () => {
    const outRef = preprodOutRef()
    const utxos = await provider.getUtxosByOutRef([outRef])
    expect(utxos).toBeInstanceOf(Array)
    expect(utxos.length).toBeGreaterThan(0)
    // Must include a UTxO matching the requested outRef exactly
    const match = utxos.find(
      (u) =>
        TransactionHash.toHex(u.transactionId) === TransactionHash.toHex(outRef.transactionId) &&
        u.index === outRef.index
    )
    expect(match).toBeDefined()
  })

  it("getDelegation", async () => {
    const delegation = await provider.getDelegation(preprodStakeAddress())
    expect(delegation).toHaveProperty("poolId")
    expect(delegation).toHaveProperty("rewards")
    // Known stable preprod delegation — this address is always delegated to this pool
    expect(delegation.poolId && PoolKeyHash.toBech32(delegation.poolId)).toBe(
      "pool1mp96jpc2dtaruz0cazmljh03dev0969c4rq3wr6hnc4rjdxn8aw"
    )
    expect(delegation.rewards).toBeGreaterThan(0n)
  })

  it("getDatum", async () => {
    const datum = await provider.getDatum(preprodDatumHash())
    expect(datum).toBeDefined()
  })

  it("awaitTx", { timeout: 200_000 }, async () => {
    const confirmed = await provider.awaitTx(preprodTxHash())
    expect(confirmed).toBe(true)
  })

  it("awaitTx rejects for preview-only tx on preprod", { timeout: 10_000 }, async () => {
    await expect(provider.awaitTx(previewTxHash(), 1000, 5000)).rejects.toThrow(
      "awaitTx failed"
    )
  })

  // submitTx and evaluateTx require a valid signed CBOR tx — skipped until we have tx fixtures
  it.skip("submitTx", async () => {})

  it("evaluateTx with multiple spend redeemers", async () => {
    const tx = Transaction.fromCBORHex(evalSample1.transaction)
    const result = await provider.evaluateTx(tx, evalSample1.utxos)
    expect(result).toEqual(evalSample1.redeemersExUnits)
  })

  it("evaluateTx with PlutusV2 reference script", async () => {
    const tx = Transaction.fromCBORHex(evalSample2.transaction)
    const result = await provider.evaluateTx(tx, evalSample2.utxos)
    expect(result).toEqual(evalSample2.redeemersExUnits)
  })

  it("evaluateTx with spend, mint, and reward redeemers", async () => {
    const tx = Transaction.fromCBORHex(evalSample3.transaction)
    const result = await provider.evaluateTx(tx, evalSample3.utxos)
    expect(result).toEqual(evalSample3.redeemersExUnits)
  })

  it("evaluateTx with cert redeemer (PlutusV3)", async () => {
    const tx = Transaction.fromCBORHex(evalSample4.transaction)
    const result = await provider.evaluateTx(tx, evalSample4.utxos)
    expect(result).toEqual(evalSample4.redeemersExUnits)
  })
}
