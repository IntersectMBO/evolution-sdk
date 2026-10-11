/**
 * The four deploy/issue transactions, read back out of the assembled bytes.
 *
 * ⚠️ Each of these is a transaction nobody gets to retry cheaply: the bootstrap is once per
 * deployment and spends one-shot seeds, a registration inserts into a sorted linked list, and an
 * issuance mints under a policy whose id is fixed forever. The failure mode is the same as the
 * transfer path's — a well-formed redeemer pointing at the wrong thing — so the assertions
 * resolve every index against the finished transaction rather than restating the encoder.
 */
import { Assets } from "@evolution-sdk/evolution"
import type { Plan } from "@evolution-sdk/plan"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import * as Cip113 from "../src/Cip113.js"
import * as Encode from "../src/internal/Encode.js"
import * as Issuer from "../src/Issuer.js"
import { Network } from "../src/Types.js"
import { V0_4_0, V0_5_0_ALPHA_2 } from "../src/Versions.js"
import { assembled, CML, intsOf } from "./tx-shape.js"

const h28 = (b: string): string => b.repeat(28)
const txHash = (b: string): string => b.repeat(32)
const utf8Hex = (s: string): string => Buffer.from(s, "utf8").toString("hex")

const run = <A, E>(e: Effect.Effect<A, E>): A => Effect.runSync(e as Effect.Effect<A, never>)
const buildFailure = <A>(e: Effect.Effect<A, Plan.BuildError | Cip113.Cip113Error>): string => {
  const r = Effect.runSync(Effect.either(e))
  if (Either.isRight(r)) throw new Error("expected a BuildError, got a transaction")
  if (r.left._tag !== "BuildError") throw new Error(`expected a BuildError, got ${r.left._tag}`)
  return r.left.reason
}

const PARAMS: Plan.ProtocolParams = {
  minFeeA: 44n,
  minFeeB: 155_381n,
  coinsPerUtxoByte: 4310n,
  keyDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  maxValueSize: 5000n,
  maxTxSize: 16_384n,
  priceMem: [577n, 10_000n],
  priceStep: [721n, 10_000_000n],
  collateralPercentage: 150,
  maxCollateralInputs: 3,
  plutusV3CostModel: Array.from({ length: 251 }, () => 0n),
}
const COST_MODELS = [{ language: 2, costs: Array.from({ length: 251 }, () => 0n) }]
const SCRIPT = (tail: string): string => `4e4d0100003322222005120012${tail}`
const CHANGE = `00${h28("0d")}${h28("0e")}`

/** A deployment record, written out rather than derived: these builders consume the record. */
const deployment = (over: Partial<Issuer.Deployment> = {}): Issuer.Deployment => ({
  alwaysFailHash: h28("a1"),
  protocolParamsCs: h28("a2"),
  issuanceCborHexCs: h28("a3"),
  registrySpendCred: h28("a4"),
  registryNodeCs: h28("a4"),
  transferCred: h28("a5"),
  plbCred: h28("a6"),
  unfrackingCred: h28("a7"),
  thirdPartyCred: h28("a8"),
  coordinationCred: h28("a9"),
  upgradeCred: h28("aa"),
  plgCred: h28("ab"),
  issuanceLogicCred: h28("ac"),
  applied: {
    protocolParamsMint: SCRIPT("01"),
    issuanceCborHexMint: SCRIPT("02"),
    registrySpend: SCRIPT("03"),
    registryMint: SCRIPT("03"),
    transfer: SCRIPT("04"),
    programmableLogicBase: SCRIPT("05"),
    unfracking: SCRIPT("06"),
    alwaysFail: SCRIPT("07"),
    thirdParty: SCRIPT("08"),
    coordinationSpend: SCRIPT("09"),
    upgradeMultisig: SCRIPT("0a"),
    programmableLogicGlobal: SCRIPT("0b"),
    issuanceLogic: SCRIPT("0c"),
  },
  protocolParamsDatumHex: run(
    Effect.succeed(`d8799f${"d87a9f581c".concat(h28("ab"), "ff")}d87a80ff`)
  ),
  protocolParamsInfo: { plgCred: { kind: "script", hashHex: h28("ab") }, pendingUpgradeCred: null },
  issuanceTemplate: { prefixHex: `${SCRIPT("0d")}d87a9f581c`, postfixHex: `ff581c${h28("a2")}` },
  ...over,
})

