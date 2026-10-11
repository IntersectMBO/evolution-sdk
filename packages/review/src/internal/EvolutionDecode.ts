/**
 * The Evolution-backed `Decode` backend: their decoded models onto this package's views.
 *
 * Each body field is decoded from the **exact span it occupies** rather than from a re-decode of
 * the whole body, because the review tier already holds those spans from its own walk and a
 * second body parser would be a second thing to keep in step with the first.
 *
 * ⚠️ Two shapes have no source on their side and this throws rather than inventing one: a
 * `require_guard` native script (Dijkstra, pre-fork) and any certificate their schema rejects. A
 * backend that quietly answered `[]` would show a script transaction as carrying no scripts.
 *
 * @since 0.1.0
 */

import * as E from "@evolution-sdk/evolution"

import type {
  Anchor,
  Certificate,
  Credential,
  DRep,
  GovAction,
  GovActionId,
  Mint,
  NativeScript,
  PlutusData,
  PoolParams,
  ProposalProcedure,
  Redeemer,
  Relay,
  Vote,
  Voter,
  VotingProcedure,
  VotingProcedures
} from "../Types.js"
import { hexToBytes } from "./Hex.js"

/** Their hash-like wrappers all carry the bytes under `bytes` or `hash`. */
const bytesOf = (v: any): Uint8Array => (v instanceof Uint8Array ? v : (v?.bytes ?? v?.hash))

const cred = (c: any): Credential => ({ hash: bytesOf(c), isScript: c._tag === "ScriptHash" })

const drep = (d: any): DRep => {
  switch (d._tag) {
    case "AlwaysAbstainDRep":
      return { kind: "abstain" }
    case "AlwaysNoConfidenceDRep":
      return { kind: "no_confidence" }
    case "ScriptHashDRep":
      return { kind: "script", hash: bytesOf(d.scriptHash ?? d) }
    default:
      return { kind: "key", hash: bytesOf(d.keyHash ?? d) }
  }
}

/**
 * ⚠️ Their fields are `anchorUrl`/`anchorDataHash`, and `anchorUrl` is a `Url` CLASS — `String()`
 * on it yields its JSON rendering, not the address. Take `.href`.
 */
const anchor = (a: any): Anchor | undefined =>
  a == null ? undefined : { url: a.anchorUrl.href, dataHash: bytesOf(a.anchorDataHash) }

const withAnchor = <T extends object>(base: T, a: any): T => (a == null ? base : { ...base, anchor: anchor(a) })

const relay = (r: any): Relay => {
  switch (r._tag) {
    case "SingleHostAddr":
      return {
        kind: "single_host_addr",
        ...(r.port == null ? {} : { port: Number(r.port) }),
        ...(r.ipv4 == null ? {} : { ipv4: bytesOf(r.ipv4) }),
        ...(r.ipv6 == null ? {} : { ipv6: bytesOf(r.ipv6) })
      }
    case "SingleHostName":
      return { kind: "single_host_name", ...(r.port == null ? {} : { port: Number(r.port) }), dns: String(r.dnsName) }
    case "MultiHostName":
      return { kind: "multi_host_name", dns: String(r.dnsName) }
    default:
      throw new Error(`review/decode: unmodelled relay ${r._tag}`)
  }
}

const poolParams = (p: any): PoolParams => ({
  operator: bytesOf(p.operator),
  vrfKeyhash: bytesOf(p.vrfKeyhash),
  pledge: p.pledge,
  cost: p.cost,
  margin: [p.margin.numerator, p.margin.denominator],
  // Their RewardAccount is structured (`{networkId, stakeCredential}`); the view is the 29 raw
  // bytes, header included, so go through their own encoder rather than rebuilding it.
  rewardAccount: E.RewardAccount.toBytes(p.rewardAccount),
  owners: p.poolOwners.map((o: unknown) => bytesOf(o)),
  relays: p.relays.map(relay),
  ...(p.poolMetadata == null
    ? {}
    : { meta: [p.poolMetadata.url.href, bytesOf(p.poolMetadata.hash)] as [string, Uint8Array] })
})

