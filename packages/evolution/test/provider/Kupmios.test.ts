/**
 * Kupmios read paths against Kupo and Ogmios responses, with `fetch` stubbed.
 * Both servers write amounts as bare JSON numbers, so these check that integers
 * past 2^53 decode exactly and that decimals stay numbers.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as CoreAddress from "../../src/Address.js"
import * as CoreAssets from "../../src/Assets.js"
import * as PlutusData from "../../src/Data.js"
import * as DatumHash from "../../src/DatumHash.js"
import * as PoolKeyHash from "../../src/PoolKeyHash.js"
import * as RewardAddress from "../../src/RewardAddress.js"
import * as ScriptHash from "../../src/ScriptHash.js"
import * as KupmiosEffects from "../../src/sdk/provider/internal/KupmiosEffects.js"
import * as Transaction from "../../src/Transaction.js"
import * as TransactionHash from "../../src/TransactionHash.js"
import * as TransactionInput from "../../src/TransactionInput.js"
import { evalSample1 } from "./fixtures/evaluateTx.js"

const KUPO_URL = "https://kupo.test"
const OGMIOS_URL = "https://ogmios.test"

// Preprod script UTxO 23f94840…49b4#0 holding one token and an inline datum
const ADDRESS = "addr_test1wz7uytdxstxe4nhdtl2gj9rcnlyce99tc707mz6qewxyx9qac0urr"
const TX_HASH = "23f94840ca94f7bb0a5a2b28e5b6a77e61d0414c7427e03d6c4d57b13d5e49b4"
const POLICY_ID = "ec0f50624331d0df45f40ab0e6081e5f1ff577c5c4dc767079d4fe59"
const ASSET_NAME = "695553443230323430343033313833343534"
const DATUM_HASH = "facfe6aa45fa8023a97a3f13afb823f3966313533f6d68821e65d8431b5a4918"
const DATUM = "d8799fd8799f1a001a8ea5ff1b0000018ea6888e58ff"

/** Kupo `/matches` body for that UTxO, with the token quantity as given */
const matches = (quantity: string) => `[{
  "transaction_index": 0,
  "transaction_id": "${TX_HASH}",
  "output_index": 0,
  "address": "${ADDRESS}",
  "value": {"coins": 2000000, "assets": {"${POLICY_ID}.${ASSET_NAME}": ${quantity}}},
  "datum_hash": "${DATUM_HASH}",
  "datum_type": "inline",
  "script_hash": null,
  "created_at": {"slot_no": 56486181, "header_hash": "d25ac5572bedeba724d8c8178a5b6dcf95b75992970dab7145403cfbc44f9809"},
  "spent_at": null
}]`

/** Ogmios `queryLedgerState/protocolParameters` reply with preprod epoch 315 values */
const protocolParameters = readFileSync(join(__dirname, "fixtures", "ogmios", "protocolParameters.json"), "utf8")

/** Ogmios `queryLedgerState/rewardAccountSummaries` reply for a delegated preprod stake key */
const STAKE_ADDRESS = "stake_test1upxue2rk4tp0e3tp7l0nmfmj6ar7y9yvngzu0vn7fxs9ags2apttt"
const POOL_ID = "pool1mp96jpc2dtaruz0cazmljh03dev0969c4rq3wr6hnc4rjdxn8aw"
const rewardAccountSummaries = (rewards: string) => `{
  "jsonrpc": "2.0",
  "method": "queryLedgerState/rewardAccountSummaries",
  "result": [{
    "from": "verificationKey",
    "credential": "4dcca876aac2fcc561f7df3da772d747e2148c9a05c7b27e49a05ea2",
    "stakePool": {"id": "${POOL_ID}"},
    "rewards": {"ada": {"lovelace": ${rewards}}},
    "deposit": {"ada": {"lovelace": 2000000}}
  }],
  "id": null
}`

const evaluation = (cpu: string) => {
  const redeemers = [0, 1, 2, 3].map(
    (index) => `{"validator":{"index":${index},"purpose":"spend"},"budget":{"memory":26285,"cpu":${cpu}}}`
  )
  return `{"jsonrpc":"2.0","method":"evaluateTransaction","result":[${redeemers.join(",")}],"id":null}`
}

/** Serve Kupo GETs by path prefix and Ogmios POSTs by JSON-RPC method */
const stubKupmios = (bodies: { kupo?: Record<string, string>; ogmios?: Record<string, string> }) =>
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const body =
        init.method === "POST"
          ? bodies.ogmios?.[JSON.parse(String(init.body)).method]
          : Object.entries(bodies.kupo ?? {}).find(([prefix]) => new URL(url).pathname.startsWith(prefix))?.[1]
      return Promise.resolve(body === undefined ? new Response("not stubbed", { status: 404 }) : new Response(body))
    })
  )

