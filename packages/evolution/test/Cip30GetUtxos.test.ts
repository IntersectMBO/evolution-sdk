import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import * as CoreAddress from "../src/Address.js"
import * as AddressEras from "../src/AddressEras.js"
import * as AssetName from "../src/AssetName.js"
import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as DatumHash from "../src/DatumHash.js"
import * as KeyHash from "../src/KeyHash.js"
import * as MultiAsset from "../src/MultiAsset.js"
import * as PolicyId from "../src/PolicyId.js"
import * as PrivateKey from "../src/PrivateKey.js"
import { resolveAvailableUtxos } from "../src/sdk/builders/internal/resolve.js"
import { preprod } from "../src/sdk/client/Chain.js"
import { cip30UtxoFromCBORHex, cip30Wallet } from "../src/sdk/client/internal/Wallets.js"
import type * as Wallet from "../src/sdk/wallet/Wallet.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionInput from "../src/TransactionInput.js"
import * as TransactionOutput from "../src/TransactionOutput.js"
import * as Value from "../src/Value.js"

// Build a real enterprise (testnet) address bound to a fresh key.
const keyHash = KeyHash.fromPrivateKey(PrivateKey.fromBytes(PrivateKey.generate()))
const addressHex = CoreAddress.toHex(new CoreAddress.Address({ networkId: 0, paymentCredential: keyHash }))
const addressEras = AddressEras.fromHex(addressHex)

// Build a CIP-30 UTxO: CBOR hex of [transaction_input, transaction_output].
const makeCip30UtxoHex = (amount: Value.Value, index: bigint): string => {
  const input = new TransactionInput.TransactionInput(
    { transactionId: TransactionHash.fromHex("aa".repeat(32)), index },
    { disableValidation: true }
  )
  const output = new TransactionOutput.BabbageTransactionOutput(
    { address: addressEras, amount },
    { disableValidation: true }
  )
  const inputCBOR = CBOR.fromCBORBytes(TransactionInput.toCBORBytes(input))
  const outputCBOR = CBOR.fromCBORBytes(TransactionOutput.toCBORBytes(output))
  return Bytes.toHex(CBOR.toCBORBytes([inputCBOR, outputCBOR]))
}

