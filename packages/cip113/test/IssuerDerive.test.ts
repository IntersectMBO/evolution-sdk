/**
 * The deploy-time derivation: which parameters reach which validator, in which order.
 *
 * ⚠️ Why this is the shape of the test. `deriveDeployment` decides the script hash of every
 * validator in a deployment, and a wrong parameter does not fail — it yields a real, wrong hash,
 * which presents as an empty registry or a params NFT that matches nothing on chain. The UPLC
 * application itself belongs to `aiken-uplc`; what belongs HERE is the dependency graph and the
 * parameter order, so the backend is a RECORDING one and the assertions are over the call log.
 *
 * Its `scriptHashV3` is a sha256 truncated to 28 bytes over `03 ‖ script`, mirroring the real
 * rule's shape (`blake2b224(0x03 ‖ script)`) without being it: the derivation only requires that
 * a hash be a function of the applied script, and keeping the `03` prefix makes the issuance
 * template's splice identity — the one claim here with an on-chain consequence — checkable.
 *
 * The parameter BYTES are held separately, against the Plutus CDDL and CML, exactly as
 * `Cip113Codec.test.ts` holds the redeemers.
 */
import { createHash } from "node:crypto"
import { createRequire } from "node:module"

import { Effect, Either, Layer } from "effect"
import { describe, expect, it } from "vitest"

import * as Cip113 from "../src/Cip113.js"
import * as Issuer from "../src/Issuer.js"
import { LATEST, V0_3_0, V0_4_0, V0_5_0_ALPHA_2 } from "../src/Versions.js"

const require = createRequire(import.meta.url)
type Oracle = any
const CML: Oracle = require("@dcspark/cardano-multiplatform-lib-nodejs")

const h28 = (b: string): string => b.repeat(28)
const txHash = (b: string): string => b.repeat(32)

/** Stand-in for `blake2b224(0x03 ‖ script)` — see the module doc. */
const digest28 = (applied: string): string => createHash("sha256").update(`03${applied}`).digest("hex").slice(0, 56)

interface Call {
  readonly script: string
  readonly params: ReadonlyArray<string>
}

const recording = (log: Array<Call>): Layer.Layer<Issuer.IssuerTag> =>
  Layer.succeed(Issuer.IssuerTag, {
    // Concatenation, so a parameter's bytes appear VERBATIM in the applied script. The real
    // `applyParams` wraps each in a UPLC term; what the splice below depends on is that the
    // parameter bytes are findable in the result, which both share.
    applyParams: (scriptHex, params) => {
      log.push({ script: scriptHex, params: [...params] })
      return Effect.succeed(`${scriptHex}${params.join("")}`)
    },
    scriptHashV3: (applied) => Effect.succeed(digest28(applied)),
    evalTx: () => Effect.fail(new Issuer.IssuerError({ reason: "evalTx is not part of derivation" })),
  })

const BLUEPRINT: Issuer.Blueprint = {
  alwaysFail: "0100",
  protocolParamsMint: "0200",
  issuanceCborHexMint: "0300",
  registrySpend: "0400",
  registryMint: "0500",
  transfer: "0600",
  programmableLogicBase: "0700",
  unfracking: "0800",
  issuanceMint: "0900",
  thirdParty: "0a00",
  coordinationSpend: "0b00",
  upgradeMultisig: "0c00",
  programmableLogicGlobal: "0d00",
  issuanceLogic: "0e00",
}

const CONFIG: Issuer.DeployConfig = {
  blueprint: BLUEPRINT,
  nonceHex: "1234",
  coordinationNonceHex: "5678",
  protocolParamsSeed: { txHash: txHash("a1") as never, index: 0 },
  issuanceCborHexSeed: { txHash: txHash("a2") as never, index: 1 },
  registrySeed: { txHash: txHash("a3") as never, index: 2 },
  upgradeMultisigSeed: { txHash: txHash("a4") as never, index: 3 },
  upgrade: { signers: [h28("b1"), h28("b2")], threshold: 2 },
  maxInlineDatumBytes: 512n,
}

const derive = (
  cfg: Issuer.DeployConfig = CONFIG,
  version = LATEST
): { readonly deployment: Issuer.Deployment; readonly log: ReadonlyArray<Call> } => {
  const log: Array<Call> = []
  const deployment = Effect.runSync(
    Effect.provide(Issuer.deriveDeployment(cfg, version), recording(log)) as Effect.Effect<Issuer.Deployment, never>
  )
  return { deployment, log }
}

