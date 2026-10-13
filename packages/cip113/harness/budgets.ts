/**
 * Measure the CIP-113 framework scripts' execution budgets, offline, on a real Plutus VM.
 *
 * ⚠️ WHY THIS EXISTS AT ALL. `Budgets.ts` records four measurements, and until this harness every
 * one of them cited a script outside this repository — so nothing here could re-derive them, and
 * a redeploy or an upstream cost change would have surfaced as a REJECTED TRANSACTION rather than
 * as a failing check. This is the re-derivation, over this repository's own pieces:
 * `UPLC.applyParamsToScript` for the deployment, `@evolution-sdk/aiken-uplc` for the VM.
 *
 * What it buys and what it does not: the validators and their costs are REAL, so the SLOPES are
 * trustworthy. The absolute intercept depends on transaction shape — asset counts, datums,
 * registry-proof lengths — which is what the margin in `transferBudgets` is for. Re-measure
 * against a real deployment before anyone submits on a new shape.
 *
 * It also PINS `measurementFor(version)`: it re-derives the numbers and fails if the recorded
 * presets no longer reproduce them, so an upstream cost change shows up here.
 *
 *   pnpm --filter @evolution-sdk/cip113 run budgets
 *   CIP113_VERSION=v0.5.0-alpha.4 pnpm --filter @evolution-sdk/cip113 run budgets
 */
import { createAikenEvaluator } from "@evolution-sdk/aiken-uplc"
import { Address, Assets, CostModel, InlineDatum, TransactionHash, TransactionInput, TxOut } from "@evolution-sdk/evolution"
import type { Plan } from "@evolution-sdk/plan"
import type { ExUnits } from "@evolution-sdk/plan/ExUnits"
import { Effect } from "effect"

import * as Budgets from "../src/Budgets.js"
import * as Cip113 from "../src/Cip113.js"
import * as Encode from "../src/internal/Encode.js"
import * as Issuer from "../src/Issuer.js"
import { Network } from "../src/Types.js"
import { uplcBackend } from "../src/UplcBackend.js"
import type { Cip113Version } from "../src/Versions.js"
import { LATEST, versionById } from "../src/Versions.js"
import { blueprintFor, CLONE, DEPLOY_DEFAULTS, loadBlueprint, paramsLockHash, refFor } from "./blueprint.js"
import { COST_MODELS, PLUTUS_V3_COSTS } from "./cost-model.js"

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, detail?: string): void => {
  if (cond) {
    pass += 1
    console.log(`  ok   ${name}${detail === undefined ? "" : ` — ${detail}`}`)
  } else {
    fail += 1
    console.error(`  FAIL ${name}${detail === undefined ? "" : ` — ${detail}`}`)
  }
}

const version: Cip113Version = (() => {
  const id = process.env.CIP113_VERSION
  if (id === undefined) return LATEST
  const found = versionById(id)
  if (found.kind !== "found") throw new Error(`CIP113_VERSION=${id} is not a known descriptor: ${found.known.join(", ")}`)
  return found.version
})()

/**
 * ⚠️ A missing clone is a SKIP, loudly, not a crash and not a pass. The blueprint is upstream's
 * build output and is not vendored here, so a machine without the sibling clone cannot measure
 * anything — and a harness that dies with ENOENT reads as a broken harness, while one that exits
 * 0 silently reads as a green check that never ran.
 */
const loaded = (() => {
  try {
    return loadBlueprint(refFor(version))
  } catch (e) {
    console.log(`  SKIPPED: no CIP-113 blueprint (${e instanceof Error ? e.message : String(e)})`)
    console.log(`  It needs a clone of cardano-foundation/cip113-programmable-tokens at ${CLONE},`)
    console.log("  or CIP113_CLONE / CIP113_BLUEPRINT / CIP113_BLUEPRINT_REF pointing at one.")
    console.log("cip113 budgets: 0 pass, 0 fail (skipped — nothing was measured)")
    process.exit(0)
  }
})()
const { blueprint: raw, source } = loaded
console.log(`  blueprint: ${source}, preamble ${raw.preamble.version ?? "?"}`)
console.log(`  version:   ${version.id}`)

const backend = uplcBackend(createAikenEvaluator)
const run = <A, E>(e: Effect.Effect<A, E, Issuer.IssuerTag>): Promise<A> =>
  Effect.runPromise(Effect.provideService(e, Issuer.IssuerTag, backend) as Effect.Effect<A, never>)

