/**
 * `buildTransferTx` through an ASSEMBLED transaction, read back with CML.
 *
 * ⚠️ Why this file is not more encoder vectors. Every index CIP-113 puts in a redeemer is a
 * position in something the ledger sorts — the reference inputs by outpoint, the withdrawals by
 * `Ord Credential`, the inputs canonically — and `Cip113Codec.test.ts` can only check that the
 * integer we passed came out the other side. A corpus covering each half does not cover the pair:
 * the phase-2 bug this month was a redeemer that encoded correctly and pointed at the wrong thing
 * once the transaction was assembled. So everything here reads the index out of the FINISHED
 * transaction and resolves it against the FINISHED transaction, with CML doing the parsing.
 *
 * The fixture is built so the orderings cannot coincide by accident: the params reference input is
 * supplied FIRST and sorts LAST, and the extra reference input is supplied last and sorts first.
 * An implementation that used insertion order would pass every encoder vector and fail here.
 */
import { Assets } from "@evolution-sdk/evolution"
import type { Plan } from "@evolution-sdk/plan"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import * as Cip113 from "../src/Cip113.js"
import { Network } from "../src/Types.js"
import { V0_3_0, V0_4_0, V0_5_0_ALPHA_2 } from "../src/Versions.js"
import { type Assembled, assembled, CML, intsOf } from "./tx-shape.js"

const h28 = (b: string): string => b.repeat(28)
const txHash = (b: string): string => b.repeat(32)

const run = <A, E>(e: Effect.Effect<A, E>): A => Effect.runSync(e as Effect.Effect<A, never>)
/**
 * The typed failure, insisting it really is a `Plan.BuildError`.
 *
 * ⚠️ Not just `.reason` off the union: `selectCoveringNode`'s throw used to escape as a DEFECT
 * rather than the error this function's type promises, which `Effect.either` never sees. Asserting
 * the tag is what tells the two apart.
 */
const buildFailure = <A>(e: Effect.Effect<A, Plan.BuildError | Cip113.Cip113Error>): string => {
  const r = Effect.runSync(Effect.either(e))
  if (Either.isRight(r)) throw new Error("expected a BuildError, got a transaction")
  if (r.left._tag !== "BuildError") throw new Error(`expected a BuildError, got ${r.left._tag}`)
  return r.left.reason
}

const PLB = h28("0a")
const TRANSFER = h28("ee")
const PLG = h28("cc")
const TL = h28("d1")
const TL2 = h28("d2")
const OWNER = h28("0b")
const RECIPIENT = h28("0c")
const P_A = h28("20")
const P_B = h28("40")

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

const nodeFor = (keyHex: string, nextHex: string, transferLogicHex: string): Cip113.RegistryNode => ({
  keyHex,
  nextHex,
  mintingLogicScript: Cip113.ABSENT_CRED,
  transferLogicScript: { kind: "script", hashHex: transferLogicHex },
  thirdPartyTransferLogicScript: Cip113.ABSENT_CRED,
  unfrackingLogicScript: Cip113.ABSENT_CRED,
  globalStateCsHex: "",
})

/** origin → P_A → sentinel: P_A is registered, anything above it is covered by P_A's node. */
const NODE_A = nodeFor(P_A, Cip113.SENTINEL_NEXT_KEY, TL)

const request = (over: Partial<Cip113.TransferRequest> = {}): Cip113.TransferRequest => ({
  network: Network.Testnet,
  params: PARAMS,
  plbScriptHashHex: PLB,
  plbScriptHex: SCRIPT("11") as never,
  transferScriptHashHex: TRANSFER,
  transferScriptHex: SCRIPT("12") as never,
  transferExUnits: [1_000n, 500_000n],
  plgScriptHashHex: PLG,
  plgScriptHex: SCRIPT("13") as never,
  plgExUnits: [900n, 400_000n],
  // Supplied first, sorts last.
  protocolParamsRef: { txHash: txHash("f1") as never, index: 0 },
  // Supplied last, sorts first.
  extraReferenceInputs: [{ txHash: txHash("01") as never, index: 7 }],
  registryNodes: [{ txHash: txHash("a0") as never, index: 3, node: NODE_A }],
  movedPolicies: [P_A],
  substandards: [
    { scriptHashHex: TL, scriptHex: SCRIPT("14") as never, redeemerDataHex: "d8799f00ff", exUnits: [100n, 50_000n] },
  ],
  plbInputs: [
    {
      txHash: txHash("b0") as never,
      index: 1,
      assets: Assets.fromLovelace(5_000_000n),
      owner: { kind: "key", hashHex: OWNER },
      exUnits: [200n, 100_000n],
    },
  ],
  plbOutputs: [{ recipient: { kind: "key", hashHex: RECIPIENT }, assets: Assets.fromLovelace(5_000_000n) }],
  fundingInputs: [{ txHash: txHash("c0"), index: 0, assets: Assets.fromLovelace(20_000_000n) }],
  collateral: [{ txHash: txHash("c0") as never, index: 0 }],
  changeAddressHex: `00${h28("0d")}${h28("0e")}` as never,
  costModels: COST_MODELS,
  ...over,
})