const UNIT = `${POLICY_ID}${ASSET_NAME}`

afterEach(() => {
  vi.unstubAllGlobals()
})

// Every Kupo path reads this token quantity, a bare JSON number past 2^53
const QUANTITY = 18446744073709551615n

const kupo = (quantity = QUANTITY.toString()) => ({
  "/matches/": matches(quantity),
  [`/datums/${DATUM_HASH}`]: `{"datum":"${DATUM}"}`
})

describe("Kupmios read paths", () => {
  it("getProtocolParameters", async () => {
    stubKupmios({ ogmios: { "queryLedgerState/protocolParameters": protocolParameters } })
    const { result: expected } = JSON.parse(protocolParameters)

    const params = await Effect.runPromise(KupmiosEffects.getProtocolParametersEffect(OGMIOS_URL))

    expect(params).toMatchObject({
      minFeeA: 44,
      minFeeB: 155381,
      maxTxSize: 16384,
      maxValSize: 5000,
      keyDeposit: 2000000n,
      poolDeposit: 500000000n,
      drepDeposit: 500000000n,
      govActionDeposit: 1000000000n,
      priceMem: 0.0577,
      priceStep: 7.21e-5,
      maxTxExMem: 17500000n,
      maxTxExSteps: 10000000000n,
      coinsPerUtxoByte: 4310n,
      collateralPercentage: 150,
      maxCollateralInputs: 3,
      minFeeRefScriptCostPerByte: 15
    })
    // PlutusV3 carries negative entries
    expect(Object.values(params.costModels.PlutusV3)).toEqual(expected.plutusCostModels["plutus:v3"])
  })

  it("getUtxos by address", async () => {
    stubKupmios({ kupo: kupo() })

    const [utxo] = await Effect.runPromise(KupmiosEffects.getUtxosEffect(KUPO_URL)(CoreAddress.fromBech32(ADDRESS)))

    expect(TransactionHash.toHex(utxo!.transactionId)).toBe(TX_HASH)
    expect(utxo!.index).toBe(0n)
    expect(utxo!.assets.lovelace).toBe(2000000n)
    expect(CoreAssets.getByUnit(utxo!.assets, UNIT)).toBe(QUANTITY)
    expect(utxo!.datumOption?._tag).toBe("InlineDatum")
  })

  it("getUtxos by credential", async () => {
    stubKupmios({ kupo: kupo() })

    const [utxo] = await Effect.runPromise(
      KupmiosEffects.getUtxosEffect(KUPO_URL)(
        ScriptHash.fromHex("bdc22da682cd9aceed5fd48914789fc98c94abc79fed8b40cb8c4314")
      )
    )

    expect(utxo!.assets.lovelace).toBe(2000000n)
    expect(CoreAssets.getByUnit(utxo!.assets, UNIT)).toBe(QUANTITY)
  })

  it("getUtxosWithUnit", async () => {
    stubKupmios({ kupo: kupo() })

    const [utxo] = await Effect.runPromise(
      KupmiosEffects.getUtxosWithUnitEffect(KUPO_URL)(CoreAddress.fromBech32(ADDRESS), UNIT)
    )

    expect(CoreAssets.getByUnit(utxo!.assets, UNIT)).toBe(QUANTITY)
  })

  it("getUtxoByUnit", async () => {
    stubKupmios({ kupo: kupo() })

    const utxo = await Effect.runPromise(KupmiosEffects.getUtxoByUnitEffect(KUPO_URL)(UNIT))

    expect(utxo.assets.lovelace).toBe(2000000n)
    expect(CoreAssets.getByUnit(utxo.assets, UNIT)).toBe(QUANTITY)
  })

  it("getUtxosByOutRef", async () => {
    stubKupmios({ kupo: kupo() })
    const input = new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(TX_HASH), index: 0n })

    const [utxo] = await Effect.runPromise(KupmiosEffects.getUtxosByOutRefEffect(KUPO_URL)([input]))

    expect(utxo!.assets.lovelace).toBe(2000000n)
    expect(CoreAssets.getByUnit(utxo!.assets, UNIT)).toBe(QUANTITY)
  })

  it("awaitTx", async () => {
    stubKupmios({ kupo: kupo() })

    const confirmed = await Effect.runPromise(
      KupmiosEffects.awaitTxEffect(KUPO_URL)(TransactionHash.fromHex(TX_HASH), 10, 1_000)
    )

    expect(confirmed).toBe(true)
  })

  it("getDatum", async () => {
    stubKupmios({ kupo: kupo() })

    const datum = await Effect.runPromise(KupmiosEffects.getDatumEffect(KUPO_URL)(DatumHash.fromHex(DATUM_HASH)))

    expect(PlutusData.toCBORHex(datum)).toBe(DATUM)
  })

  it("getDelegation", async () => {
    stubKupmios({ ogmios: { "queryLedgerState/rewardAccountSummaries": rewardAccountSummaries("52981948456") } })

    const delegation = await Effect.runPromise(
      KupmiosEffects.getDelegationEffect(OGMIOS_URL)(RewardAddress.RewardAddress.make(STAKE_ADDRESS))
    )

    expect(delegation.rewards).toBe(52981948456n)
    expect(delegation.poolId && PoolKeyHash.toBech32(delegation.poolId)).toBe(POOL_ID)
  })

  it("submitTx", async () => {
    stubKupmios({
      ogmios: {
        submitTransaction: `{"jsonrpc":"2.0","method":"submitTransaction","result":{"transaction":{"id":"${TX_HASH}"}},"id":null}`
      }
    })

    const submitted = await Effect.runPromise(
      KupmiosEffects.submitTxEffect(OGMIOS_URL)(Transaction.fromCBORHex(evalSample1.transaction))
    )

    expect(TransactionHash.toHex(submitted)).toBe(TX_HASH)
  })

  it("evaluateTx", async () => {
    stubKupmios({ ogmios: { evaluateTransaction: evaluation("7850649") } })

    const redeemers = await Effect.runPromise(
      KupmiosEffects.evaluateTxEffect(OGMIOS_URL)(Transaction.fromCBORHex(evalSample1.transaction), evalSample1.utxos)
    )

    expect(redeemers).toEqual(evalSample1.redeemersExUnits)
  })
})