describe("CIP-30 getUtxos (#414)", () => {
  it("parses a CIP-30 UTxO hex into a typed UTxO", () => {
    const utxo = cip30UtxoFromCBORHex(makeCip30UtxoHex(Value.onlyCoin(5_000_000n), 1n))
    expect(TransactionHash.toHex(utxo.transactionId)).toBe("aa".repeat(32))
    expect(utxo.index).toBe(1n)
    expect(CoreAddress.toHex(utxo.address)).toBe(addressHex)
    expect(utxo.assets.lovelace).toBe(5_000_000n)
    expect(utxo.datumOption).toBeUndefined()
    expect(utxo.scriptRef).toBeUndefined()
  })

  it("getUtxos parses every UTxO the CIP-30 api returns", async () => {
    const hexes = [makeCip30UtxoHex(Value.onlyCoin(2_000_000n), 0n), makeCip30UtxoHex(Value.onlyCoin(7_000_000n), 1n)]
    const api = { getUtxos: () => Promise.resolve(hexes) } as unknown as Wallet.WalletApi
    const wallet = cip30Wallet(api)(preprod)

    const utxos = await wallet.getUtxos()
    expect(utxos).toHaveLength(2)
    expect(utxos.map((u) => u.assets.lovelace).sort()).toEqual([2_000_000n, 7_000_000n])
  })

  it("getUtxos returns an empty array when the wallet has no UTxOs", async () => {
    const api = { getUtxos: () => Promise.resolve(undefined) } as unknown as Wallet.WalletApi
    const wallet = cip30Wallet(api)(preprod)
    expect(await wallet.getUtxos()).toEqual([])
  })

  it("the builder resolves UTxOs from a CIP-30 wallet with no provider", async () => {
    const api = {
      getUtxos: () => Promise.resolve([makeCip30UtxoHex(Value.onlyCoin(9_000_000n), 0n)])
    } as unknown as Wallet.WalletApi
    const wallet = cip30Wallet(api)(preprod)

    // No provider in the config — the builder must source UTxOs from the wallet.
    const utxos = await Effect.runPromise(resolveAvailableUtxos({ wallet }))
    expect(utxos).toHaveLength(1)
    expect(utxos[0].assets.lovelace).toBe(9_000_000n)
  })

  it("parses a real-world CIP-30 UTxO fixture (from cardano-js-sdk)", () => {
    // Real TransactionUnspentOutput CBOR from input-output-hk/cardano-js-sdk fixtures:
    // base address, 4,027,026,465 lovelace, two native assets, no datum/script.
    const realHex =
      "82825820bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e00182583900287a7e37219128cfb05322626daa8b19d1ad37c6779d21853f7b94177c16240714ea0e12b41a914f2945784ac494bb19573f0ca61a08afa8821af0078c21a2581c1ec85dcee27f2d90ec1f9a1e4ce74a667dc9be8b184463223f9c9601a14350584c05581c659f2917fb63f12b33667463ee575eeac1845bbc736b9c0bbc40ba82a14454534c410a"
    const utxo = cip30UtxoFromCBORHex(realHex)
    expect(TransactionHash.toHex(utxo.transactionId)).toBe("bb217abaca60fc0ca68c1555eca6a96d2478547818ae76ce6836133f3cc546e0")
    expect(utxo.index).toBe(1n)
    expect(utxo.assets.lovelace).toBe(4_027_026_465n)
    // base address (payment + staking) parsed
    expect(utxo.address.stakingCredential).toBeDefined()
    // two native asset policies present
    expect(utxo.assets.multiAsset).toBeDefined()
    expect(MultiAsset.getPolicyIds(utxo.assets.multiAsset!).length).toBe(2)
    expect(utxo.datumOption).toBeUndefined()
    expect(utxo.scriptRef).toBeUndefined()
  })

  it("preserves a realistic wallet UTxO: base address (with staking), native assets, datum hash", () => {
    const stakeKeyHash = KeyHash.fromPrivateKey(PrivateKey.fromBytes(PrivateKey.generate()))
    const baseAddressHex = CoreAddress.toHex(
      new CoreAddress.Address({ networkId: 0, paymentCredential: keyHash, stakingCredential: stakeKeyHash })
    )
    const policyId = PolicyId.fromHex("bb".repeat(28))
    const assetName = AssetName.fromHex("cafe")
    const value = Value.withAssets(3_000_000n, MultiAsset.singleton(policyId, assetName, 42n))
    const datumHash = DatumHash.fromHex("dd".repeat(32))

    const input = new TransactionInput.TransactionInput(
      { transactionId: TransactionHash.fromHex("aa".repeat(32)), index: 0n },
      { disableValidation: true }
    )
    const output = new TransactionOutput.BabbageTransactionOutput(
      { address: AddressEras.fromHex(baseAddressHex), amount: value, datumOption: datumHash },
      { disableValidation: true }
    )
    const inputCBOR = CBOR.fromCBORBytes(TransactionInput.toCBORBytes(input))
    const outputCBOR = CBOR.fromCBORBytes(TransactionOutput.toCBORBytes(output))
    const utxoHex = Bytes.toHex(CBOR.toCBORBytes([inputCBOR, outputCBOR]))

    const utxo = cip30UtxoFromCBORHex(utxoHex)
    // Full base address (payment + staking credential) is preserved
    expect(CoreAddress.toHex(utxo.address)).toBe(baseAddressHex)
    expect(utxo.address.stakingCredential).toBeDefined()
    // Lovelace + native asset preserved
    expect(utxo.assets.lovelace).toBe(3_000_000n)
    // Datum hash preserved as a DatumHash datum option
    expect(utxo.datumOption?._tag).toBe("DatumHash")
  })
})
