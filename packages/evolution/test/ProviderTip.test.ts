/**
 * Offline tests for `getTip` on every provider. `fetch` is stubbed with payloads in each
 * backend's own documented shape, written as raw JSON text so the numbers reach the decoder
 * exactly as the server would send them.
 */
import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as BlockfrostEffect from "../src/sdk/provider/internal/BlockfrostEffect.js"
import * as KoiosEffect from "../src/sdk/provider/internal/KoiosEffect.js"
import * as KupmiosEffects from "../src/sdk/provider/internal/KupmiosEffects.js"
import * as MaestroEffect from "../src/sdk/provider/internal/MaestroEffect.js"
import { MockProvider } from "../src/sdk/provider/Mock.js"

const BASE = "https://provider.test"

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Serve one body for any request; anything else is a 404. */
const stub = (body: string, match: (url: string, init?: RequestInit) => boolean = () => true) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(match(url, init) ? new Response(body, { status: 200 }) : new Response("{}", { status: 404 }))
    )
  )
}

describe("getTip", () => {
  it("Koios reads the one row of /tip, including the height and the block time", async () => {
    stub(
      `[{"hash":"d8b4e38e5a7a0a0b26c0e1f3c1b8d8a5a5f0f4e2d2c1b0a9f8e7d6c5b4a39281",
         "epoch_no":521,"abs_slot":139742905,"epoch_slot":243705,
         "block_no":11471928,"block_time":1758128596}]`,
      (url) => url === `${BASE}/tip`
    )

    const tip = await Effect.runPromise(KoiosEffect.getTip(BASE)())

    expect(tip.slot).toBe(139_742_905)
    expect(tip.epoch).toBe(521)
    expect(tip.blockHeight).toBe(11_471_928)
    expect(tip.blockTime).toBe(1_758_128_596)
    expect(tip.blockHash).toBe("d8b4e38e5a7a0a0b26c0e1f3c1b8d8a5a5f0f4e2d2c1b0a9f8e7d6c5b4a39281")
  })

  it("Koios reports an empty tip as a failure rather than a slot of zero", async () => {
    stub("[]", (url) => url === `${BASE}/tip`)

    await expect(Effect.runPromise(KoiosEffect.getTip(BASE)())).rejects.toThrow()
  })

  it("Koios leaves a null height and block time absent", async () => {
    stub(
      `[{"hash":"aa","epoch_no":0,"abs_slot":0,"block_no":null,"block_time":null}]`,
      (url) => url === `${BASE}/tip`
    )

    const tip = await Effect.runPromise(KoiosEffect.getTip(BASE)())

    expect(tip.blockHeight).toBeUndefined()
    expect(tip.blockTime).toBeUndefined()
    expect(tip.epoch).toBe(0)
  })

  it("Blockfrost reads /blocks/latest", async () => {
    stub(
      `{"time":1632136410,"height":2927618,
        "hash":"86e837d8a6cdfddaf364525ce9857eb93430b7e59a5fd776f0a9e11df476a7e5",
        "slot":37767194,"epoch":157,"epoch_slot":312794,
        "slot_leader":"pool1zuevzm3xlrhmwjw87ec38mzs02tlkwec9wxpgafcaykmwg7efhh",
        "size":1050,"tx_count":3,"output":"9249073880","fees":"513839","confirmations":0}`,
      (url) => url === `${BASE}/blocks/latest`
    )

    const tip = await Effect.runPromise(BlockfrostEffect.getTip(BASE)())

    expect(tip.slot).toBe(37_767_194)
    expect(tip.epoch).toBe(157)
    expect(tip.blockHeight).toBe(2_927_618)
    expect(tip.blockTime).toBe(1_632_136_410)
    expect(tip.blockHash).toBe("86e837d8a6cdfddaf364525ce9857eb93430b7e59a5fd776f0a9e11df476a7e5")
  })

  it("Blockfrost: a real mainnet tip, captured from the live endpoint", async () => {
    // Response of GET /blocks/latest on cardano-mainnet, 2026-10-03. The OpenAPI example above
    // is documentation; this is what the server actually sends.
    stub(
      `{"time":1790948116,"height":14016477,
        "hash":"e2349e90fc37d3ab860045fe53910a05762fb897c232adc3253b1e060b645c78",
        "slot":199381825,"epoch":659,"epoch_slot":57025,
        "slot_leader":"pool1v62c7d92xv6gyh4x9rhfpkwzlpw2ypxk92xvzavakg3xypatklv",
        "size":7585,"tx_count":6,"output":"3526378971330","fees":"2558299",
        "block_vrf":"vrf_vk1p2879jgftc5jg0z6xu93c69wjlmfvst5mtwr2lhqeprw0ez7xf0s9uph0s",
        "op_cert":"4dc1e0cd2e857921dddb83d48a000d1165d9beabc8b0cbb1ed5b9222db9149ba",
        "op_cert_counter":"15",
        "previous_block":"a08f307971da6cca1a909d0a6045cd57c7e05571bfa534c784b9f8725b38f387",
        "next_block":null,"confirmations":0}`,
      (url) => url === `${BASE}/blocks/latest`
    )

    const tip = await Effect.runPromise(BlockfrostEffect.getTip(BASE)())

    expect(tip).toStrictEqual({
      slot: 199_381_825,
      blockHash: "e2349e90fc37d3ab860045fe53910a05762fb897c232adc3253b1e060b645c78",
      epoch: 659,
      blockHeight: 14_016_477,
      blockTime: 1_790_948_116
    })
  })

  it("Blockfrost refuses a latest block with no slot instead of reporting one", async () => {
    stub(`{"time":1,"height":null,"hash":"aa","slot":null,"epoch":null}`, (url) => url === `${BASE}/blocks/latest`)

    await expect(Effect.runPromise(BlockfrostEffect.getTip(BASE)())).rejects.toThrow()
  })

  it("Maestro reads /chain-tip, which carries no epoch and no block time", async () => {
    stub(
      `{"data":{"block_hash":"4c0916eea22254efc2a35f72b4fa8ec5caaf3cd0b193a4df8efb4c0f5ff2be4a",
        "slot":32284578,"height":1102039},
        "last_updated":{"timestamp":"2022-10-10 20:25:28",
        "block_hash":"4c0916eea22254efc2a35f72b4fa8ec5caaf3cd0b193a4df8efb4c0f5ff2be4a",
        "block_slot":32284578}}`,
      (url) => url === `${BASE}/chain-tip`
    )

    const tip = await Effect.runPromise(MaestroEffect.getTip(BASE, "key")())

    expect(tip.slot).toBe(32_284_578)
    expect(tip.blockHeight).toBe(1_102_039)
    expect(tip.blockHash).toBe("4c0916eea22254efc2a35f72b4fa8ec5caaf3cd0b193a4df8efb4c0f5ff2be4a")
    expect(tip.epoch).toBeUndefined()
    expect(tip.blockTime).toBeUndefined()
  })

  it("Kupmios asks Ogmios for the tip and the epoch, and reports no height or time", async () => {
    const bodies: Record<string, string> = {
      "queryLedgerState/tip": `{"jsonrpc":"2.0","method":"queryLedgerState/tip",
        "result":{"slot":139742905,"id":"d8b4e38e5a7a0a0b26c0e1f3c1b8d8a5a5f0f4e2d2c1b0a9f8e7d6c5b4a39281"},
        "id":null}`,
      "queryLedgerState/epoch": `{"jsonrpc":"2.0","method":"queryLedgerState/epoch","result":521,"id":null}`
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const method = JSON.parse(String(init?.body)).method as string
        const body = bodies[method]
        return Promise.resolve(body === undefined ? new Response("{}", { status: 404 }) : new Response(body))
      })
    )

    const tip = await Effect.runPromise(KupmiosEffects.getTipEffect(`${BASE}/ogmios`))

    expect(tip.slot).toBe(139_742_905)
    expect(tip.epoch).toBe(521)
    expect(tip.blockHash).toBe("d8b4e38e5a7a0a0b26c0e1f3c1b8d8a5a5f0f4e2d2c1b0a9f8e7d6c5b4a39281")
    expect("blockHeight" in tip).toBe(false)
    expect("blockTime" in tip).toBe(false)
  })

  it("the mock serves the tip it was seeded with", async () => {
    const seeded = { slot: 7, blockHash: "ff", epoch: 1 }
    const provider = new MockProvider({ tip: seeded })

    expect(await Effect.runPromise(provider.effect.getTip())).toStrictEqual(seeded)
  })
})
