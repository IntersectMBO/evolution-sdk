/**
 * Koios v1.5 will send lovelace fields as JSON numbers instead of strings (#539).
 * Each read path runs against real preprod responses in both forms, with `fetch`
 * stubbed, so the provider keeps working across the switch.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as CoreAddress from "../../src/Address.js"
import * as CoreAssets from "../../src/Assets.js"
import * as PlutusData from "../../src/Data.js"
import * as DatumHash from "../../src/DatumHash.js"
import * as RewardAddress from "../../src/RewardAddress.js"
import * as ScriptHash from "../../src/ScriptHash.js"
import * as KoiosEffect from "../../src/sdk/provider/internal/KoiosEffect.js"
import * as Transaction from "../../src/Transaction.js"
import * as TransactionHash from "../../src/TransactionHash.js"
import * as TransactionInput from "../../src/TransactionInput.js"
import { evalSample1 } from "./fixtures/evaluateTx.js"

const BASE_URL = "https://koios.test/api/v1"

// Every lovelace or quantity field the provider decodes, as Koios v1.4 sends them today
const LOVELACE_FIELDS = [
  "key_deposit",
  "pool_deposit",
  "drep_deposit",
  "gov_action_deposit",
  "min_utxo_value",
  "min_pool_cost",
  "coins_per_utxo_size",
  "value",
  "balance",
  "quantity",
  "rewards_available",
  "fee",
  "deposit",
  "total_output",
  "treasury_donation"
]

type Form = "string" | "numeric"

const readFixture = (name: string): string => readFileSync(join(__dirname, "fixtures", "koios", `${name}.json`), "utf8")

/** The fixture as Koios v1.4 sends it, or with every lovelace field as a bare JSON number as v1.5 will */
const fixture = (name: string, form: Form): string =>
  form === "string"
    ? readFixture(name)
    : readFixture(name).replace(
        new RegExp(`"(${LOVELACE_FIELDS.join("|")})": "(-?\\d+)"`, "g"),
        (_match, field: string, digits: string) => `"${field}": ${digits}`
      )

const parsed = (name: string) => JSON.parse(readFixture(name))

/** Replace the first `"field": <value>` in a fixture with a bare JSON number */
const withBare = (body: string, field: string, digits: string): string =>
  body.replace(new RegExp(`"${field}": ("[^"]*"|-?[\\d.e+-]+)`), `"${field}": ${digits}`)

/** `/datum_info` row for the inline datum on the preprod script UTxO in `address_info.json` */
const DATUM_INFO = `[{
  "datum_hash": "facfe6aa45fa8023a97a3f13afb823f3966313533f6d68821e65d8431b5a4918",
  "creation_tx_hash": "23f94840ca94f7bb0a5a2b28e5b6a77e61d0414c7427e03d6c4d57b13d5e49b4",
  "value": {"fields": [{"fields": [{"int": 1740453}], "constructor": 0}, {"int": 1712190951000}], "constructor": 0},
  "bytes": "d8799fd8799f1a001a8ea5ff1b0000018ea6888e58ff"
}]`

/** Ogmios `evaluateTransaction` reply that Koios relays from `/ogmios` */
const evaluation = (cpu: string) => {
  const redeemers = [0, 1, 2, 3].map(
    (index) => `{"validator":{"index":${index},"purpose":"spend"},"budget":{"memory":26285,"cpu":${cpu}}}`
  )
  return `{"jsonrpc":"2.0","method":"evaluateTransaction","result":[${redeemers.join(",")}],"id":null}`
}

