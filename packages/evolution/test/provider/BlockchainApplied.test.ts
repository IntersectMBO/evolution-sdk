/**
 * Offline tests for the Blockchain Applied (BCA) provider. `fetch` is stubbed with response
 * bodies recorded from the BCA preprod API (cost models shortened, `/tx` trimmed to its header
 * fields), so no test needs a BCA token.
 */
import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as Address from "../../src/Address.js"
import * as Assets from "../../src/Assets.js"
import * as Bytes from "../../src/Bytes.js"
import * as Credential from "../../src/Credential.js"
import * as Data from "../../src/Data.js"
import * as DatumHash from "../../src/DatumHash.js"
import * as InlineDatum from "../../src/InlineDatum.js"
import * as KeyHash from "../../src/KeyHash.js"
import * as NativeScripts from "../../src/NativeScripts.js"
import * as PoolKeyHash from "../../src/PoolKeyHash.js"
import * as BlockchainAppliedEffect from "../../src/sdk/provider/internal/BlockchainAppliedEffect.js"
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

const BASE_URL = "https://api.blockchain-applied.com/api_preprod/v1"
const TOKEN = "test-token"

type Route = string | { readonly status: number; readonly body: string }

/**
 * Route each request URL to a raw JSON body, so numbers reach the parser exactly as written.
 * An array answers successive requests in order (the last entry repeats).
 */
