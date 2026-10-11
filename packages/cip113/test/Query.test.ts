import {
  Address,
  AddressEras,
  AssetName,
  Assets,
  Data,
  InlineDatum,
  MultiAsset,
  OriginalBytes,
  PlutusV3,
  PolicyId,
  Provider as ProviderModule,
  TransactionHash,
  UTxO as CoreUTxO
} from "@evolution-sdk/evolution"
import { MockProvider } from "@evolution-sdk/evolution/sdk/provider/Mock"
import { Effect, Either, Layer } from "effect"
import { describe, expect, it } from "vitest"

import * as Cip113 from "../src/Cip113.js"
import type { Cip113Deployment } from "../src/Deployment.js"
import * as Encode from "../src/internal/Encode.js"
import * as Query from "../src/Query.js"
import { Network } from "../src/Types.js"
import { V0_0_1 } from "../src/Versions.js"

const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"))

const PLB = "0a".repeat(28)
const REGISTRY_SPEND = "0b".repeat(28)
const REGISTRY_POLICY = REGISTRY_SPEND
const PARAMS_POLICY = "0c".repeat(28)
const PARAMS_NAME = "50726f746f636f6c506172616d73"
const TX = (n: number) => `${String(n).padStart(2, "0")}`.repeat(32)

const registryAddr = Encode.enterpriseScriptHex(Network.Testnet, REGISTRY_SPEND)
const paramsAddr = Encode.enterpriseScriptHex(Network.Testnet, "0d".repeat(28))

const deployment: Cip113Deployment = {
  id: "test",
  network: Network.Testnet,
  protocolMagic: 1,
  version: V0_0_1,
  plbScriptHashHex: PLB,
  transferScriptHashHex: "ee".repeat(28),
  plgScriptHashHex: "cc".repeat(28),
  registrySpendScriptHashHex: REGISTRY_SPEND,
  registryPolicyHex: REGISTRY_POLICY,
  paramsPolicyHex: PARAMS_POLICY,
  paramsAssetNameHex: PARAMS_NAME,
  paramsAddressBech32: AddressEras.toBech32(AddressEras.fromHex(paramsAddr)),
  maxInlineDatumBytes: 512n
} as unknown as Cip113Deployment

const withAsset = (policyHex: string, nameHex: string) =>
  Assets.withMultiAsset(2_000_000n, MultiAsset.singleton(PolicyId.fromHex(policyHex), AssetName.fromHex(nameHex), 1n))

const utxo = (opts: {
  readonly addrHex: string
  readonly index: number
  readonly assets?: Assets.Assets
  readonly datumHex?: string
  /** A datum built from scratch has no recorded bytes — which a provider's UTxO never is. */
  readonly datumWithoutRaw?: string
  readonly scriptHex?: string
  readonly txHash?: string
}) =>
  new CoreUTxO.UTxO({
    transactionId: TransactionHash.fromHex(opts.txHash ?? TX(1)),
    index: BigInt(opts.index),
    address: Address.fromHex(opts.addrHex),
    assets: opts.assets ?? Assets.fromLovelace(2_000_000n),
    ...(opts.datumHex !== undefined
      ? {
        datumOption: OriginalBytes.record(
          new InlineDatum.InlineDatum({
            data: Data.fromCBORHex(opts.datumHex)
          }),
          hexBytes(opts.datumHex)
        )
      }
      : {}),
    ...(opts.datumWithoutRaw !== undefined
      ? { datumOption: new InlineDatum.InlineDatum({ data: Data.fromCBORHex(opts.datumWithoutRaw) }) }
      : {}),
    ...(opts.scriptHex !== undefined ? { scriptRef: new PlutusV3.PlutusV3({ bytes: hexBytes(opts.scriptHex) }) } : {})
  })

const run = <A, E>(eff: Effect.Effect<A, E, ProviderModule.ProviderEffect>, provider: MockProvider) =>
  Effect.runPromise(Effect.either(eff).pipe(Effect.provide(Layer.succeed(ProviderModule.ProviderEffect, provider.effect))))

const node = (keyHex: string, nextHex: string) => ({
  keyHex,
  nextHex,
  mintingLogicScript: Cip113.ABSENT_CRED,
  transferLogicScript: { kind: "script" as const, hashHex: "22".repeat(28) },
  thirdPartyTransferLogicScript: { kind: "script" as const, hashHex: "33".repeat(28) },
  unfrackingLogicScript: Cip113.ABSENT_CRED,
  globalStateCsHex: ""
})

const nodeDatum = (keyHex: string, nextHex: string) =>
  Effect.runSync(Cip113.registryNodeDatum(node(keyHex, nextHex), V0_0_1))

/** The layer itself, built against whichever provider the test supplies. */
const query = Effect.flatMap(Cip113.QueryTag, (q) => Effect.succeed(q)).pipe(
  Effect.provide(Query.providerQuery(deployment))
)

