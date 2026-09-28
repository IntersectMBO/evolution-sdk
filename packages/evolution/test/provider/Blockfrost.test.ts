/**
 * Offline tests for the Blockfrost response paths. `fetch` is stubbed with payloads
 * taken from the Blockfrost OpenAPI examples, written as raw JSON text so integers
 * past 2^53 reach the decoder exactly as the server would send them.
 */
import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as Address from "../../src/Address.js"
import * as Assets from "../../src/Assets.js"
import * as Data from "../../src/Data.js"
import * as DatumHash from "../../src/DatumHash.js"
import * as InlineDatum from "../../src/InlineDatum.js"
import * as PlutusV2 from "../../src/PlutusV2.js"
import * as PoolKeyHash from "../../src/PoolKeyHash.js"
import * as RewardAddress from "../../src/RewardAddress.js"
import * as Blockfrost from "../../src/sdk/provider/internal/Blockfrost.js"
import * as BlockfrostEffect from "../../src/sdk/provider/internal/BlockfrostEffect.js"
import * as HttpUtils from "../../src/sdk/provider/internal/HttpUtils.js"
import * as Transaction from "../../src/Transaction.js"
import * as TransactionHash from "../../src/TransactionHash.js"
import * as TransactionInput from "../../src/TransactionInput.js"
import { evalSample1 } from "./fixtures/evaluateTx.js"

const BASE = "https://blockfrost.test/api/v0"
const PROJECT_ID = "mainnetTestProjectId"