const certificate = (c: any): Certificate => {
  switch (c._tag) {
    case "StakeRegistration":
      return { type: "stake_registration", cred: cred(c.stakeCredential) }
    case "StakeDeregistration":
      return { type: "stake_deregistration", cred: cred(c.stakeCredential) }
    case "StakeDelegation":
      return { type: "stake_delegation", cred: cred(c.stakeCredential), pool: bytesOf(c.poolKeyHash) }
    case "PoolRegistration":
      return { type: "pool_registration", params: poolParams(c.poolParams) }
    case "PoolRetirement":
      return { type: "pool_retirement", pool: bytesOf(c.poolKeyHash), epoch: BigInt(c.epoch) }
    case "RegCert":
      return { type: "reg", cred: cred(c.stakeCredential), deposit: c.coin }
    case "UnregCert":
      return { type: "unreg", cred: cred(c.stakeCredential), deposit: c.coin }
    case "VoteDelegCert":
      return { type: "vote_delegation", cred: cred(c.stakeCredential), drep: drep(c.drep) }
    case "StakeVoteDelegCert":
      return {
        type: "stake_vote_delegation",
        cred: cred(c.stakeCredential),
        pool: bytesOf(c.poolKeyHash),
        drep: drep(c.drep)
      }
    case "StakeRegDelegCert":
      return {
        type: "stake_reg_delegation",
        cred: cred(c.stakeCredential),
        pool: bytesOf(c.poolKeyHash),
        deposit: c.coin
      }
    case "VoteRegDelegCert":
      return { type: "vote_reg_delegation", cred: cred(c.stakeCredential), drep: drep(c.drep), deposit: c.coin }
    case "StakeVoteRegDelegCert":
      return {
        type: "stake_vote_reg_delegation",
        cred: cred(c.stakeCredential),
        pool: bytesOf(c.poolKeyHash),
        drep: drep(c.drep),
        deposit: c.coin
      }
    case "AuthCommitteeHotCert":
      return {
        type: "committee_hot_auth",
        cold: cred(c.committeeColdCredential),
        hot: cred(c.committeeHotCredential)
      }
    case "ResignCommitteeColdCert":
      return withAnchor({ type: "committee_cold_resign" as const, cold: cred(c.committeeColdCredential) }, c.anchor)
    case "RegDrepCert":
      return withAnchor({ type: "drep_registration" as const, cred: cred(c.drepCredential), deposit: c.coin }, c.anchor)
    case "UnregDrepCert":
      return { type: "drep_deregistration", cred: cred(c.drepCredential), deposit: c.coin }
    case "UpdateDrepCert":
      return withAnchor({ type: "drep_update" as const, cred: cred(c.drepCredential) }, c.anchor)
    default:
      throw new Error(`review/decode: unmodelled certificate ${c._tag}`)
  }
}

/**
 * ⚠️ Their `NativeScript` is a WRAPPER — `_tag: "NativeScript"` with the variant under `.script`.
 * Reading `_tag` off the wrapper gives the wrapper's name, not the variant's.
 */
const nativeScriptOf = (wrapper: any): NativeScript => {
  const ns = wrapper._tag === "NativeScript" ? wrapper.script : wrapper
  switch (ns._tag) {
    case "ScriptPubKey":
      return { type: "pubkey", keyHash: bytesOf(ns.keyHash) }
    case "ScriptAll":
      return { type: "all", scripts: ns.scripts.map(nativeScriptOf) }
    case "ScriptAny":
      return { type: "any", scripts: ns.scripts.map(nativeScriptOf) }
    case "ScriptNOfK":
      return { type: "n_of_k", n: BigInt(ns.required), scripts: ns.scripts.map(nativeScriptOf) }
    case "InvalidBefore":
      return { type: "invalid_before", slot: BigInt(ns.slot) }
    case "InvalidHereafter":
      return { type: "invalid_hereafter", slot: BigInt(ns.slot) }
    default:
      // `require_guard` is Dijkstra's pre-fork script_require_guard (tag 6), which Evolution
      // does not model at all.
      throw new Error(`review/decode: unmodelled native script ${ns._tag}`)
  }
}

/**
 * Evolution's `Data` is plain JS — a `Constr`, a `Map`, an array, a `bigint` or a `Uint8Array`.
 *
 * ⚠️ Their `bigint` covers BOTH a CBOR integer and a tag-2/3 bignum, so the `{type:'bigint'}`
 * form has no source here. Anything inside the 64-bit range maps to `int` and agrees; a true
 * bignum would not.
 */