const queryOf = async (provider: MockProvider) => {
  const r = await run(query, provider)
  if (Either.isLeft(r)) throw new Error(`layer failed: ${JSON.stringify(r.left)}`)
  return r.right
}

describe("registryNodes", () => {
  it("reads the nodes that carry the registry NFT and decodes each datum", async () => {
    const p = new MockProvider({
      utxos: [
        utxo({ addrHex: registryAddr, index: 0, assets: withAsset(REGISTRY_POLICY, ""), datumHex: nodeDatum("", "40".repeat(28)) }),
        utxo({ addrHex: registryAddr, index: 1, assets: withAsset(REGISTRY_POLICY, "40".repeat(28)), datumHex: nodeDatum("40".repeat(28), "ff".repeat(30)) })
      ]
    })
    const q = await queryOf(p)
    const r = await run(q.registryNodes, p)
    expect(Either.isRight(r) && r.right.length).toBe(2)
    expect(Either.isRight(r) && r.right[0]!.node.nextHex).toBe("40".repeat(28))
    // `index` is narrowed from their Uint16 bigint; a bigint here would not compare equal.
    expect(Either.isRight(r) && r.right[1]!.index).toBe(1)
  })

  // A junk UTxO paid to a script address is not a registry node: anyone can make one, and a
  // "node" that decoded would corrupt covering-node selection.
  it("ignores a UTxO at the address that does not carry the NFT", async () => {
    const p = new MockProvider({
      utxos: [
        utxo({ addrHex: registryAddr, index: 0, assets: withAsset(REGISTRY_POLICY, ""), datumHex: nodeDatum("", "ff".repeat(30)) }),
        utxo({ addrHex: registryAddr, index: 5, datumHex: "d87980" })
      ]
    })
    const q = await queryOf(p)
    const r = await run(q.registryNodes, p)
    expect(Either.isRight(r) && r.right.length).toBe(1)
  })

  it("fails loudly on an NFT-carrying node with no inline datum", async () => {
    const p = new MockProvider({ utxos: [utxo({ addrHex: registryAddr, index: 2, assets: withAsset(REGISTRY_POLICY, "") })] })
    const q = await queryOf(p)
    const r = await run(q.registryNodes, p)
    expect(Either.isLeft(r) && r.left.reason).toMatch(/carries the registry NFT but has no inline datum/)
  })

  // "No registry at all" and "an empty registry" are different facts, and only one of them is
  // ever true of a live deployment.
  it("fails rather than answering an empty list", async () => {
    const p = new MockProvider({ utxos: [] })
    const q = await queryOf(p)
    const r = await run(q.registryNodes, p)
    expect(Either.isLeft(r) && r.left.reason).toMatch(/no registry nodes at/)
  })

  it("names the version when a datum does not decode at it", async () => {
    const p = new MockProvider({
      utxos: [utxo({ addrHex: registryAddr, index: 0, assets: withAsset(REGISTRY_POLICY, ""), datumHex: "d87980" })]
    })
    const q = await queryOf(p)
    const r = await run(q.registryNodes, p)
    expect(Either.isLeft(r) && r.left.reason).toMatch(/did not decode as v0\.0\.1/)
  })

  // ⚠️ Recorded bytes are absent only for a datum built from scratch. Re-encoding `data` instead would
  // reframe an empty Plutus array and hash to a different node, so absence is an error.
  it("refuses a datum that carries no raw bytes rather than re-deriving them", async () => {
    const p = new MockProvider({
      utxos: [utxo({ addrHex: registryAddr, index: 0, assets: withAsset(REGISTRY_POLICY, ""), datumWithoutRaw: nodeDatum("", "ff".repeat(30)) })]
    })
    const q = await queryOf(p)
    const r = await run(q.registryNodes, p)
    expect(Either.isLeft(r) && r.left.reason).toMatch(/carries no raw datum bytes/)
  })
})