const deriveFailure = (cfg: Issuer.DeployConfig, version = LATEST): string => {
  const log: Array<Call> = []
  const r = Effect.runSync(Effect.either(Effect.provide(Issuer.deriveDeployment(cfg, version), recording(log))))
  if (Either.isRight(r)) throw new Error("expected the derivation to fail")
  return "reason" in r.left ? r.left.reason : r.left.message
}

/** A parameter rendered from its BYTES, so the call log reads as what the validator receives. */
const renderParam = (hex: string): string => {
  const pd = CML.PlutusData.from_cbor_hex(hex)
  switch (pd.kind()) {
    case 4:
      return `bytes(${Buffer.from(pd.as_bytes()).toString("hex")})`
    case 3:
      return `int(${pd.as_integer().to_str()})`
    case 2: {
      const l = pd.as_list()
      return `list(${Array.from({ length: l.len() }, (_, i) => renderParam(l.get(i).to_cbor_hex())).join(",")})`
    }
    case 0: {
      const c = pd.as_constr_plutus_data()
      const f = c.fields()
      const fields = Array.from({ length: f.len() }, (_, i) => renderParam(f.get(i).to_cbor_hex()))
      if (f.len() === 1 && c.alternative() === 0n) return `key(${fields[0]})`
      if (f.len() === 1 && c.alternative() === 1n) return `script(${fields[0]})`
      if (f.len() === 2 && c.alternative() === 0n) return `outputRef(${fields.join(",")})`
      return `constr${c.alternative()}(${fields.join(",")})`
    }
    default:
      return `kind${pd.kind()}`
  }
}

const rendered = (log: ReadonlyArray<Call>): ReadonlyArray<string> =>
  log.map((c) => `${c.script}: ${c.params.map(renderParam).join(" ")}`)

describe("the deploy-parameter encoders", () => {
  const run = <A, E>(e: Effect.Effect<A, E>): A => Effect.runSync(e as Effect.Effect<A, never>)

  it("encodes a Credential as the key/script constructor over its hash [RULE]", () => {
    expect(run(Issuer.credentialParam({ kind: "key", hashHex: h28("01") }))).toBe(`d8799f581c${h28("01")}ff`)
    expect(run(Issuer.credentialParam({ kind: "script", hashHex: h28("01") }))).toBe(`d87a9f581c${h28("01")}ff`)
  })

  it("encodes a PolicyId / ByteArray as plutus bytes, and the empty one as `40` [RULE]", () => {
    expect(run(Issuer.byteArrayParam(h28("02")))).toBe(`581c${h28("02")}`)
    expect(run(Issuer.byteArrayParam(""))).toBe("40")
  })

  it("encodes an OutputReference as Constr 0 [bytes, int] — the Plutus V3 shape [RULE]", () => {
    // ⚠️ V3, not V2: the V2 shape wrapped the transaction id in a further `Constr 0 [bytes]`.
    // Both decode; only one hashes to the policy id the chain has.
    expect(run(Issuer.outputRefParam(txHash("03"), 7))).toBe(`d8799f5820${txHash("03")}07ff`)
    expect(run(Issuer.outputRefParam(txHash("03"), 0))).toBe(`d8799f5820${txHash("03")}00ff`)
  })

  it("encodes an Int param, negatives included [RULE]", () => {
    expect(run(Issuer.intParam(0n))).toBe("00")
    expect(run(Issuer.intParam(512n))).toBe("190200")
    expect(run(Issuer.intParam(-1n))).toBe("20")
  })

  it("encodes a List<ByteArray> indefinite when non-empty and definite when empty [RULE]", () => {
    expect(run(Issuer.byteArrayListParam([h28("04"), h28("05")]))).toBe(`9f581c${h28("04")}581c${h28("05")}ff`)
    expect(run(Issuer.byteArrayListParam([]))).toBe("80")
  })

  it("reads back, through CML, as the parameters we meant [READS]", () => {
    for (const hex of [
      run(Issuer.credentialParam({ kind: "script", hashHex: h28("06") })),
      run(Issuer.byteArrayParam(h28("07"))),
      run(Issuer.outputRefParam(txHash("08"), 3)),
      run(Issuer.intParam(99n)),
      run(Issuer.byteArrayListParam([h28("09")])),
    ]) {
      expect(CML.PlutusData.from_cbor_hex(hex).to_cbor_hex()).toBe(hex)
    }
    expect(renderParam(run(Issuer.outputRefParam(txHash("08"), 3)))).toBe(`outputRef(bytes(${txHash("08")}),int(3))`)
    expect(renderParam(run(Issuer.byteArrayListParam([h28("09")])))).toBe(`list(bytes(${h28("09")}))`)
  })

  it("refuses odd-length hex rather than encoding half a byte", () => {
    const r = Effect.runSync(Effect.either(Issuer.byteArrayParam("abc")))
    expect(Either.isLeft(r)).toBe(true)
  })
})

