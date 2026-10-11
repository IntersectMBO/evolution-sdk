/**
 * The transaction-inspection facade: typed decode of a received transaction's body and witness
 * set into domain objects, in the Effect channel.
 *
 * The read-side companion to a builder. Backed by the swappable `Decode` service; a throw on
 * malformed input becomes a typed `DecodeError`.
 *
 * ```ts
 * Effect.gen(function* () {
 *   const certs = yield* Analyze.certificates(bodyHex)   // Certificate[] | undefined
 *   const rdmrs = yield* Analyze.redeemers(witnessHex)   // Redeemer[]
 * }).pipe(Effect.provide(Decode.layer))
 * ```
 *
 * @since 0.1.0
 */

import { Data, Effect } from "effect"

import { Decode } from "./Decode.js"
import { bytesToHex } from "./internal/Hex.js"
import type {
  Certificate,
  Credential,
  Mint,
  NativeScript,
  ProposalProcedure,
  Voter,
  VotingProcedures
} from "./Types.js"

export type {
  Certificate,
  Credential,
  Mint,
  NativeScript,
  PlutusData,
  ProposalProcedure,
  Redeemer,
  Voter,
  VotingProcedures
} from "./Types.js"

/**
 * Typed decode of a received transaction failed (malformed body or witness set).
 *
 * @since 0.1.0
 */
export class DecodeError extends Data.TaggedError("DecodeError")<{
  readonly op: string
  readonly message: string
}> {}

const opD = <A>(name: string, f: (d: Decode) => A): Effect.Effect<A, DecodeError, Decode> =>
  Effect.flatMap(Decode, (d) =>
    Effect.try({
      try: () => f(d),
      catch: (e) => new DecodeError({ op: name, message: e instanceof Error ? e.message : String(e) })
    })
  )

// ── body fields (from the tx body hex; undefined when the field is absent) ──────
export const certificates = (bodyHex: string) => opD("certificates", (d) => d.certificates(bodyHex))
export const mint = (bodyHex: string) => opD("mint", (d) => d.mint(bodyHex))
export const votingProcedures = (bodyHex: string) => opD("votingProcedures", (d) => d.votingProcedures(bodyHex))
export const proposalProcedures = (bodyHex: string) => opD("proposalProcedures", (d) => d.proposalProcedures(bodyHex))

// ── witness fields (from the witness-set hex; [] when absent) ───────────────────
export const nativeScripts = (witnessHex: string) => opD("nativeScripts", (d) => d.nativeScripts(witnessHex))
export const datums = (witnessHex: string) => opD("datums", (d) => d.datums(witnessHex))
export const redeemers = (witnessHex: string) => opD("redeemers", (d) => d.redeemers(witnessHex))
export const plutusScripts = (witnessHex: string, version: 1 | 2 | 3) =>
  opD("plutusScripts", (d) => d.plutusScripts(witnessHex, version))

// ── a single plutus_data item (datum / redeemer data) ───────────────────────────
export const plutusData = (itemHex: string) => opD("plutusData", (d) => d.plutusData(itemHex))

// ════════════════════════════════════════════════════════════════════════════════
// Review IR — a single read-only, data-only summary of "what this tx does",
// composed from the typed decode above. Normalizes certificates / mint / votes /
// proposals into one `operations` list, derives the key-hash credentials that must
// witness (`signers`), tallies the script surface, and raises structural warnings.
// NO formatting / i18n — that's the consuming app's UI. What it can see is bounded
// by the typed decode: it does NOT cover input payment credentials, the explicit
// `required_signers` body field, outputs, fee, or withdrawals (not typed-decoded),
// so `signers` is the cert/voter/native-script-derived set, not the complete one.
// ════════════════════════════════════════════════════════════════════════════════

/** Broad classification of a certificate operation (data, not display text). */
export type CertCategory = "stake" | "delegation" | "drep" | "pool" | "committee" | "other"

export interface MintedAsset {
  readonly nameHex: string
  readonly quantity: bigint
}