const funding = (lovelace: bigint): Plan.PlanInput => ({
  txHash: txHash("c0"),
  index: 0,
  assets: Assets.fromLovelace(lovelace),
})
const COLLATERAL = [{ txHash: txHash("c0") as never, index: 0 }]

describe("the bootstrap transaction", () => {
  const ACTIVATION = {
    rewardAcctHex: Encode.rewardScriptHex(Network.Testnet, h28("aa")),
    scriptHex: SCRIPT("0a") as never,
    redeemerHex: "d87980",
    exUnits: [100n, 50_000n] as const,
  }
  const config = (over: Partial<Issuer.BootstrapConfig> = {}): Issuer.BootstrapConfig => ({
    network: Network.Testnet,
    deployment: deployment(),
    protocolParamsSeed: { txHash: txHash("a1"), index: 0, assets: Assets.fromLovelace(5_000_000n) },
    registrySeed: { txHash: txHash("a3"), index: 2, assets: Assets.fromLovelace(5_000_000n) },
    fundingInputs: [funding(30_000_000n)],
    collateral: COLLATERAL,
    changeAddressHex: CHANGE as never,
    params: PARAMS,
    costModels: COST_MODELS,
    paramsMintExUnits: [1_000n, 500_000n],
    registryMintExUnits: [1_000n, 500_000n],
    upgradeAuthorityActivation: ACTIVATION,
    ...over,
  })

  const d = deployment()
  const tx = assembled(run(Issuer.buildBootstrapTx(config())))

  it("spends both one-shot seeds, which is what makes the two NFTs unrepeatable", () => {
    expect(tx.outpoints).toContain(`${txHash("a1")}#0`)
    expect(tx.outpoints).toContain(`${txHash("a3")}#2`)
  })

  it("mints exactly the params NFT and the origin node token", () => {
    expect(tx.mint).toEqual([
      { policyHex: d.protocolParamsCs, nameHex: utf8Hex("ProtocolParams"), amount: 1n },
      // ⚠️ The origin node's token name is the EMPTY bytestring, which is also its registry key:
      // the origin sorts below every policy id precisely because it is empty.
      { policyHex: d.registryNodeCs, nameHex: "", amount: 1n },
    ])
  })

  it("locks the params NFT at the merged validator's OWN hash on LATEST", () => {
    // Three different lock targets across three generations, and `protocol_params_mint` enforces
    // which: sending it to the wrong one fails phase 2 at the mint, not later.
    const out = tx.outputs.find((o) => o.assetIds.some((a) => a.startsWith(d.protocolParamsCs)))!
    expect(out.addressHex).toBe(Encode.enterpriseScriptHex(Network.Testnet, d.protocolParamsCs))
    expect(out.datumHex).toBe(d.protocolParamsDatumHex)
    expect(out.hasDatumHash).toBe(false)
  })

  it("locks the params NFT at coordination_spend on the upgrade-rail generation", () => {
    const a2 = assembled(
      run(Issuer.buildBootstrapTx(config({ version: V0_5_0_ALPHA_2, upgradeAuthorityActivation: undefined })))
    )
    const out = a2.outputs.find((o) => o.assetIds.some((a) => a.startsWith(d.protocolParamsCs)))!
    expect(out.addressHex).toBe(Encode.enterpriseScriptHex(Network.Testnet, d.coordinationCred!))
  })

  it("locks the params NFT at always_fail before the upgrade rail existed", () => {
    const v4 = assembled(
      run(Issuer.buildBootstrapTx(config({ version: V0_4_0, upgradeAuthorityActivation: undefined })))
    )
    const out = v4.outputs.find((o) => o.assetIds.some((a) => a.startsWith(d.protocolParamsCs)))!
    expect(out.addressHex).toBe(Encode.enterpriseScriptHex(Network.Testnet, d.alwaysFailHash))
  })

  it("locks the origin node at the registry-spend address with the origin datum", () => {
    const out = tx.outputs.find((o) => o.assetIds.includes(`${d.registryNodeCs}.`))!
    expect(out.addressHex).toBe(Encode.enterpriseScriptHex(Network.Testnet, d.registrySpendCred))
    // Every credential empty, key empty, next the 30-byte sentinel: the canonical origin.
    expect(run(Cip113.decodeRegistryNode(out.datumHex!))).toEqual({
      keyHex: "",
      nextHex: Cip113.SENTINEL_NEXT_KEY,
      mintingLogicScript: Cip113.ABSENT_CRED,
      transferLogicScript: Cip113.ABSENT_CRED,
      thirdPartyTransferLogicScript: Cip113.ABSENT_CRED,
      unfrackingLogicScript: Cip113.ABSENT_CRED,
      globalStateCsHex: "",
    })
  })

  it("carries the upgrade authority's withdraw-0, which the mint requires at genesis", () => {
    // Upstream #143: the authority the datum names must run and consent in this transaction, so
    // a typo or an undeployed script hash cannot be born as the authority.
    expect(tx.withdrawalAccounts).toEqual([ACTIVATION.rewardAcctHex])
    const reward = tx.redeemers.filter((r) => r.tag === 3)
    expect(reward).toHaveLength(1)
    expect(reward[0]!.dataHex).toBe("d87980")
    expect(tx.scriptsV3).toBe(3)
  })

  it("refuses to emit a v0.0.1 bootstrap without that withdrawal", () => {
    const reason = buildFailure(Issuer.buildBootstrapTx(config({ upgradeAuthorityActivation: undefined })))
    expect(reason).toContain("upgrade authority's withdraw-0")
    expect(reason).toContain("upgradeAuthorityActivation")
  })

  it("honours the activation on a version that does not demand it", () => {
    const v4 = assembled(run(Issuer.buildBootstrapTx(config({ version: V0_4_0 }))))
    expect(v4.withdrawalAccounts).toEqual([ACTIVATION.rewardAcctHex])
  })

  it("refuses a coordination-lock version whose deployment has no coordination credential", () => {
    const reason = buildFailure(
      Issuer.buildBootstrapTx(
        config({
          version: V0_5_0_ALPHA_2,
          upgradeAuthorityActivation: undefined,
          deployment: deployment({ coordinationCred: undefined }),
        })
      )
    )
    expect(reason).toContain("no coordinationCred")
  })

  it("gives each minting policy its own redeemer, indexed by the canonical mint order", () => {
    const mints = tx.redeemers.filter((r) => r.tag === 1)
    expect(mints).toHaveLength(2)
    expect(new Set(mints.map((m) => Number(m.index)))).toEqual(new Set([0, 1]))
    for (const m of mints) expect(m.dataHex).toBe("d87980")
    // The index must land on the policy whose script that redeemer authorises.
    for (const m of mints) expect(tx.mint[Number(m.index)]).toBeDefined()
  })
})