const PARAMS_REF = `${txHash("f1")}#0`
const NODE_REF = `${txHash("a0")}#3`
const EXTRA_REF = `${txHash("01")}#7`

describe("a LATEST transfer, read back out of the assembled transaction", () => {
  const built = run(Cip113.buildTransferTx(request()))
  const tx = assembled(built)

  it("sorts the reference inputs by outpoint, not by the order they were supplied", () => {
    expect(tx.referenceInputs).toEqual([EXTRA_REF, NODE_REF, PARAMS_REF])
  })

  it("resolves params_idx, out of the PLB redeemer, to the params reference input", () => {
    const spend = tx.redeemers.find((r) => r.tag === 0)!
    const [paramsIdx] = intsOf(spend.dataHex)
    expect(tx.referenceInputs[Number(paramsIdx)]).toBe(PARAMS_REF)
    // And it is not the index the supply order would have given, which is the point of the sort.
    expect(Number(paramsIdx)).not.toBe(0)
  })

  it("resolves each proof's node_idx to the registry node's reference input", () => {
    const transfer = tx.redeemers.find((r) => r.dataHex.startsWith("d8799f9f"))!
    const proofs = CML.PlutusData.from_cbor_hex(transfer.dataHex).as_constr_plutus_data().fields().get(0).as_list()
    expect(proofs.len()).toBe(1)
    const proof = proofs.get(0).as_constr_plutus_data()
    expect(proof.alternative()).toBe(0n) // exists: P_A is registered
    const nodeIdx = Number(proof.fields().get(0).as_integer().to_str())
    expect(tx.referenceInputs[nodeIdx]).toBe(NODE_REF)
  })

  it("resolves wdrl_idx, in the LEDGER's withdrawal order, to the dispatcher's account", () => {
    // ⚠️ The order that matters is the script context's (`Ord Credential`: scripts before keys,
    // bytewise within each), not the body's canonical-CBOR map order. Every withdrawal here is a
    // script, so the two coincide — which is precisely why the resolution is computed from the
    // credential kinds rather than read off the serialised map.
    const spend = tx.redeemers.find((r) => r.tag === 0)!
    const [, wdrlIdx] = intsOf(spend.dataHex)
    const ledgerOrder = [
      { rewardAcctHex: Cip113.delegateRewardAccountHex(Network.Testnet, PLG), cred: { kind: "script", hashHex: PLG } },
      { rewardAcctHex: Cip113.delegateRewardAccountHex(Network.Testnet, TRANSFER), cred: { kind: "script", hashHex: TRANSFER } },
      { rewardAcctHex: Cip113.delegateRewardAccountHex(Network.Testnet, TL), cred: { kind: "script", hashHex: TL } },
    ] as ReadonlyArray<Cip113.WithdrawalKey>
    const sorted = [...ledgerOrder].sort(Cip113.compareWithdrawalKeys)
    expect(sorted[Number(wdrlIdx)]!.cred.hashHex).toBe(PLG)
  })

  it("carries both framework withdrawals plus the moved policy's transfer_logic", () => {
    expect(tx.withdrawalAccounts).toEqual([
      Cip113.delegateRewardAccountHex(Network.Testnet, PLG),
      Cip113.delegateRewardAccountHex(Network.Testnet, TL),
      Cip113.delegateRewardAccountHex(Network.Testnet, TRANSFER),
    ])
  })

  it("points every reward redeemer at its own withdrawal, by the body's map position", () => {
    // A reward redeemer's index is a position in the withdrawals map AS SERIALISED. Getting this
    // wrong hands the dispatcher the delegate's redeemer, which decodes and then fails in phase 2.
    const byIndex = new Map(tx.redeemers.filter((r) => r.tag === 3).map((r) => [Number(r.index), r.dataHex]))
    const accountAt = (i: number): string => tx.withdrawalAccounts[i]!
    expect(accountAt(0)).toBe(Cip113.delegateRewardAccountHex(Network.Testnet, PLG))
    expect(byIndex.get(0)).toBe(run(Cip113.plgDispatchRedeemer("transfer")))
    expect(accountAt(1)).toBe(Cip113.delegateRewardAccountHex(Network.Testnet, TL))
    expect(byIndex.get(1)).toBe("d8799f00ff") // the substandard redeemer, verbatim as supplied
    expect(accountAt(2)).toBe(Cip113.delegateRewardAccountHex(Network.Testnet, TRANSFER))
    expect(byIndex.get(2)!.startsWith("d8799f9f")).toBe(true)
  })

  it("gives every PLB input a spend redeemer resolved to its canonical input position", () => {
    const spend = tx.redeemers.filter((r) => r.tag === 0)
    expect(spend).toHaveLength(1)
    expect(tx.outpoints[Number(spend[0]!.index)]).toBe(`${txHash("b0")}#1`)
  })

  it("emits the PLB redeemer bytes the encoder emits for the computed indices", () => {
    // The pair, stated directly: the assembled redeemer is the encoder's output for the indices
    // the assembly derived, so neither side can drift without this failing.
    const spend = tx.redeemers.find((r) => r.tag === 0)!
    const [paramsIdx, wdrlIdx] = intsOf(spend.dataHex).map(Number)
    expect(spend.dataHex).toBe(
      run(Cip113.plbSpendRedeemer({ arm: "transfer", paramsIdx: paramsIdx!, wdrlIdx: wdrlIdx! }))
    )
  })

  it("requires the key owner of the PLB input to sign", () => {
    expect(tx.requiredSigners).toEqual([OWNER])
  })

  it("re-locks the moved value at the recipient's smart wallet, and keeps it seizable", () => {
    // Upstream's `is_seizable_output_shape_bounded`, all four parts: a datum HASH is forbidden (a
    // holder could pin a secret preimage and make the UTxO unspendable by anyone else, so no
    // seizure could be constructed), a reference script is forbidden (a seizure must reproduce it
    // byte for byte), an inline datum is BOUNDED, and `NoDatum` is fine. The first two are
    // unreachable through this builder, which is what makes them structural rather than checked.
    const plbOut = tx.outputs.find(
      (o) => o.addressHex === Cip113.smartWalletAddressHex(Network.Testnet, PLB, { kind: "key", hashHex: RECIPIENT })
    )
    expect(plbOut).toBeDefined()
    expect(plbOut!.hasDatumHash).toBe(false)
    expect(plbOut!.hasScriptRef).toBe(false)
    expect(plbOut!.datumHex).toBeUndefined()
  })

  it("⚠️ carries ANY bounded inline datum, because the protocol allows one", () => {
    // ⚠️ Measured against upstream's own source rather than borrowed from another SDK. A
    // comparison with `@easy1staking/cip113-sdk-ts` listed "refuses non-void inline datums" and
    // "refuses `(100)` reference tokens" as guards worth copying; upstream's `prog_assets.ak`
    // says the opposite on both counts — "Only `NoDatum` or an inline datum is allowed", bounded,
    // and CIP-68 reference tokens are named as the standing example of a datum large enough to
    // need the bound, with companion assets explicitly the token module's business and
    // "transferring them is allowed". Copying those refusals would reject transactions the chain
    // accepts, so this holds the permissive behaviour on purpose.
    const datumHex = "d8799f4101ff"
    const withDatum = assembled(
      run(
        Cip113.buildTransferTx(
          request({
            plbOutputs: [
              {
                recipient: { kind: "key", hashHex: RECIPIENT },
                assets: Assets.fromLovelace(5_000_000n),
                datumHex: datumHex as never,
              },
            ],
            maxInlineDatumBytes: 64n,
          })
        )
      )
    )
    const out = withDatum.outputs.find((o) => o.datumHex !== undefined)
    expect(out).toBeDefined()
    expect(out!.datumHex).toBe(datumHex)
    expect(out!.hasDatumHash).toBe(false)
    expect(out!.hasScriptRef).toBe(false)
  })

  it("witnesses PLB, the dispatcher, the transfer delegate and the used transfer_logic", () => {
    expect(tx.scriptsV3).toBe(4)
  })

  it("prices the whole thing — the fee is the plan's, not a placeholder", () => {
    expect(built.fee).toBeGreaterThan(0n)
    expect(built.size).toBeGreaterThan(0)
  })
})