const stubFetch = (routes: Record<string, Route | ReadonlyArray<Route>>) => {
  const served: Record<string, number> = {}
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    const entry = routes[url]
    const route = Array.isArray(entry) ? entry[Math.min((served[url] = (served[url] ?? -1) + 1), entry.length - 1)] : entry
    if (route === undefined) return Promise.resolve(new Response('{"error":"not found"}', { status: 404 }))
    return Promise.resolve(
      typeof route === "string" ? new Response(route) : new Response(route.body, { status: route.status })
    )
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const page = (url: string, n: number) => `${url}?page=${n}&pagesize=100`

const fail = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(Effect.flip(effect))

afterEach(() => {
  vi.unstubAllGlobals()
})

// Recorded from GET /utxos/{PREPROD_ADDRESS_BECH32}
const UTXO_ADA_ONLY = `{"tx_hash":"2c8f45e2aa58c7bb25739da28786cce97a97cd346107bb372807fabde323ab96","output_index":1,"address":"${PREPROD_ADDRESS_BECH32}","lovelace":"2186901580","assets":[],"datum_hash":null,"reference_script_hash":null,"inline_datum":null,"reference_script_cbor":null,"reference_script_type":null}`
const UTXO_TOKENS = `{"tx_hash":"e0568183b00d1a7625a97ba1792a7506aafc96719c0643fbb021ae75c9d815a4","output_index":1,"address":"${PREPROD_ADDRESS_BECH32}","lovelace":"2425818","assets":[{"policy_id":"2b172b4b0141058c3a5ee855cfa0f52f85808e3d3aba47f5a44cbd5e","asset_name":"69455448","quantity":"1"},{"policy_id":"d088875616229b83868ac5596e77288d8b5c9dffc2f748d8df6332b6","asset_name":"74494e4459","quantity":"9997000000"}],"datum_hash":null,"reference_script_hash":null,"inline_datum":null,"reference_script_cbor":null,"reference_script_type":null}`
const TOKEN_UNIT = "d088875616229b83868ac5596e77288d8b5c9dffc2f748d8df6332b674494e4459"

// Recorded from GET /utxo/{PREPROD_TX_HASH_HEX}/0: an inline datum, whose hash is set too
const INLINE_DATUM_CBOR = "d8799fd8799f1a001a8ea5ff1b0000018ea6888e58ff"
const UTXO_INLINE_DATUM = `{"tx_hash":"${PREPROD_TX_HASH_HEX}","output_index":0,"address":"addr_test1wz7uytdxstxe4nhdtl2gj9rcnlyce99tc707mz6qewxyx9qac0urr","lovelace":"2000000","assets":[{"policy_id":"ec0f50624331d0df45f40ab0e6081e5f1ff577c5c4dc767079d4fe59","asset_name":"695553443230323430343033313833343534","quantity":"1"}],"datum_hash":"${PREPROD_DATUM_HASH_HEX}","reference_script_hash":null,"inline_datum":"${INLINE_DATUM_CBOR}","reference_script_cbor":null,"reference_script_type":null}`
// The same output with only a datum hash
const UTXO_DATUM_HASH = UTXO_INLINE_DATUM.replace(`"inline_datum":"${INLINE_DATUM_CBOR}"`, '"inline_datum":null')

// A native reference script, its CBOR rebuilt by the API from db-sync's script JSON
const NATIVE_SCRIPT = NativeScripts.makeScriptPubKey(Bytes.fromHex("e09d36c79dec9bd1b3d9e152247701cd0bb860b5ebfd1de8abb6735a"))
const NATIVE_SCRIPT_HASH = "208bdcaf2d83ae026964e23659c703a377473168a39cbdc2b0241115"
const UTXO_NATIVE_SCRIPT = UTXO_ADA_ONLY.replace(
  '"reference_script_hash":null',
  `"reference_script_hash":"${NATIVE_SCRIPT_HASH}"`
)
  .replace('"reference_script_cbor":null', `"reference_script_cbor":"${NativeScripts.toCBORHex(NATIVE_SCRIPT)}"`)
  .replace('"reference_script_type":null', '"reference_script_type":"timelock"')
// A reference script the API returned no CBOR for
const UTXO_SCRIPT_NO_CBOR = UTXO_NATIVE_SCRIPT.replace(/"reference_script_cbor":"[0-9a-f]+"/, '"reference_script_cbor":null')

const paged = (items: ReadonlyArray<string>, n: number, hasNext: boolean) =>
  `{"data":[${items.join(",")}],"page":${n},"page_size":100,"has_next":${hasNext}}`

describe("BlockchainApplied getProtocolParameters", () => {
  // Recorded from preprod epoch 321, cost models shortened
  const body = `{"epoch_no":321,"min_fee_a":44,"min_fee_b":155381,"max_tx_size":16384,"max_val_size":5000,"key_deposit":"2000000","pool_deposit":"500000000","drep_deposit":"500000000","gov_action_deposit":"1000000000","price_mem":0.0577,"price_step":0.0000721,"max_tx_ex_mem":"17500000","max_tx_ex_steps":"18446744073709551615","coins_per_utxo_size":"4310","collateral_percentage":150,"max_collateral_inputs":3,"min_fee_ref_script_cost_per_byte":15,"cost_models":{"PlutusV1":[100788,420,1,1],"PlutusV2":[100788,420,1,1,1000],"PlutusV3":[100788,420,1,1,1000,173]}}`
  const url = `${BASE_URL}/protocol_parameters/latest`

  it("decodes the parameters and keeps the cost model order", async () => {
    stubFetch({ [url]: body })

    const params = await Effect.runPromise(BlockchainAppliedEffect.getProtocolParameters(BASE_URL, TOKEN))

    expect(params).toEqual({
      minFeeA: 44,
      minFeeB: 155381,
      maxTxSize: 16384,
      maxValSize: 5000,
      keyDeposit: 2000000n,
      poolDeposit: 500000000n,
      drepDeposit: 500000000n,
      govActionDeposit: 1000000000n,
      priceMem: 0.0577,
      priceStep: 0.0000721,
      maxTxExMem: 17500000n,
      maxTxExSteps: 18446744073709551615n,
      coinsPerUtxoByte: 4310n,
      collateralPercentage: 150,
      maxCollateralInputs: 3,
      minFeeRefScriptCostPerByte: 15,
      costModels: {
        PlutusV1: { 0: 100788, 1: 420, 2: 1, 3: 1 },
        PlutusV2: { 0: 100788, 1: 420, 2: 1, 3: 1, 4: 1000 },
        PlutusV3: { 0: 100788, 1: 420, 2: 1, 3: 1, 4: 1000, 5: 173 }
      }
    })
  })

  it("fails when coins_per_utxo_size is missing", async () => {
    stubFetch({ [url]: body.replace('"coins_per_utxo_size":"4310",', "") })

    const error = await fail(BlockchainAppliedEffect.getProtocolParameters(BASE_URL, TOKEN))

    expect(error._tag).toBe("ProviderError")
  })

  it("fails when min_fee_ref_script_cost_per_byte is null", async () => {
    stubFetch({ [url]: body.replace('"min_fee_ref_script_cost_per_byte":15', '"min_fee_ref_script_cost_per_byte":null') })

    const error = await fail(BlockchainAppliedEffect.getProtocolParameters(BASE_URL, TOKEN))

    expect(error._tag).toBe("ProviderError")
  })

  it("fails on cost models keyed by parameter name", async () => {
    stubFetch({ [url]: body.replace('"PlutusV1":[100788,420,1,1]', '"PlutusV1":{"addInteger-cpu-arguments-intercept":100788}') })

    const error = await fail(BlockchainAppliedEffect.getProtocolParameters(BASE_URL, TOKEN))

    expect(error._tag).toBe("ProviderError")
  })
})

describe("BlockchainApplied UTxO queries", () => {
  const utxosUrl = `${BASE_URL}/utxos/${PREPROD_ADDRESS_BECH32}`
  const pages = {
    [page(utxosUrl, 0)]: paged([UTXO_ADA_ONLY], 0, true),
    [page(utxosUrl, 1)]: paged([UTXO_TOKENS], 1, false)
  }

  it("getUtxos follows has_next across pages", async () => {
    const fetchMock = stubFetch(pages)

    const utxos = await Effect.runPromise(
      BlockchainAppliedEffect.getUtxos(BASE_URL, TOKEN)(Address.fromBech32(PREPROD_ADDRESS_BECH32))
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(utxos.map((u) => TransactionHash.toHex(u.transactionId))).toEqual([
      "2c8f45e2aa58c7bb25739da28786cce97a97cd346107bb372807fabde323ab96",
      "e0568183b00d1a7625a97ba1792a7506aafc96719c0643fbb021ae75c9d815a4"
    ])
    expect(utxos[0].assets).toEqual(Assets.fromLovelace(2186901580n))
    expect(utxos[1].assets).toEqual(
      Assets.addByHex(
        Assets.addByHex(Assets.fromLovelace(2425818n), "2b172b4b0141058c3a5ee855cfa0f52f85808e3d3aba47f5a44cbd5e", "69455448", 1n),
        "d088875616229b83868ac5596e77288d8b5c9dffc2f748d8df6332b6",
        "74494e4459",
        9997000000n
      )
    )
  })

  it("getUtxos queries a payment credential by its bech32 form", async () => {
    const credential = Credential.makeKeyHash(KeyHash.fromHex("c035d6e2a3c89bf7aa0f22b1bf5fe2d8a51f7e2f3e8b1a8db9d7e844").hash)
    const credentialUrl = `${BASE_URL}/utxos/${Credential.toBech32(credential)}`
    stubFetch({ [page(credentialUrl, 0)]: paged([UTXO_ADA_ONLY], 0, false) })

    const utxos = await Effect.runPromise(BlockchainAppliedEffect.getUtxos(BASE_URL, TOKEN)(credential))

    expect(credentialUrl).toContain("/utxos/addr_vkh1")
    expect(utxos).toHaveLength(1)
  })

  it("getUtxosWithUnit keeps only UTxOs holding the unit", async () => {
    stubFetch(pages)

    const utxos = await Effect.runPromise(
      BlockchainAppliedEffect.getUtxosWithUnit(BASE_URL, TOKEN)(Address.fromBech32(PREPROD_ADDRESS_BECH32), TOKEN_UNIT)
    )

    expect(utxos.map((u) => u.index)).toEqual([1n])
    expect(TransactionHash.toHex(utxos[0].transactionId)).toBe(
      "e0568183b00d1a7625a97ba1792a7506aafc96719c0643fbb021ae75c9d815a4"
    )
  })

  it("getUtxoByUnit returns the single holder", async () => {
    stubFetch({ [page(`${BASE_URL}/assets/${PREPROD_UNIT}/utxos`, 0)]: paged([UTXO_INLINE_DATUM], 0, false) })

    const utxo = await Effect.runPromise(BlockchainAppliedEffect.getUtxoByUnit(BASE_URL, TOKEN)(PREPROD_UNIT))

    expect(utxo.index).toBe(0n)
  })

  it("getUtxoByUnit fails when several UTxOs hold the unit", async () => {
    stubFetch({ [page(`${BASE_URL}/assets/${PREPROD_UNIT}/utxos`, 0)]: paged([UTXO_ADA_ONLY, UTXO_TOKENS], 0, false) })

    const error = await fail(BlockchainAppliedEffect.getUtxoByUnit(BASE_URL, TOKEN)(PREPROD_UNIT))

    expect(error._tag).toBe("ProviderError")
  })

  it("getUtxosByOutRef skips out-refs that 404", async () => {
    stubFetch({ [`${BASE_URL}/utxo/${PREPROD_TX_HASH_HEX}/0`]: UTXO_INLINE_DATUM })
    const outRef = (index: bigint) =>
      new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(PREPROD_TX_HASH_HEX), index })

    const utxos = await Effect.runPromise(
      BlockchainAppliedEffect.getUtxosByOutRef(BASE_URL, TOKEN)([outRef(0n), outRef(7n)])
    )

    expect(utxos.map((u) => u.index)).toEqual([0n])
  })
})