describe("deriving a LATEST deployment", () => {
  const { deployment, log } = derive()

  it("applies every validator exactly once, in dependency order", () => {
    // ⚠️ The ORDER is the assertion, not just the set: `0.5.0-alpha.4` inverted it. The
    // delegates now take PLB's credential, so PLB must be derived BEFORE them, and the
    // dispatcher takes all three delegate hashes, so it comes last of the group.
    expect(log.map((c) => c.script)).toEqual([
      BLUEPRINT.alwaysFail,
      BLUEPRINT.protocolParamsMint,
      BLUEPRINT.issuanceCborHexMint,
      BLUEPRINT.registryMint, // merged registry: one validator for both halves
      BLUEPRINT.programmableLogicBase,
      BLUEPRINT.transfer,
      BLUEPRINT.unfracking,
      BLUEPRINT.thirdParty,
      BLUEPRINT.programmableLogicGlobal,
      BLUEPRINT.issuanceLogic,
      BLUEPRINT.upgradeMultisig,
      BLUEPRINT.issuanceMint, // the split template, applied last with the placeholder
    ])
  })

  it("hands each validator the parameters its on-chain shape declares", () => {
    const plb = deployment.plbCred
    expect(rendered(log)).toEqual([
      `0100: bytes(1234)`,
      // merged-self: the params validator locks the NFT at its own hash, so no lock target.
      `0200: outputRef(bytes(${txHash("a1")}),int(0))`,
      `0300: outputRef(bytes(${txHash("a2")}),int(1)) bytes(${deployment.alwaysFailHash})`,
      `0500: outputRef(bytes(${txHash("a3")}),int(2)) bytes(${deployment.issuanceCborHexCs})`,
      `0700: bytes(${deployment.protocolParamsCs})`,
      `0600: script(bytes(${plb})) bytes(${deployment.registryNodeCs}) int(512)`,
      `0800: script(bytes(${plb})) bytes(${deployment.registryNodeCs}) int(512)`,
      `0a00: script(bytes(${plb})) bytes(${deployment.registryNodeCs}) int(512)`,
      `0d00: bytes(${deployment.transferCred}) bytes(${deployment.thirdPartyCred}) bytes(${deployment.unfrackingCred})`,
      `0e00: script(bytes(${plb})) bytes(${deployment.registryNodeCs}) bytes(${deployment.protocolParamsCs}) int(512)`,
      `0c00: outputRef(bytes(${txHash("a4")}),int(3))`,
      `0900: script(bytes(${h28("ee")})) bytes(${deployment.protocolParamsCs})`,
    ])
  })

  it("applies ONE max_inline_datum_bytes to all four output-creating validators", () => {
    // Nothing on chain compares them. A UTxO born under a laxer bound than `transfer` later
    // enforces is frozen AND unseizable, so "one N for all four" is the invariant, and the
    // single config field is what holds it.
    const bounds = log
      .filter((c) => [BLUEPRINT.transfer, BLUEPRINT.unfracking, BLUEPRINT.thirdParty, BLUEPRINT.issuanceLogic].includes(c.script))
      .map((c) => c.params.map(renderParam).filter((p) => p.startsWith("int(")))
    expect(bounds).toEqual([["int(512)"], ["int(512)"], ["int(512)"], ["int(512)"]])
  })

  it("collapses the merged registry: the policy id IS the spend credential", () => {
    expect(deployment.registryNodeCs).toBe(deployment.registrySpendCred)
    expect(log.filter((c) => c.script === BLUEPRINT.registrySpend)).toEqual([])
  })

  it("builds a params datum that decodes back to the derived credentials, at the right indices", () => {
    // The datum is assembled POSITIONALLY from the version layout. Decoding it with the
    // independently-tested reader is what says the positions agree — a datum built one way and
    // read another is the silent misread this protocol is full of.
    expect(Effect.runSync(Cip113.decodeGlobalParams(deployment.protocolParamsDatumHex))).toEqual({
      plgCred: { kind: "script", hashHex: deployment.plgCred },
      issuanceLogicCred: { kind: "script", hashHex: deployment.issuanceLogicCred },
      transferCred: { kind: "script", hashHex: deployment.transferCred },
      thirdPartyCred: { kind: "script", hashHex: deployment.thirdPartyCred },
      upgradeCred: { kind: "script", hashHex: deployment.upgradeCred },
      pendingUpgradeCred: null,
    })
  })

  it("is born at rest: the nomination field is None, never Some", () => {
    expect(deployment.protocolParamsDatumHex).toContain("d87a80")
    expect(deployment.protocolParamsInfo.pendingUpgradeCred).toBeNull()
  })

  it("mirrors the datum in protocolParamsInfo, field for field", () => {
    expect(deployment.protocolParamsInfo).toEqual({
      plgCred: { kind: "script", hashHex: deployment.plgCred },
      issuanceLogicCred: { kind: "script", hashHex: deployment.issuanceLogicCred },
      transferCred: { kind: "script", hashHex: deployment.transferCred },
      thirdPartyCred: { kind: "script", hashHex: deployment.thirdPartyCred },
      upgradeCred: { kind: "script", hashHex: deployment.upgradeCred },
      pendingUpgradeCred: null,
    })
    // ⚠️ The fields this version does NOT carry are absent, not empty: the merged registry and
    // the compile-time PLB credential have to be read off the deployment record instead, and a
    // consumer that found `''` here would send a transfer to a script that does not exist.
    expect(deployment.protocolParamsInfo.registryNodeCsHex).toBeUndefined()
    expect(deployment.protocolParamsInfo.progLogicCred).toBeUndefined()
    expect(deployment.protocolParamsInfo.maxInlineDatumBytes).toBeUndefined()
  })

  it("splits the issuance template around the minting-logic hole, exactly once", () => {
    const { postfixHex, prefixHex } = deployment.issuanceTemplate
    expect(prefixHex.endsWith("d87a9f581c")).toBe(true)
    expect(postfixHex.startsWith("ff")).toBe(true)
    expect(`${prefixHex}${h28("ee")}${postfixHex}`).toBe(`${BLUEPRINT.issuanceMint}${log.at(-1)!.params.join("")}`)
    expect(prefixHex).not.toContain(h28("ee"))
    expect(postfixHex).not.toContain(h28("ee"))
  })
})

