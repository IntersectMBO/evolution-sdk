/**
 * Devnet tests for TxBuilder native script operations.
 *
 * Tests native script functionality including:
 * - Minting with native scripts
 * - Spending from native script addresses
 * - Multi-sig native scripts
 */

import { beforeAll, describe, expect, it } from "@effect/vitest"
import { Cardano, Client } from "@evolution-sdk/evolution"
import * as Address from "@evolution-sdk/evolution/Address"
import * as NativeScripts from "@evolution-sdk/evolution/NativeScripts"
import * as ScriptHash from "@evolution-sdk/evolution/ScriptHash"
import * as Text from "@evolution-sdk/evolution/Text"
import * as TransactionHash from "@evolution-sdk/evolution/TransactionHash"
import * as UTxO from "@evolution-sdk/evolution/UTxO"
import { inject } from "vitest"
import { type SharedClusterResult, useSharedCluster } from "./utils/shared-cluster.js"

// Slot config type (replaces Cluster.SlotConfig)
type SlotConfig = {
  readonly zeroTime: bigint
  readonly zeroSlot: bigint
  readonly slotLength: number
}

// Time utility functions
const now = (): bigint => BigInt(Date.now())
const unixTimeToSlot = (unixTime: bigint, slotConfig: SlotConfig): bigint => {
  const timePassed = unixTime - slotConfig.zeroTime
  const slotsPassed = timePassed / BigInt(slotConfig.slotLength)
  return slotsPassed + slotConfig.zeroSlot
}
const slotToUnixTime = (slot: bigint, slotConfig: SlotConfig): bigint => {
  const msAfterBegin = (slot - slotConfig.zeroSlot) * BigInt(slotConfig.slotLength)
  return slotConfig.zeroTime + msAfterBegin
}