/** Serve each path from a raw JSON body; anything else is a 404 like Blockfrost's */
const stubRoutes = (routes: Record<string, string>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = routes[url.slice(BASE.length)]
      return Promise.resolve(
        body === undefined ? new Response('{"status_code":404}', { status: 404 }) : new Response(body, { status: 200 })
      )
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const ADDRESS =
  "addr1qxqs59lphg8g6qndelq8xwqn60ag3aeyfcp33c2kdp46a09re5df3pzwwmyq946axfcejy5n4x0y99wqpgtp2gd0k09qsgy6pz"
const TOKEN_UNIT = "b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e"
const DATUM_HASH = "9e478573ab81ea7a8e31891ce0648b81229f408d596a3483e6f4f9b92d3cf710"
const SCRIPT_HASH = "13a3efd825703a352a8f71f4e2758d08c28c564e8dfcce9f77776ad1"
const SCRIPT_CBOR = "4e4d01000033222220051200120011"
const TX_HASH = "768c63e27a1c816a83dc7b07e78af673b2400de8849ea7e7b734ae1333d100d2"

// /epochs/latest/parameters, from the OpenAPI example with the cost models shortened
const PROTOCOL_PARAMETERS = `{
  "epoch": 225,
  "min_fee_a": 44,
  "min_fee_b": 155381,
  "max_block_size": 65536,
  "max_tx_size": 16384,
  "max_block_header_size": 1100,
  "key_deposit": "2000000",
  "pool_deposit": "500000000",
  "e_max": 18,
  "n_opt": 150,
  "a0": 0.3,
  "rho": 0.003,
  "tau": 0.2,
  "decentralisation_param": 0.5,
  "extra_entropy": null,
  "protocol_major_ver": 2,
  "protocol_minor_ver": 0,
  "min_utxo": "1000000",
  "min_pool_cost": "340000000",
  "nonce": "1a3be38bcbb7911969283716ad7aa550250226b76a61fc51cc9a9a35d9276d81",
  "cost_models": {
    "PlutusV1": { "addInteger-cpu-arguments-intercept": 197209, "addInteger-cpu-arguments-slope": 0 },
    "PlutusV2": { "addInteger-cpu-arguments-intercept": 197209, "addInteger-cpu-arguments-slope": 0 },
    "PlutusV3": { "addInteger-cpu-arguments-intercept": 100788, "addInteger-cpu-arguments-slope": 420 }
  },
  "cost_models_raw": {
    "PlutusV1": [100788, 420, 1, 1, 1000, 173],
    "PlutusV2": [100788, 420, 1, 1, 1000, 173],
    "PlutusV3": [100788, 420, 1, 1, 1000, 173]
  },
  "price_mem": 0.0577,
  "price_step": 0.0000721,
  "max_tx_ex_mem": "10000000",
  "max_tx_ex_steps": "10000000000",
  "max_block_ex_mem": "50000000",
  "max_block_ex_steps": "40000000000",
  "max_val_size": "5000",
  "collateral_percent": 150,
  "max_collateral_inputs": 3,
  "coins_per_utxo_size": "34482",
  "coins_per_utxo_word": "34482",
  "gov_action_deposit": "100000000000",
  "drep_deposit": "500000000",
  "min_fee_ref_script_cost_per_byte": 15
}`

// /addresses/{address}/utxos, from the OpenAPI example with tx_index as real responses send it,
// a token quantity at the uint64 limit and a reference script on the last output
const ADDRESS_UTXOS = `[
  {
    "address": "${ADDRESS}",
    "tx_hash": "39a7a284c2a0948189dc45dec670211cd4d72f7b66c5726c08d9b3df11e44d58",
    "tx_index": 0,
    "output_index": 0,
    "amount": [{ "unit": "lovelace", "quantity": "42000000" }],
    "block": "7eb8e27d18686c7db9a18f8bbcfe34e3fed6e047afaa2d969904d15e934847e6",
    "data_hash": "${DATUM_HASH}",
    "inline_datum": null,
    "reference_script_hash": null
  },
  {
    "address": "${ADDRESS}",
    "tx_hash": "${TX_HASH}",
    "tx_index": 9007199254740993,
    "output_index": 1,
    "amount": [
      { "unit": "lovelace", "quantity": "42000000" },
      { "unit": "${TOKEN_UNIT}", "quantity": "18446744073709551615" }
    ],
    "block": "5c571f83fe6c784d3fbc223792627ccf0eea96773100f9aedecf8b1eda4544d7",
    "data_hash": null,
    "inline_datum": "19a6aa",
    "reference_script_hash": "${SCRIPT_HASH}"
  }
]`

const SCRIPT_ROUTES = {
  [`/scripts/${SCRIPT_HASH}`]: `{"script_hash":"${SCRIPT_HASH}","type":"plutusV2","serialised_size":15}`,
  [`/scripts/${SCRIPT_HASH}/cbor`]: `{"cbor":"${SCRIPT_CBOR}"}`,
  [`/scripts/datum/${DATUM_HASH}/cbor`]: `{"cbor":"19a6aa"}`
}

const expectAddressUtxos = (utxos: ReadonlyArray<{ readonly index: bigint; readonly assets: Assets.Assets }>) => {
  expect(utxos.map((utxo) => utxo.index)).toEqual([0n, 1n])
  expect(utxos[0].assets.lovelace).toBe(42000000n)
  expect(Assets.getByUnit(utxos[1].assets, TOKEN_UNIT)).toBe(18446744073709551615n)
}

describe("Blockfrost getProtocolParameters", () => {
  it("maps the parameters, keeping integers exact and decimals as numbers", async () => {
    stubRoutes({ "/epochs/latest/parameters": PROTOCOL_PARAMETERS })

    const params = await Effect.runPromise(BlockfrostEffect.getProtocolParameters(BASE, PROJECT_ID))

    expect(params).toEqual({
      minFeeA: 44,
      minFeeB: 155381,
      poolDeposit: 500000000n,
      keyDeposit: 2000000n,
      maxTxSize: 16384,
      maxValSize: 5000,
      priceMem: 0.0577,
      priceStep: 0.0000721,
      maxTxExMem: 10000000n,
      maxTxExSteps: 10000000000n,
      coinsPerUtxoByte: 34482n,
      collateralPercentage: 150,
      maxCollateralInputs: 3,
      minFeeRefScriptCostPerByte: 15,
      drepDeposit: 500000000n,
      govActionDeposit: 100000000000n,
      costModels: {
        PlutusV1: { 0: 100788, 1: 420, 2: 1, 3: 1, 4: 1000, 5: 173 },
        PlutusV2: { 0: 100788, 1: 420, 2: 1, 3: 1, 4: 1000, 5: 173 },
        PlutusV3: { 0: 100788, 1: 420, 2: 1, 3: 1, 4: 1000, 5: 173 }
      }
    })
  })

  it("falls back to the named cost models as numbers", async () => {
    stubRoutes({ "/epochs/latest/parameters": PROTOCOL_PARAMETERS.replace(/"cost_models_raw": \{[^}]*\},/, "") })

    const params = await Effect.runPromise(BlockfrostEffect.getProtocolParameters(BASE, PROJECT_ID))

    expect(params.costModels.PlutusV3).toEqual({
      "addInteger-cpu-arguments-intercept": 100788,
      "addInteger-cpu-arguments-slope": 420
    })
  })

  it("decodes an integer past 2^53 exactly", async () => {
    stubRoutes({
      "/epochs/latest/parameters": PROTOCOL_PARAMETERS.replace(
        '"max_block_size": 65536',
        '"max_block_size": 18446744073709551616'
      )
    })

    const params = await Effect.runPromise(
      HttpUtils.get(`${BASE}/epochs/latest/parameters`, Blockfrost.BlockfrostProtocolParameters)
    )

    expect(params.max_block_size).toBe(18446744073709551616n)
    expect(params.price_step).toBe(0.0000721)
  })
})