const NET = Network.Mainnet
const KEY_ADDR = `61${"77".repeat(28)}`
const PARAMS: Plan.ProtocolParams = {
  minFeeA: 44n,
  minFeeB: 155_381n,
  coinsPerUtxoByte: 4310n,
  keyDeposit: 2_000_000n,
  poolDeposit: 500_000_000n,
  drepDeposit: 500_000_000n,
  priceMem: [577n, 10_000n],
  priceStep: [721n, 10_000_000n],
  collateralPercentage: 150,
  maxCollateralInputs: 3,
}
/**
 * ⚠️ The SAME model on both sides. The body commits to a `script_data_hash` over the cost models,
 * and the VM prices with the ones it is handed; different models there would measure prices the
 * transaction does not commit to, and the figure would be plausible and wrong.
 */
const COSTS = [{ language: 2, costs: PLUTUS_V3_COSTS }]
const COST_MODELS_HEX = CostModel.toCBORHex(COST_MODELS)
const SLOT: readonly [bigint, bigint, number] = [1_660_003_200_000n, 0n, 1000]
/** Deliberately generous: we are MEASURING, so the budget must never be the binding constraint. */
const BIG: readonly [bigint, bigint] = [6_000_000n, 3_000_000_000n]
const ADA2 = 2_000_000n

/** A real compiled script standing in for a substandard's logic — it ignores its redeemer. */
const DUMMY_CODE =
  "586d01010029800aba2aba1aab9eaab9dab9a48888966002646465300130053754003300700398038012444b30013370e9002001c4c928980518049baa0048acc004cdc3a40000071324a26eb8c028c024dd5002459007200e18031803800980300098019baa0068a4d13656400401"
const DUMMY_HASH = await run(backend.scriptHashV3(DUMMY_CODE))

const bp = blueprintFor(raw, version)
const dep = await run(Issuer.deriveDeployment({ blueprint: bp, ...DEPLOY_DEFAULTS }, version))
const tokenPolicy = await run(Issuer.deriveTokenPolicy(bp.issuanceMint, dep, DUMMY_HASH, version))
console.log(`  plb:       ${dep.plbCred}`)
console.log(`  transfer:  ${dep.transferCred}`)
console.log(`  token:     ${tokenPolicy.policyId}`)

// ── the UTxO set the VM resolves the transaction against ────────────────────────
// Hand-built rather than fetched: the whole point is that no network is involved. The state is
// fabricated but internally consistent — the params UTxO carries the datum the derivation
// produced, the registry node carries the token's own policy as its key.

const assembleTx = (built: Plan.UnsignedPlanTx): string => {
  const entries = built.witnessExtra.map(([k, hex]) => `${k.toString(16).padStart(2, "0")}${hex}`)
  const witnessSet = `${(0xa0 + entries.length).toString(16).padStart(2, "0")}${entries.join("")}`
  return `84${built.bodyHex}${witnessSet}f5${built.auxHex === "" ? "f6" : built.auxHex}`
}

const inputHex = (txHash: string, index: number): string =>
  TransactionInput.toCBORHex(
    // ⚠️ `index` is `Uint16Schema`, which is bigint-backed: a number fails schema validation.
    new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(txHash), index: BigInt(index) })
  )

const outputHex = (addressHex: string, assets: Assets.Assets, datumHex?: string): string =>
  TxOut.toCBORHex(
    new TxOut.TransactionOutput({
      address: Address.fromHex(addressHex),
      assets,
      ...(datumHex === undefined ? {} : { datumOption: InlineDatum.fromCBORHex(datumHex) }),
    })
  )

const enterprise = (hashHex: string): string => Encode.enterpriseScriptHex(NET, hashHex)

const PARAMS_REF = { txHash: "b1".repeat(32), index: 0 }
const NODE_REF = { txHash: "e1".repeat(32), index: 0 }
const FUND = { txHash: "f0".repeat(32), index: 0 }
const COLLATERAL = { txHash: "c0".repeat(32), index: 0 }

const lock = paramsLockHash(dep, version)
if (lock === undefined) throw new Error(`no params lock target for ${version.id}`)

const paramsUtxo: readonly [string, string] = [
  inputHex(PARAMS_REF.txHash, PARAMS_REF.index),
  outputHex(
    enterprise(lock),
    Encode.assetsOf(ADA2, [`${dep.protocolParamsCs}.${Buffer.from("ProtocolParams").toString("hex")}`], [1n]),
    dep.protocolParamsDatumHex
  ),
]