describe("Kupmios integers past 2^53", () => {
  it.each([
    ["2^64 - 1", "18446744073709551615", 18446744073709551615n],
    ["2^64", "18446744073709551616", 18446744073709551616n]
  ])("decodes a bare %s Kupo asset quantity exactly", async (_label, quantity, expected) => {
    stubKupmios({ kupo: kupo(quantity) })

    const [utxo] = await Effect.runPromise(KupmiosEffects.getUtxosEffect(KUPO_URL)(CoreAddress.fromBech32(ADDRESS)))

    expect(CoreAssets.getByUnit(utxo!.assets, UNIT)).toBe(expected)
  })

  it("decodes bare Ogmios execution unit limits exactly", async () => {
    stubKupmios({
      ogmios: {
        "queryLedgerState/protocolParameters": protocolParameters.replace(
          /"maxExecutionUnitsPerTransaction": \{\s*"memory": \d+,\s*"cpu": \d+\s*\}/,
          `"maxExecutionUnitsPerTransaction": {"memory": 9007199254740993, "cpu": 18446744073709551615}`
        )
      }
    })

    const params = await Effect.runPromise(KupmiosEffects.getProtocolParametersEffect(OGMIOS_URL))

    expect(params.maxTxExMem).toBe(9007199254740993n)
    expect(params.maxTxExSteps).toBe(18446744073709551615n)
  })

  it("decodes bare Ogmios rewards exactly", async () => {
    stubKupmios({
      ogmios: { "queryLedgerState/rewardAccountSummaries": rewardAccountSummaries("45000000000000001") }
    })

    const delegation = await Effect.runPromise(
      KupmiosEffects.getDelegationEffect(OGMIOS_URL)(RewardAddress.RewardAddress.make(STAKE_ADDRESS))
    )

    expect(delegation.rewards).toBe(45000000000000001n)
  })

  it("decodes a bare Ogmios execution budget exactly", async () => {
    stubKupmios({ ogmios: { evaluateTransaction: evaluation("18446744073709551615") } })

    const redeemers = await Effect.runPromise(
      KupmiosEffects.evaluateTxEffect(OGMIOS_URL)(Transaction.fromCBORHex(evalSample1.transaction), evalSample1.utxos)
    )

    expect(redeemers.map((redeemer) => redeemer.ex_units.steps)).toEqual([
      18446744073709551615n,
      18446744073709551615n,
      18446744073709551615n,
      18446744073709551615n
    ])
  })
})
