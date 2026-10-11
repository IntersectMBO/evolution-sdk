/**
 * The Evolution-backed issuer backend, against CML and against the earlier attachment's numbers.
 *
 * ⚠️ Why the second anchor matters. This backend replaces an isolated Rust attachment that was
 * never part of this repository, and every ex-units number in `Budgets.ts` was produced through
 * that attachment. A replacement that computed *slightly* different script hashes would silently
 * describe a different deployment, so the hash it produces for the attachment's own fixture is
 * pinned here: `756bf39c…` is the value that attachment printed.
 *
 * CML is the independent oracle for the hashing rule itself. It cannot apply parameters, so the
 * apply-params side is held by the splice identity instead — the same identity the on-chain
 * `apply_hashed_parameter` depends on, which is the strongest available statement that our
 * application agrees with upstream's.
 */
import type {
  UTxO} from "@evolution-sdk/evolution";
import {
  Address,
  Assets,
  Bytes,
  CostModel,
  TransactionHash,
  TransactionInput,
  TxOut,
  UPLC
} from "@evolution-sdk/evolution"
import type * as TransactionBuilder from "@evolution-sdk/evolution/sdk/builders/TransactionBuilder"
import { Plan } from "@evolution-sdk/plan"
import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"

import type { IssuerBackend } from "../src/Issuer.js"
import * as Issuer from "../src/Issuer.js"
import { applyParams, scriptHashV3, uplcBackend, uplcBackendLayer } from "../src/UplcBackend.js"
import { V0_5_0_ALPHA_2 } from "../src/Versions.js"
import { CML } from "./tx-shape.js"

/** The spy evaluator's context is shaped only by what we read off it. */
type Oracle = any

const run = <A, E>(e: Effect.Effect<A, E>): A => Effect.runSync(e as Effect.Effect<A, never>)
const reasonOf = <A>(e: Effect.Effect<A, Issuer.IssuerError | { readonly message: string }>): string => {
  const r = Effect.runSync(Effect.either(e))
  if (Either.isRight(r)) throw new Error("expected a failure")
  return "reason" in r.left ? r.left.reason : r.left.message
}

/** A real compiled Plutus V3 script — the fixture the earlier attachment measured against. */
const SCRIPT =
  "586d01010029800aba2aba1aab9eaab9dab9a48888966002646465300130053754003300700398038012444b30013370e9002001c4c928980518049baa0048acc004cdc3a40000071324a26eb8c028c024dd5002459007200e18031803800980300098019baa0068a4d13656400401"
/** What the earlier attachment's `cip113_plutus_script_hash_v3` answered for it. */
const ATTACHMENT_HASH = "756bf39c1524a2222fe35acab2573dbc6d5a63873bf5d01f1cd084ce"

/**
 * CML's hash of a script.
 *
 * ⚠️ It takes the DOUBLE-encoded form, because it strips exactly one CBOR layer and hashes the
 * rest — so a single-encoded hex (what `applyParams` returns, and what a witness set carries)
 * must be re-wrapped before it goes in. Getting this backwards is how the harness's
 * "missing required script" was reached from the other direction.
 */
const cmlHash = (scriptHex: string): string =>
  CML.PlutusV3Script.from_cbor_hex(UPLC.applyDoubleCborEncoding(scriptHex)).hash().to_hex()
const h28 = (b: string): string => b.repeat(28)
const txHash = (b: string): string => b.repeat(32)

