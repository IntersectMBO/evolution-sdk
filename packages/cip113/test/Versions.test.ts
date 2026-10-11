/**
 * The version descriptors as DATA: the invariants a hand-written descriptor must satisfy.
 *
 * ⚠️ Why this is worth a file. Every descriptor is ~50 hand-written fields, and the module's own
 * warning is that nothing in these layouts is stable — the params datum has been reordered and
 * had fields removed four times inside one audit window. A typo in an index does not fail: it
 * decodes a datum at the wrong offset and returns a plausible `RegistryNode` with the credentials
 * shuffled. So the checks here are structural and generic over every descriptor, present and
 * future: the positions a layout declares must tile its field count exactly, and the flags that
 * describe the same fact must agree.
 */
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import * as Cip113 from "../src/Cip113.js"
import type { Cip113Version, GlobalParamsLayout, RegistryNodeLayout } from "../src/Versions.js"
import { LATEST, V0_0_1, V0_3_0, V0_4_0, V0_5_0_ALPHA_2, V0_5_0_ALPHA_4, versionById,VERSIONS } from "../src/Versions.js"
import { CML } from "./tx-shape.js"

const DESCRIPTORS: ReadonlyArray<readonly [string, Cip113Version]> = Object.entries(VERSIONS)
  .filter((e): e is [string, Cip113Version] => e[1] !== undefined)
  .map(([id, v]) => [id, v] as const)

const nodePositions = (L: RegistryNodeLayout): ReadonlyArray<number> =>
  [L.key, L.next, L.mintingLogic, L.transferLogic, L.thirdParty, L.unfrackingLogic, L.globalStateCs].filter(
    (i): i is number => i !== null
  )

const paramsPositions = (P: GlobalParamsLayout): ReadonlyArray<number> =>
  [
    P.registryNodeCs,
    P.progLogicCred,
    P.plgCred,
    P.issuanceLogicCred,
    P.transferCred,
    P.thirdPartyCred,
    P.unfrackingCred,
    P.upgradeCred,
    P.pendingUpgradeCred,
    P.maxInlineDatumBytes,
  ].filter((i): i is number => i !== null)

describe("every descriptor's layouts tile their field count", () => {
  it.each(DESCRIPTORS)("%s declares each node position exactly once, 0..fieldCount-1", (_id, version) => {
    // ⚠️ A HOLE is the failure this catches. `registryNodeDatum` allocates `fieldCount` slots and
    // fills the ones the layout names; an unnamed slot stays `undefined` and reaches the encoder.
    // A DUPLICATE is as bad the other way: two fields write one slot and one of them is lost.
    const positions = [...nodePositions(version.node)].sort((a, b) => a - b)
    expect(positions).toEqual(Array.from({ length: version.node.fieldCount }, (_, i) => i))
  })

  it.each(DESCRIPTORS)("%s declares each params position exactly once, 0..fieldCount-1", (_id, version) => {
    const positions = [...paramsPositions(version.params)].sort((a, b) => a - b)
    expect(positions).toEqual(Array.from({ length: version.params.fieldCount }, (_, i) => i))
  })

  it.each(DESCRIPTORS)("%s emits exactly fieldCount fields when it encodes a node", (_id, version) => {
    // Ties the descriptor to the encoder: a layout can satisfy the arithmetic above and still
    // disagree with what `registryNodeDatum` actually writes.
    const datum = Effect.runSync(
      Cip113.registryNodeDatum(
        {
          keyHex: "aa".repeat(28),
          nextHex: "bb".repeat(28),
          mintingLogicScript: { kind: "script", hashHex: "cc".repeat(28) },
          transferLogicScript: { kind: "script", hashHex: "dd".repeat(28) },
          thirdPartyTransferLogicScript: { kind: "script", hashHex: "ee".repeat(28) },
          unfrackingLogicScript: Cip113.ABSENT_CRED,
          globalStateCsHex: "",
        },
        version
      ) as Effect.Effect<string, never>
    )
    expect(CML.PlutusData.from_cbor_hex(datum).as_constr_plutus_data().fields().len()).toBe(version.node.fieldCount)
  })
})

