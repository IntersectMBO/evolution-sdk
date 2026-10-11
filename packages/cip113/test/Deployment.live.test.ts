import { describe, expect, it } from "vitest"

import * as Deployment from "../src/Deployment.js"

/**
 * Verify every SHIPPED deployment record against the chain it claims to describe.
 *
 * Skipped unless `CIP113_LIVE=1`, because it reads a public indexer. Run it after transcribing a
 * record and before trusting one:
 *
 *   CIP113_LIVE=1 pnpm vitest run packages/cip113/test/Deployment.live.test.ts
 *
 * ⚠️ **Why this cannot be replaced by the offline suite.** A wrong script hash produces no error at
 * any layer — the wallet simply watches an address nothing was ever minted to, and an empty balance
 * reads as "the user holds nothing" rather than "we are looking in the wrong place". The only thing
 * that distinguishes the two is fetching what the chain actually published.
 *
 * ⚠️ And a passing run says nothing about whether the record is the CURRENT generation: a
 * superseded deployment stays on chain and keeps verifying forever. CF re-bootstraps every few
 * days, so "green" here means "this record describes a real instance", never "this is the instance
 * to be using". Comparing against CF's `protocol-bootstraps-<network>.json` is the separate check
 * that answers that.
 */
const KOIOS: Readonly<Record<number, string>> = {
  1: process.env.KOIOS_PREPROD_URL ?? "https://preprod.koios.rest/api/v1",
  2: process.env.KOIOS_PREVIEW_URL ?? "https://preview.koios.rest/api/v1",
  [Deployment.MAINNET_MAGIC]: process.env.KOIOS_MAINNET_URL ?? "https://api.koios.rest/api/v1"
}

const post = async (base: string, path: string, body: unknown): Promise<Array<any>> => {
  const r = await fetch(`${base}${path}`, {
    method: "post",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(`${path} answered ${r.status}`)
  return (await r.json()) as Array<any>
}

const records = Object.values(Deployment.DEPLOYMENTS).filter(
  (d): d is Deployment.Cip113Deployment => d !== undefined
)

describe.skipIf(process.env.CIP113_LIVE !== "1")("the shipped records, against chain", () => {
  it.each(records.map((d) => [d.id, d] as const))(
    "%s publishes every reference script it names, at the index it names",
    async (_id, d) => {
      const base = KOIOS[d.protocolMagic]
      expect(base, `no indexer configured for magic ${d.protocolMagic}`).toBeDefined()

      const refs = d.refScripts ?? {}
      const txHash = refs.plb?.txHash
      expect(txHash, "the record names no PLB reference script").toBeDefined()

      // `/tx_utxos` omits `reference_script` entirely — only `/tx_info` with `_scripts` carries it,
      // and a probe reading the wrong field reports every hash as ABSENT rather than as wrong,
      // which looks like a broken record instead of a broken probe.
      const [info] = await post(base!, "/tx_info", { _tx_hashes: [txHash], _scripts: true })
      const outputs = (info?.outputs ?? []) as Array<any>
      expect(outputs.length, "the reference-script transaction was not found").toBeGreaterThan(0)

      const expected: ReadonlyArray<readonly [string, string | undefined]> = [
        ["plb", d.plbScriptHashHex],
        ["plg", d.plgScriptHashHex],
        ["transfer", d.transferScriptHashHex],
        ["thirdParty", d.thirdPartyScriptHashHex],
        ["unfracking", d.unfrackingScriptHashHex],
        ["issuanceLogic", d.issuanceLogicScriptHashHex]
      ]
      for (const [label, want] of expected) {
        const ref = (refs as Record<string, { txHash: string; index: number } | undefined>)[label]
        if (ref === undefined || want === undefined) continue
        const out = outputs.find((o) => o.tx_index === ref.index)
        expect(out?.reference_script?.hash, `${d.id} ${label} at index ${ref.index}`).toBe(want)
      }
    },
    60_000
  )

  it.each(records.map((d) => [d.id, d] as const))(
    "%s has its params NFT at the address it names, under the policy it names",
    async (_id, d) => {
      const base = KOIOS[d.protocolMagic]!
      const [info] = await post(base, "/address_info", { _addresses: [d.paramsAddressBech32] })
      const assets = ((info?.utxo_set ?? []) as Array<any>).flatMap((u) => u.asset_list ?? [])
      const params = assets.find((a: any) => a.asset_name === d.paramsAssetNameHex)
      expect(params?.policy_id, `${d.id} params NFT policy`).toBe(d.paramsPolicyHex)
      // One, and only one: the params NFT is the trust anchor, and a second would make "the params"
      // ambiguous.
      expect(params?.quantity).toBe("1")
    },
    60_000
  )

  it.each(records.map((d) => [d.id, d] as const))(
    "%s was bootstrapped by a transaction the chain still has",
    async (_id, d) => {
      const base = KOIOS[d.protocolMagic]!
      const txHash = d.refScripts?.plb?.txHash
      const [status] = await post(base, "/tx_status", { _tx_hashes: [txHash] })
      expect(Number(status?.num_confirmations ?? 0)).toBeGreaterThan(0)
    },
    60_000
  )
})