/** One normalized operation the transaction performs. */
export type ReviewOp =
  | { readonly kind: "certificate"; readonly category: CertCategory; readonly cert: Certificate }
  | {
      readonly kind: "mint"
      readonly policyHex: string
      readonly assets: ReadonlyArray<MintedAsset>
      readonly burns: boolean
    }
  | { readonly kind: "vote"; readonly voter: Voter; readonly votes: number }
  | { readonly kind: "proposal"; readonly procedure: ProposalProcedure }

export type SignerSource = "certificate" | "voter" | "native_script"

/** A key-hash credential that must produce a vkey witness for this tx. */
export interface RequiredSigner {
  readonly keyHashHex: string
  readonly source: SignerSource
}

export interface ScriptSummary {
  readonly native: number
  readonly plutusV1: number
  readonly plutusV2: number
  readonly plutusV3: number
  readonly redeemers: number
  readonly datums: number
}

/** The read-only review of a received transaction. */
export interface ReviewedTransaction {
  readonly operations: ReadonlyArray<ReviewOp>
  readonly signers: ReadonlyArray<RequiredSigner>
  readonly scripts: ScriptSummary
  readonly warnings: ReadonlyArray<string>
}

const hx = (b: Uint8Array): string => bytesToHex(b)

const CERT_CATEGORY: Record<Certificate["type"], CertCategory> = {
  stake_registration: "stake",
  stake_deregistration: "stake",
  reg: "stake",
  unreg: "stake",
  stake_delegation: "delegation",
  vote_delegation: "delegation",
  stake_vote_delegation: "delegation",
  stake_reg_delegation: "delegation",
  vote_reg_delegation: "delegation",
  stake_vote_reg_delegation: "delegation",
  drep_registration: "drep",
  drep_deregistration: "drep",
  drep_update: "drep",
  pool_registration: "pool",
  pool_retirement: "pool",
  committee_hot_auth: "committee",
  committee_cold_resign: "committee",
  other: "other"
}

/** Credentials a certificate obliges to witness (script creds are satisfied by scripts, not keys). */
export const certificateCredentials = (c: Certificate): Array<Credential> => {
  switch (c.type) {
    case "stake_registration":
    case "stake_deregistration":
    case "reg":
    case "unreg":
    case "stake_delegation":
    case "vote_delegation":
    case "stake_vote_delegation":
    case "stake_reg_delegation":
    case "vote_reg_delegation":
    case "stake_vote_reg_delegation":
    case "drep_registration":
    case "drep_deregistration":
    case "drep_update":
      return [c.cred]
    case "committee_hot_auth":
      return [c.cold, c.hot]
    case "committee_cold_resign":
      return [c.cold]
    case "pool_registration":
    case "pool_retirement":
    case "other":
      return []
  }
}

/** All pubkey key-hashes referenced (recursively) by a native script. */
const nativeScriptSigners = (s: NativeScript, out: Array<Uint8Array>): void => {
  switch (s.type) {
    case "pubkey":
      out.push(s.keyHash)
      break
    case "all":
    case "any":
    case "n_of_k":
      s.scripts.forEach((x) => nativeScriptSigners(x, out))
      break
    case "invalid_before":
    case "invalid_hereafter":
      break
    case "require_guard":
      if (!s.cred.isScript) out.push(s.cred.hash)
      break // Dijkstra guard (PRE-FORK)
  }
}

const voterKeyCred = (v: Voter): Uint8Array | undefined => {
  if (v.role === "pool") return v.keyHash
  return v.cred.isScript ? undefined : v.cred.hash
}

/**
 * Review a received transaction: `bodyHex` (required) + `witnessHex` (optional, for
 * the script/redeemer/datum surface and native-script-derived signers). Read-only.
 */