describe("the Plutus V3 script hash", () => {
  it("reproduces the earlier attachment's hash for its own fixture", () => {
    expect(run(scriptHashV3(SCRIPT))).toBe(ATTACHMENT_HASH)
  })

  it("agrees with CML, which hashes the double-encoded form [BYTES]", () => {
    expect(run(scriptHashV3(SCRIPT))).toBe(cmlHash(SCRIPT))
  })

  it("normalises the encoding level, so single and double input hash alike", () => {
    // ⚠️ The trap this closes: the SAME bytes single-encoded hash to something else entirely
    // (CML will happily tell you so), and an address derived from that hash resolves and holds
    // nothing. A caller must not have to know which level its blueprint used.
    const single = UPLC.applySingleCborEncoding(SCRIPT)
    const double = UPLC.applyDoubleCborEncoding(SCRIPT)
    expect(UPLC.getCborEncodingLevel(single)).toBe("single")
    expect(UPLC.getCborEncodingLevel(double)).toBe("double")
    expect(run(scriptHashV3(single))).toBe(ATTACHMENT_HASH)
    expect(run(scriptHashV3(double))).toBe(ATTACHMENT_HASH)
    // ⚠️ And the oracle agrees that the LEVELS are not interchangeable for hashing: handed the
    // single-encoded hex directly, CML strips its one layer and hashes the raw body instead.
    expect(CML.PlutusV3Script.from_cbor_hex(single).hash().to_hex()).not.toBe(ATTACHMENT_HASH)
  })

  it("refuses something that is not a script rather than hashing it anyway", () => {
    expect(reasonOf(scriptHashV3("zzzz"))).toContain("scriptHashV3")
    // ⚠️ The empty one is the reachable case, and it used to SUCCEED: `''` wraps to the CBOR
    // bytestring `40` and came back as a real-looking policy id. A `Deployment` derived through
    // `alwaysFailHashHex` records `applied.alwaysFail = ''`, so hashing it is one call away.
    expect(reasonOf(scriptHashV3(""))).toContain("empty script")
  })
})

describe("applying deploy parameters", () => {
  const credParam = run(Issuer.credentialParam({ kind: "script", hashHex: h28("a1") }))
  const otherParam = run(Issuer.byteArrayParam(h28("b2")))

  it("⚠️ returns the SINGLE-encoded form, which is what a witness set carries", () => {
    // `UPLC.applyParamsToScript` answers double-encoded. Handing that to a builder puts one CBOR
    // layer too many in the witness set; the node hashes the wrapper, finds no match for any
    // script the transaction requires, and rejects it as "missing required script" — naming
    // neither the script nor the layer. Found on the first run of the budgets harness.
    const applied = run(applyParams(SCRIPT, [credParam]))
    expect(UPLC.getCborEncodingLevel(applied)).toBe("single")
    // The hash is the same either way, which is exactly why the wrong level is invisible until
    // a VM resolves the script.
    expect(run(scriptHashV3(applied))).toBe(run(scriptHashV3(UPLC.applyDoubleCborEncoding(applied))))
    expect(run(scriptHashV3(applied))).toBe(cmlHash(applied))
  })

  it("is deterministic, and the parameter ORDER changes the hash", () => {
    // Order is the mistake no arity check catches: `issuanceMintParams` exists because upstream
    // has reordered these, and two orders give two different, equally real policy ids.
    const a = run(applyParams(SCRIPT, [credParam, otherParam]))
    const b = run(applyParams(SCRIPT, [credParam, otherParam]))
    const swapped = run(applyParams(SCRIPT, [otherParam, credParam]))
    expect(a).toBe(b)
    expect(swapped).not.toBe(a)
    expect(run(scriptHashV3(swapped))).not.toBe(run(scriptHashV3(a)))
  })

  it("changes the hash with each parameter applied", () => {
    const zero = run(scriptHashV3(run(applyParams(SCRIPT, []))))
    const one = run(scriptHashV3(run(applyParams(SCRIPT, [credParam]))))
    const two = run(scriptHashV3(run(applyParams(SCRIPT, [credParam, otherParam]))))
    expect(new Set([zero, one, two]).size).toBe(3)
    expect(zero).toBe(ATTACHMENT_HASH)
  })

  it("refuses a parameter that is not Plutus data", () => {
    expect(reasonOf(applyParams(SCRIPT, ["not-cbor"]))).toContain("applyParams")
  })
})