/** Serve each Koios endpoint from its fixture */
const stubKoios = (bodies: Record<string, string>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const endpoint = new URL(url).pathname.split("/").pop() ?? ""
      const body = bodies[endpoint]
      return Promise.resolve(body === undefined ? new Response("not stubbed", { status: 404 }) : new Response(body))
    })
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each<Form>(["string", "numeric"])("Koios lovelace fields as %s", (form) => {
  it("getProtocolParameters", async () => {
    stubKoios({ epoch_params: fixture("epoch_params", form) })
    const [expected] = parsed("epoch_params")

    const params = await Effect.runPromise(KoiosEffect.getProtocolParameters(BASE_URL))

    expect(params.keyDeposit).toBe(BigInt(expected.key_deposit))
    expect(params.poolDeposit).toBe(BigInt(expected.pool_deposit))
    expect(params.drepDeposit).toBe(BigInt(expected.drep_deposit))
    expect(params.govActionDeposit).toBe(BigInt(expected.gov_action_deposit))
    expect(params.coinsPerUtxoByte).toBe(BigInt(expected.coins_per_utxo_size))
    expect(params.maxTxExMem).toBe(17500000n)
    expect(params.maxTxExSteps).toBe(10000000000n)
    expect(params.minFeeA).toBe(44)
    expect(params.minFeeB).toBe(155381)
    expect(params.maxTxSize).toBe(16384)
    expect(params.maxValSize).toBe(5000)
    expect(params.collateralPercentage).toBe(150)
    expect(params.maxCollateralInputs).toBe(3)
    expect(params.priceMem).toBe(0.0577)
    expect(params.priceStep).toBe(7.21e-5)
    expect(params.minFeeRefScriptCostPerByte).toBe(15)
    // PlutusV3 carries negative entries
    expect(Object.values(params.costModels.PlutusV3)).toEqual(expected.cost_models.PlutusV3)
  })

  it("getUtxos by address", async () => {
    stubKoios({ address_info: fixture("address_info", form) })
    const [info] = parsed("address_info")
    const [plain, withAsset] = info.utxo_set
    const [asset] = withAsset.asset_list

    const utxos = await Effect.runPromise(KoiosEffect.getUtxos(BASE_URL)(CoreAddress.fromBech32(info.address)))

    expect(utxos.map((utxo) => utxo.assets.lovelace)).toEqual([BigInt(plain.value), BigInt(withAsset.value)])
    expect(utxos.map((utxo) => utxo.index)).toEqual([6n, 0n])
    expect(CoreAssets.getByUnit(utxos[1]!.assets, `${asset.policy_id}${asset.asset_name}`)).toBe(
      BigInt(asset.quantity)
    )
  })

  it("getUtxos by credential", async () => {
    stubKoios({ credential_utxos: fixture("utxo_info", form) })
    const [expected] = parsed("utxo_info")

    const [utxo] = await Effect.runPromise(
      KoiosEffect.getUtxos(BASE_URL)(ScriptHash.fromHex(expected.payment_cred))
    )

    expect(utxo!.assets.lovelace).toBe(BigInt(expected.value))
    expect(utxo!.index).toBe(BigInt(expected.tx_index))
  })

  it("getUtxosWithUnit", async () => {
    stubKoios({ address_info: fixture("address_info", form) })
    const [info] = parsed("address_info")
    const withAsset = info.utxo_set[1]
    const [asset] = withAsset.asset_list

    const utxos = await Effect.runPromise(
      KoiosEffect.getUtxosWithUnit(BASE_URL)(
        CoreAddress.fromBech32(info.address),
        `${asset.policy_id}${asset.asset_name}`
      )
    )

    expect(utxos.map((utxo) => utxo.assets.lovelace)).toEqual([BigInt(withAsset.value)])
  })

  it("getUtxosByOutRef", async () => {
    stubKoios({ utxo_info: fixture("utxo_info", form) })
    const [expected] = parsed("utxo_info")
    const input = new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex(expected.tx_hash),
      index: BigInt(expected.tx_index)
    })

    const [utxo] = await Effect.runPromise(KoiosEffect.getUtxosByOutRef(BASE_URL)([input]))

    expect(utxo!.assets.lovelace).toBe(BigInt(expected.value))
  })

  it("getUtxoByUnit", async () => {
    stubKoios({
      asset_addresses: fixture("asset_addresses", form),
      address_info: fixture("address_info", form)
    })
    const [info] = parsed("address_info")
    const withAsset = info.utxo_set[1]
    const [asset] = withAsset.asset_list

    const utxo = await Effect.runPromise(KoiosEffect.getUtxoByUnit(BASE_URL)(`${asset.policy_id}${asset.asset_name}`))

    expect(utxo.assets.lovelace).toBe(BigInt(withAsset.value))
  })

  it("getDelegation", async () => {
    stubKoios({ account_info: fixture("account_info", form) })
    const [expected] = parsed("account_info")

    const delegation = await Effect.runPromise(
      KoiosEffect.getDelegation(BASE_URL)(RewardAddress.RewardAddress.make(expected.stake_address))
    )

    expect(delegation.rewards).toBe(BigInt(expected.rewards_available))
  })

  it("awaitTx", async () => {
    stubKoios({ tx_info: fixture("tx_info", form) })
    const [expected] = parsed("tx_info")

    const confirmed = await Effect.runPromise(
      KoiosEffect.awaitTx(BASE_URL)(TransactionHash.fromHex(expected.tx_hash), 10, 1_000)
    )

    expect(confirmed).toBe(true)
  })
})