describe("Blockfrost UTxO queries", () => {
  it("getUtxos resolves datums and scripts and keeps quantities exact", async () => {
    stubRoutes({ [`/addresses/${ADDRESS}/utxos?page=1&count=100`]: ADDRESS_UTXOS, ...SCRIPT_ROUTES })

    const utxos = await Effect.runPromise(
      BlockfrostEffect.getUtxos(BASE, PROJECT_ID)(Address.fromBech32(ADDRESS))
    )

    expectAddressUtxos(utxos)
    expect(utxos[0].datumOption).toEqual(new InlineDatum.InlineDatum({ data: Data.fromCBORHex("19a6aa") }))
    expect(utxos[1].scriptRef).toBeInstanceOf(PlutusV2.PlutusV2)
  })

  it("decodes tx_index past 2^53 exactly", async () => {
    stubRoutes({ "/utxos": ADDRESS_UTXOS })

    const utxos = await Effect.runPromise(HttpUtils.get(`${BASE}/utxos`, Schema.Array(Blockfrost.BlockfrostUTxO)))

    expect(utxos[1].tx_index).toBe(9007199254740993n)
    expect(utxos[1].amount[1].quantity).toBe(18446744073709551615n)
  })

  it("getUtxosWithUnit reads the unit-filtered listing", async () => {
    stubRoutes({ [`/addresses/${ADDRESS}/utxos/${TOKEN_UNIT}?page=1&count=100`]: ADDRESS_UTXOS, ...SCRIPT_ROUTES })

    const utxos = await Effect.runPromise(
      BlockfrostEffect.getUtxosWithUnit(BASE, PROJECT_ID)(Address.fromBech32(ADDRESS), TOKEN_UNIT)
    )

    expectAddressUtxos(utxos)
  })

  it("getUtxoByUnit reads the holder then its UTxO", async () => {
    stubRoutes({
      // /assets/{asset}/addresses, from the OpenAPI example
      [`/assets/${TOKEN_UNIT}/addresses`]: `[{"address":"${ADDRESS}","quantity":"18446744073709551615"}]`,
      [`/addresses/${ADDRESS}/utxos/${TOKEN_UNIT}`]: `[${ADDRESS_UTXOS.slice(ADDRESS_UTXOS.indexOf("},") + 2)}`,
      ...SCRIPT_ROUTES
    })

    const utxo = await Effect.runPromise(BlockfrostEffect.getUtxoByUnit(BASE, PROJECT_ID)(TOKEN_UNIT))

    expect(utxo.index).toBe(1n)
    expect(Assets.getByUnit(utxo.assets, TOKEN_UNIT)).toBe(18446744073709551615n)
  })

  it("getUtxosByOutRef picks the requested output", async () => {
    stubRoutes({
      // /txs/{hash}/utxos, from the OpenAPI example
      [`/txs/${TX_HASH}/utxos`]: `{
        "hash": "${TX_HASH}",
        "inputs": [{
          "address": "${ADDRESS}",
          "amount": [{ "unit": "lovelace", "quantity": "42000000" }],
          "tx_hash": "1a0570af966fb355a7160e4f82d5a80b8681b7955f5d44bec0dce628516157f0",
          "output_index": 0,
          "data_hash": null,
          "inline_datum": null,
          "reference_script_hash": null,
          "collateral": false,
          "reference": false
        }],
        "outputs": [
          {
            "address": "${ADDRESS}",
            "amount": [{ "unit": "lovelace", "quantity": "42000000" }],
            "output_index": 0,
            "data_hash": null,
            "inline_datum": null,
            "collateral": false,
            "reference_script_hash": null,
            "consumed_by_tx": null
          },
          {
            "address": "${ADDRESS}",
            "amount": [
              { "unit": "lovelace", "quantity": "18446744073709551615" },
              { "unit": "${TOKEN_UNIT}", "quantity": "12" }
            ],
            "output_index": 1,
            "data_hash": "${DATUM_HASH}",
            "inline_datum": null,
            "collateral": false,
            "reference_script_hash": null,
            "consumed_by_tx": "66c29b56952f6085afac3b0632d781af78d020b080063bcfd6c54b8e2b8fed41"
          }
        ]
      }`
    })

    const utxos = await Effect.runPromise(
      BlockfrostEffect.getUtxosByOutRef(BASE, PROJECT_ID)([
        new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(TX_HASH), index: 1n })
      ])
    )

    expect(utxos).toHaveLength(1)
    expect(utxos[0].index).toBe(1n)
    expect(utxos[0].assets.lovelace).toBe(18446744073709551615n)
    // No datum route is stubbed, so the hash is kept
    expect(utxos[0].datumOption).toEqual(DatumHash.fromHex(DATUM_HASH))
  })
})