describe("a token policy derived two ways", () => {
  it("agrees with the hash of the spliced template, which is what the chain computes", () => {
    // The on-chain `apply_hashed_parameter`: a registration proves the new policy id by hashing
    // `prefix ‖ minting_logic ‖ postfix` out of the IssuanceCborHex datum. If the splice and the
    // direct application ever disagree, every registration of that deployment is unprovable.
    const { deployment } = derive()
    const mintingLogic = h28("77")
    const log: Array<Call> = []
    const direct = Effect.runSync(
      Effect.provide(
        Issuer.deriveTokenPolicy(BLUEPRINT.issuanceMint, deployment, mintingLogic),
        recording(log)
      ) as Effect.Effect<{ policyId: string; appliedScript: string }, never>
    )
    const spliced = `${deployment.issuanceTemplate.prefixHex}${mintingLogic}${deployment.issuanceTemplate.postfixHex}`
    expect(direct.appliedScript).toBe(spliced)
    expect(direct.policyId).toBe(digest28(spliced))
  })

  it("orders issuance_mint's parameters by NAME, so a reorder cannot pass silently", () => {
    // The arity has been 2, 3 and 4, one parameter changed TYPE without the arity moving, and
    // alpha.4 reordered what was left. Each version's parameter list is asserted whole.
    const forVersion = (version: Parameters<typeof derive>[1]): ReadonlyArray<string> => {
      const { deployment, log } = derive(CONFIG, version)
      const call = log.filter((c) => c.script === BLUEPRINT.issuanceMint).at(-1)!
      return [deployment.plbCred, ...call.params.map(renderParam)]
    }
    const [plbLatest, ...latest] = forVersion(LATEST)
    expect(latest).toEqual([`script(bytes(${h28("ee")}))`, expect.stringContaining("bytes(")])
    const [plbA2, ...a2] = forVersion(V0_5_0_ALPHA_2)
    expect(a2).toEqual([
      `script(bytes(${plbA2}))`,
      expect.stringContaining("bytes("),
      `script(bytes(${h28("ee")}))`,
      expect.stringContaining("bytes("),
    ])
    expect(plbLatest).not.toBe(plbA2)
  })
})

