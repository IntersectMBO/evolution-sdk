import { Address } from "@evolution-sdk/evolution"
import { describe, expect, it } from "vitest"

import * as Deployment from "../src/Deployment.js"
import * as Encode from "../src/internal/Encode.js"
import { Network } from "../src/Types.js"

const records = Object.values(Deployment.DEPLOYMENTS).filter(
  (d): d is Deployment.Cip113Deployment => d !== undefined
)

describe("the shipped deployment registry", () => {
  // ⚠️ Why this file exists: `validateDeployment` had never been run against the records the
  // package actually ships. CF re-bootstraps every few days and each record is ~20 hand-copied
  // hashes, so the realistic failure is a transcription — a hash from the wrong generation, or a
  // record whose magic says preprod while its address header says something else. Every rule below
  // is one the author of a new record cannot satisfy by accident.
  it("is not empty — an empty registry disables the feature silently", () => {
    expect(records.length).toBeGreaterThan(0)
  })

  it.each(records.map((d) => [d.id, d] as const))("%s passes validateDeployment", (_id, d) => {
    expect(Deployment.validateDeployment(d)).toEqual([])
  })

  it("holds exactly one record per chain", () => {
    // The registry's own documented invariant. Two records for one magic makes selection ambiguous,
    // and a consumer that resolves the ambiguity points every holder at the wrong protocol.
    const byMagic = new Map<number, Array<string>>()
    for (const d of records) byMagic.set(d.protocolMagic, [...(byMagic.get(d.protocolMagic) ?? []), d.id])
    const clashes = [...byMagic].filter(([, ids]) => ids.length > 1)
    expect(clashes).toEqual([])
  })

  it("keys every record by its own id", () => {
    for (const [key, d] of Object.entries(Deployment.DEPLOYMENTS)) expect(d?.id).toBe(key)
  })

  it.each(records.map((d) => [d.id, d] as const))(
    "%s derives its params address from its params policy (merged-self)",
    (_id, d) => {
      // `paramsAddressBech32` is the one field that is not a hash copied out of CF's bootstrap
      // JSON — it is derived. Pinning the derivation here is what makes a hand-typed address a
      // detectable error rather than a wallet looking for params at an address nothing minted to.
      expect(d.version.protocolParams).toBe("merged-self")
      const derived = Address.toBech32(Address.fromHex(Encode.enterpriseScriptHex(d.network, d.paramsPolicyHex)))
      expect(d.paramsAddressBech32).toBe(derived)
    }
  )

  it.each(records.map((d) => [d.id, d] as const))(
    "%s does not list its own live PLB as a prior generation",
    (_id, d) => {
      // A prior generation means "stranded, nothing more can be sent here". Listing the live PLB
      // would label every current holding as abandoned.
      const priors = (d.priorGenerations ?? []).map((p) => p.plbScriptHashHex)
      expect(priors).not.toContain(d.plbScriptHashHex)
      expect(new Set(priors).size).toBe(priors.length)
    }
  )

  it("gives every prior generation across all records a distinct id and PLB", () => {
    const all = records.flatMap((d) => d.priorGenerations ?? [])
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length)
    expect(new Set(all.map((p) => p.plbScriptHashHex)).size).toBe(all.length)
    for (const p of all) expect(p.source.length).toBeGreaterThan(0)
  })

  it("shares no script hash between two different chains", () => {
    // The scripts are the same compiled code with different applied parameters, so a hash repeated
    // across chains means a parameter was copied from the wrong record. `always_fail` used to be
    // the documented exception — CF's bootstraps since 2026-09-30 give it a distinct hash per
    // deployment too, which is what retired that assumption.
    const seen = new Map<string, string>()
    for (const d of records) {
      const hashes = [
        d.plbScriptHashHex,
        d.transferScriptHashHex,
        d.plgScriptHashHex,
        d.issuanceLogicScriptHashHex,
        d.thirdPartyScriptHashHex,
        d.unfrackingScriptHashHex,
        d.paramsPolicyHex,
        d.registryPolicyHex,
        d.issuanceCborHexPolicyHex,
        ...(d.alwaysFailScriptHashHexes ?? [])
      ].filter((h): h is string => h !== undefined)
      for (const h of hashes) {
        const owner = seen.get(h)
        expect(owner, `${h} appears in both ${owner} and ${d.id}`).toBeUndefined()
        seen.set(h, d.id)
      }
    }
  })

  it("resolves each record by id, and refuses an unknown one rather than falling back", () => {
    for (const d of records) {
      expect(Deployment.deploymentById(d.id)).toEqual({ kind: "found", deployment: d })
      expect(Deployment.deploymentById(d.id, d.network)).toEqual({ kind: "found", deployment: d })
    }
    const miss = Deployment.deploymentById("cf-nowhere-1999-01-01")
    expect(miss.kind).toBe("unknown-id")
  })

  it("refuses a record asked for under the wrong network", () => {
    const mainnet = records.find((d) => d.network === Network.Mainnet)
    const testnet = records.find((d) => d.network === Network.Testnet)
    expect(mainnet, "no mainnet record is shipped").toBeDefined()
    expect(testnet, "no testnet record is shipped").toBeDefined()
    expect(Deployment.deploymentById(mainnet!.id, Network.Testnet).kind).toBe("network-mismatch")
    expect(Deployment.deploymentById(testnet!.id, Network.Mainnet).kind).toBe("network-mismatch")
  })

  it("publishes six reference scripts per record, all from one transaction", () => {
    // CF publishes them in a single tx with the delegates at fixed indices; a record whose refs
    // span two transactions means one was copied from a superseded publication.
    for (const d of records) {
      const refs = Object.values(d.refScripts ?? {}).filter((r) => r !== undefined)
      expect(refs.length, `${d.id}`).toBe(6)
      expect(new Set(refs.map((r) => r!.txHash)).size, `${d.id} spans more than one tx`).toBe(1)
      expect(new Set(refs.map((r) => r!.index)).size, `${d.id} reuses an output index`).toBe(6)
    }
  })
})