describe("the indices move with the transaction", () => {
  it("shifts params_idx and node_idx when a reference input is added", () => {
    // The facade recomputes both from the finished sorted list. A caller that supplied the
    // indices itself, or an implementation that cached them, would be wrong by one here.
    const without = assembled(run(Cip113.buildTransferTx(request({ extraReferenceInputs: [] }))))
    const with2 = assembled(
      run(
        Cip113.buildTransferTx(
          request({
            extraReferenceInputs: [
              { txHash: txHash("01") as never, index: 7 },
              { txHash: txHash("02") as never, index: 0 },
            ],
          })
        )
      )
    )
    const paramsIdxOf = (tx: Assembled): number => Number(intsOf(tx.redeemers.find((r) => r.tag === 0)!.dataHex)[0])
    expect(without.referenceInputs).toEqual([NODE_REF, PARAMS_REF])
    expect(paramsIdxOf(without)).toBe(1)
    expect(paramsIdxOf(with2)).toBe(3)
    expect(with2.referenceInputs[paramsIdxOf(with2)]).toBe(PARAMS_REF)
  })

  it("keeps one reference input and two proofs when two policies share a covering node", () => {
    const tx = assembled(run(Cip113.buildTransferTx(request({ movedPolicies: [P_A, P_B] }))))
    expect(tx.referenceInputs).toEqual([EXTRA_REF, NODE_REF, PARAMS_REF])
    const transfer = tx.redeemers.find((r) => r.dataHex.startsWith("d8799f9f"))!
    const proofs = CML.PlutusData.from_cbor_hex(transfer.dataHex).as_constr_plutus_data().fields().get(0).as_list()
    expect(proofs.len()).toBe(2)
    // P_A is registered, P_B is covered by P_A's node — both point at the same reference input.
    expect(proofs.get(0).as_constr_plutus_data().alternative()).toBe(0n)
    expect(proofs.get(1).as_constr_plutus_data().alternative()).toBe(1n)
    const idxOf = (i: number): number =>
      Number(proofs.get(i).as_constr_plutus_data().fields().get(0).as_integer().to_str())
    expect(tx.referenceInputs[idxOf(0)]).toBe(NODE_REF)
    expect(idxOf(1)).toBe(idxOf(0))
  })

  it("withdraws from each distinct transfer_logic once, however many policies use it", () => {
    const nodeB = nodeFor(P_B, Cip113.SENTINEL_NEXT_KEY, TL)
    const tx = assembled(
      run(
        Cip113.buildTransferTx(
          request({
            registryNodes: [
              { txHash: txHash("a0") as never, index: 3, node: nodeFor(P_A, P_B, TL) },
              { txHash: txHash("a1") as never, index: 0, node: nodeB },
            ],
            movedPolicies: [P_A, P_B],
          })
        )
      )
    )
    expect(tx.withdrawalAccounts.filter((a) => a === Cip113.delegateRewardAccountHex(Network.Testnet, TL))).toHaveLength(1)
    expect(tx.withdrawalAccounts).toHaveLength(3)
  })

  it("asks for no transfer_logic at all when every moved policy is unregistered", () => {
    // An unregistered policy's proof is `notExists`; there is no substandard to run, so the only
    // withdrawals left are the framework's two.
    const tx = assembled(
      run(Cip113.buildTransferTx(request({ movedPolicies: [P_B], substandards: [] })))
    )
    expect(tx.withdrawalAccounts).toEqual([
      Cip113.delegateRewardAccountHex(Network.Testnet, PLG),
      Cip113.delegateRewardAccountHex(Network.Testnet, TRANSFER),
    ])
    expect(tx.scriptsV3).toBe(3)
  })

  it("gives several PLB inputs the same redeemer data and distinct resolved indices", () => {
    const tx = assembled(
      run(
        Cip113.buildTransferTx(
          request({
            plbInputs: [
              {
                txHash: txHash("b0") as never,
                index: 1,
                assets: Assets.fromLovelace(3_000_000n),
                owner: { kind: "key", hashHex: OWNER },
                exUnits: [200n, 100_000n],
              },
              {
                txHash: txHash("b1") as never,
                index: 0,
                assets: Assets.fromLovelace(3_000_000n),
                owner: { kind: "key", hashHex: OWNER },
                exUnits: [200n, 100_000n],
              },
            ],
          })
        )
      )
    )
    const spends = tx.redeemers.filter((r) => r.tag === 0)
    expect(spends).toHaveLength(2)
    expect(new Set(spends.map((s) => s.dataHex)).size).toBe(1)
    expect(new Set(spends.map((s) => Number(s.index))).size).toBe(2)
    for (const s of spends) expect(tx.outpoints[Number(s.index)]!.startsWith("b")).toBe(true)
    // One owner, one required signer — not one per input.
    expect(tx.requiredSigners).toEqual([OWNER])
  })
})