const node: Cip113.RegistryNode = {
  keyHex: tokenPolicy.policyId,
  nextHex: Cip113.SENTINEL_NEXT_KEY,
  mintingLogicScript: { kind: "script", hashHex: DUMMY_HASH },
  transferLogicScript: { kind: "script", hashHex: DUMMY_HASH },
  thirdPartyTransferLogicScript: { kind: "script", hashHex: DUMMY_HASH },
  unfrackingLogicScript: Cip113.ABSENT_CRED,
  globalStateCsHex: "",
}
const nodeDatum = await run(Cip113.registryNodeDatum(node, version))
const nodeUtxo: readonly [string, string] = [
  inputHex(NODE_REF.txHash, NODE_REF.index),
  outputHex(
    enterprise(dep.registrySpendCred),
    Encode.assetsOf(ADA2, [`${dep.registryNodeCs}.${tokenPolicy.policyId}`], [1n]),
    nodeDatum
  ),
]

const OWNER: Cip113.Credential = { kind: "key", hashHex: "11".repeat(28) }
const RECIPIENT: Cip113.Credential = { kind: "key", hashHex: "22".repeat(28) }
const NAME = Buffer.from("TOKEN").toString("hex")
const asset = `${tokenPolicy.policyId}.${NAME}`
const walletAddr = Cip113.smartWalletAddressHex(NET, dep.plbCred, OWNER)

interface Shape {
  readonly plb: ExUnits
  readonly plbAll: ReadonlyArray<ExUnits>
  readonly transfer: ExUnits
  readonly plg?: ExUnits
  readonly n: number
  readonly o: number
}

/**
 * Evaluate one transfer of `ins` PLB inputs → `outs` PLB outputs.
 *
 * ⚠️ Constant-WIDTH quantities. With 120 per input the totals were 120 / 240 / 360 — 1-, 2- and
 * 3-byte CBOR integers — and that alone moved the measured per-input cost by ~15%. 1000·n keeps
 * every total a 2-byte integer across the whole sweep.
 */
const measure = async (ins: number, outs: number): Promise<Shape> => {
  const perIn = 1_000n
  const total = perIn * BigInt(ins)
  const plbInputs = Array.from({ length: ins }, (_, i) => ({
    txHash: (16 + i).toString(16).padStart(2, "0").repeat(32) as never,
    index: 0,
    assets: Encode.assetsOf(4_000_000n, [asset], [perIn]),
    owner: OWNER,
    exUnits: BIG,
  }))
  // Conserve exactly: the first output takes the remainder, the rest an equal floor share, so
  // the per-policy conservation the transfer validator enforces holds.
  const share = total / BigInt(outs)
  const quantities = Array.from({ length: outs }, (_, i) => (i === 0 ? total - share * BigInt(outs - 1) : share))
  const plbOutputs = quantities.map((q) => ({
    recipient: RECIPIENT,
    assets: Encode.assetsOf(ADA2, [asset], [q]),
  }))

  const dispatching = version.dispatch === "plg-dispatcher"
  const built = await run(
    Cip113.buildTransferTx({
      network: NET,
      params: PARAMS,
      costModels: COSTS,
      version,
      plbScriptHashHex: dep.plbCred,
      plbScriptHex: dep.applied.programmableLogicBase as never,
      transferScriptHashHex: dep.transferCred,
      transferScriptHex: dep.applied.transfer as never,
      transferExUnits: BIG,
      ...(dispatching
        ? {
            plgScriptHashHex: dep.plgCred,
            plgScriptHex: dep.applied.programmableLogicGlobal as never,
            plgExUnits: BIG,
          }
        : {}),
      protocolParamsRef: { txHash: PARAMS_REF.txHash as never, index: PARAMS_REF.index },
      registryNodes: [{ txHash: NODE_REF.txHash as never, index: NODE_REF.index, node }],
      movedPolicies: [tokenPolicy.policyId],
      substandards: [
        { scriptHashHex: DUMMY_HASH, scriptHex: DUMMY_CODE as never, redeemerDataHex: "d87980", exUnits: BIG },
      ],
      plbInputs,
      plbOutputs,
      fundingInputs: [{ txHash: FUND.txHash, index: FUND.index, assets: Assets.fromLovelace(300_000_000n) }],
      collateral: [{ txHash: COLLATERAL.txHash as never, index: COLLATERAL.index }],
      changeAddressHex: KEY_ADDR as never,
    })
  )

  const utxos: ReadonlyArray<readonly [string, string]> = [
    ...plbInputs.map((i): readonly [string, string] => [inputHex(i.txHash, 0), outputHex(walletAddr, i.assets)]),
    paramsUtxo,
    nodeUtxo,
    [inputHex(FUND.txHash, FUND.index), outputHex(KEY_ADDR, Assets.fromLovelace(300_000_000n))],
    [inputHex(COLLATERAL.txHash, COLLATERAL.index), outputHex(KEY_ADDR, Assets.fromLovelace(20_000_000n))],
  ]

  const costs = await run(
    backend.evalTx({
      txHex: assembleTx(built),
      utxos,
      costModelsHex: COST_MODELS_HEX,
      maxMem: 140_000_000n,
      maxSteps: 100_000_000_000n,
      slot: SLOT,
    })
  )

  const spends = costs.filter((c) => c.tag === 0)
  if (spends.length === 0) throw new Error("the VM reported no spend redeemers — the shape is wrong, not cheap")

  // ⚠️ Identify each reward redeemer by its ACCOUNT, not as "the most expensive one". With the
  // dispatcher there are three reward redeemers, and the old heuristic would silently start
  // measuring whichever script happened to be dearest. A reward redeemer's index is its position
  // in the CANONICALLY SERIALISED withdrawals map — sorted by reward-account bytes — so the
  // mapping is computable rather than guessed.
  const acct = (h: string): string => Cip113.delegateRewardAccountHex(NET, h)
  const accounts = [acct(dep.transferCred), acct(DUMMY_HASH), ...(dispatching ? [acct(dep.plgCred!)] : [])].sort()
  const rewardAt = (h: string) => costs.find((c) => c.tag === 3 && c.index === accounts.indexOf(acct(h)))
  const transfer = rewardAt(dep.transferCred)
  if (transfer === undefined) throw new Error("could not map the transfer delegate's reward redeemer to its account")
  const plg = dispatching ? rewardAt(dep.plgCred!) : undefined
  if (dispatching && plg === undefined) throw new Error("could not map the dispatcher's reward redeemer")

  return { plb: spends[0]!, plbAll: spends, transfer, ...(plg === undefined ? {} : { plg }), n: ins, o: outs }
}

