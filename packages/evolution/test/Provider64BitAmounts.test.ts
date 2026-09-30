import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as KeyHash from "../src/KeyHash.js"
import * as Blockfrost from "../src/sdk/provider/internal/Blockfrost.js"
import * as BlockfrostEffect from "../src/sdk/provider/internal/BlockfrostEffect.js"
import * as HttpUtils from "../src/sdk/provider/internal/HttpUtils.js"
import * as KoiosEffect from "../src/sdk/provider/internal/KoiosEffect.js"
import * as KupmiosEffects from "../src/sdk/provider/internal/KupmiosEffects.js"
import * as Ogmios from "../src/sdk/provider/internal/Ogmios.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as CoreUTxO from "../src/UTxO.js"

const UNSAFE_LOVELACE = 9_007_199_254_740_993n // 2^53 + 1
const MAX_UINT64 = 18_446_744_073_709_551_615n // 2^64 - 1
const ROUNDED_LOVELACE = "9007199254740992"
const ROUNDED_QUANTITY = "18446744073709552000"

const POLICY_ID = "a".repeat(56)
const ASSET_NAME = "b".repeat(8)

const address = new CoreAddress.Address({
  networkId: 0,
  paymentCredential: KeyHash.fromHex("00".repeat(28))
})

const utxoWithHugeAmounts = () => {
  let assets = CoreAssets.fromLovelace(UNSAFE_LOVELACE)
  assets = CoreAssets.addByHex(assets, POLICY_ID, ASSET_NAME, MAX_UINT64)
  return new CoreUTxO.UTxO(
    { transactionId: TransactionHash.fromHex("aa".repeat(32)), index: 0n, address, assets },
    { disableValidation: true }
  )
}

const emptyTx = Transaction.fromCBORHex("84a300d90102800180021800a0f5f6")

const stubFetch = (body: string) => {
  const sent: Array<string> = []
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    if (typeof init?.body === "string") sent.push(init.body)
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })
  })
  return sent
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Ogmios outbound amounts (#406)", () => {
  it("posts additionalUtxo amounts as exact unquoted integers", async () => {
    const sent = stubFetch('{"jsonrpc":"2.0","id":null,"result":[]}')

    await Effect.runPromise(
      KupmiosEffects.evaluateTxEffect("http://ogmios.test")(emptyTx, [utxoWithHugeAmounts()])
    )

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain(`"lovelace":${UNSAFE_LOVELACE}`)
    expect(sent[0]).toContain(`"${ASSET_NAME}":${MAX_UINT64}`)
    expect(sent[0]).not.toContain(`"lovelace":"`)
    expect(sent[0]).not.toContain(ROUNDED_LOVELACE)
    expect(sent[0]).not.toContain(ROUNDED_QUANTITY)
  })
})

describe("Koios outbound amounts", () => {
  it("posts the Ogmios additionalUtxo amounts as exact unquoted integers", async () => {
    const sent = stubFetch('{"jsonrpc":"2.0","id":null,"result":[]}')

    await Effect.runPromise(KoiosEffect.evaluateTx("http://koios.test")(emptyTx, [utxoWithHugeAmounts()]))

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain(`"lovelace":${UNSAFE_LOVELACE}`)
    expect(sent[0]).toContain(`"${ASSET_NAME}":${MAX_UINT64}`)
  })
})

describe("Blockfrost outbound amounts (#455)", () => {
  it("posts additionalUtxoSet amounts as exact unquoted integers", async () => {
    const sent = stubFetch("[]")

    await Effect.runPromise(
      Effect.either(BlockfrostEffect.evaluateTx("http://blockfrost.test", "key")(emptyTx, [utxoWithHugeAmounts()]))
    )

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain(`"coins":${UNSAFE_LOVELACE}`)
    expect(sent[0]).toContain(`"assets":{"${POLICY_ID}.${ASSET_NAME}":${MAX_UINT64}}`)
    expect(sent[0]).not.toContain(ROUNDED_LOVELACE)
    expect(sent[0]).not.toContain(ROUNDED_QUANTITY)
  })
})

describe("Evaluate request bodies read back through the reader", () => {
  it("decodes the Ogmios body to the same bigint amounts", async () => {
    const sent = stubFetch('{"jsonrpc":"2.0","id":null,"result":[]}')
    await Effect.runPromise(
      KupmiosEffects.evaluateTxEffect("http://ogmios.test")(emptyTx, [utxoWithHugeAmounts()])
    )

    stubFetch(sent[0])
    const decoded = await Effect.runPromise(
      HttpUtils.get("http://echo.test", Ogmios.EvaluateTransactionSchema)
    )

    const [utxo] = decoded.params.additionalUtxo
    expect(utxo.value.ada.lovelace).toBe(UNSAFE_LOVELACE)
    expect(utxo.value[POLICY_ID][ASSET_NAME]).toBe(MAX_UINT64)
  })

  it("decodes the Blockfrost body to the same bigint amounts", async () => {
    const sent = stubFetch("[]")
    await Effect.runPromise(
      Effect.either(BlockfrostEffect.evaluateTx("http://blockfrost.test", "key")(emptyTx, [utxoWithHugeAmounts()]))
    )

    stubFetch(sent[0])
    const decoded = await Effect.runPromise(
      HttpUtils.get("http://echo.test", Blockfrost.EvaluateUtxosRequest)
    )

    const [[, txOut]] = decoded.additionalUtxoSet
    expect(txOut.value.coins).toBe(UNSAFE_LOVELACE)
    expect(txOut.value.assets).toEqual({ [`${POLICY_ID}.${ASSET_NAME}`]: MAX_UINT64 })
  })
})