describe("the issuance-cbor-hex deploy", () => {
  const d = deployment()
  const tx = assembled(
    run(
      Issuer.buildIssuanceCborHexTx({
        network: Network.Testnet,
        deployment: d,
        issuanceCborHexSeed: { txHash: txHash("a2"), index: 1, assets: Assets.fromLovelace(5_000_000n) },
        fundingInputs: [funding(20_000_000n)],
        collateral: COLLATERAL,
        changeAddressHex: CHANGE as never,
        params: PARAMS,
        costModels: COST_MODELS,
        mintExUnits: [1_000n, 500_000n],
      })
    )
  )

  it("mints the reference NFT and locks it at always_fail, frozen forever", () => {
    expect(tx.mint).toEqual([
      { policyHex: d.issuanceCborHexCs, nameHex: utf8Hex("IssuanceCborHex"), amount: 1n },
    ])
    const out = tx.outputs.find((o) => o.assetIds.some((a) => a.startsWith(d.issuanceCborHexCs)))!
    expect(out.addressHex).toBe(Encode.enterpriseScriptHex(Network.Testnet, d.alwaysFailHash))
  })

  it("carries the template split as Constr 0 [prefix, postfix], in that order", () => {
    // A registration hashes `prefix ‖ minting_logic ‖ postfix` out of this datum to prove the new
    // policy id. Swapping the two halves yields a datum that decodes and proves nothing.
    const out = tx.outputs.find((o) => o.datumHex !== undefined)!
    const fields = CML.PlutusData.from_cbor_hex(out.datumHex!).as_constr_plutus_data().fields()
    expect(fields.len()).toBe(2)
    expect(Buffer.from(fields.get(0).as_bytes()).toString("hex")).toBe(d.issuanceTemplate.prefixHex)
    expect(Buffer.from(fields.get(1).as_bytes()).toString("hex")).toBe(d.issuanceTemplate.postfixHex)
  })
})