describe("evaluating ex-units", () => {
  /** A stand-in for Evolution's `Evaluator` seam that records what it was handed. */
  const spyEvaluator = (
    rows: ReadonlyArray<{
      readonly redeemer_tag: "spend" | "mint" | "cert" | "reward"
      readonly redeemer_index: number
      readonly ex_units: { readonly mem: bigint; readonly steps: bigint }
    }> = []
  ) => {
    const calls: Array<{ readonly utxos: ReadonlyArray<UTxO.UTxO>; readonly context: Oracle }> = []
    const evaluator = {
      evaluate: (_tx: Oracle, utxos: ReadonlyArray<UTxO.UTxO> | undefined, context: Oracle) => {
        calls.push({ utxos: utxos ?? [], context })
        return Effect.succeed(rows)
      },
    } as unknown as TransactionBuilder.Evaluator
    return { evaluator, calls }
  }

  /** A minimal real transaction and one real UTxO, so the decode path is exercised. */
  const TX_HEX = (() => {
    const body = run(
      Effect.succeed(
        Plan.buildUnsigned({
          inputs: [{ txHash: txHash("c0"), index: 0, assets: Assets.fromLovelace(10_000_000n) }],
          outputs: [{ addressHex: `61${h28("77")}`, assets: Assets.fromLovelace(2_000_000n) }],
          changeAddressHex: `61${h28("78")}`,
          params: {
            minFeeA: 44n,
            minFeeB: 155_381n,
            coinsPerUtxoByte: 4310n,
            keyDeposit: 2_000_000n,
            poolDeposit: 500_000_000n,
            drepDeposit: 500_000_000n,
          },
          signerCount: 1,
        })
      )
    )
    return `84${body.bodyHex}a0f5f6`
  })()
  const INPUT_HEX = TransactionInput.toCBORHex(
    new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(txHash("c0")), index: 0n })
  )
  const OUTPUT_HEX = TxOut.toCBORHex(
    new TxOut.TransactionOutput({
      address: Address.fromHex(`61${h28("77")}`),
      assets: Assets.fromLovelace(10_000_000n),
    })
  )
  /** A shaped-but-tiny cost model: this suite checks the plumbing, not the prices. */
  const COSTS_HEX = CostModel.toCBORHex(
    new CostModel.CostModels({
      PlutusV1: new CostModel.CostModel({ costs: [1n, 2n, 3n] }),
      PlutusV2: new CostModel.CostModel({ costs: [1n, 2n, 3n] }),
      PlutusV3: new CostModel.CostModel({ costs: [1n, 2n, 3n] }),
    })
  )

  const call = (over: Partial<Parameters<IssuerBackend["evalTx"]>[0]> = {}) => ({
    txHex: TX_HEX,
    utxos: [[INPUT_HEX, OUTPUT_HEX]] as ReadonlyArray<readonly [string, string]>,
    costModelsHex: COSTS_HEX,
    maxMem: 111n,
    maxSteps: 222n,
    slot: [1_660_003_200_000n, 0n, 1000] as const,
    ...over,
  })

  it("says the evaluator is missing rather than reporting a zero cost", () => {
    // ⚠️ A zero here would read as "this script is free" and produce a budget the node rejects.
    const backend = uplcBackend()
    expect(reasonOf(backend.evalTx(call()))).toContain("without an evaluator")
  })

  it("refuses an absent cost model instead of measuring every script as free", () => {
    // ⚠️ An empty model set prices every builtin at zero, so the VM answers with costs of 0 and
    // the budget derived from them is rejected on submission. There is no safe default.
    const { evaluator } = spyEvaluator()
    expect(reasonOf(uplcBackend(evaluator).evalTx(call({ costModelsHex: undefined })))).toContain("costModelsHex is required")
  })

  it("passes the limits through as steps and mem, in the context's own fields", () => {
    // ⚠️ Two bigints of the same type: a swap is invisible to every type and fails as a budget
    // error on a transaction that is fine.
    const { calls, evaluator } = spyEvaluator()
    run(uplcBackend(evaluator).evalTx(call()))
    expect(calls[0]!.context.maxTxExSteps).toBe(222n)
    expect(calls[0]!.context.maxTxExMem).toBe(111n)
    expect(calls[0]!.context.slotConfig).toEqual({ zeroTime: 1_660_003_200_000n, zeroSlot: 0n, slotLength: 1000 })
  })

  it("rebuilds each (input, output) hex pair into the UTxO the VM resolves against", () => {
    // The pair shape is the VM's; Evolution's seam wants typed UTxOs. A pair reassembled wrong —
    // an outpoint from one row with another row's value — resolves to a transaction the VM
    // accepts and prices differently.
    const { calls, evaluator } = spyEvaluator()
    run(uplcBackend(evaluator).evalTx(call()))
    const utxo = calls[0]!.utxos[0]!
    expect(Bytes.toHex(utxo.transactionId.hash)).toBe(txHash("c0"))
    // ⚠️ A bigint: `index` is `Uint16Schema`, which is bigint-backed, so a number here fails
    // schema validation rather than being coerced.
    expect(utxo.index).toBe(0n)
    expect(Address.toHex(utxo.address)).toBe(`61${h28("77")}`)
    expect(utxo.assets.lovelace).toBe(10_000_000n)
  })

  it("maps the VM's STRING tag to the CDDL integer every caller filters on", () => {
    // ⚠️ This caught a real defect in this backend: `Number(row.redeemer_tag)` over `"reward"` is
    // `NaN`, and every caller picks rows with `tag === 0` or `tag === 3`, so a measurement would
    // have found no rows at all instead of failing.
    const { evaluator } = spyEvaluator([
      { redeemer_tag: "spend", redeemer_index: 0, ex_units: { mem: 10n, steps: 20n } },
      { redeemer_tag: "reward", redeemer_index: 2, ex_units: { mem: 1_234n, steps: 5_678n } },
    ])
    expect(run(uplcBackend(evaluator).evalTx(call()))).toEqual([
      { tag: 0, index: 0, mem: 10n, steps: 20n },
      { tag: 3, index: 2, mem: 1_234n, steps: 5_678n },
    ])
  })

  it("reports an evaluator failure as its own reason, not as a success with no rows", () => {
    const failing = {
      evaluate: () => Effect.fail({ message: "Withdraw(0): validation failed" }),
    } as unknown as TransactionBuilder.Evaluator
    expect(reasonOf(uplcBackend(failing).evalTx(call()))).toContain("Withdraw(0)")
  })
})