describe("TxBuilder NativeScript (Devnet Submit)", () => {
  let shared: SharedClusterResult
  let slotConfig: SlotConfig

  beforeAll(async () => {
    const injectData = inject("sharedCluster" as any)
    const info = JSON.parse(injectData)
    slotConfig = {
      zeroTime: BigInt(info.chain.slotConfig.zeroTime),
      zeroSlot: BigInt(info.chain.slotConfig.zeroSlot),
      slotLength: info.chain.slotConfig.slotLength
    }
    shared = await useSharedCluster(injectData, [8, 9, 10])
  }, 180_000)

  it("should handle multi-sig native script (all)", { timeout: 60_000 }, async () => {
    const client1 = shared.makeClient(8)
    const client2 = shared.makeClient(9)

    const address1 = await client1.address()
    const address2 = await client2.address()

    const credential1 = address1.paymentCredential
    const credential2 = address2.paymentCredential

    if (credential1._tag !== "KeyHash" || credential2._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credentials")
    }

    // Create multi-sig script requiring BOTH signatures
    const script1 = NativeScripts.makeScriptPubKey(credential1.hash)
    const script2 = NativeScripts.makeScriptPubKey(credential2.hash)
    const multiSigScript = NativeScripts.makeScriptAll([script1.script, script2.script])

    const scriptHash = ScriptHash.fromScript(multiSigScript)
    const policyId = ScriptHash.toHex(scriptHash)
    const assetNameHex = Text.toHex("MultiSigToken")
    const unit = policyId + assetNameHex

    // Build transaction with multi-sig mint
    const signBuilder = await client1
      .newTx()
      .attachScript({ script: multiSigScript })
      .mintAssets({
        assets: Cardano.Assets.fromRecord({ [unit]: 500n })
      })
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(2_000_000n)
      })
      .build({ availableUtxos: [...shared.genesisUtxos] })

    const tx = await signBuilder.toTransaction()

    // Verify mint and script
    expect(tx.body.mint).toBeDefined()
    expect(tx.witnessSet.nativeScripts).toBeDefined()

    // Client1 partial signs
    const witness1 = await signBuilder.partialSign()
    expect(witness1.vkeyWitnesses?.length).toBe(1)

    // Client2 signs the same transaction
    const witness2 = await client2.signTx(tx)
    expect(witness2.vkeyWitnesses?.length).toBe(1)

    // Assemble and submit
    const submitBuilder = await signBuilder.assemble([witness1, witness2])
    const txHash = await submitBuilder.submit()

    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client1.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should handle multi-sig native script (any - 1 of N)", { timeout: 60_000 }, async () => {
    const client1 = shared.makeClient(8)
    const client2 = shared.makeClient(9)

    const address1 = await client1.address()
    const address2 = await client2.address()

    const credential1 = address1.paymentCredential
    const credential2 = address2.paymentCredential

    if (credential1._tag !== "KeyHash" || credential2._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credentials")
    }

    // Create multi-sig script requiring ANY ONE signature (1-of-2)
    const script1 = NativeScripts.makeScriptPubKey(credential1.hash)
    const script2 = NativeScripts.makeScriptPubKey(credential2.hash)
    const anyScript = NativeScripts.makeScriptAny([script1.script, script2.script])

    const scriptHash = ScriptHash.fromScript(anyScript)
    const policyId = ScriptHash.toHex(scriptHash)
    const assetNameHex = Text.toHex("AnyOneToken")
    const unit = policyId + assetNameHex

    // Build transaction - only client1 needs to sign
    // Client fetches UTxOs automatically from the provider
    const signBuilder = await client1
      .newTx()
      .attachScript({ script: anyScript })
      .mintAssets({
        assets: Cardano.Assets.fromRecord({ [unit]: 100n })
      })
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(2_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    expect(tx.body.mint).toBeDefined()
    expect(tx.witnessSet.nativeScripts).toBeDefined()

    // Only client1 signs - should be sufficient for "any"
    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()

    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client1.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should handle N-of-K native script (2 of 3)", { timeout: 60_000 }, async () => {
    const client1 = shared.makeClient(8)
    const client2 = shared.makeClient(9)
    const client3 = shared.makeClient(10)

    const address1 = await client1.address()
    const address2 = await client2.address()
    const address3 = await client3.address()

    const credential1 = address1.paymentCredential
    const credential2 = address2.paymentCredential
    const credential3 = address3.paymentCredential

    if (credential1._tag !== "KeyHash" || credential2._tag !== "KeyHash" || credential3._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credentials")
    }

    // Create 2-of-3 multi-sig script
    const script1 = NativeScripts.makeScriptPubKey(credential1.hash)
    const script2 = NativeScripts.makeScriptPubKey(credential2.hash)
    const script3 = NativeScripts.makeScriptPubKey(credential3.hash)
    const nOfKScript = NativeScripts.makeScriptNOfK(2n, [script1.script, script2.script, script3.script])

    const scriptHash = ScriptHash.fromScript(nOfKScript)
    const policyId = ScriptHash.toHex(scriptHash)
    const assetNameHex = Text.toHex("TwoOfThreeToken")
    const unit = policyId + assetNameHex

    // Build transaction - client fetches UTxOs automatically
    const signBuilder = await client1
      .newTx()
      .attachScript({ script: nOfKScript })
      .mintAssets({
        assets: Cardano.Assets.fromRecord({ [unit]: 200n })
      })
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(2_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    expect(tx.body.mint).toBeDefined()
    expect(tx.witnessSet.nativeScripts).toBeDefined()

    // Client1 and Client2 sign (2 of 3 - Client3 not needed)
    const witness1 = await signBuilder.partialSign()
    const witness2 = await client2.signTx(tx)

    // Assemble with only 2 signatures
    const submitBuilder = await signBuilder.assemble([witness1, witness2])
    const txHash = await submitBuilder.submit()

    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client1.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should handle time-locked native script (invalidHereafter)", { timeout: 60_000 }, async () => {
    const client = shared.makeClient(8)
    const myAddress = await client.address()

    const paymentCredential = myAddress.paymentCredential
    if (paymentCredential._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credential")
    }

    const currentTime = now()
    const currentSlot = unixTimeToSlot(currentTime, slotConfig)

    // Set future slot 1000 slots ahead (20 seconds at 0.02s/slot)
    const futureSlot = currentSlot + 1000n
    const futureUnixTime = slotToUnixTime(futureSlot, slotConfig)

    // Create time-locked script: signature required AND must be before futureSlot
    const sigScript = NativeScripts.makeScriptPubKey(paymentCredential.hash)
    const timeScript = NativeScripts.makeInvalidHereafter(futureSlot)
    const timelockScript = NativeScripts.makeScriptAll([sigScript.script, timeScript.script])

    const scriptHash = ScriptHash.fromScript(timelockScript)
    const policyId = ScriptHash.toHex(scriptHash)
    const assetNameHex = Text.toHex("TimeLockToken")
    const unit = policyId + assetNameHex

    // Build transaction - setValidity uses the same slot config via the client
    const signBuilder = await client
      .newTx()
      .attachScript({ script: timelockScript })
      .setValidity({ to: futureUnixTime })
      .mintAssets({
        assets: Cardano.Assets.fromRecord({ [unit]: 50n })
      })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(2_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    // Verify time constraints are set correctly
    expect(tx.body.mint).toBeDefined()
    expect(tx.body.ttl).toBeDefined()
    expect(tx.body.ttl).toBe(futureSlot)

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()
    expect(TransactionHash.toHex(txHash).length).toBe(64)
    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should handle complex nested native script (sig AND (any of time conditions))", { timeout: 60_000 }, async () => {
    const client = shared.makeClient(8)
    const myAddress = await client.address()

    const paymentCredential = myAddress.paymentCredential
    if (paymentCredential._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credential")
    }

    const currentTime = now()
    const currentSlot = unixTimeToSlot(currentTime, slotConfig)

    // beforeSlot: 2000 slots ahead (~40 seconds) - InvalidHereafter will be satisfied
    // afterSlot: 10000 slots ahead (~200 seconds) - InvalidBefore will NOT be satisfied yet
    const beforeSlot = currentSlot + 2000n
    const afterSlot = currentSlot + 10000n
    const beforeUnixTime = slotToUnixTime(beforeSlot, slotConfig)

    // Complex script structure:
    // ALL of:
    //   - Signature from our key
    //   - ANY of:
    //     - Before slot (current + 2000)  <- this one will be satisfied
    //     - After slot (current + 10000)  <- this one won't be satisfied yet
    const sigScript = NativeScripts.makeScriptPubKey(paymentCredential.hash)
    const beforeSlotScript = NativeScripts.makeInvalidHereafter(beforeSlot)
    const afterSlotScript = NativeScripts.makeInvalidBefore(afterSlot)

    const timeOptionsScript = NativeScripts.makeScriptAny([beforeSlotScript.script, afterSlotScript.script])
    const complexScript = NativeScripts.makeScriptAll([sigScript.script, timeOptionsScript.script])

    const scriptHash = ScriptHash.fromScript(complexScript)
    const policyId = ScriptHash.toHex(scriptHash)
    const assetNameHex = Text.toHex("ComplexToken")
    const unit = policyId + assetNameHex

    // Use the "before slot" option by setting TTL to beforeSlot
    const signBuilder = await client
      .newTx()
      .attachScript({ script: complexScript })
      .setValidity({ to: beforeUnixTime })
      .mintAssets({
        assets: Cardano.Assets.fromRecord({ [unit]: 25n })
      })
      .payToAddress({
        address: myAddress,
        assets: Cardano.Assets.fromLovelace(2_000_000n)
      })
      .build()

    const tx = await signBuilder.toTransaction()

    expect(tx.body.mint).toBeDefined()
    expect(tx.body.ttl).toBe(beforeSlot)
    expect(tx.witnessSet.nativeScripts).toBeDefined()

    const submitBuilder = await signBuilder.sign()
    const txHash = await submitBuilder.submit()

    expect(TransactionHash.toHex(txHash).length).toBe(64)

    const confirmed = await client.awaitTx(txHash, 1000)
    expect(confirmed).toBe(true)
  })

  it("should spend from a 2-of-2 multi-sig script address", { timeout: 60_000 }, async () => {
    const client1 = shared.makeClient(8)
    const client2 = shared.makeClient(9)

    const address1 = await client1.address()
    const address2 = await client2.address()

    const credential1 = address1.paymentCredential
    const credential2 = address2.paymentCredential

    if (credential1._tag !== "KeyHash" || credential2._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credentials")
    }

    // Create 2-of-2 multi-sig script
    const script1 = NativeScripts.makeScriptPubKey(credential1.hash)
    const script2 = NativeScripts.makeScriptPubKey(credential2.hash)
    const multiSigScript = NativeScripts.makeScriptAll([script1.script, script2.script])

    const scriptHash = ScriptHash.fromScript(multiSigScript)

    // Create script address
    const scriptAddress = new Address.Address({
      networkId: 0,
      paymentCredential: scriptHash,
      stakingCredential: undefined
    })

    // Fund the script address - client fetches UTxOs automatically
    const fundSignBuilder = await client1
      .newTx()
      .payToAddress({
        address: scriptAddress,
        assets: Cardano.Assets.fromLovelace(10_000_000n)
      })
      .build()

    const fundSubmitBuilder = await fundSignBuilder.sign()
    const fundTxHash = await fundSubmitBuilder.submit()

    await client1.awaitTx(fundTxHash, 1000)
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    // Fetch UTxOs at the script address
    const scriptUtxos = await client1.getUtxos(scriptAddress)
    expect(scriptUtxos.length).toBeGreaterThan(0)

    const scriptUtxo = scriptUtxos.find((u) => UTxO.toOutRefString(u).startsWith(TransactionHash.toHex(fundTxHash)))
    expect(scriptUtxo).toBeDefined()

    // Spend from multi-sig script - requires both signatures
    // Client fetches wallet UTxOs automatically, but we explicitly add the script UTxO
    const spendSignBuilder = await client1
      .newTx()
      .attachScript({ script: multiSigScript })
      .collectFrom({ inputs: [scriptUtxo!] })
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build()

    const spendTx = await spendSignBuilder.toTransaction()

    // Both clients must sign
    const witness1 = await spendSignBuilder.partialSign()
    const witness2 = await client2.signTx(spendTx)

    const spendSubmitBuilder = await spendSignBuilder.assemble([witness1, witness2])
    const spendTxHash = await spendSubmitBuilder.submit()

    expect(TransactionHash.toHex(spendTxHash).length).toBe(64)

    const spendConfirmed = await client1.awaitTx(spendTxHash, 1000)
    expect(spendConfirmed).toBe(true)
  })

  it("should use native script as reference script for minting", { timeout: 60_000 }, async () => {
    const client1 = shared.makeClient(8)
    const client2 = shared.makeClient(9)

    const address1 = await client1.address()
    const address2 = await client2.address()

    const credential1 = address1.paymentCredential
    const credential2 = address2.paymentCredential

    if (credential1._tag !== "KeyHash" || credential2._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credentials")
    }

    // Create a 2-of-2 multi-sig native script
    const script1 = NativeScripts.makeScriptPubKey(credential1.hash)
    const script2 = NativeScripts.makeScriptPubKey(credential2.hash)
    const multiSigScript = NativeScripts.makeScriptAll([script1.script, script2.script])

    const scriptHash = ScriptHash.fromScript(multiSigScript)
    const policyId = ScriptHash.toHex(scriptHash)

    // Step 1: Create a UTxO with the native script as a reference script
    const refScriptSignBuilder = await client1
      .newTx()
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(5_000_000n),
        script: multiSigScript
      })
      .build()

    const refScriptSubmitBuilder = await refScriptSignBuilder.sign()
    const refScriptTxHash = await refScriptSubmitBuilder.submit()

    expect(TransactionHash.toHex(refScriptTxHash).length).toBe(64)
    await client1.awaitTx(refScriptTxHash, 1000)
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    // Find the UTxO with the reference script
    const walletUtxos = await client1.getUtxos(address1)
    const refScriptUtxo = walletUtxos.find(
      (u) => UTxO.toOutRefString(u).startsWith(TransactionHash.toHex(refScriptTxHash)) && u.scriptRef !== undefined
    )
    expect(refScriptUtxo).toBeDefined()
    expect(refScriptUtxo!.scriptRef).toBeDefined()

    // Step 2: Mint using the reference script (readFrom) instead of attachScript
    const assetNameHex = Text.toHex("RefMinted")
    const unit = policyId + assetNameHex

    const mintSignBuilder = await client1
      .newTx()
      .readFrom({ referenceInputs: [refScriptUtxo!] }) // Reference the UTxO with the script
      .mintAssets({
        assets: Cardano.Assets.fromRecord({ [unit]: 100n })
      })
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(2_000_000n)
      })
      .build()

    const mintTx = await mintSignBuilder.toTransaction()

    // Both signers still need to sign (native script requires signatures)
    // When using client.signTx directly, reference UTxOs are auto-fetched
    // so the wallet can determine required signers from reference scripts
    const mintWitness1 = await mintSignBuilder.partialSign()
    const mintWitness2 = await client2.signTx(mintTx)

    const mintSubmitBuilder = await mintSignBuilder.assemble([mintWitness1, mintWitness2])
    const mintTxHash = await mintSubmitBuilder.submit()

    expect(TransactionHash.toHex(mintTxHash).length).toBe(64)

    const mintConfirmed = await client1.awaitTx(mintTxHash, 1000)
    expect(mintConfirmed).toBe(true)
  })

  it("should spend from script address using native script as reference input", { timeout: 60_000 }, async () => {
    const client1 = shared.makeClient(8)
    const client2 = shared.makeClient(9)

    const address1 = await client1.address()
    const address2 = await client2.address()

    const credential1 = address1.paymentCredential
    const credential2 = address2.paymentCredential

    if (credential1._tag !== "KeyHash" || credential2._tag !== "KeyHash") {
      throw new Error("Expected KeyHash credentials")
    }

    // Create a 2-of-2 multi-sig native script
    const script1 = NativeScripts.makeScriptPubKey(credential1.hash)
    const script2 = NativeScripts.makeScriptPubKey(credential2.hash)
    const multiSigScript = NativeScripts.makeScriptAll([script1.script, script2.script])

    const scriptHash = ScriptHash.fromScript(multiSigScript)

    // Create script address
    const scriptAddress = new Address.Address({
      networkId: 0,
      paymentCredential: scriptHash,
      stakingCredential: undefined
    })

    // Step 1: Create a UTxO with the native script as a reference script
    const refScriptSignBuilder = await client1
      .newTx()
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(5_000_000n),
        script: multiSigScript
      })
      .build()

    const refScriptSubmitBuilder = await refScriptSignBuilder.sign()
    const refScriptTxHash = await refScriptSubmitBuilder.submit()

    expect(TransactionHash.toHex(refScriptTxHash).length).toBe(64)
    await client1.awaitTx(refScriptTxHash, 1000)
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    // Step 2: Fund the script address
    const fundSignBuilder = await client1
      .newTx()
      .payToAddress({
        address: scriptAddress,
        assets: Cardano.Assets.fromLovelace(10_000_000n)
      })
      .build()

    const fundSubmitBuilder = await fundSignBuilder.sign()
    const fundTxHash = await fundSubmitBuilder.submit()

    await client1.awaitTx(fundTxHash, 1000)
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    // Fetch UTxOs at the script address
    const scriptUtxos = await client1.getUtxos(scriptAddress)
    expect(scriptUtxos.length).toBeGreaterThan(0)

    const scriptUtxo = scriptUtxos.find((u) => UTxO.toOutRefString(u).startsWith(TransactionHash.toHex(fundTxHash)))
    expect(scriptUtxo).toBeDefined()

    // Find the UTxO with the reference script (fetch AFTER fund tx to get fresh state)
    const walletUtxos = await client1.getUtxos(address1)
    const refScriptUtxo = walletUtxos.find(
      (u) => UTxO.toOutRefString(u).startsWith(TransactionHash.toHex(refScriptTxHash)) && u.scriptRef !== undefined
    )
    expect(refScriptUtxo).toBeDefined()
    expect(refScriptUtxo!.scriptRef).toBeDefined()

    // Step 3: Spend from script address using readFrom (reference input) instead of attachScript
    // This tests that native scripts provided via reference inputs don't incorrectly require redeemers
    const spendSignBuilder = await client1
      .newTx()
      .readFrom({ referenceInputs: [refScriptUtxo!] }) // Reference the UTxO with the script
      .collectFrom({ inputs: [scriptUtxo!] }) // Spend from the script address
      .payToAddress({
        address: address1,
        assets: Cardano.Assets.fromLovelace(5_000_000n)
      })
      .build()

    const spendTx = await spendSignBuilder.toTransaction()

    // Both clients must sign (native script requires signatures)
    const witness1 = await spendSignBuilder.partialSign()
    const witness2 = await client2.signTx(spendTx)

    const spendSubmitBuilder = await spendSignBuilder.assemble([witness1, witness2])
    const spendTxHash = await spendSubmitBuilder.submit()

    expect(TransactionHash.toHex(spendTxHash).length).toBe(64)
    const spendConfirmed = await client1.awaitTx(spendTxHash, 1000)
    expect(spendConfirmed).toBe(true)
  })
})
