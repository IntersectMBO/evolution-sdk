// CIP-113 classification — what a programmable token IS, per the registry.
//
// This module answers "what is this?" and deliberately cannot answer "is it mine?".
//
// The two questions have different sources of truth. What a token is comes from the
// registry node and the deployment record, and is identical for everyone looking at that
// policy. Whether a UTxO is yours comes from your own credential set, and differs per
// wallet. Keeping them in one type makes the distinction a convention that the next caller
// can quietly violate; keeping them apart makes it structural — there is no ownership field
// here to misuse, and a consumer must bring its own credentials to reach a verdict.
//
// So: this side classifies, the wallet decides. A registry node tells us a policy's RULES;
// it never tells us a UTxO is ours.

import { ABSENT_CRED, type Credential, type RegistryNode, selectCoveringNode } from "./Cip113.js"
import type { Cip113Deployment } from "./Deployment.js"

/** Can the issuer's third party seize this token? */
export type Seizure =
  /** `third_party_transfer_logic_script` is a live script — seizure is possible. */
  | { readonly kind: 'possible'; readonly logic: Credential }
  /** It points at a known always-fail script — nobody can seize. */
  | { readonly kind: 'disabled' }
  /** It points at something we cannot classify against this deployment's known
   *  always-fail hashes. NOT the same as "disabled" — say so rather than reassure. */
  | { readonly kind: 'unknown'; readonly logic: Credential }

/** Can PLB UTxOs of this policy be restructured (unfracked)? */
export type Unfracking =
  /** The `empty_vkey` sentinel — unfracking is forbidden for this policy (default-deny). */
  | { readonly kind: 'forbidden' }
  /** Delegated to the issuer's hook validator. */
  | { readonly kind: 'delegated'; readonly logic: Credential }
  /** A key credential — signature-gated unfracking. */
  | { readonly kind: 'signature-gated'; readonly logic: Credential }

/**
 * What governs moving this token, and — crucially — whether we are in a position to say.
 *
 * `unknown-substandard` is a first-class answer, not a failure. Most live CIP-113 policies
 * delegate transfers to an issuer's script whose rules we cannot evaluate off-chain (KYC
 * allowlists, jurisdiction gates). "Yours, but we cannot tell you whether you can move it"
 * is the honest report; collapsing it into either transferable or blocked is a lie in one
 * direction or the other.
 */
export type Transferability =
  /** The policy is not in this registry — not a programmable token of this deployment. */
  | { readonly kind: 'not-programmable' }
  /** Transfer logic is a script the caller told us it can satisfy. */
  | { readonly kind: 'known-substandard'; readonly scriptHashHex: string }
  /** Transfer logic is a script the caller has no witness for. */
  | { readonly kind: 'unknown-substandard'; readonly scriptHashHex: string }
  /** Transfer logic is a key credential — a signature, not a script. */
  | { readonly kind: 'signature-gated'; readonly keyHashHex: string }

/**
 * The registry-derived facts about one policy under one deployment. No ownership notion,
 * by design (see the module header).
 */
export interface Cip113Classification {
  readonly policyHex: string
  /** The deployment this classification is relative to — the same policy classifies
   *  differently under a different registry. */
  readonly deploymentId: string
  /** `registered` = the registry has a node keyed by this policy. */
  readonly registration: 'registered' | 'unregistered'
  readonly transferability: Transferability
  readonly seizure: Seizure
  readonly unfracking: Unfracking
  /** `minting_logic_script` — who may issue more. Absent for unregistered policies. */
  readonly mintingLogic?: Credential
  /** The policy's global-state currency symbol, when it declares one. */
  readonly globalStateCsHex?: string
}

const isAbsent = (c: Credential): boolean => c.hashHex === ABSENT_CRED.hashHex

const classifySeizure = (node: RegistryNode, deployment: Cip113Deployment): Seizure => {
  const logic = node.thirdPartyTransferLogicScript
  if (isAbsent(logic)) return { kind: 'disabled' }
  const alwaysFail = deployment.alwaysFailScriptHashHexes ?? []
  if (logic.kind === 'script' && alwaysFail.includes(logic.hashHex)) return { kind: 'disabled' }
  // A live script MIGHT be a bespoke always-fail we have not been told about, but saying
  // "disabled" on a guess is the one error that materially misleads a holder.
  return alwaysFail.length === 0 ? { kind: 'unknown', logic } : { kind: 'possible', logic }
}

const classifyUnfracking = (node: RegistryNode): Unfracking => {
  const logic = node.unfrackingLogicScript
  if (isAbsent(logic)) return { kind: 'forbidden' }
  return logic.kind === 'script' ? { kind: 'delegated', logic } : { kind: 'signature-gated', logic }
}