describe("BlockchainApplied datums and reference scripts on UTxOs", () => {
  const outRefUrl = `${BASE_URL}/utxo/${PREPROD_TX_HASH_HEX}/0`
  const resolve = () =>
    BlockchainAppliedEffect.getUtxosByOutRef(
      BASE_URL,
      TOKEN
    )([new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(PREPROD_TX_HASH_HEX), index: 0n })])

  it("an inline datum becomes an InlineDatum", async () => {
    stubFetch({ [outRefUrl]: UTXO_INLINE_DATUM })

    const [utxo] = await Effect.runPromise(resolve())

    expect(utxo.datumOption).toEqual(new InlineDatum.InlineDatum({ data: Data.fromCBORHex(INLINE_DATUM_CBOR) }))
  })

  it("a hash-only datum stays a DatumHash, without fetching the datum", async () => {
    const fetchMock = stubFetch({ [outRefUrl]: UTXO_DATUM_HASH })

    const [utxo] = await Effect.runPromise(resolve())

    expect(utxo.datumOption).toEqual(DatumHash.fromHex(PREPROD_DATUM_HASH_HEX))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("decodes a native reference script", async () => {
    stubFetch({ [outRefUrl]: UTXO_NATIVE_SCRIPT })

    const [utxo] = await Effect.runPromise(resolve())

    expect(utxo.scriptRef).toEqual(NATIVE_SCRIPT)
  })

  it("fails when a reference script comes without its CBOR", async () => {
    stubFetch({ [outRefUrl]: UTXO_SCRIPT_NO_CBOR })

    const error = await fail(resolve())

    expect(error._tag).toBe("ProviderError")
  })
})