export const review = (bodyHex: string, witnessHex?: string): Effect.Effect<ReviewedTransaction, DecodeError, Decode> =>
  Effect.flatMap(Decode, (d) =>
    Effect.try({
      try: (): ReviewedTransaction => {
        const certs: Array<Certificate> = d.certificates(bodyHex) ?? []
        const mintField: Mint | undefined = d.mint(bodyHex)
        const voting: VotingProcedures | undefined = d.votingProcedures(bodyHex)
        const proposals: Array<ProposalProcedure> | undefined = d.proposalProcedures(bodyHex)

        const nativeScripts = witnessHex ? d.nativeScripts(witnessHex) : []
        const redeemers = witnessHex ? d.redeemers(witnessHex) : []
        const datums = witnessHex ? d.datums(witnessHex) : []
        const plutus = witnessHex
          ? {
              v1: d.plutusScripts(witnessHex, 1).length,
              v2: d.plutusScripts(witnessHex, 2).length,
              v3: d.plutusScripts(witnessHex, 3).length
            }
          : { v1: 0, v2: 0, v3: 0 }

        const operations: Array<ReviewOp> = []
        const warnings: Array<string> = []

        for (const cert of certs) {
          operations.push({ kind: "certificate", category: CERT_CATEGORY[cert.type], cert })
          if (cert.type === "other") warnings.push(`unrecognized certificate (tag ${cert.tag})`)
        }

        for (const [policy, assets] of mintField ?? []) {
          const minted = assets.map(([name, quantity]) => ({ nameHex: hx(name), quantity }))
          const burns = minted.some((a) => a.quantity < 0n)
          operations.push({ kind: "mint", policyHex: hx(policy), assets: minted, burns })
          if (burns) warnings.push(`burns token(s) under policy ${hx(policy).slice(0, 12)}…`)
        }

        for (const [voter, votes] of voting ?? []) operations.push({ kind: "vote", voter, votes: votes.length })
        for (const procedure of proposals ?? []) operations.push({ kind: "proposal", procedure })

        // ── required signers (key-hash creds only) from certs + voters + native scripts ──
        const signers: Array<RequiredSigner> = []
        const seen = new Set<string>()
        const add = (hash: Uint8Array, source: SignerSource) => {
          const h = hx(hash)
          if (!seen.has(h)) {
            seen.add(h)
            signers.push({ keyHashHex: h, source })
          }
        }
        const scriptCredCerts = certs.some((c) => certificateCredentials(c).some((cr) => cr.isScript))
        certs.forEach((c) =>
          certificateCredentials(c)
            .filter((cr) => !cr.isScript)
            .forEach((cr) => add(cr.hash, "certificate"))
        )
        for (const [voter] of voting ?? []) {
          const k = voterKeyCred(voter)
          if (k) add(k, "voter")
        }
        nativeScripts.forEach((s) => {
          const out: Array<Uint8Array> = []
          nativeScriptSigners(s, out)
          out.forEach((h) => add(h, "native_script"))
        })

        if (scriptCredCerts)
          warnings.push("has script-credential certificate(s) — satisfied by a script, not a key witness")
        if (redeemers.length > 0)
          warnings.push(`spends via Plutus (${redeemers.length} redeemer(s)) — collateral required`)

        return {
          operations,
          signers,
          scripts: {
            native: nativeScripts.length,
            plutusV1: plutus.v1,
            plutusV2: plutus.v2,
            plutusV3: plutus.v3,
            redeemers: redeemers.length,
            datums: datums.length
          },
          warnings
        }
      },
      catch: (e) => new DecodeError({ op: "review", message: e instanceof Error ? e.message : String(e) })
    })
  )

/** A key I control, for signing-role matching (path/label are echoed as hints). */
export interface OwnedKey {
  readonly keyHashHex: string
  readonly path?: ReadonlyArray<number>
  readonly label?: string
}
export interface SigningRoles {
  /** Required signers I control, annotated with the owned key's path/label hint. */
  readonly mine: ReadonlyArray<RequiredSigner & OwnedKey>
  /** Required signers not matched by any owned key. */
  readonly missing: ReadonlyArray<RequiredSigner>
}

/**
 * Split a review's required signers into the ones I control (with derivation-path
 * hints from `owned`) and the ones I don't. Pure — no decode, no services.
 */
export const signingRoles = (reviewed: ReviewedTransaction, owned: ReadonlyArray<OwnedKey>): SigningRoles => {
  const byHash = new Map(owned.map((o) => [o.keyHashHex, o]))
  const mine: Array<RequiredSigner & OwnedKey> = []
  const missing: Array<RequiredSigner> = []
  for (const s of reviewed.signers) {
    const o = byHash.get(s.keyHashHex)
    if (o) mine.push({ ...s, ...o })
    else missing.push(s)
  }
  return { mine, missing }
}