describe("the flags that describe the same fact agree", () => {
  // Each row is a way a new descriptor can be internally inconsistent, and each inconsistency
  // produces a transaction that builds and then fails in phase 2.
  it.each(DESCRIPTORS)("%s: a dispatcher exists iff the params datum names one", (_id, version) => {
    expect(version.dispatch === "plg-dispatcher").toBe(version.params.plgCred !== null)
  })

  it.each(DESCRIPTORS)("%s: issuance_logic exists iff the params datum names it", (_id, version) => {
    expect(version.hasIssuanceLogic).toBe(version.params.issuanceLogicCred !== null)
  })

  it.each(DESCRIPTORS)("%s: a standalone third_party exists iff the params datum names it", (_id, version) => {
    expect(version.hasThirdPartyValidator).toBe(version.params.thirdPartyCred !== null)
  })

  it.each(DESCRIPTORS)("%s: an upgrade authority exists iff coordination does", (_id, version) => {
    expect(version.upgradeAuthority !== "none").toBe(version.hasCoordination)
  })

  it.each(DESCRIPTORS)("%s: the inline-datum bound is in the datum iff the layout has the field", (_id, version) => {
    expect(version.maxInlineDatumBytesSource === "params-datum").toBe(version.params.maxInlineDatumBytes !== null)
  })

  it.each(DESCRIPTORS)("%s: datum-reading delegates take the params policy, bound ones take a bound", (_id, version) => {
    // `'plb-cs-bound'` delegates read no datum, so the bound cannot come from chain state.
    if (version.delegateParams === "plb-cs-bound") expect(version.maxInlineDatumBytesSource).toBe("script-param")
    if (version.delegateParams === "params-policy") expect(version.maxInlineDatumBytesSource).not.toBe("script-param")
  })

  it.each(DESCRIPTORS)("%s: PLB names the delegate iff PLB dispatches directly", (_id, version) => {
    expect(version.plbSpendRedeemer === "dispatch").toBe(version.dispatch === "plb-direct")
  })

  it.each(DESCRIPTORS)("%s: the transfer redeemer carries params_idx iff PLB dispatches directly", (_id, version) => {
    expect(version.transferRedeemer === "params-indexed").toBe(version.dispatch === "plb-direct")
  })

  it.each(DESCRIPTORS)("%s: a merged registry has no spend credential to name", (_id, version) => {
    if (version.registry === "merged") expect(version.registryMintTakesSpendCred).toBe(false)
  })

  it.each(DESCRIPTORS)("%s: issuance_mint takes the minting-logic credential exactly once", (_id, version) => {
    // The template splice depends on it: `deriveDeployment` applies a placeholder in that slot
    // and cuts the applied bytes around it, which needs exactly one occurrence.
    expect(version.issuanceMintParams.filter((p) => p === "minting-logic-cred")).toHaveLength(1)
  })

  it.each(DESCRIPTORS)("%s: issuance_mint names no parameter twice", (_id, version) => {
    expect(new Set(version.issuanceMintParams).size).toBe(version.issuanceMintParams.length)
  })

  it.each(DESCRIPTORS)("%s: the deprecated transferTitle still matches titles.transfer", (_id, version) => {
    expect(version.transferTitle).toBe(version.titles.transfer)
  })
})

describe("resolving a version id", () => {
  it("finds every shipped descriptor by its own id", () => {
    for (const [id, version] of DESCRIPTORS) {
      expect(versionById(id)).toEqual({ kind: "found", version })
      expect(version.id).toBe(id)
    }
  })

  it("⚠️ does NOT resolve 'latest', on purpose", () => {
    // It used to, as an alias for the current descriptor's id — which made a PERSISTED 'latest'
    // silently retarget every time upstream moved. Failing loudly is the point.
    const r = versionById("latest")
    expect(r.kind).toBe("unknown-id")
    if (r.kind === "unknown-id") expect(r.known).toEqual(Object.keys(VERSIONS))
  })

  it("never falls back to a descriptor close to the ask", () => {
    for (const id of ["v0.5.0", "V0_0_1", "v0.0.2", ""]) {
      expect(versionById(id).kind).toBe("unknown-id")
    }
  })

  it("keeps LATEST pointing at a descriptor the registry actually carries", () => {
    expect(LATEST).toBe(V0_0_1)
    expect(VERSIONS[LATEST.id]).toBe(LATEST)
  })

  it("keeps v0.0.1 as alpha.4 plus the genesis authority withdrawal, and nothing else", () => {
    // The whole difference between the two, asserted so a future edit to either is deliberate.
    const { id: _id, paramsGenesisAuthorityWithdrawal: _flag, ...rest } = V0_0_1
    const { id: _id4, paramsGenesisAuthorityWithdrawal: _flag4, ...rest4 } = V0_5_0_ALPHA_4
    expect(rest).toEqual(rest4)
    expect(V0_0_1.paramsGenesisAuthorityWithdrawal).toBe(true)
    expect(V0_5_0_ALPHA_4.paramsGenesisAuthorityWithdrawal).toBe(false)
  })

  it("keeps the five descriptors distinct in the fields that decide wire shapes", () => {
    const shapes = [V0_0_1, V0_5_0_ALPHA_4, V0_5_0_ALPHA_2, V0_4_0, V0_3_0].map((v) =>
      [v.plbSpendRedeemer, v.dispatch, v.transferRedeemer, v.delegateRedeemer, v.node.fieldCount, v.params.fieldCount].join("/")
    )
    // v0.0.1 and alpha.4 share every wire shape (they differ only in a genesis rule), so four.
    expect(new Set(shapes).size).toBe(4)
  })
})
