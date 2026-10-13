/**
 * Resolve the upstream CIP-113 reference blueprint (`plutus.json`) for the harnesses.
 *
 * ⚠️ WHY THE RESOLUTION ORDER MATTERS. Every CIP-113 harness used to read the sibling clone's
 * WORKING TREE, which silently pins a measurement to whichever branch that clone is parked on —
 * and on 2026-08-26 it was parked four commits off `main`'s lineage, so the whole suite measured
 * three-week-old code and reported green. A regression watch that reads a stale file cannot go
 * red. So the default path is `git show <ref>:plutus.json`, which never touches the checkout.
 *
 * Order, most explicit first:
 *   1. `CIP113_BLUEPRINT`     — a path to a specific plutus.json. Absolute control.
 *   2. `CIP113_BLUEPRINT_REF` — a git ref in the sibling clone, read without checking it out.
 *   3. the descriptor's PINNED ref (below), which is the default.
 *   4. the working tree       — only if the clone has no such ref, and it says so.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { Blueprint, DeployConfig, Deployment  } from "../src/Issuer.js"
import type { Cip113Version } from "../src/Versions.js"

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Where the upstream Aiken project is cloned.
 *
 * ⚠️ Not in this repo and not vendored: it is upstream's build output, several megabytes, and
 * pinning a copy here would be one more thing to forget to refresh. `CIP113_CLONE` overrides.
 */
export const CLONE = process.env.CIP113_CLONE ?? resolve(here, "../../../../cip113-programmable-tokens")

/** One blueprint validator entry, as `plutus.json` writes it. */
export interface BlueprintValidator {
  readonly title: string
  readonly compiledCode: string
  readonly hash?: string
}

/** The parts of `plutus.json` a harness reads. */
export interface RawBlueprint {
  readonly preamble: { readonly version?: string; readonly title?: string }
  readonly validators: ReadonlyArray<BlueprintValidator>
}

/**
 * The upstream commit each descriptor was written against.
 *
 * Pinned rather than tracked, because `origin/main` moves and a descriptor does not, and the two
 * drifting apart is silent: it is what left a derivation producing `alpha.4` scripts while
 * building a `v0.0.1` genesis out of them.
 */
export const UPSTREAM_REFS: Readonly<Record<string, string>> = {
  "v0.5.0-alpha.4": "7e8a631",
  "v0.0.1": "6b75ba3",
  // Pinned 2026-10-11 by re-deriving it: `Budgets.ts` says the alpha.2 numbers came from a
  // deployment derived from this ref, and the measurement reproduces them to the digit from it.
  "v0.5.0-alpha.2": "9db7e06",
}

/** The pinned upstream ref for a descriptor; `origin/main` for one nobody pinned. */
export const refFor = (version: Cip113Version): string => UPSTREAM_REFS[version.id] ?? "origin/main"