describe("protocolParams", () => {
  const paramsDatum = () => {
    const P = V0_0_1.params
    const fields: Array<string> = new Array(P.fieldCount)
    const cred = (h: string) => Encode.plutusDataConstr(1n, [Encode.plutusDataBytes(h)])
    const put = (i: number | null, hex: string) => {
      if (i !== null) fields[i] = hex
    }
    put(P.registryNodeCs, Encode.plutusDataBytes(REGISTRY_POLICY))
    put(P.progLogicCred, cred(PLB))
    put(P.plgCred, cred("cc".repeat(28)))
    put(P.issuanceLogicCred, cred("dd".repeat(28)))
    put(P.transferCred, cred("ee".repeat(28)))
    put(P.thirdPartyCred, cred("12".repeat(28)))
    put(P.unfrackingCred, cred("34".repeat(28)))
    put(P.upgradeCred, cred("56".repeat(28)))
    put(P.pendingUpgradeCred, Encode.plutusDataConstr(1n, []))
    put(P.maxInlineDatumBytes, Encode.plutusDataInt("256"))
    return Encode.plutusDataConstr(0n, fields)
  }

  it("finds the params UTxO by its NFT and returns the whole datum", async () => {
    const p = new MockProvider({
      utxos: [utxo({ addrHex: paramsAddr, index: 3, assets: withAsset(PARAMS_POLICY, PARAMS_NAME), datumHex: paramsDatum() })]
    })
    const q = await queryOf(p)
    const r = await run(q.protocolParams, p)
    expect(Either.isRight(r) && r.right.index).toBe(3)
    expect(Either.isRight(r) && r.right.plgCred?.hashHex).toBe("cc".repeat(28))
    // `None` is the field existing and nominating nobody — not the field being absent.
    expect(Either.isRight(r) && r.right.pendingUpgradeCred).toBe(null)
  })

  // The params NFT is one-shot. More than one means we are not looking at what we think.
  it("refuses two UTxOs carrying the params NFT", async () => {
    const p = new MockProvider({
      utxos: [
        utxo({ addrHex: paramsAddr, index: 0, assets: withAsset(PARAMS_POLICY, PARAMS_NAME), datumHex: paramsDatum() }),
        utxo({ addrHex: paramsAddr, index: 1, txHash: TX(2), assets: withAsset(PARAMS_POLICY, PARAMS_NAME), datumHex: paramsDatum() })
      ]
    })
    const q = await queryOf(p)
    const r = await run(q.protocolParams, p)
    expect(Either.isLeft(r) && r.left.reason).toMatch(/2 UTxOs carry the params NFT/)
  })

  it("names the deployment when no params UTxO is there at all", async () => {
    const q = await queryOf(new MockProvider({ utxos: [] }))
    const r = await run(q.protocolParams, new MockProvider({ utxos: [] }))
    expect(Either.isLeft(r) && r.left.reason).toMatch(/no protocol-params UTxO at/)
  })

  // ⚠️ The asset NAME matters: the params policy may mint more than one token, and matching on
  // the policy alone would pick up whichever happened to sort first.
  it("does not accept the right policy under the wrong asset name", async () => {
    const p = new MockProvider({
      utxos: [utxo({ addrHex: paramsAddr, index: 0, assets: withAsset(PARAMS_POLICY, "00"), datumHex: paramsDatum() })]
    })
    const q = await queryOf(p)
    const r = await run(q.protocolParams, p)
    expect(Either.isLeft(r) && r.left.reason).toMatch(/no protocol-params UTxO/)
  })

  // ⚠️ `v0.0.1` REMOVED `prog_logic_cred` and `registry_node_cs` from the datum, so the two
  // cross-checks cannot run at this version — and that is not a weakening: PLB is parameterised
  // by the params NFT policy, so finding this UTxO by that policy already establishes the same
  // binding the equality used to. Pinned, because "we used to verify this" is the kind of thing
  // that gets quietly reintroduced as a guess.
  it("has no prog_logic_cred to cross-check at v0.0.1, by design", () => {
    expect(V0_0_1.params.progLogicCred).toBe(null)
    expect(V0_0_1.params.registryNodeCs).toBe(null)
  })

  // The bound is chain state up to alpha.2 and a deployment parameter from alpha.4. A caller
  // must not silently get `undefined` on a version where it exists and is enforced on chain.
  it("falls back to the record's bound when the datum has none", async () => {
    const p = new MockProvider({
      utxos: [utxo({ addrHex: paramsAddr, index: 0, assets: withAsset(PARAMS_POLICY, PARAMS_NAME), datumHex: paramsDatum() })]
    })
    const q = await queryOf(p)
    const r = await run(q.protocolParams, p)
    const expected = V0_0_1.params.maxInlineDatumBytes === null ? deployment.maxInlineDatumBytes : 256n
    expect(Either.isRight(r) && r.right.maxInlineDatumBytes).toBe(expected)
  })
})