describe("the pre-dispatcher generations", () => {
  it("alpha.2 withdraws from the delegate directly, and says so in both redeemers", () => {
    const tx = assembled(
      run(
        Cip113.buildTransferTx(
          request({
            version: V0_5_0_ALPHA_2,
            plgScriptHashHex: undefined,
            plgScriptHex: undefined,
            plgExUnits: undefined,
          })
        )
      )
    )
    expect(tx.withdrawalAccounts).toEqual([
      Cip113.delegateRewardAccountHex(Network.Testnet, TL),
      Cip113.delegateRewardAccountHex(Network.Testnet, TRANSFER),
    ])
    const spend = tx.redeemers.find((r) => r.tag === 0)!
    const [paramsIdx, wdrlIdx] = intsOf(spend.dataHex).map(Number)
    // wdrl_idx now names the TRANSFER delegate: TL sorts before TRANSFER bytewise, so it is 1.
    expect(wdrlIdx).toBe(1)
    expect(tx.referenceInputs[paramsIdx!]).toBe(PARAMS_REF)
    // The alpha.2 transfer redeemer carries params_idx ahead of the proofs.
    const transfer = tx.redeemers.filter((r) => r.tag === 3).map((r) => r.dataHex).find((d) => d.length > 20)!
    expect(intsOf(transfer)).toEqual([String(paramsIdx)])
    expect(tx.scriptsV3).toBe(3)
  })

  it("v0.4.0 sends PLB a unit redeemer and the coordinator a TransferAct", () => {
    const tx = assembled(
      run(
        Cip113.buildTransferTx(
          request({ version: V0_4_0, plgScriptHashHex: undefined, plgScriptHex: undefined, plgExUnits: undefined })
        )
      )
    )
    expect(tx.redeemers.find((r) => r.tag === 0)!.dataHex).toBe("d87980")
    expect(tx.withdrawalAccounts).toHaveLength(2)
  })

  it("v0.3.0 behaves as v0.4.0 does on the transfer path", () => {
    const tx = assembled(
      run(
        Cip113.buildTransferTx(
          request({ version: V0_3_0, plgScriptHashHex: undefined, plgScriptHex: undefined, plgExUnits: undefined })
        )
      )
    )
    expect(tx.redeemers.find((r) => r.tag === 0)!.dataHex).toBe("d87980")
  })
})