describe("a deployment derived through the real UPLC path", () => {
  // Every validator is the same real script with different parameters, which is enough: the
  // derivation's job is the parameters, and distinct parameters must give distinct hashes.
  const blueprint: Issuer.Blueprint = {
    alwaysFail: SCRIPT,
    protocolParamsMint: SCRIPT,
    issuanceCborHexMint: SCRIPT,
    registrySpend: SCRIPT,
    registryMint: SCRIPT,
    transfer: SCRIPT,
    programmableLogicBase: SCRIPT,
    unfracking: SCRIPT,
    issuanceMint: SCRIPT,
    thirdParty: SCRIPT,
    coordinationSpend: SCRIPT,
    upgradeMultisig: SCRIPT,
    programmableLogicGlobal: SCRIPT,
    issuanceLogic: SCRIPT,
  }
  const config: Issuer.DeployConfig = {
    blueprint,
    nonceHex: "1234",
    coordinationNonceHex: "5678",
    protocolParamsSeed: { txHash: txHash("a1") as never, index: 0 },
    issuanceCborHexSeed: { txHash: txHash("a2") as never, index: 1 },
    registrySeed: { txHash: txHash("a3") as never, index: 2 },
    upgradeMultisigSeed: { txHash: txHash("a4") as never, index: 3 },
    upgrade: { signers: [h28("b1")], threshold: 1 },
    maxInlineDatumBytes: 512n,
  }
  const deployment = run(Effect.provide(Issuer.deriveDeployment(config), uplcBackendLayer()))

  it("derives 28-byte hashes that CML agrees with for every applied script", () => {
    const pairs: ReadonlyArray<readonly [string, string | undefined]> = [
      [deployment.protocolParamsCs, deployment.applied.protocolParamsMint],
      [deployment.issuanceCborHexCs, deployment.applied.issuanceCborHexMint],
      [deployment.registryNodeCs, deployment.applied.registryMint],
      [deployment.transferCred, deployment.applied.transfer],
      [deployment.plbCred, deployment.applied.programmableLogicBase],
      [deployment.unfrackingCred, deployment.applied.unfracking],
      [deployment.thirdPartyCred!, deployment.applied.thirdParty],
      [deployment.plgCred!, deployment.applied.programmableLogicGlobal],
      [deployment.issuanceLogicCred!, deployment.applied.issuanceLogic],
      [deployment.upgradeCred!, deployment.applied.upgradeMultisig],
    ]
    for (const [hash, applied] of pairs) {
      expect(hash).toMatch(/^[0-9a-f]{56}$/)
      expect(hash).toBe(cmlHash(applied!))
    }
  })

  it("gives every validator a distinct hash, from one script and different parameters", () => {
    // Shared bytes with shared parameters would be the same script, which is correct behaviour
    // and also what a parameter bug looks like. These parameters all differ, so these must too.
    const hashes = [
      deployment.protocolParamsCs,
      deployment.issuanceCborHexCs,
      deployment.registryNodeCs,
      deployment.transferCred,
      deployment.plbCred,
      deployment.plgCred!,
      deployment.issuanceLogicCred!,
      deployment.upgradeCred!,
    ]
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it("⚠️ splices the issuance template to the SAME policy id the direct application gives", () => {
    // The identity the on-chain `apply_hashed_parameter` rests on: a registration proves a new
    // policy id by hashing `prefix ‖ minting_logic ‖ postfix` out of the IssuanceCborHex datum,
    // never by applying parameters itself. If the two disagree, every registration of that
    // deployment is unprovable. Through the REAL UPLC encoder, so this is a statement about flat
    // encoding keeping the parameter's bytes findable and byte-aligned, not about a stub.
    const mintingLogic = h28("77")
    const direct = run(
      Effect.provide(Issuer.deriveTokenPolicy(blueprint.issuanceMint, deployment, mintingLogic), uplcBackendLayer())
    )
    const spliced = `${deployment.issuanceTemplate.prefixHex}${mintingLogic}${deployment.issuanceTemplate.postfixHex}`
    expect(direct.appliedScript).toBe(spliced)
    expect(direct.policyId).toBe(run(scriptHashV3(spliced)))
    expect(direct.policyId).toBe(cmlHash(spliced))
  })

  it("holds the same splice identity on the alpha.2 parameter order", () => {
    // alpha.2 puts the minting-logic credential THIRD of four rather than first of two, so the
    // placeholder sits deep in the applied bytes. Same identity, different offset.
    const a2 = run(Effect.provide(Issuer.deriveDeployment(config, V0_5_0_ALPHA_2), uplcBackendLayer()))
    const mintingLogic = h28("66")
    const direct = run(
      Effect.provide(Issuer.deriveTokenPolicy(blueprint.issuanceMint, a2, mintingLogic, V0_5_0_ALPHA_2), uplcBackendLayer())
    )
    expect(direct.appliedScript).toBe(`${a2.issuanceTemplate.prefixHex}${mintingLogic}${a2.issuanceTemplate.postfixHex}`)
    expect(direct.policyId).toBe(cmlHash(direct.appliedScript))
    expect(a2.issuanceTemplate.prefixHex.length).toBeGreaterThan(deployment.issuanceTemplate.prefixHex.length)
  })
})