describe("BlockchainApplied getDelegation", () => {
  const url = `${BASE_URL}/staking/${PREPROD_STAKE_ADDRESS_BECH32}`

  it("returns the pool and the withdrawable rewards", async () => {
    // Recorded
    stubFetch({
      [url]: `{"address":"${PREPROD_STAKE_ADDRESS_BECH32}","pool_id":"pool1mp96jpc2dtaruz0cazmljh03dev0969c4rq3wr6hnc4rjdxn8aw","active_epoch":30,"delegation_tx":"a7412e82b9d556162230faa0090535b499160c45766ea429e53e829ed8fe0c04","total_rewards":"147911340884","total_withdrawn":"94929392428","withdrawable_rewards":"52981948456"}`
    })

    const delegation = await Effect.runPromise(
      BlockchainAppliedEffect.getDelegation(BASE_URL, TOKEN)(PREPROD_STAKE_ADDRESS_BECH32)
    )

    expect(delegation).toEqual({
      poolId: PoolKeyHash.fromBech32("pool1mp96jpc2dtaruz0cazmljh03dev0969c4rq3wr6hnc4rjdxn8aw"),
      rewards: 52981948456n
    })
  })

  it("returns no pool and no rewards for an unknown stake address", async () => {
    stubFetch({})

    const delegation = await Effect.runPromise(
      BlockchainAppliedEffect.getDelegation(BASE_URL, TOKEN)(PREPROD_STAKE_ADDRESS_BECH32)
    )

    expect(delegation).toEqual({ poolId: null, rewards: 0n })
  })
})

describe("BlockchainApplied getDatum", () => {
  it("decodes the datum bytes", async () => {
    // Recorded
    stubFetch({
      [`${BASE_URL}/datum/${PREPROD_DATUM_HASH_HEX}`]: `{"summary":"datum","details":{"hash":"${PREPROD_DATUM_HASH_HEX}","tx_hash":"${PREPROD_TX_HASH_HEX}","json":{"constructor":0,"fields":[{"constructor":0,"fields":[{"int":1740453}]},{"int":1712190951000}]},"bytes":"${INLINE_DATUM_CBOR}"}}`
    })

    const datum = await Effect.runPromise(
      BlockchainAppliedEffect.getDatum(BASE_URL, TOKEN)(DatumHash.fromHex(PREPROD_DATUM_HASH_HEX))
    )

    expect(datum).toEqual(Data.fromCBORHex(INLINE_DATUM_CBOR))
  })
})