const plutusDataOf = (d: any): PlutusData => {
  if (d instanceof Uint8Array) return { type: "bytes", bytes: d }
  if (typeof d === "bigint") return { type: "int", value: d }
  if (d instanceof Map) {
    return { type: "map", pairs: [...d.entries()].map(([k, v]) => [plutusDataOf(k), plutusDataOf(v)]) }
  }
  if (Array.isArray(d)) return { type: "list", items: d.map(plutusDataOf) }
  if (d?.index !== undefined && Array.isArray(d.fields)) {
    return { type: "constr", alt: d.index, fields: d.fields.map(plutusDataOf) }
  }
  throw new Error(`review/decode: unmodelled plutus data ${Object.prototype.toString.call(d)}`)
}

/** ⚠️ Their Vote is a tagged class (`YesVote`); the view is the CDDL name. */
const VOTE: Record<string, Vote> = { NoVote: "no", YesVote: "yes", AbstainVote: "abstain" }

const voteProcedure = (proc: any): VotingProcedure => {
  const vote = VOTE[proc.vote._tag]
  if (vote === undefined) throw new Error(`review/decode: unmodelled vote ${proc.vote._tag}`)
  return withAnchor({ vote }, proc.anchor)
}

/**
 * Their `rewardAccount` field is declared `RewardAccount.FromBech32`, but the DECODED value is a
 * `RewardAccount`, not the bech32 string — the schema names the wire form, not the runtime one.
 */
const rewardAccountBytes = (ra: any): Uint8Array => (ra instanceof Uint8Array ? ra : E.RewardAccount.toBytes(ra))

const gaidOf = (g: any): GovActionId | undefined =>
  g == null ? undefined : { txId: bytesOf(g.transactionId), index: BigInt(g.govActionIndex) }

const hashOf = (h: any): Uint8Array | undefined => (h == null ? undefined : bytesOf(h))

const headWidth = (bytes: Uint8Array, pos: number): number => {
  const ai = bytes[pos]! & 0x1f
  if (ai === 31) throw new Error("review/decode: indefinite-length container in a proposal procedure")
  return ai < 24 ? 1 : ai === 24 ? 2 : ai === 25 ? 3 : ai === 26 ? 5 : 9
}

const endOf = (bytes: Uint8Array, pos: number): number => E.CBOR.decodeItemWithOffset(bytes, pos).newOffset

/**
 * The raw `protocol_param_update` bytes, spliced out of the procedure's own span.
 *
 * ⚠️ Not taken from their parsed `ProtocolParamUpdate`: the update map gains keys with every
 * era, so re-encoding what their schema recognised would silently drop the rest — and this value
 * is what a reviewer is shown.
 *
 * `proposal_procedure = [deposit, reward_account, gov_action, anchor]` and
 * `parameter_change_action = (0, gov_action_id/null, protocol_param_update, policy_hash/null)`.
 */
const paramUpdateRaw = (procSpan: Uint8Array): Uint8Array => {
  let p = headWidth(procSpan, 0)
  p = endOf(procSpan, p) // past deposit
  p = endOf(procSpan, p) // past reward_account
  let g = p + headWidth(procSpan, p)
  g = endOf(procSpan, g) // past the variant tag
  g = endOf(procSpan, g) // past gov_action_id/null
  return procSpan.subarray(g, endOf(procSpan, g))
}

/**
 * One governance action, payload included.
 *
 * ⚠️ Every field is carried. A `{type}`-only mapper agrees with a full decoder on `info` and on
 * a bare `no_confidence` and on nothing else — and a review surface shown
 * `treasury_withdrawals` with no recipient and no amount is being told nothing about a
 * transaction that moves treasury funds.
 */