describe("Blockfrost getDelegation", () => {
  // /accounts/{stake_address}, from the OpenAPI example with an active_epoch past 2^53
  const STAKE_ADDRESS = "stake1ux3g2c9dx2nhhehyrezyxpkstartcqmu9hk63qgfkccw5rqttygt7"
  const POOL_ID = "pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy"
  const ACCOUNT = `{
    "stake_address": "${STAKE_ADDRESS}",
    "active": true,
    "registered": true,
    "active_epoch": 9007199254740993,
    "controlled_amount": "619154618165",
    "rewards_sum": "319154618165",
    "withdrawals_sum": "12125369253",
    "reserves_sum": "319154618165",
    "treasury_sum": "12000000",
    "withdrawable_amount": "18446744073709551616",
    "pool_id": "${POOL_ID}",
    "drep_id": "drep15cfxz9exyn5rx0807zvxfrvslrjqfchrd4d47kv9e0f46uedqtc"
  }`

  it("maps the pool and withdrawable rewards exactly", async () => {
    stubRoutes({ [`/accounts/${STAKE_ADDRESS}`]: ACCOUNT })

    const delegation = await Effect.runPromise(
      BlockfrostEffect.getDelegation(BASE, PROJECT_ID)(RewardAddress.RewardAddress.make(STAKE_ADDRESS))
    )

    expect(delegation).toEqual({
      poolId: Schema.decodeSync(PoolKeyHash.FromBech32)(POOL_ID),
      rewards: 18446744073709551616n
    })
  })

  it("decodes active_epoch past 2^53 exactly", async () => {
    stubRoutes({ [`/accounts/${STAKE_ADDRESS}`]: ACCOUNT })

    const account = await Effect.runPromise(
      HttpUtils.get(`${BASE}/accounts/${STAKE_ADDRESS}`, Blockfrost.BlockfrostDelegation)
    )

    expect(account.active_epoch).toBe(9007199254740993n)
    expect(account.controlled_amount).toBe(619154618165n)
  })
})

describe("Blockfrost other endpoints", () => {
  it("getDatum parses the datum CBOR", async () => {
    stubRoutes({ [`/scripts/datum/${DATUM_HASH}/cbor`]: `{"cbor":"19a6aa"}` })

    const datum = await Effect.runPromise(BlockfrostEffect.getDatum(BASE, PROJECT_ID)(DatumHash.fromHex(DATUM_HASH)))

    expect(datum).toEqual(Data.fromCBORHex("19a6aa"))
  })

  it("awaitTx succeeds once the transaction is found", async () => {
    stubRoutes({
      // /txs/{hash}, trimmed from the OpenAPI example
      [`/txs/${TX_HASH}`]: `{"hash":"${TX_HASH}","block_height":123456,"slot":42000000,"index":1,"fees":"182485","size":433}`
    })

    const found = await Effect.runPromise(BlockfrostEffect.awaitTx(BASE, PROJECT_ID)(TransactionHash.fromHex(TX_HASH)))

    expect(found).toBe(true)
  })

  it("submitTx returns the hash from the JSON string body", async () => {
    const tx = Transaction.fromCBORHex(evalSample1.transaction)
    stubRoutes({ "/tx/submit": `"${TX_HASH}"` })

    const hash = await Effect.runPromise(BlockfrostEffect.submitTx(BASE, PROJECT_ID)(tx))

    expect(TransactionHash.toHex(hash)).toBe(TX_HASH)
  })

  it("evaluateTx reads execution units past 2^53 exactly", async () => {
    const tx = Transaction.fromCBORHex(evalSample1.transaction)
    stubRoutes({
      // Ogmios v5 JSONWSP EvaluateTx response, as Blockfrost relays it
      "/utils/txs/evaluate/utxos": `{
        "type": "jsonwsp/response",
        "version": "1.0",
        "servicename": "ogmios",
        "methodname": "EvaluateTx",
        "result": {
          "EvaluationResult": {
            "spend:0": { "memory": 26285, "steps": 7850649 },
            "certificate:1": { "memory": 9007199254740993, "steps": 18446744073709551615 }
          }
        },
        "reflection": { "id": "0f5a0a6c-4d7b-4b4a-9d3b-3f4c1d2e5a6b" }
      }`
    })

    const redeemers = await Effect.runPromise(BlockfrostEffect.evaluateTx(BASE, PROJECT_ID)(tx))

    expect(redeemers.map((r) => [r.redeemer_tag, r.redeemer_index, r.ex_units.mem, r.ex_units.steps])).toEqual([
      ["spend", 0, 26285n, 7850649n],
      ["cert", 1, 9007199254740993n, 18446744073709551615n]
    ])
  })
})