describe("BlockchainApplied awaitTx", () => {
  const url = `${BASE_URL}/tx/${PREPROD_TX_HASH_HEX}`
  // Recorded, trimmed to the header fields
  const confirmed = `{"hash":"${PREPROD_TX_HASH_HEX}","block_index":1,"epoch_no":129,"fee":"190713","inputs":[],"outputs":[]}`
  const notFound = { status: 404, body: '{"error":"Transaction not found"}' }

  it("polls while the transaction 404s, then returns", async () => {
    const fetchMock = stubFetch({ [url]: [notFound, notFound, confirmed] })

    const result = await Effect.runPromise(
      BlockchainAppliedEffect.awaitTx(BASE_URL, TOKEN)(TransactionHash.fromHex(PREPROD_TX_HASH_HEX), 10, 5_000)
    )

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("fails at once on a 401 instead of polling until the timeout", async () => {
    const fetchMock = stubFetch({ [url]: { status: 401, body: '{"error":"Unauthorized"}' } })

    const error = await fail(
      BlockchainAppliedEffect.awaitTx(BASE_URL, TOKEN)(TransactionHash.fromHex(PREPROD_TX_HASH_HEX), 10, 5_000)
    )

    expect(error._tag).toBe("ProviderError")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("BlockchainApplied submitTx and evaluateTx", () => {
  const tx = Transaction.fromCBORHex(evalSample1.transaction)

  it("submitTx posts the CBOR bytes and returns the hash", async () => {
    const txHash = "7e6378266748b08a44c24682af0e46384e7a58b1a7b71b44e84a24f35444ffba"
    const fetchMock = stubFetch({ [`${BASE_URL}/tx/submit`]: `{"tx_hash":"${txHash}"}` })

    const result = await Effect.runPromise(BlockchainAppliedEffect.submitTx(BASE_URL, TOKEN)(tx))

    expect(TransactionHash.toHex(result)).toBe(txHash)
    const init = fetchMock.mock.calls[0][1]!
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/cbor")
    expect(init.body).toEqual(Transaction.toCBORBytes(tx))
  })

  it("evaluateTx sends additional_utxos and decodes the redeemers", async () => {
    const fetchMock = stubFetch({
      [`${BASE_URL}/tx/evaluate`]:
        '[{"redeemer_tag":"spend","redeemer_index":0,"ex_units":{"mem":"1700","steps":"9007199254740993"}},{"redeemer_tag":"reward","redeemer_index":1,"ex_units":{"mem":"476468","steps":"133296322"}},{"redeemer_tag":"cert","redeemer_index":2,"ex_units":{"mem":"1","steps":"2"}}]'
    })

    const result = await Effect.runPromise(BlockchainAppliedEffect.evaluateTx(BASE_URL, TOKEN)(tx, evalSample1.utxos))

    expect(result.map((r) => [r.redeemer_tag, r.redeemer_index, r.ex_units.mem, r.ex_units.steps])).toEqual([
      ["spend", 0, 1700n, 9007199254740993n],
      ["reward", 1, 476468n, 133296322n],
      ["cert", 2, 1n, 2n]
    ])
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(body.cbor).toBe(Transaction.toCBORHex(tx))
    expect(body.additional_utxos).toHaveLength(evalSample1.utxos.length)
    expect(body.additional_utxos[0]).toMatchObject({
      tx_hash: TransactionHash.toHex(evalSample1.utxos[0].transactionId),
      output_index: Number(evalSample1.utxos[0].index),
      address: Address.toBech32(evalSample1.utxos[0].address),
      lovelace: evalSample1.utxos[0].assets.lovelace.toString()
    })
  })

  it("evaluateTx fails on an unknown redeemer tag", async () => {
    stubFetch({
      [`${BASE_URL}/tx/evaluate`]: '[{"redeemer_tag":"withdraw","redeemer_index":0,"ex_units":{"mem":"1","steps":"2"}}]'
    })

    const error = await fail(BlockchainAppliedEffect.evaluateTx(BASE_URL, TOKEN)(tx))

    expect(error._tag).toBe("ProviderError")
  })
})

describe("BlockchainApplied authentication", () => {
  it("sends the bearer token on every request", async () => {
    const fetchMock = stubFetch({
      [`${BASE_URL}/utxo/${PREPROD_TX_HASH_HEX}/0`]: UTXO_INLINE_DATUM,
      [`${BASE_URL}/tx/evaluate`]: "[]"
    })

    await Effect.runPromise(
      BlockchainAppliedEffect.getUtxosByOutRef(
        BASE_URL,
        TOKEN
      )([new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(PREPROD_TX_HASH_HEX), index: 0n })])
    )
    await Effect.runPromise(
      BlockchainAppliedEffect.evaluateTx(BASE_URL, TOKEN)(Transaction.fromCBORHex(evalSample1.transaction))
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init!.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`)
    }
  })
})