const classifyTransferability = (node: RegistryNode, knownSubstandards: ReadonlySet<string>): Transferability => {
  const logic = node.transferLogicScript
  if (logic.kind === 'key') return { kind: 'signature-gated', keyHashHex: logic.hashHex }
  return knownSubstandards.has(logic.hashHex)
    ? { kind: 'known-substandard', scriptHashHex: logic.hashHex }
    : { kind: 'unknown-substandard', scriptHashHex: logic.hashHex }
}

/**
 * Classify `policyHex` against a registry view.
 *
 * `knownSubstandards` is the set of `transfer_logic` script hashes the CALLER can witness
 * (it holds the pre-applied script and a redeemer for each). It is a caller input rather
 * than a lookup here because whether a transfer can be built is a fact about the caller's
 * capabilities, not about the token.
 *
 * Throws only if the registry view does not cover the policy at all — an incomplete read,
 * which is a different problem from the policy being unregistered. ⚠️ A policy ABOVE the last
 * node's key is covered (by its sentinel `next`) and is therefore unregistered, not uncovered;
 * a policy below the lowest key held is uncovered, because the origin node is missing.
 *
 * The decision table, one row per answer (`test/Classify.test.ts` has a case per row):
 *
 * | registry node | transfer_logic | third_party_logic | always-fail list | → |
 * |---|---|---|---|---|
 * | none (covered) | — | — | — | `unregistered` / `not-programmable` / seizure `disabled` / unfracking `forbidden` |
 * | found | key | — | — | `signature-gated` — even if the hash is in `knownSubstandards` |
 * | found | script in `knownSubstandards` | — | — | `known-substandard` |
 * | found | script, unknown to the caller | — | — | `unknown-substandard` |
 * | found | — | `empty_vkey` | — | seizure `disabled` |
 * | found | — | script in the list | non-empty | seizure `disabled` |
 * | found | — | anything else | non-empty | seizure `possible` |
 * | found | — | anything else | empty / absent | seizure **`unknown`**, never `disabled` |
 *
 * Unfracking reads the same way: `empty_vkey` → `forbidden`, script → `delegated`, key →
 * `signature-gated`.
 */
export const classifyPolicy = (
  nodes: ReadonlyArray<RegistryNode>,
  deployment: Cip113Deployment,
  policyHex: string,
  knownSubstandards: ReadonlySet<string> = new Set(),
): Cip113Classification => {
  const selection = selectCoveringNode(nodes, policyHex)
  if (selection.kind === 'notExists') {
    return {
      policyHex,
      deploymentId: deployment.id,
      registration: 'unregistered',
      transferability: { kind: 'not-programmable' },
      // An unregistered policy has no issuer rules at all — it is an ordinary token that
      // happens to be sitting at a smart-wallet address.
      seizure: { kind: 'disabled' },
      unfracking: { kind: 'forbidden' },
    }
  }
  const node = selection.node
  return {
    policyHex,
    deploymentId: deployment.id,
    registration: 'registered',
    transferability: classifyTransferability(node, knownSubstandards),
    seizure: classifySeizure(node, deployment),
    unfracking: classifyUnfracking(node),
    mintingLogic: node.mintingLogicScript,
    ...(node.globalStateCsHex.length > 0 ? { globalStateCsHex: node.globalStateCsHex } : {}),
  }
}

/**
 * Which deployment generation a smart-wallet payment credential belongs to.
 *
 * Answers the "I can see tokens but the wallet says nothing" case after a redeploy. Note
 * `unrecognised` genuinely means unrecognised: a script credential sharing the user's stake
 * credential is just as likely to be a DEX, escrow or multisig address, and calling that a
 * prior generation would invent history.
 */
export type Generation =
  | { readonly kind: 'current'; readonly deploymentId: string }
  | { readonly kind: 'prior'; readonly generationId: string; readonly source: string }
  | { readonly kind: 'unrecognised' }

/**
 * Classify a payment credential against a deployment and its recorded prior generations.
 *
 * | credential | → |
 * |---|---|
 * | equals `deployment.plbScriptHashHex` | `current` |
 * | listed in `priorGenerations` | `prior`, with that entry's `source` |
 * | anything else | `unrecognised` — never a guess at a generation |
 */
export const classifyGeneration = (deployment: Cip113Deployment, paymentCredHashHex: string): Generation => {
  if (paymentCredHashHex === deployment.plbScriptHashHex) return { kind: 'current', deploymentId: deployment.id }
  const prior = (deployment.priorGenerations ?? []).find((g) => g.plbScriptHashHex === paymentCredHashHex)
  return prior === undefined ? { kind: 'unrecognised' } : { kind: 'prior', generationId: prior.id, source: prior.source }
}