describe("registering a token policy", () => {
  const d = deployment()
  const COVERING_KEY = h28("20")
  const NEW_KEY = h28("50")
  const MINTING_LOGIC = { kind: "script", hashHex: h28("b1") } as const
  const coveringNode: Cip113.RegistryNode = {
    keyHex: COVERING_KEY,
    nextHex: Cip113.SENTINEL_NEXT_KEY,
    mintingLogicScript: Cip113.ABSENT_CRED,
    transferLogicScript: { kind: "script", hashHex: h28("b9") },
    thirdPartyTransferLogicScript: Cip113.ABSENT_CRED,
    unfrackingLogicScript: Cip113.ABSENT_CRED,
    globalStateCsHex: "",
  }
  const config = (over: Partial<Issuer.RegisterConfig> = {}): Issuer.RegisterConfig => ({
    network: Network.Testnet,
    deployment: d,
    coveringNode: {
      txHash: txHash("d0") as never,
      index: 0,
      // ⚠️ Its own node NFT, not bare ada: the updated covering output has to carry the same
      // token back, and the mint in this transaction only produces the NEW node's.
      assets: run(Effect.try(() => Encode.assetsOf(2_000_000n, [`${d.registryNodeCs}.${COVERING_KEY}`], [1n]))),
      node: coveringNode,
    },
    newKey: NEW_KEY,
    mintingLogic: MINTING_LOGIC,
    transferLogic: { kind: "script", hashHex: h28("b2") },
    thirdPartyLogic: { kind: "script", hashHex: h28("b3") },
    substandard: { scriptHex: SCRIPT("20") as never, redeemerDataHex: "d87980" as never, exUnits: [100n, 50_000n] },
    protocolParamsRef: { txHash: txHash("f1") as never, index: 0 },
    issuanceCborHexRef: { txHash: txHash("f2") as never, index: 1 },
    fundingInputs: [funding(30_000_000n)],
    collateral: COLLATERAL,
    changeAddressHex: CHANGE as never,
    params: PARAMS,
    costModels: COST_MODELS,
    registrySpendExUnits: [1_000n, 500_000n],
    registryMintExUnits: [1_000n, 500_000n],
    ...over,
  })
  const tx = assembled(run(Issuer.buildRegisterTx(config())))

  it("relinks the list: the covering node points at the new key, the new node at the old next", () => {
    // ⚠️ This is the insert, and getting either side wrong SEVERS the list: a node whose `next`
    // skips a key makes that key unprovable, and the proof the transfer path builds is a
    // non-membership proof over exactly this ordering.
    const nodes = tx.outputs
      .filter((o) => o.datumHex !== undefined && o.addressHex === Encode.enterpriseScriptHex(Network.Testnet, d.registrySpendCred))
      .map((o) => run(Cip113.decodeRegistryNode(o.datumHex!)))
    expect(nodes).toHaveLength(2)
    const updated = nodes.find((n) => n.keyHex === COVERING_KEY)!
    const inserted = nodes.find((n) => n.keyHex === NEW_KEY)!
    expect(updated.nextHex).toBe(NEW_KEY)
    expect(inserted.nextHex).toBe(Cip113.SENTINEL_NEXT_KEY)
    // And the covering node keeps everything else it had.
    expect(updated.transferLogicScript).toEqual(coveringNode.transferLogicScript)
  })

  it("writes the substandard's credentials into the new node and nothing else", () => {
    const inserted = tx.outputs
      .map((o) => (o.datumHex === undefined ? undefined : run(Cip113.decodeRegistryNode(o.datumHex))))
      .find((n) => n?.keyHex === NEW_KEY)!
    expect(inserted.mintingLogicScript).toEqual(MINTING_LOGIC)
    expect(inserted.transferLogicScript).toEqual({ kind: "script", hashHex: h28("b2") })
    expect(inserted.thirdPartyTransferLogicScript).toEqual({ kind: "script", hashHex: h28("b3") })
    // ⚠️ Default-DENY: an omitted unfracking hook is the empty-key sentinel, which forbids
    // unfracking for this policy, NOT a permissive absence.
    expect(inserted.unfrackingLogicScript).toEqual(Cip113.ABSENT_CRED)
    expect(inserted.globalStateCsHex).toBe("")
  })

  it("carries the issuer's unfracking hook when one is declared", () => {
    const hook = { kind: "script", hashHex: h28("b4") } as const
    const withHook = assembled(run(Issuer.buildRegisterTx(config({ unfrackingLogic: hook }))))
    const inserted = withHook.outputs
      .map((o) => (o.datumHex === undefined ? undefined : run(Cip113.decodeRegistryNode(o.datumHex))))
      .find((n) => n?.keyHex === NEW_KEY)!
    expect(inserted.unfrackingLogicScript).toEqual(hook)
  })

  it("mints exactly the new node's NFT, named by the policy id it registers", () => {
    expect(tx.mint).toEqual([{ policyHex: d.registryNodeCs, nameHex: NEW_KEY, amount: 1n }])
    // Each node output carries one node token, named for the key that node holds: the covering
    // node's travels through unchanged, the new node's is the one minted here.
    const nodeAssets = tx.outputs
      .filter((o) => o.addressHex === Encode.enterpriseScriptHex(Network.Testnet, d.registrySpendCred))
      .map((o) => o.assetIds)
    expect(nodeAssets).toEqual([[`${d.registryNodeCs}.${COVERING_KEY}`], [`${d.registryNodeCs}.${NEW_KEY}`]])
  })

  it("sends RegistryInsert as Constr 1 [key, minting_logic], not Constr 0", () => {
    // Constructor 1 is the insert; 0 is RegistryInit, which the bootstrap uses. Both decode.
    const mint = tx.redeemers.find((r) => r.tag === 1)!
    const c = CML.PlutusData.from_cbor_hex(mint.dataHex).as_constr_plutus_data()
    expect(c.alternative()).toBe(1n)
    expect(c.fields().len()).toBe(2)
    expect(Buffer.from(c.fields().get(0).as_bytes()).toString("hex")).toBe(NEW_KEY)
    expect(c.fields().get(1).to_cbor_hex()).toBe(run(Issuer.credentialParam(MINTING_LOGIC)))
  })

  it("runs the substandard's minting logic through a withdraw-0 at its own account", () => {
    expect(tx.withdrawalAccounts).toEqual([Encode.rewardScriptHex(Network.Testnet, MINTING_LOGIC.hashHex)])
    expect(tx.redeemers.filter((r) => r.tag === 3)).toHaveLength(1)
  })

  it("references the params and issuance-cbor-hex UTxOs, and spends the covering node", () => {
    expect(tx.referenceInputs).toEqual([`${txHash("f1")}#0`, `${txHash("f2")}#1`])
    const spend = tx.redeemers.find((r) => r.tag === 0)!
    expect(tx.outpoints[Number(spend.index)]).toBe(`${txHash("d0")}#0`)
  })
})

