/**
 * Offline tests for the Maestro response paths. `fetch` is stubbed with payloads in the
 * shape of the Maestro v1 API, so every integer is checked to decode exactly as a bigint,
 * including bare JSON numbers past 2^53.
 */
import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as Address from "../../src/Address.js"
import * as Assets from "../../src/Assets.js"
import * as Data from "../../src/Data.js"
import * as DatumHash from "../../src/DatumHash.js"
import * as PoolKeyHash from "../../src/PoolKeyHash.js"
import * as MaestroEffect from "../../src/sdk/provider/internal/MaestroEffect.js"
import * as Transaction from "../../src/Transaction.js"
import * as TransactionHash from "../../src/TransactionHash.js"
import * as TransactionInput from "../../src/TransactionInput.js"
import {
  PREPROD_ADDRESS_BECH32,
  PREPROD_DATUM_HASH_HEX,
  PREPROD_STAKE_ADDRESS_BECH32,
  PREPROD_TX_HASH_HEX,
  PREPROD_UNIT
} from "./fixtures/constants.js"
import { evalSample1 } from "./fixtures/evaluateTx.js"

const BASE_URL = "https://preprod.gomaestro-api.org/v1"
const API_KEY = "test-key"

const POLICY_ID = PREPROD_UNIT.slice(0, 56)
const ASSET_NAME = PREPROD_UNIT.slice(56)
const POOL_ID = "pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy"

const lastUpdated =
  '"last_updated":{"timestamp":"2025-06-10 12:00:00","block_hash":"8a5a2b1d9f0e6c3e2d1b0a99f8e7d6c5b4a39281706f5e4d3c2b1a0918273645","block_slot":94668800}'