describe("smartWalletUtxos", () => {
  it("returns the owner's UTxOs with the value as CBOR and the owner echoed back", async () => {
    const owner = { kind: "key" as const, hashHex: "aa".repeat(28) }
    const addr = Cip113.smartWalletAddressHex(Network.Testnet, PLB, owner)
    const p = new MockProvider({
      utxos: [
        utxo({ addrHex: addr, index: 0, assets: withAsset("40".repeat(28), "74") }),
        utxo({ addrHex: addr, index: 1, datumHex: "d87980" })
      ]
    })
    const q = await queryOf(p)
    const r = await run(q.smartWalletUtxos(owner), p)
    expect(Either.isRight(r) && r.right.length).toBe(2)
    expect(Either.isRight(r) && r.right[0]!.owner).toEqual(owner)
    // The bag itself, not a CBOR prefix: the query used to hand back the value re-encoded as hex
    // and this asserted its first byte, which says nothing about whether the asset survived.
    expect(Either.isRight(r) && Assets.lovelaceOf(r.right[0]!.assets)).toBe(2_000_000n)
    expect(Either.isRight(r) && Assets.getByUnit(r.right[0]!.assets, `${"40".repeat(28)}74`)).toBe(1n)
    expect(Either.isRight(r) && r.right[1]!.datumHex).toBe("d87980")
    expect(Either.isRight(r) && r.right[0]!.datumHex).toBeUndefined()
  })

  // A script owner takes the type-3 header; a key owner type 1. Same script, different address.
  it("asks a different address for a script owner than for a key owner", async () => {
    const k = Cip113.smartWalletAddressHex(Network.Testnet, PLB, { kind: "key", hashHex: "aa".repeat(28) })
    const s = Cip113.smartWalletAddressHex(Network.Testnet, PLB, { kind: "script", hashHex: "aa".repeat(28) })
    expect(k).not.toBe(s)
    const p = new MockProvider({ utxos: [utxo({ addrHex: k, index: 0 })] })
    const q = await queryOf(p)
    const r = await run(q.smartWalletUtxos({ kind: "script", hashHex: "aa".repeat(28) }), p)
    expect(Either.isRight(r) && r.right.length).toBe(0)
  })
})

describe("deploymentScripts", () => {
  const plbScript = "59000401"
  const transferScript = "59000402"
  const plgScript = "59000403"
  const withRefs = {
    ...deployment,
    plbScriptHashHex: Query.scriptHashV3(plbScript),
    transferScriptHashHex: Query.scriptHashV3(transferScript),
    plgScriptHashHex: Query.scriptHashV3(plgScript),
    refScripts: {
      plb: { txHash: TX(1), index: 0 },
      transfer: { txHash: TX(1), index: 1 },
      plg: { txHash: TX(1), index: 2 }
    }
  } as unknown as Cip113Deployment

  it("fetches each script and checks it hashes to the configured credential", async () => {
    const p = new MockProvider({
      utxos: [
        utxo({ addrHex: registryAddr, index: 0, scriptHex: plbScript }),
        utxo({ addrHex: registryAddr, index: 1, scriptHex: transferScript }),
        utxo({ addrHex: registryAddr, index: 2, scriptHex: plgScript })
      ]
    })
    const r = await run(Query.deploymentScripts(withRefs), p)
    expect(Either.isRight(r) && r.right.plbScriptHex).toBe(plbScript)
    expect(Either.isRight(r) && r.right.plgScriptHex).toBe(plgScript)
  })

  // ⚠️ An unverified fetch would let whatever sits at that outpoint today become a script we
  // hand to the ledger.
  it("refuses a reference script that hashes to something else", async () => {
    const p = new MockProvider({
      utxos: [
        utxo({ addrHex: registryAddr, index: 0, scriptHex: "59000499" }),
        utxo({ addrHex: registryAddr, index: 1, scriptHex: transferScript }),
        utxo({ addrHex: registryAddr, index: 2, scriptHex: plgScript })
      ]
    })
    const r = await run(Query.deploymentScripts(withRefs), p)
    expect(Either.isLeft(r) && r.left.reason).toMatch(/PLB reference script at .* hashes to/)
  })

  // A consumed reference output is ABSENT from `getUtxosByOutRef`, not present-and-flagged, so
  // membership is the liveness signal and "not found" has to say both things.
  it("reports a missing reference UTxO as spent-or-wrong-record", async () => {
    const p = new MockProvider({ utxos: [utxo({ addrHex: registryAddr, index: 1, scriptHex: transferScript })] })
    const r = await run(Query.deploymentScripts(withRefs), p)
    expect(Either.isLeft(r) && r.left.reason).toMatch(/not found \(spent, or wrong record\)/)
  })

  it("refuses a reference UTxO carrying no script at all", async () => {
    const p = new MockProvider({
      utxos: [
        utxo({ addrHex: registryAddr, index: 0 }),
        utxo({ addrHex: registryAddr, index: 1, scriptHex: transferScript }),
        utxo({ addrHex: registryAddr, index: 2, scriptHex: plgScript })
      ]
    })
    const r = await run(Query.deploymentScripts(withRefs), p)
    expect(Either.isLeft(r) && r.left.reason).toMatch(/carries no script bytes/)
  })

  it("says so when the record publishes no reference scripts", async () => {
    const r = await run(Query.deploymentScripts(deployment), new MockProvider({ utxos: [] }))
    expect(Either.isLeft(r) && r.left.reason).toMatch(/no published reference scripts/)
  })
})