const govActionOf = (a: any, procSpan: Uint8Array): GovAction => {
  switch (a._tag) {
    case "ParameterChangeAction":
      return {
        type: "parameter_change",
        prev: gaidOf(a.govActionId),
        paramUpdate: paramUpdateRaw(procSpan),
        policyHash: hashOf(a.policyHash)
      }
    case "HardForkInitiationAction":
      return {
        type: "hard_fork",
        prev: gaidOf(a.govActionId),
        major: BigInt(a.protocolVersion.major),
        minor: BigInt(a.protocolVersion.minor)
      }
    case "TreasuryWithdrawalsAction":
      return {
        type: "treasury_withdrawals",
        withdrawals: [...a.withdrawals.entries()].map(([ra, coin]: [any, bigint]) => [rewardAccountBytes(ra), coin]),
        policyHash: hashOf(a.policyHash)
      }
    case "NoConfidenceAction":
      return { type: "no_confidence", prev: gaidOf(a.govActionId) }
    case "UpdateCommitteeAction":
      return {
        type: "update_committee",
        prev: gaidOf(a.govActionId),
        removed: a.membersToRemove.map(cred),
        added: [...a.membersToAdd.entries()].map(([c, epoch]: [any, bigint]) => [cred(c), BigInt(epoch)]),
        threshold: [a.threshold.numerator, a.threshold.denominator]
      }
    case "NewConstitutionAction":
      return {
        type: "new_constitution",
        prev: gaidOf(a.govActionId),
        anchor: anchor(a.constitution.anchor)!,
        scriptHash: hashOf(a.constitution.scriptHash)
      }
    case "InfoAction":
      return { type: "info" }
    default:
      throw new Error(`review/decode: unmodelled governance action ${a._tag}`)
  }
}

const voterOf = (v: any): Voter => {
  switch (v._tag) {
    case "ConstitutionalCommitteeVoter":
      return { role: "committee_hot", cred: cred(v.credential) }
    case "DRepVoter":
      // ⚠️ Their DRepVoter holds a DRep, not a Credential. A DRep can be abstain/no-confidence,
      // which is not a voter — only the key/script forms reach here.
      return {
        role: "drep",
        cred: {
          hash: bytesOf(v.drep.scriptHash ?? v.drep.keyHash ?? v.drep),
          isScript: v.drep._tag === "ScriptHashDRep"
        }
      }
    default:
      return { role: "pool", keyHash: bytesOf(v.poolKeyHash) }
  }
}

/**
 * Each element of a CBOR array/set field, as its own exact span.
 *
 * @since 0.1.0
 */
export const elementSpans = (bytes: Uint8Array): Array<Uint8Array> => {
  // A Conway set is `#6.258([...])`; step past the tag before reading the array.
  let pos = 0
  if (bytes[0] === 0xd9 && bytes[1] === 0x01 && bytes[2] === 0x02) pos = 3
  const width = headWidth(bytes, pos)
  const head = bytes[pos]! & 0x1f
  let count = BigInt(head)
  if (head >= 24) {
    count = 0n
    for (let i = 1; i < width; i++) count = (count << 8n) | BigInt(bytes[pos + i]!)
  }
  let cursor = pos + width
  const out: Array<Uint8Array> = []
  for (let i = 0n; i < count; i++) {
    const next = endOf(bytes, cursor)
    out.push(bytes.subarray(cursor, next))
    cursor = next
  }
  return out
}

/** The exact span of body-map key `key`, or `undefined` when the key is absent. */
const bodyField = (bodyHex: string, key: bigint): Uint8Array | undefined => {
  const bytes = hexToBytes(bodyHex)
  const width = headWidth(bytes, 0)
  const head = bytes[0]! & 0x1f
  let count = BigInt(head)
  if (head >= 24) {
    count = 0n
    for (let i = 1; i < width; i++) count = (count << 8n) | BigInt(bytes[i]!)
  }
  let pos = width
  for (let i = 0n; i < count; i++) {
    const kWidth = headWidth(bytes, pos)
    const kHead = bytes[pos]! & 0x1f
    let k = BigInt(kHead)
    if (kHead >= 24) {
      k = 0n
      for (let j = 1; j < kWidth; j++) k = (k << 8n) | BigInt(bytes[pos + j]!)
    }
    pos += kWidth
    const next = endOf(bytes, pos)
    if (k === key) return bytes.subarray(pos, next)
    pos = next
  }
  return undefined
}

/**
 * The four structured body fields, each from the EXACT span it occupies.
 *
 * Exported because the review walk already holds those spans: a tier that re-found the field
 * would be a second body parser to keep in step with the first.
 *
 * @since 0.1.0
 */
export const certificatesFromSpan = (span: Uint8Array): Array<Certificate> =>
  elementSpans(span).map((s) => certificate(E.Certificate.fromCBORBytes(s)))