describe("what buildTransferTx refuses", () => {
  it("refuses a dispatcher version without the dispatcher's script, hash and budget", () => {
    // ⚠️ Not "defaults to no dispatcher". A LATEST transaction missing that withdrawal is accepted
    // by every encoder and rejected by PLB, which reads `plg_cred` and requires it withdraw.
    for (const missing of [{ plgScriptHashHex: undefined }, { plgScriptHex: undefined }, { plgExUnits: undefined }]) {
      expect(buildFailure(Cip113.buildTransferTx(request(missing)))).toContain("dispatches through")
    }
  })

  it("refuses a dispatcher on a version that has none", () => {
    expect(
      buildFailure(Cip113.buildTransferTx(request({ version: V0_4_0 })))
    ).toContain("has no dispatcher")
  })

  it("refuses a moved policy no supplied node covers", () => {
    expect(buildFailure(Cip113.buildTransferTx(request({ registryNodes: [] })))).toContain(
      "no covering registry node"
    )
  })

  it("names the transfer_logic it has no substandard for", () => {
    const reason = buildFailure(Cip113.buildTransferTx(request({ substandards: [] })))
    expect(reason).toContain(TL)
    expect(reason).toContain(P_A)
  })

  it("refuses a substandard that does not match the node's transfer_logic", () => {
    const reason = buildFailure(
      Cip113.buildTransferTx(
        request({
          substandards: [
            { scriptHashHex: TL2, scriptHex: SCRIPT("15") as never, redeemerDataHex: "d87980", exUnits: [1n, 1n] },
          ],
        })
      )
    )
    expect(reason).toContain(TL)
  })

  it("refuses a registered policy whose transfer_logic is a key credential", () => {
    // A key credential cannot run, so there is nothing to withdraw from; the registry entry is
    // malformed rather than permissive.
    const keyLogic: Cip113.RegistryNode = { ...NODE_A, transferLogicScript: { kind: "key", hashHex: TL } }
    const reason = buildFailure(
      Cip113.buildTransferTx(request({ registryNodes: [{ txHash: txHash("a0") as never, index: 3, node: keyLogic }] }))
    )
    expect(reason).toContain("non-script transfer_logic")
  })

  it("refuses an inline datum over max_inline_datum_bytes, and accepts one at the bound", () => {
    const datumHex = `d8799f${"41ff".repeat(8)}ff`
    const bytes = BigInt(datumHex.length / 2)
    const over = buildFailure(
      Cip113.buildTransferTx(
        request({
          plbOutputs: [{ recipient: { kind: "key", hashHex: RECIPIENT }, assets: Assets.fromLovelace(5_000_000n), datumHex: datumHex as never }],
          maxInlineDatumBytes: bytes - 1n,
        })
      )
    )
    expect(over).toContain("over max_inline_datum_bytes")
    const at = run(
      Cip113.buildTransferTx(
        request({
          plbOutputs: [{ recipient: { kind: "key", hashHex: RECIPIENT }, assets: Assets.fromLovelace(5_000_000n), datumHex: datumHex as never }],
          maxInlineDatumBytes: bytes,
        })
      )
    )
    const out = assembled(at).outputs.find((o) => o.datumHex !== undefined)
    expect(out).toBeDefined()
  })

  it("leaves the bound unchecked when the caller has no params datum to read it from", () => {
    // Documented behaviour, asserted so it stays a decision: without the bound an over-large
    // datum builds and is rejected on submission.
    const huge = `d8799f${"41ff".repeat(400)}ff`
    const built = run(
      Cip113.buildTransferTx(
        request({
          plbOutputs: [{ recipient: { kind: "key", hashHex: RECIPIENT }, assets: Assets.fromLovelace(8_000_000n), datumHex: huge as never }],
        })
      )
    )
    expect(built.bodyHex.length).toBeGreaterThan(0)
  })
})