/** Route each request URL to a raw JSON body, so numbers reach the parser exactly as written */
const stubFetch = (routes: Record<string, string>) => {
  const fetchMock = vi.fn((url: string) => {
    const body = routes[url]
    return Promise.resolve(body === undefined ? new Response("not found", { status: 404 }) : new Response(body))
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const utxoJson = (index: number, lovelace: string, token: string) =>
  `{"tx_hash":"${PREPROD_TX_HASH_HEX}","index":${index},"assets":[{"unit":"lovelace","amount":${lovelace}},{"unit":"${PREPROD_UNIT}","amount":${token}}],"address":"${PREPROD_ADDRESS_BECH32}","datum":null,"reference_script":null,"txout_cbor":null}`

// Lovelace as a bare number past 2^53, the token amount as the digit string `amounts-as-strings` yields
const UTXO_0 = utxoJson(0, "45000000000000001", '"18446744073709551615"')
const UTXO_1 = utxoJson(1, '"4810000000"', '"1"')

const expectedAssets = (lovelace: bigint, token: bigint) =>
  Assets.addByHex(Assets.fromLovelace(lovelace), POLICY_ID, ASSET_NAME, token)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Maestro getProtocolParameters", () => {
  // Preprod values; max_execution_units_per_transaction.cpu is raised past 2^53 to check exact decoding
  const body = `{"data":{
    "collateral_percentage":150,
    "delegate_representative_deposit":{"ada":{"lovelace":500000000}},
    "desired_number_of_stake_pools":500,
    "governance_action_deposit":{"ada":{"lovelace":100000000000}},
    "max_collateral_inputs":3,
    "max_execution_units_per_block":{"cpu":20000000000,"memory":62000000},
    "max_execution_units_per_transaction":{"cpu":18446744073709551615,"memory":14000000},
    "max_transaction_size":{"bytes":16384},
    "max_value_size":{"bytes":5000},
    "min_fee_coefficient":44,
    "min_fee_constant":{"ada":{"lovelace":155381}},
    "min_fee_reference_scripts":{"base":15,"multiplier":1.2,"range":25600},
    "min_utxo_deposit_coefficient":4310,
    "monetary_expansion":"3/1000",
    "plutus_cost_models":{
      "plutus_v1":[100788,420,1,1,1000,173,0,1],
      "plutus_v2":[100788,420,1,1,1000,173,0,1],
      "plutus_v3":[100788,420,1,1,1000,173,0,1,1000,42921]
    },
    "protocol_version":{"major":10,"minor":0},
    "script_execution_prices":{"memory":"577/10000","cpu":"721/10000000"},
    "stake_credential_deposit":{"ada":{"lovelace":2000000}},
    "stake_pool_deposit":{"ada":{"lovelace":500000000}},
    "stake_pool_pledge_influence":"3/10",
    "treasury_expansion":"1/5"
  },${lastUpdated}}`

  it("decodes integers as bigint and converts only the number fields of the public type", async () => {
    stubFetch({ [`${BASE_URL}/protocol-parameters`]: body })

    const params = await Effect.runPromise(MaestroEffect.getProtocolParameters(BASE_URL, API_KEY))

    expect(params).toEqual({
      minFeeA: 44,
      minFeeB: 155381,
      maxTxSize: 16384,
      maxValSize: 5000,
      keyDeposit: 2000000n,
      poolDeposit: 500000000n,
      drepDeposit: 500000000n,
      govActionDeposit: 100000000000n,
      priceMem: 0.0577,
      priceStep: 0.0000721,
      maxTxExMem: 14000000n,
      maxTxExSteps: 18446744073709551615n,
      coinsPerUtxoByte: 4310n,
      collateralPercentage: 150,
      maxCollateralInputs: 3,
      minFeeRefScriptCostPerByte: 15,
      costModels: {
        PlutusV1: { 0: 100788, 1: 420, 2: 1, 3: 1, 4: 1000, 5: 173, 6: 0, 7: 1 },
        PlutusV2: { 0: 100788, 1: 420, 2: 1, 3: 1, 4: 1000, 5: 173, 6: 0, 7: 1 },
        PlutusV3: { 0: 100788, 1: 420, 2: 1, 3: 1, 4: 1000, 5: 173, 6: 0, 7: 1, 8: 1000, 9: 42921 }
      }
    })
  })

  it("keeps a fractional reference script base as a decimal", async () => {
    stubFetch({ [`${BASE_URL}/protocol-parameters`]: body.replace('"base":15', '"base":15.5') })

    const params = await Effect.runPromise(MaestroEffect.getProtocolParameters(BASE_URL, API_KEY))

    expect(params.minFeeRefScriptCostPerByte).toBe(15.5)
  })
})

describe("Maestro UTxO queries", () => {
  const utxosUrl = `${BASE_URL}/addresses/${PREPROD_ADDRESS_BECH32}/utxos`
  const pages = {
    [utxosUrl]: `{"data":[${UTXO_0}],"next_cursor":"cursor1",${lastUpdated}}`,
    [`${utxosUrl}?cursor=cursor1`]: `{"data":[${UTXO_1}],"next_cursor":null,${lastUpdated}}`
  }

  it("getUtxos follows the cursor and decodes amounts in either form exactly", async () => {
    const fetchMock = stubFetch(pages)

    const utxos = await Effect.runPromise(
      MaestroEffect.getUtxos(BASE_URL, API_KEY)(Address.fromBech32(PREPROD_ADDRESS_BECH32))
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(utxos.map((u) => u.index)).toEqual([0n, 1n])
    expect(utxos[0].assets).toEqual(expectedAssets(45000000000000001n, 18446744073709551615n))
    expect(utxos[1].assets).toEqual(expectedAssets(4810000000n, 1n))
  })

  it("getUtxosWithUnit keeps only UTxOs holding the unit", async () => {
    stubFetch({
      [utxosUrl]: `{"data":[${UTXO_0},${utxoJson(2, "2000000", '"0"').replace(PREPROD_UNIT, POLICY_ID)}],"next_cursor":null,${lastUpdated}}`
    })

    const utxos = await Effect.runPromise(
      MaestroEffect.getUtxosWithUnit(BASE_URL, API_KEY)(Address.fromBech32(PREPROD_ADDRESS_BECH32), PREPROD_UNIT)
    )

    expect(utxos.map((u) => u.index)).toEqual([0n])
  })

  it("getUtxosByOutRef matches outputs by bigint index", async () => {
    stubFetch({
      [`${BASE_URL}/transactions/${PREPROD_TX_HASH_HEX}`]: `{"data":{"tx_hash":"${PREPROD_TX_HASH_HEX}","fee":"171573","outputs":[${UTXO_0},${UTXO_1}]},${lastUpdated}}`
    })

    const utxos = await Effect.runPromise(
      MaestroEffect.getUtxosByOutRef(
        BASE_URL,
        API_KEY
      )([
        new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(PREPROD_TX_HASH_HEX), index: 0n })
      ])
    )

    expect(utxos).toHaveLength(1)
    expect(utxos[0].index).toBe(0n)
    expect(utxos[0].assets).toEqual(expectedAssets(45000000000000001n, 18446744073709551615n))
  })

  it("getUtxoByUnit resolves the asset reference to the full UTxO", async () => {
    stubFetch({
      [`${BASE_URL}/assets/${PREPROD_UNIT}/utxos?count=1`]: `{"data":[{"tx_hash":"${PREPROD_TX_HASH_HEX}","index":1,"slot":94668800,"address":"${PREPROD_ADDRESS_BECH32}","amount":"1"}],"next_cursor":null,${lastUpdated}}`,
      ...pages
    })

    const utxo = await Effect.runPromise(MaestroEffect.getUtxoByUnit(BASE_URL, API_KEY)(PREPROD_UNIT))

    expect(utxo.index).toBe(1n)
    expect(utxo.assets).toEqual(expectedAssets(4810000000n, 1n))
  })
})