/** @since 0.1.0 */
export const mintFromSpan = (span: Uint8Array): Mint => {
  const m = E.Mint.fromCBORBytes(span)
  return [...m.map.entries()].map(([policy, assets]: [any, any]) => [
    bytesOf(policy),
    [...assets.entries()].map(([name, qty]: [any, bigint]) => [bytesOf(name), qty] as [Uint8Array, bigint])
  ])
}

/** @since 0.1.0 */
export const votingProceduresFromSpan = (span: Uint8Array): VotingProcedures => {
  const vp = E.VotingProcedures.fromCBORBytes(span)
  return [...vp.procedures.entries()].map(([voter, votes]: [any, any]) => [
    voterOf(voter),
    [...votes.entries()].map(
      ([gid, proc]: [any, any]) =>
        [{ txId: bytesOf(gid.transactionId), index: BigInt(gid.govActionIndex) }, voteProcedure(proc)] as [
          GovActionId,
          VotingProcedure
        ]
    )
  ])
}

/** @since 0.1.0 */
export const proposalProceduresFromSpan = (span: Uint8Array): Array<ProposalProcedure> => {
  // Each procedure's own span travels with it: `parameter_change` carries a protocol-parameter
  // update that must be reported as the bytes it arrived as, not as a re-encode.
  const spans = elementSpans(span)
  return E.ProposalProcedures.fromCBORBytes(span).procedures.map((p: any, i: number) => ({
    deposit: p.deposit,
    // ⚠️ Their `rewardAccount` is the BECH32 string (FromBech32); the view is the 29 raw bytes.
    rewardAccount: rewardAccountBytes(p.rewardAccount),
    govAction: govActionOf(p.governanceAction, spans[i]!),
    anchor: anchor(p.anchor)!
  }))
}

const fromSpan = <T>(bodyHex: string, key: bigint, decode: (span: Uint8Array) => T): T | undefined => {
  const span = bodyField(bodyHex, key)
  return span === undefined ? undefined : decode(span)
}

const witnessSet = (witnessHex: string): any => E.TransactionWitnessSet.fromCBORBytes(hexToBytes(witnessHex))

/** ⚠️ Their tag is a string literal; the view's is the CDDL integer. */
const REDEEMER_TAG: Record<string, number> = { spend: 0, mint: 1, cert: 2, reward: 3, vote: 4, propose: 5 }

/**
 * The Evolution-backed `Decode` implementation.
 *
 * @since 0.1.0
 */
export const makeEvolutionDecode = () => ({
  certificates: (bodyHex: string) => fromSpan(bodyHex, 4n, certificatesFromSpan),
  mint: (bodyHex: string) => fromSpan(bodyHex, 9n, mintFromSpan),
  votingProcedures: (bodyHex: string) => fromSpan(bodyHex, 19n, votingProceduresFromSpan),
  proposalProcedures: (bodyHex: string) => fromSpan(bodyHex, 20n, proposalProceduresFromSpan),

  nativeScripts: (witnessHex: string): Array<NativeScript> =>
    (witnessSet(witnessHex).nativeScripts ?? []).map(nativeScriptOf),

  datums: (witnessHex: string): Array<PlutusData> => (witnessSet(witnessHex).plutusData ?? []).map(plutusDataOf),

  redeemers: (witnessHex: string): Array<Redeemer> => {
    const rs = witnessSet(witnessHex).redeemers
    if (rs === undefined) return []
    return rs.toArray().map((r: any): Redeemer => {
      const tag = REDEEMER_TAG[r.tag]
      if (tag === undefined) throw new Error(`review/decode: unmodelled redeemer tag ${r.tag}`)
      return { tag, index: r.index, data: plutusDataOf(r.data), exUnits: [r.exUnits.mem, r.exUnits.steps] }
    })
  },

  plutusScripts: (witnessHex: string, version: 1 | 2 | 3): Array<Uint8Array> => {
    const w = witnessSet(witnessHex)
    const scripts = version === 1 ? w.plutusV1Scripts : version === 2 ? w.plutusV2Scripts : w.plutusV3Scripts
    return (scripts ?? []).map((sc: unknown) => bytesOf(sc))
  },

  plutusData: (itemHex: string): PlutusData => plutusDataOf(E.Data.fromCBORBytes(hexToBytes(itemHex)))
})