describe("the pre-alpha.4 generations derive a different graph", () => {
  it("alpha.2 derives the delegates from the params policy, and PLB last", () => {
    const { deployment, log } = derive(CONFIG, V0_5_0_ALPHA_2)
    // `'params-policy'` delegates read everything live from the params datum, so they take only
    // that policy — and PLB is anchored to the same policy, so order between them is free.
    expect(rendered(log)).toEqual([
      `0100: bytes(1234)`,
      `0b00: bytes(5678)`,
      `0200: outputRef(bytes(${txHash("a1")}),int(0)) bytes(${deployment.coordinationCred})`,
      `0300: outputRef(bytes(${txHash("a2")}),int(1)) bytes(${deployment.alwaysFailHash})`,
      `0400: bytes(${deployment.protocolParamsCs})`,
      `0500: outputRef(bytes(${txHash("a3")}),int(2)) bytes(${deployment.issuanceCborHexCs}) script(bytes(${deployment.registrySpendCred}))`,
      `0600: bytes(${deployment.protocolParamsCs})`,
      `0800: bytes(${deployment.protocolParamsCs})`,
      `0a00: bytes(${deployment.protocolParamsCs})`,
      `0700: bytes(${deployment.protocolParamsCs})`,
      `0c00: list(bytes(${h28("b1")}),bytes(${h28("b2")})) int(2)`,
      `0900: script(bytes(${deployment.plbCred})) bytes(${deployment.registryNodeCs}) script(bytes(${h28("ee")})) bytes(${deployment.protocolParamsCs})`,
    ])
    // Split registry: the spend credential and the node policy are different hashes.
    expect(deployment.registrySpendCred).not.toBe(deployment.registryNodeCs)
    expect(deployment.plgCred).toBeUndefined()
    expect(deployment.issuanceLogicCred).toBeUndefined()
  })

  it("locks the params NFT at coordination_spend from the upgrade rail on, not always_fail", () => {
    const { deployment } = derive(CONFIG, V0_5_0_ALPHA_2)
    expect(deployment.coordinationCred).toBeDefined()
    expect(deployment.coordinationCred).not.toBe(deployment.alwaysFailHash)
  })

  it("v0.4.0 parameterises PLB with the COORDINATOR, which is why it could never be replaced", () => {
    const { deployment, log } = derive(CONFIG, V0_4_0)
    const plbCall = log.find((c) => c.script === BLUEPRINT.programmableLogicBase)!
    expect(plbCall.params.map(renderParam)).toEqual([`script(bytes(${deployment.transferCred}))`])
    expect(log.findIndex((c) => c.script === BLUEPRINT.transfer)).toBeLessThan(
      log.findIndex((c) => c.script === BLUEPRINT.programmableLogicBase)
    )
    expect(deployment.thirdPartyCred).toBeUndefined()
    expect(deployment.upgradeCred).toBeUndefined()
  })

  it("v0.3.0 derives no upgrade authority and no coordination lock at all", () => {
    const { deployment } = derive(CONFIG, V0_3_0)
    expect(deployment.coordinationCred).toBeUndefined()
    expect(deployment.upgradeCred).toBeUndefined()
    expect(Effect.runSync(Cip113.decodeGlobalParams(deployment.protocolParamsDatumHex, V0_3_0))).toEqual({
      registryNodeCsHex: deployment.registryNodeCs,
      progLogicCred: { kind: "script", hashHex: deployment.plbCred },
    })
  })

  it("⚠️ derives the SAME PLB credential for v0.4.0 and v0.3.0, from the same parameters", () => {
    // Measured, and it follows from the graph: PLB's parameter is the coordinator credential,
    // which takes only the params policy, which takes only the seed. Nothing in that chain moved
    // between those two generations, so a smart-wallet address does NOT distinguish them — only
    // the registry policy does. ⚠️ Equality here is equality of PARAMETERS: the fixture reuses one
    // stub blueprint across versions where real blueprints differ, so this says the derivation
    // passed the same inputs, not that upstream shipped the same script.
    const plbOf = (v: Parameters<typeof derive>[1]): string => derive(CONFIG, v).deployment.plbCred
    expect(plbOf(V0_4_0)).toBe(plbOf(V0_3_0))
    expect(new Set([plbOf(LATEST), plbOf(V0_5_0_ALPHA_2), plbOf(V0_4_0)]).size).toBe(3)
    // What does separate them is the registry, whose mint took the spend credential at v0.4.0.
    expect(derive(CONFIG, V0_4_0).deployment.registryNodeCs).not.toBe(
      derive(CONFIG, V0_3_0).deployment.registryNodeCs
    )
  })
})