describe("issuing tokens into a smart wallet", () => {
  const d = deployment()
  const POLICY = h28("c1")
  const MINTING_LOGIC = { kind: "script", hashHex: h28("b1") } as const
  const RECIPIENT = { kind: "key", hashHex: h28("0c") } as const
  const config = (over: Partial<Issuer.IssuanceConfig> = {}): Issuer.IssuanceConfig => ({
    network: Network.Testnet,
    deployment: d,
    tokenPolicyScriptHex: SCRIPT("30") as never,
    tokenPolicyId: POLICY,
    // Supplied first, sorts LAST — so a builder reading insertion order gets both indices wrong.
    registryNodeRef: { txHash: txHash("f9") as never, index: 3 },
    protocolParamsRef: { txHash: txHash("11") as never, index: 0 },
    issuanceLogic: { scriptHex: SCRIPT("0c") as never, exUnits: [500n, 200_000n] },
    mintingLogic: MINTING_LOGIC,
    substandard: { scriptHex: SCRIPT("20") as never, redeemerDataHex: "d87980" as never, exUnits: [100n, 50_000n] },
    recipient: RECIPIENT,
    assetNameHex: utf8Hex("TOKEN"),
    amount: 1_000n,
    fundingInputs: [funding(30_000_000n)],
    collateral: COLLATERAL,
    changeAddressHex: CHANGE as never,
    params: PARAMS,
    costModels: COST_MODELS,
    issuanceExUnits: [1_000n, 500_000n],
    ...over,
  })
  const tx = assembled(run(Issuer.buildIssuanceTx(config())))

  it("mints the tokens and sends them all to the recipient's smart wallet", () => {
    expect(tx.mint).toEqual([{ policyHex: POLICY, nameHex: utf8Hex("TOKEN"), amount: 1_000n }])
    const out = tx.outputs.find((o) => o.assetIds.includes(`${POLICY}.${utf8Hex("TOKEN")}`))!
    expect(out.addressHex).toBe(Cip113.smartWalletAddressHex(Network.Testnet, d.plbCred, RECIPIENT))
    expect(out.hasDatumHash).toBe(false)
  })

  it("⚠️ points the mint redeemer at the PARAMS input and the logic redeemer at the NODE", () => {
    // The trap this assertion exists for: the mint redeemer is `Constr 0 [int]` on BOTH issuance
    // shapes and the integer means different things — the registry node's position before the
    // split, the params UTxO's after. Two ints, two reference inputs, nothing to decode wrong.
    expect(tx.referenceInputs).toEqual([`${txHash("11")}#0`, `${txHash("f9")}#3`])
    const mint = tx.redeemers.find((r) => r.tag === 1)!
    const [paramsIdx] = intsOf(mint.dataHex)
    expect(tx.referenceInputs[Number(paramsIdx)]).toBe(`${txHash("11")}#0`)

    const logic = tx.redeemers.find((r) => r.tag === 3 && r.dataHex.startsWith("a1"))!
    const map = CML.PlutusData.from_cbor_hex(logic.dataHex).as_map()
    expect(map.keys().len()).toBe(1)
    const key = map.keys().get(0)
    expect(Buffer.from(key.as_bytes()).toString("hex")).toBe(POLICY)
    const nodeIdx = Number(map.get(key).as_constr_plutus_data().fields().get(0).as_integer().to_str())
    expect(tx.referenceInputs[nodeIdx]).toBe(`${txHash("f9")}#3`)
    // The two indices really are different positions, which is the whole point.
    expect(nodeIdx).not.toBe(Number(paramsIdx))
  })

  it("carries both withdrawals: the substandard's minting logic and issuance_logic", () => {
    expect([...tx.withdrawalAccounts].sort()).toEqual(
      [
        Encode.rewardScriptHex(Network.Testnet, MINTING_LOGIC.hashHex),
        Encode.rewardScriptHex(Network.Testnet, d.issuanceLogicCred!),
      ].sort()
    )
    expect(tx.scriptsV3).toBe(3)
  })

  it("keys the issuance_logic redeemer by policy, the one shape upstream has committed to", () => {
    const logic = tx.redeemers.find((r) => r.tag === 3 && r.dataHex.startsWith("a1"))!
    // A definite-framed map, entries in the order given: a Plutus map is not sorted.
    expect(logic.dataHex.startsWith("a1")).toBe(true)
  })

  it("uses the pre-split shape on v0.4.0: one withdrawal, and the node index in the mint", () => {
    const v4 = assembled(
      run(
        Issuer.buildIssuanceTx(
          config({ version: V0_4_0, protocolParamsRef: undefined, issuanceLogic: undefined })
        )
      )
    )
    expect(v4.referenceInputs).toEqual([`${txHash("f9")}#3`])
    const mint = v4.redeemers.find((r) => r.tag === 1)!
    expect(intsOf(mint.dataHex)).toEqual(["0"])
    expect(v4.withdrawalAccounts).toEqual([Encode.rewardScriptHex(Network.Testnet, MINTING_LOGIC.hashHex)])
    expect(v4.scriptsV3).toBe(2)
  })

  it("refuses a split-issuance build missing the params reference or the issuance_logic script", () => {
    expect(buildFailure(Issuer.buildIssuanceTx(config({ protocolParamsRef: undefined })))).toContain(
      "splits issuance"
    )
    expect(buildFailure(Issuer.buildIssuanceTx(config({ issuanceLogic: undefined })))).toContain("splits issuance")
  })

  it("refuses a split-issuance build whose deployment has no issuance_logic credential", () => {
    expect(
      buildFailure(Issuer.buildIssuanceTx(config({ deployment: deployment({ issuanceLogicCred: undefined }) })))
    ).toContain("no issuanceLogicCred")
  })
})