/**
 * A programmable input's inline datum is the caller's to move, and this builder refuses to decide
 * for them.
 *
 * ⚠️ The reference SDK measured the cost of deciding wrong: asked to transfer a CIP-68 (100)
 * reference token, it emitted the output with `d87980` where the metadata had been, the ledger
 * ACCEPTED it, and the reference NFT ended up at an address its issuer no longer controlled.
 * Nothing failed — not the build, not the evaluation, not the submission, not its suite.
 *
 * This builder cannot overwrite a datum (it writes only what the caller supplies), so the loss it
 * could cause is the quiet one: a transfer that silently leaves the datum behind. Refused.
 */
describe("a transfer refuses to drop an input's inline datum", () => {
  const inputWith = (datumHex?: string): Cip113.PlbInput => ({
    txHash: txHash("b0") as never,
    index: 1,
    assets: Assets.fromLovelace(5_000_000n),
    owner: { kind: "key", hashHex: OWNER },
    exUnits: [200n, 100_000n],
    ...(datumHex === undefined ? {} : { datumHex: datumHex as never })
  })

  it("refuses an input carrying a non-void inline datum, naming it", () => {
    const reason = buildFailure(Cip113.buildTransferTx(request({ plbInputs: [inputWith("d8799f4463697036ff")] })))

    expect(reason).toContain("non-void inline datum")
    expect(reason).toContain("CIP-68")
  })

  it("builds when the input carries the void datum, which is what a plain programmable output holds", () => {
    const tx = assembled(run(Cip113.buildTransferTx(request({ plbInputs: [inputWith("d87980")] }))))

    expect(tx.outpoints).toContain(`${txHash("b0")}#1`)
  })

  it("builds when the input carries no datum at all", () => {
    const tx = assembled(run(Cip113.buildTransferTx(request({ plbInputs: [inputWith()] }))))

    expect(tx.outpoints).toContain(`${txHash("b0")}#1`)
  })
})