const m11 = await measure(1, 1)
const m21 = await measure(2, 1)
const m31 = await measure(3, 1)
const m41 = await measure(4, 1)
const m12 = await measure(1, 2)
const m13 = await measure(1, 3)
const m14 = await measure(1, 4)
const SHAPES = [m11, m21, m31, m41, m12, m13, m14]

const same = (a: ExUnits, b: ExUnits): boolean => a.mem === b.mem && a.steps === b.steps

ok(
  "every PLB spend in a tx costs the same",
  m31.plbAll.every((c) => same(c, m31.plb)),
  `${m31.plbAll.length} spends at ${m31.plb.mem}/${m31.plb.steps}`
)
ok(
  "PLB spend is FLAT in the input count",
  same(m11.plb, m21.plb) && same(m21.plb, m31.plb),
  `${m11.plb.mem} mem at 1, 2 and 3 inputs`
)
if (m11.plg !== undefined) {
  // The dispatcher resolves one hash baked into its own identity, so it should not vary with the
  // transaction's shape at all. Asserted rather than assumed: if it ever does vary, the budget
  // model needs a slope for it and would otherwise under-budget silently.
  ok(
    "the dispatcher is FLAT in inputs and outputs",
    SHAPES.every((m) => m.plg !== undefined && same(m.plg, m11.plg!)),
    `${m11.plg.mem} mem / ${m11.plg.steps} steps, every shape`
  )
}

const delta = (a: Shape, b: Shape): ExUnits => ({
  mem: b.transfer.mem - a.transfer.mem,
  steps: b.transfer.steps - a.transfer.steps,
})
const dIn = [delta(m11, m21), delta(m21, m31), delta(m31, m41)]
const dOut = [delta(m11, m12), delta(m12, m13), delta(m13, m14)]
console.log(`  per-input mem deltas:  ${dIn.map((d) => d.mem).join(", ")}`)
console.log(`  per-output mem deltas: ${dOut.map((d) => d.mem).join(", ")}`)

// ⚠️ The FIRST additional input is cheaper than every one after it: `assets.collect` creates the
// policy entry on the first PLB input and merges via `tokens.union` on each subsequent one, so
// input 1 does not pay a union. From the second input on the slope is exactly constant.
ok(
  "delegate cost is LINEAR per PLB input from the second input on",
  same(dIn[1]!, dIn[2]!),
  `+${dIn[1]!.mem} mem / +${dIn[1]!.steps} steps per input (the first step is cheaper: +${dIn[0]!.mem})`
)
ok(
  "delegate cost is LINEAR per PLB output",
  dOut.every((d) => same(d, dOut[0]!)),
  `+${dOut[0]!.mem} mem / +${dOut[0]!.steps} steps per output`
)