describe("Maestro getDelegation", () => {
  it("decodes rewards past 2^53 exactly", async () => {
    stubFetch({
      [`${BASE_URL}/accounts/${PREPROD_STAKE_ADDRESS_BECH32}`]: `{"data":{"delegated_pool":"${POOL_ID}","registered":true,"rewards_available":9007199254740993,"stake_address":"${PREPROD_STAKE_ADDRESS_BECH32}","total_balance":9007199254740993,"total_rewarded":9007199254740993,"total_withdrawn":0,"utxo_balance":0},${lastUpdated}}`
    })

    const delegation = await Effect.runPromise(
      MaestroEffect.getDelegation(BASE_URL, API_KEY)(PREPROD_STAKE_ADDRESS_BECH32)
    )

    expect(delegation).toEqual({ poolId: PoolKeyHash.fromBech32(POOL_ID), rewards: 9007199254740993n })
  })
})

describe("Maestro evaluateTx", () => {
  it("decodes execution units exactly and converts the redeemer index to number", async () => {
    stubFetch({
      [`${BASE_URL}/transactions/evaluate`]:
        '[{"redeemer_tag":"spend","redeemer_index":0,"ex_units":{"mem":1700,"steps":9007199254740993}},{"redeemer_tag":"wdrl","redeemer_index":1,"ex_units":{"mem":"476468","steps":"133296322"}}]'
    })

    const result = await Effect.runPromise(MaestroEffect.evaluateTx(BASE_URL, API_KEY)(Transaction.fromCBORHex(evalSample1.transaction)))

    expect(result.map((r) => [r.redeemer_tag, r.redeemer_index, r.ex_units.mem, r.ex_units.steps])).toEqual([
      ["spend", 0, 1700n, 9007199254740993n],
      ["reward", 1, 476468n, 133296322n]
    ])
  })
})

describe("Maestro getDatum and awaitTx", () => {
  it("getDatum decodes the datum bytes", async () => {
    stubFetch({ [`${BASE_URL}/datums/${PREPROD_DATUM_HASH_HEX}`]: `{"data":{"bytes":"d87980","json":{"constructor":0,"fields":[]}},${lastUpdated}}` })

    const datum = await Effect.runPromise(MaestroEffect.getDatum(BASE_URL, API_KEY)(DatumHash.fromHex(PREPROD_DATUM_HASH_HEX)))

    expect(datum).toEqual(Data.fromCBORHex("d87980"))
  })

  it("awaitTx returns once the transaction has a block", async () => {
    stubFetch({
      [`${BASE_URL}/transactions/${PREPROD_TX_HASH_HEX}`]: `{"data":{"tx_hash":"${PREPROD_TX_HASH_HEX}","block_hash":"8a5a2b1d9f0e6c3e2d1b0a99f8e7d6c5b4a39281706f5e4d3c2b1a0918273645","block_height":3456789,"fee":"171573"},${lastUpdated}}`
    })

    const confirmed = await Effect.runPromise(
      MaestroEffect.awaitTx(BASE_URL, API_KEY)(TransactionHash.fromHex(PREPROD_TX_HASH_HEX))
    )

    expect(confirmed).toBe(true)
  })
})