describe("Koios paths without lovelace fields", () => {
  it("getDatum", async () => {
    stubKoios({ datum_info: DATUM_INFO })
    const [expected] = JSON.parse(DATUM_INFO)

    const datum = await Effect.runPromise(KoiosEffect.getDatum(BASE_URL)(DatumHash.fromHex(expected.datum_hash)))

    expect(PlutusData.toCBORHex(datum)).toBe(expected.bytes)
  })

  it("submitTx", async () => {
    const txHash = "23f94840ca94f7bb0a5a2b28e5b6a77e61d0414c7427e03d6c4d57b13d5e49b4"
    stubKoios({ submittx: JSON.stringify(txHash) })

    const submitted = await Effect.runPromise(
      KoiosEffect.submitTx(BASE_URL)(Transaction.fromCBORHex(evalSample1.transaction))
    )

    expect(TransactionHash.toHex(submitted)).toBe(txHash)
  })

  it("evaluateTx", async () => {
    stubKoios({ ogmios: evaluation("7850649") })

    const redeemers = await Effect.runPromise(
      KoiosEffect.evaluateTx(BASE_URL)(Transaction.fromCBORHex(evalSample1.transaction), evalSample1.utxos)
    )

    expect(redeemers).toEqual(evalSample1.redeemersExUnits)
  })
})

describe("Koios integers past 2^53", () => {
  const withQuantity = (quantity: string) =>
    fixture("address_info", "string").replace(/"quantity": "\d+"/, `"quantity": ${quantity}`)

  it.each([
    ["quoted 2^64 - 1", '"18446744073709551615"', 18446744073709551615n],
    ["bare 2^64 - 1", "18446744073709551615", 18446744073709551615n],
    ["bare 2^64", "18446744073709551616", 18446744073709551616n]
  ])("decodes a %s asset quantity exactly", async (_form, quantity, expected) => {
    stubKoios({ address_info: withQuantity(quantity) })
    const [info] = parsed("address_info")
    const [asset] = info.utxo_set[1].asset_list

    const utxos = await Effect.runPromise(KoiosEffect.getUtxos(BASE_URL)(CoreAddress.fromBech32(info.address)))

    expect(CoreAssets.getByUnit(utxos[1]!.assets, `${asset.policy_id}${asset.asset_name}`)).toBe(expected)
  })

  it("decodes bare execution unit limits exactly", async () => {
    stubKoios({
      epoch_params: withBare(
        withBare(fixture("epoch_params", "numeric"), "max_tx_ex_steps", "18446744073709551615"),
        "max_tx_ex_mem",
        "9007199254740993"
      )
    })

    const params = await Effect.runPromise(KoiosEffect.getProtocolParameters(BASE_URL))

    expect(params.maxTxExSteps).toBe(18446744073709551615n)
    expect(params.maxTxExMem).toBe(9007199254740993n)
  })

  it("decodes a bare UTxO value exactly", async () => {
    stubKoios({ utxo_info: withBare(fixture("utxo_info", "numeric"), "value", "45000000000000001") })
    const [expected] = parsed("utxo_info")
    const input = new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex(expected.tx_hash),
      index: BigInt(expected.tx_index)
    })

    const [utxo] = await Effect.runPromise(KoiosEffect.getUtxosByOutRef(BASE_URL)([input]))

    expect(utxo!.assets.lovelace).toBe(45000000000000001n)
  })

  it("decodes bare available rewards exactly", async () => {
    stubKoios({
      account_info: withBare(fixture("account_info", "numeric"), "rewards_available", "45000000000000001")
    })
    const [expected] = parsed("account_info")

    const delegation = await Effect.runPromise(
      KoiosEffect.getDelegation(BASE_URL)(RewardAddress.RewardAddress.make(expected.stake_address))
    )

    expect(delegation.rewards).toBe(45000000000000001n)
  })

  it("decodes a bare execution budget exactly", async () => {
    stubKoios({ ogmios: evaluation("18446744073709551615") })

    const redeemers = await Effect.runPromise(
      KoiosEffect.evaluateTx(BASE_URL)(Transaction.fromCBORHex(evalSample1.transaction), evalSample1.utxos)
    )

    expect(redeemers.map((redeemer) => redeemer.ex_units.steps)).toEqual([
      18446744073709551615n,
      18446744073709551615n,
      18446744073709551615n,
      18446744073709551615n
    ])
  })
})