// Fit the ASYMPTOTIC slope through the NARROWEST shape. A budget model must never UNDER-estimate
// — an under-budgeted redeemer is a rejected transaction — and because the first input's delta is
// the small one the measured curve is convex: anchoring the steep slope at the last point
// under-shoots the early ones. Anchoring at (1,1) is exact there and over-estimates as the shape
// widens, which is the safe direction.
const perInput = dIn[2]!
const perOutput = dOut[0]!
const base: ExUnits = {
  mem: m11.transfer.mem - perInput.mem - perOutput.mem,
  steps: m11.transfer.steps - perInput.steps - perOutput.steps,
}
const model = (n: number, o: number): ExUnits => ({
  mem: base.mem + perInput.mem * BigInt(n) + perOutput.mem * BigInt(o),
  steps: base.steps + perInput.steps * BigInt(n) + perOutput.steps * BigInt(o),
})
ok(
  "the fitted model covers every measured shape (never under-budgets)",
  SHAPES.every((m) => {
    const p = model(m.n, m.o)
    return p.mem >= m.transfer.mem && p.steps >= m.transfer.steps
  }),
  `worst over-estimate ${SHAPES.reduce((w, m) => {
    const d = model(m.n, m.o).mem - m.transfer.mem
    return d > w ? d : w
  }, 0n)} mem`
)
ok(
  "the model is EXACT at every 1-input shape (its anchor)",
  [m11, m12, m13, m14].every((m) => same(model(m.n, m.o), m.transfer))
)

console.log("")
console.log(`  ── measured, ${version.id} (derived from ${source}, local Plutus VM) ──`)
console.log(`  plbSpendPerInput      { mem: ${m11.plb.mem}n, steps: ${m11.plb.steps}n }`)
if (m11.plg !== undefined) console.log(`  plgDispatch           { mem: ${m11.plg.mem}n, steps: ${m11.plg.steps}n }`)
console.log(`  transferBase          { mem: ${base.mem}n, steps: ${base.steps}n }`)
console.log(`  transferPerInput      { mem: ${perInput.mem}n, steps: ${perInput.steps}n }`)
console.log(`  transferPerOutput     { mem: ${perOutput.mem}n, steps: ${perOutput.steps}n }`)
console.log("")

// ── the recorded presets must still reproduce the measurement ────────────────────
// Via `measurementFor(version)`, not a named constant: the harness has to check the record
// PRODUCTION would use for the version it just measured. Pinned to a constant, it kept asserting
// one revision's numbers while deriving another's scripts.
const recorded = Budgets.measurementFor(version)
if (recorded === undefined) {
  console.error(`  FAIL no recorded measurement for ${version.id} — measurementFor returned undefined`)
  process.exit(1)
}
ok("preset plbSpendPerInput matches the measurement", same(recorded.plbSpendPerInput, m11.plb),
  `recorded ${recorded.plbSpendPerInput.mem}/${recorded.plbSpendPerInput.steps}, measured ${m11.plb.mem}/${m11.plb.steps}`)
ok("preset transferBase matches", same(recorded.transferBase, base),
  `recorded ${recorded.transferBase.mem}/${recorded.transferBase.steps}, measured ${base.mem}/${base.steps}`)
ok("preset transferPerInput matches", same(recorded.transferPerInput, perInput), `recorded ${recorded.transferPerInput.mem}`)
ok("preset transferPerOutput matches", same(recorded.transferPerOutput, perOutput), `recorded ${recorded.transferPerOutput.mem}`)
ok(
  "preset plgDispatch matches",
  (recorded.plgDispatch === undefined) === (m11.plg === undefined) &&
    (m11.plg === undefined || same(recorded.plgDispatch!, m11.plg)),
  `recorded ${recorded.plgDispatch?.mem ?? "(none)"}, measured ${m11.plg?.mem ?? "(none)"}`
)

// ── and the budgets derived from those presets must cover a real transfer ────────
// The point of the whole module: a budget that is too small is a rejected transaction.
for (const m of SHAPES) {
  const b = Budgets.transferBudgets(m.n, m.o, recorded)
  const coversPlb = b.plbSpend.mem >= m.plb.mem && b.plbSpend.steps >= m.plb.steps
  const coversDelegate = b.transferDelegate.mem >= m.transfer.mem && b.transferDelegate.steps >= m.transfer.steps
  const coversPlg =
    b.plgDispatch === undefined || m.plg === undefined || (b.plgDispatch.mem >= m.plg.mem && b.plgDispatch.steps >= m.plg.steps)
  ok(
    `budgets cover the real cost at ${m.n} in / ${m.o} out`,
    coversPlb && coversDelegate && coversPlg,
    `delegate budget ${b.transferDelegate.mem} vs actual ${m.transfer.mem} mem`
  )
}

console.log(`cip113 budgets: ${pass} pass, ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