describe("what the derivation refuses", () => {
  it("names the blueprint entry a version needs and the config did not carry", () => {
    const without = (key: keyof Issuer.Blueprint): Issuer.DeployConfig => {
      const bp = { ...BLUEPRINT }
      delete bp[key]
      return { ...CONFIG, blueprint: bp }
    }
    expect(deriveFailure(without("thirdParty"))).toContain("blueprint.thirdParty")
    expect(deriveFailure(without("programmableLogicGlobal"))).toContain("blueprint.programmableLogicGlobal")
    expect(deriveFailure(without("issuanceLogic"))).toContain("blueprint.issuanceLogic")
    expect(deriveFailure(without("upgradeMultisig"))).toContain("blueprint.upgradeMultisig")
    expect(deriveFailure(without("coordinationSpend"), V0_5_0_ALPHA_2)).toContain("blueprint.coordinationSpend")
  })

  it("refuses to default max_inline_datum_bytes, which would bake a silent bound", () => {
    const { maxInlineDatumBytes: _dropped, ...rest } = CONFIG
    expect(deriveFailure(rest as Issuer.DeployConfig)).toContain("config.maxInlineDatumBytes")
  })

  it("refuses to default the upgrade authority, which would be a silent takeover", () => {
    const { upgradeMultisigSeed: _seed, ...rest } = CONFIG
    expect(deriveFailure(rest as Issuer.DeployConfig)).toContain("config.upgradeMultisigSeed")
    const { upgrade: _auth, ...noAuth } = CONFIG
    expect(deriveFailure(noAuth as Issuer.DeployConfig, V0_5_0_ALPHA_2)).toContain("config.upgrade")
  })

  it("names the version in the refusal, since the same config is valid on another", () => {
    const { upgrade: _auth, ...noAuth } = CONFIG
    expect(deriveFailure(noAuth as Issuer.DeployConfig, V0_5_0_ALPHA_2)).toContain("v0.5.0-alpha.2")
  })
})

describe("reproducing a deployment whose nonce was never published", () => {
  it("takes the always-fail hash directly, and applies nothing for it", () => {
    // CF's preview bootstrap publishes the hash and not the nonce. That hash parameterises
    // `issuance_cbor_hex_mint`, whose policy parameterises the registry, so guessing it wrong
    // yields a registry policy that matches nothing — an empty registry rather than an error.
    const published = h28("fe")
    const { deployment, log } = derive({ ...CONFIG, alwaysFailHashHex: published })
    expect(deployment.alwaysFailHash).toBe(published)
    expect(log.filter((c) => c.script === BLUEPRINT.alwaysFail)).toEqual([])
    expect(deployment.applied.alwaysFail).toBe("")
    // And it really is load-bearing downstream.
    expect(deployment.issuanceCborHexCs).not.toBe(derive().deployment.issuanceCborHexCs)
  })

  it("uses the separate coordination nonce, which real deployments do not share", () => {
    const shared = derive({ ...CONFIG, coordinationNonceHex: undefined }, V0_5_0_ALPHA_2)
    const split = derive(CONFIG, V0_5_0_ALPHA_2)
    expect(shared.deployment.coordinationCred).not.toBe(split.deployment.coordinationCred)
    expect(shared.log[1]!.params.map(renderParam)).toEqual(["bytes(1234)"])
    expect(split.log[1]!.params.map(renderParam)).toEqual(["bytes(5678)"])
  })
})