/** The blueprint plus where it came from — the provenance every harness prints. */
export const loadBlueprint = (wantRef?: string): { readonly blueprint: RawBlueprint; readonly source: string } => {
  const explicit = process.env.CIP113_BLUEPRINT
  if (explicit !== undefined && explicit.length > 0) {
    return { blueprint: JSON.parse(readFileSync(explicit, "utf8")) as RawBlueprint, source: explicit }
  }

  const ref = process.env.CIP113_BLUEPRINT_REF ?? wantRef ?? "origin/main"
  try {
    const json = execFileSync("git", ["-C", CLONE, "show", `${ref}:plutus.json`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
    const sha = execFileSync("git", ["-C", CLONE, "rev-parse", "--short", ref], { encoding: "utf8" }).trim()
    return { blueprint: JSON.parse(json) as RawBlueprint, source: `${ref} (${sha})` }
  } catch {
    // An odd clone, or no such ref — fall through to the working tree, saying so.
  }

  const path = join(CLONE, "plutus.json")
  return {
    blueprint: JSON.parse(readFileSync(path, "utf8")) as RawBlueprint,
    source: `${path} (WORKING TREE — may be any branch)`,
  }
}

/**
 * `compiledCode` of the blueprint entry whose title is `prefix` or starts with `prefix.`.
 *
 * ⚠️ A WHOLE title segment, not a raw string prefix: since the registry and protocol-params
 * pairs merged, the merged titles are proper prefixes of the split ones, so a bare
 * `startsWith('registry')` would happily return `registry_mint` from an older blueprint and
 * derive a plausible, wrong hash. Throws with the available titles, because the realistic miss
 * is an upstream RENAME and `Cannot read properties of undefined` names nothing.
 */
export const validatorCode = (blueprint: RawBlueprint, prefix: string): string => {
  const hit = blueprint.validators.find((v) => v.title === prefix || v.title.startsWith(`${prefix}.`))
  if (hit === undefined) {
    const titles = [...new Set(blueprint.validators.map((v) => v.title.split(".")[0]))].join(", ")
    throw new Error(`blueprint has no validator titled ${prefix}* — it has: ${titles}`)
  }
  return hit.compiledCode
}

/**
 * The `Blueprint` record for a version descriptor, pulled out of a raw `plutus.json`.
 *
 * Every title comes from `version.titles`, never a literal here: the validator SET is
 * version-dependent in three separate ways — two pairs merged (so the mint and spend slots of
 * each hold the same `compiledCode`), the dispatcher came back under a title that used to mean
 * the coordinator, and `issuance_logic` is new.
 */
export const blueprintFor = (blueprint: RawBlueprint, version: Cip113Version): Blueprint => {
  const t = version.titles
  const at = (title: string): string => validatorCode(blueprint, title)
  return {
    alwaysFail: at(t.alwaysFail),
    protocolParamsMint: at(t.protocolParamsMint),
    issuanceCborHexMint: at(t.issuanceCborHexMint),
    registrySpend: at(t.registrySpend),
    registryMint: at(t.registryMint),
    transfer: at(t.transfer),
    programmableLogicBase: at(t.programmableLogicBase),
    unfracking: at(t.unfracking),
    issuanceMint: at(t.issuanceMint),
    ...(t.thirdParty !== null ? { thirdParty: at(t.thirdParty) } : {}),
    // The params UTxO's lock is a separate `coordination_spend` script only on the
    // `'split-coordination'` shape: before it was always-fail, and after the merge the params
    // validator locks the NFT at its own hash with nothing extra to load.
    ...(version.protocolParams === "split-coordination" ? { coordinationSpend: at(t.protocolParamsSpend) } : {}),
    ...(t.upgradeMultisig !== null ? { upgradeMultisig: at(t.upgradeMultisig) } : {}),
    ...(t.programmableLogicGlobal !== null ? { programmableLogicGlobal: at(t.programmableLogicGlobal) } : {}),
    ...(t.issuanceLogic !== null ? { issuanceLogic: at(t.issuanceLogic) } : {}),
  }
}

/** Deploy inputs the derivation requires but a measurement has no opinion on. */
export const DEPLOY_DEFAULTS: Omit<DeployConfig, "blueprint"> = {
  nonceHex: "deadbeef",
  protocolParamsSeed: { txHash: "a1".repeat(32) as never, index: 0 },
  issuanceCborHexSeed: { txHash: "a2".repeat(32) as never, index: 0 },
  registrySeed: { txHash: "a3".repeat(32) as never, index: 0 },
  upgradeMultisigSeed: { txHash: "a4".repeat(32) as never, index: 0 },
  upgrade: { signers: ["ef".repeat(28)], threshold: 1 },
  maxInlineDatumBytes: 256n,
}

/**
 * Where a derived deployment's params NFT is locked — the lock target moved twice.
 *
 * `always_fail` (frozen), then `coordination_spend` (the upgrade rail), then the params
 * validator's own hash after the merge. A harness that hardcodes any one of them builds an
 * address for a script that does not exist in that version and dies on a hex length, several
 * frames from the cause.
 */
export const paramsLockHash = (deployment: Deployment, version: Cip113Version): string | undefined =>
  version.protocolParams === "merged-self"
    ? deployment.protocolParamsCs
    : version.protocolParams === "split-coordination"
      ? deployment.coordinationCred
      : deployment.alwaysFailHash
