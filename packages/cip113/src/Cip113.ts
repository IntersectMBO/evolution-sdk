/**
 * CIP-113 — programmable ("smart"/regulated) tokens, CONSUMER path.
 *
 * @since 0.1.0
 */

// //
// CIP-113 tokens can only change hands if a script succeeds — using only existing
// Plutus V2/V3 primitives (no hard fork). All programmable tokens are custodied at
// one shared spend script, `programmable_logic_base` (PLB); a holder's "smart wallet"
// is a PLB UTxO whose PAYMENT credential is the PLB script and whose STAKE credential
// is the user's own credential (that stake cred identifies the real owner). Spending a
// PLB UTxO delegates enforcement to a stake validator via the withdraw-zero pattern; for
// a transfer that is the `transfer` validator, which reads a sorted linked-list registry
// (reference inputs) and runs each moved token's substandard `transfer_logic`.
//
// PLB does NOT choose the delegate. It reads one credential — `plg_cred`, field 0 of the
// protocol-params datum — and requires that withdraw-0; the `programmable_logic_global`
// (PLG) DISPATCHER, parameterised by the three delegate hashes, then requires the delegate
// its own field-less redeemer names. The chain is
// `PLB -> params[plg_cred] -> PLG -> transfer | third_party | unfracking`, and every
// programmable transaction therefore carries two framework withdrawals, not one.
//
// That chain has been all three of its possible shapes inside one audit window: a PLG
// COORDINATOR hosting all three actions (`Cip113.V0_4_0`), PLB dispatching DIRECTLY to a
// delegate (`Cip113.V0_5_0_ALPHA_2` — what CF's live preview instance runs), and now the
// dispatcher again as a separate swappable script (`Cip113.LATEST`). All three are
// reachable; the descriptor decides, and `Cip113.V0_5_0_ALPHA_2` is the one with a
// deployment behind it.
//
// SCOPE: consumer-only — we HOLD and TRANSFER existing programmable
// tokens. We do NOT issue, register policies, or run admin (seize/freeze); no UPLC /
// applyParamsToScript anywhere (scripts are consumed pre-applied from the blueprint /
// registry). This module owns the read/spend byte structures + smart-wallet address +
// covering-node selection. The tx assembly facade (`buildTransferTx`) and ex-units
// evaluation are separate (Phase 1 / the ex-units seam).
//
// STATUS: Proposed-tier. CIP-0113 is an unmerged draft (CIPs PR #444, at the editors'
// "Last Check" stage) and the on-chain code is post-audit-fixes but the final audit report
// is unpublished; the on-chain `RegistryNode` has 7 fields (two more than the draft README).
// Shapes reproduced from the Aiken source `main` (2026-09-10, `7e8a631` = `0.5.0-alpha.4`,
// `../cip113-programmable-tokens`); re-verify on every upstream bump — the params-datum
// layout has now moved FOUR times inside the audit window, and the last move REMOVED fields
// and re-sorted the rest, so a stale positional parser reads the wrong credential rather
// than failing (see `cip113-versions.ts`). The ConstrPlutusData bytes are verified
// byte-exact vs CSL.

import type { Assets } from "@evolution-sdk/evolution"
import { Bytes, Data as PlutusDataCodec } from "@evolution-sdk/evolution"
import { Plan } from "@evolution-sdk/plan"
import { Analyze, Brands } from "@evolution-sdk/review"
import { Context, Data, Effect, Layer } from "effect"

import type { Cip113Error} from "./internal/Effects.js";
import { op, planAttempt } from "./internal/Effects.js"
import * as Encode from "./internal/Encode.js"
import type { Credential,Network  , ScriptHex } from "./Types.js"
import { KeyHashHex, PlutusDataHex } from "./Types.js"
import { type Cip113Version, LATEST } from "./Versions.js"

/** @since 0.1.0 */
export { Cip113Error } from "./internal/Effects.js"
/** @since 0.1.0 */
export type { Credential } from "./Types.js"
export type { Cip113Version } from "./Versions.js"
export { LATEST, V0_0_1, V0_3_0, V0_4_0, V0_5_0_ALPHA_2, V0_5_0_ALPHA_4, VERSIONS } from "./Versions.js"

// ── constants (lib/registry_node.ak, lib/types.ak) ──────────────────────────────

/** Absent credential — the empty-key sentinel (Aiken's `empty_vkey`). Used for fields a
 *  version omits (`minting_logic_script`), for the origin node's empty credentials, and as
 *  the `unfracking_logic_script` value that means "unfracking forbidden for this policy".
 *
 *  @since 0.1.0 */
export const ABSENT_CRED: Credential = { kind: "key", hashHex: "" }

/** Origin registry node key — empty bytestring, sorts before any 28-byte policy id. */
export const ORIGIN_NODE_KEY = ''
/** Sentinel `next` of the last node — 30 bytes of `0xff`, strictly greater than any
 *  28-byte policy id (Plutus treats the longer bytestring as greater on a prefix tie).
 *  The 30-byte length is load-bearing; do NOT normalise it to 28 bytes. */
export const SENTINEL_NEXT_KEY = 'ff'.repeat(30)
/** Token name of the issuance CBOR-hex reference NFT. */
export const ISSUANCE_CBOR_HEX_TOKEN_NAME = 'IssuanceCborHex'

// ── domain types ────────────────────────────────────────────────────────────────

/**
 * A registry node (`lib/registry_node.ak`), held as an inline datum at a registry
 * UTxO and read as a reference input. Field order is load-bearing (it is the CBOR
 * layout). `keyHex` is the policy id (28B) — or `ORIGIN_NODE_KEY` for the origin;
 * `nextHex` is the next policy id in ascending order — or `SENTINEL_NEXT_KEY` for
 * the last node. `globalStateCsHex` is `''` or a 28-byte policy id.
 *
 * `unfrackingLogicScript` is the issuer-declared unfracking hook (upstream `f16c857`,
 * "unfracking v2"): `ABSENT_CRED` (the empty-key sentinel, Aiken's `empty_vkey`) means
 * unfracking is FORBIDDEN for this policy — default-deny. A script credential delegates
 * to the issuer's hook validator; a key credential gives signature-gated unfracking.
 */
export interface RegistryNode {
  readonly keyHex: string
  readonly nextHex: string
  readonly mintingLogicScript: Credential
  readonly transferLogicScript: Credential
  readonly thirdPartyTransferLogicScript: Credential
  readonly unfrackingLogicScript: Credential
  readonly globalStateCsHex: string
}

/** A `RegistryProof` (PLG `TransferAct`): the moved policy's node is at reference-input
 *  index `nodeIdx` — `exists` when the policy IS in the registry, `notExists` when
 *  `nodeIdx` points at the covering node (`prev.key < policy < prev.next`). */
export interface RegistryProof {
  readonly kind: 'exists' | 'notExists'
  readonly nodeIdx: number
}

// ── encode: ConstrPlutusData builders ───────────────────────────────────────────

const credData = (cred: Credential): PlutusDataHex =>
  Encode.plutusDataConstr(cred.kind === "script" ? 1n : 0n, [Encode.plutusDataBytes(cred.hashHex)])

/** Encode a `RegistryNode` inline datum (`Constr 0`) for `version` (default `LATEST` = the
 *  7-field post-audit shape). Older versions omit `minting_logic_script` /
 *  `unfracking_logic_script` and shift the rest — the version descriptor's field layout
 *  drives the emitted order. */
export const registryNodeDatum = (
  node: RegistryNode,
  version: Cip113Version = LATEST
): Effect.Effect<string, Cip113Error> =>
  op("cip113RegistryNodeDatum", () => {
    const L = version.node
    // build the fields in this version's positional order
    const fields: Array<PlutusDataHex> = new Array(L.fieldCount)
    fields[L.key] = Encode.plutusDataBytes(node.keyHex)
    fields[L.next] = Encode.plutusDataBytes(node.nextHex)
    if (L.mintingLogic !== null) fields[L.mintingLogic] = credData(node.mintingLogicScript)
    fields[L.transferLogic] = credData(node.transferLogicScript)
    fields[L.thirdParty] = credData(node.thirdPartyTransferLogicScript)
    if (L.unfrackingLogic !== null) fields[L.unfrackingLogic] = credData(node.unfrackingLogicScript)
    fields[L.globalStateCs] = Encode.plutusDataBytes(node.globalStateCsHex)
    return Encode.plutusDataConstr(0n, fields)
  })

/** Encode one `RegistryProof` — `TokenExists{node_idx}` = `Constr 0 [int]`,
 *  `TokenDoesNotExist{node_idx}` = `Constr 1 [int]`. */
export const registryProofData = (proof: RegistryProof): Effect.Effect<string, Cip113Error> =>
  op("cip113RegistryProof", () => registryProofSync(proof))

const registryProofSync = (proof: RegistryProof): PlutusDataHex =>
  Encode.plutusDataConstr(proof.kind === "exists" ? 0n : 1n, [Encode.plutusDataInt(String(proof.nodeIdx))])

/** Encode the pre-split PLG `TransferAct{proofs}` redeemer (`Constr 0 [list RegistryProof]`) —
 *  one proof per moved policy, in the same order the tokens are processed. `V0_4_0` and
 *  earlier; `LATEST` prefixes a `params_idx` (see `transferRedeemer`). */
export const transferActRedeemer = (
  proofs: ReadonlyArray<RegistryProof>
): Effect.Effect<string, Cip113Error> =>
  op("cip113TransferAct", () =>
    Encode.plutusDataConstr(0n, [Encode.plutusDataList(proofs.map(registryProofSync))]))

/**
 * Encode the transfer withdraw-0 redeemer for `version`.
 *
 *  - `LATEST` — `TransferRedeemer { proofs }` = `Constr 0 [list]`, `paramsIdx` unused: the
 *    delegate reads no params datum any more, so it has nothing to index.
 *  - `V0_5_0_ALPHA_2` — `TransferRedeemer { params_idx, proofs }` = `Constr 0 [int, list]`.
 *  - `V0_4_0` / `V0_3_0` — `TransferAct { proofs }` = `Constr 0 [list]`, `paramsIdx` unused.
 *
 * `LATEST` and the pre-split shape encode IDENTICALLY. That is upstream's doing, not a
 * simplification here — see `TransferRedeemerShape`.
 *
 * `paramsIdx` is the params UTxO's position in the LEDGER-SORTED reference-input list
 * (sorted by outpoint), which the validator uses as a direct `list.expect_at` instead of
 * scanning — a wrong index simply fails the params-NFT check. `buildTransferTx` computes
 * it; supply it yourself only when hand-assembling.
 */
export const transferRedeemer = (
  args: { readonly paramsIdx: number; readonly proofs: ReadonlyArray<RegistryProof> },
  version: Cip113Version = LATEST
): Effect.Effect<string, Cip113Error> =>
  op("cip113TransferRedeemer", () => {
    const proofs = Encode.plutusDataList(args.proofs.map(registryProofSync))
    return version.transferRedeemer === "params-indexed"
      ? Encode.plutusDataConstr(0n, [Encode.plutusDataInt(String(args.paramsIdx)), proofs])
      : Encode.plutusDataConstr(0n, [proofs])
    // 'proofs-only' and 'transfer-act' share this branch because upstream gave them the same
    // bytes; the descriptor keeps them distinct so the next divergence is a one-line change.
  })

/** Which delegate a PLB spend trampolines to (`BaseSpendRedeemer`'s constructor). */
export type PlbDispatchArm = 'transfer' | 'thirdParty' | 'unfracking'

const DISPATCH_ALT: Readonly<Record<PlbDispatchArm, bigint>> = { transfer: 0n, thirdParty: 1n, unfracking: 2n }

/**
 * Encode the PLB spend redeemer for `version`.
 *
 *  - `LATEST` — `BaseSpendRedeemer { params_idx, wdrl_idx }` = `Constr 0 [int, int]`. PLB
 *    chooses nothing: `wdrlIdx` witnesses where the DISPATCHER's credential (`plg_cred`,
 *    params field 0) sits in the ledger-ordered withdrawal map. `arm` is ignored — which
 *    action this is, is the dispatcher's redeemer to say (`plgDispatchRedeemer`).
 *  - `V0_5_0_ALPHA_2` — `BaseSpendRedeemer` = `Constr 0|1|2 [params_idx, wdrl_idx]`, naming
 *    the delegate and witnessing where THAT delegate's credential sits.
 *  - `V0_4_0` / `V0_3_0` — PLB ignored its redeemer; a Plutus unit (`Constr 0 []`).
 *
 * ⚠️ `LATEST` and `V0_5_0_ALPHA_2`'s TRANSFER arm are the same bytes, so passing the wrong
 * descriptor here does not fail to encode or to decode — it fails on chain as a withdrawal
 * mismatch, because the two versions index different credentials. The seize and unfracking
 * arms (constructors 1/2) do fail to decode on `LATEST`.
 *
 * Self-validating on-chain: a wrong `wdrl_idx` resolves to some other credential, so a
 * dishonest witness can only invalidate its own tx. It is still ours to get right — see
 * `withdrawalIndexOf` for the ordering rule, which is NOT the order the withdrawals map is
 * serialised in.
 */
export const plbSpendRedeemer = (
  args: { readonly arm: PlbDispatchArm; readonly paramsIdx: number; readonly wdrlIdx: number },
  version: Cip113Version = LATEST
): Effect.Effect<PlutusDataHex, Cip113Error> =>
  op("cip113PlbSpendRedeemer", () => {
    const idxs = [Encode.plutusDataInt(String(args.paramsIdx)), Encode.plutusDataInt(String(args.wdrlIdx))]
    switch (version.plbSpendRedeemer) {
      case "params-wdrl":
        return Encode.plutusDataConstr(0n, idxs)
      case "dispatch":
        return Encode.plutusDataConstr(DISPATCH_ALT[args.arm], idxs)
      case "unit":
        return Encode.plutusDataConstr(0n, [])
    }
  })

/**
 * Encode the `programmable_logic_global` DISPATCHER's withdraw-0 redeemer —
 * `TransferAct` / `ThirdPartyAct` / `UnfrackingAct` as constructors 0 / 1 / 2, all field-less.
 *
 * `'plg-dispatcher'` versions (`LATEST`) only. This is where the ACTION is named now: PLB
 * carries indices and nothing else, and the dispatcher — parameterised by the three delegate
 * hashes — requires the withdraw-0 of whichever delegate this arm selects. A redeemer naming
 * an action whose delegate is not withdrawn from can only invalidate its own transaction.
 *
 * Everything the delegate needs (proofs, node indices, output offsets) travels in the
 * DELEGATE's redeemer; duplicating any of it here would be a second unchecked claim about the
 * same fact, which is why these arms are empty.
 */
export const plgDispatchRedeemer = (arm: PlbDispatchArm): Effect.Effect<string, Cip113Error> =>
  op("cip113PlgDispatchRedeemer", () => Encode.plutusDataConstr(DISPATCH_ALT[arm], []))

/** The three positional indices a `third_party` (seize / clawback / freeze) or `unfracking`
 *  withdraw-0 redeemer carries. Both types have the identical wire shape. */
export interface DelegateIndices {
  /** the params UTxO's position in the ledger-sorted reference inputs. Emitted only where the
   *  version's `delegateRedeemer` is `'params-node-outputs'`; ignored on `LATEST`. */
  readonly paramsIdx: number
  /** the acted-on policy's registry node, likewise in the sorted reference inputs. */
  readonly registryNodeIdx: number
  /** the first output of the positionally-paired continuing outputs. */
  readonly outputsStartIdx: number
}

const delegateIndicesSync = (i: DelegateIndices, version: Cip113Version): string =>
  Encode.plutusDataConstr(0n, [
    ...(version.delegateRedeemer === "params-node-outputs" ? [Encode.plutusDataInt(String(i.paramsIdx))] : []),
    Encode.plutusDataInt(String(i.registryNodeIdx)),
    Encode.plutusDataInt(String(i.outputsStartIdx))
  ])

/** Encode `ThirdPartyRedeemer` — the standalone seize/clawback/freeze withdraw-0.
 *
 *  - `LATEST` — `{ registry_node_idx, outputs_start_idx }`; `paramsIdx` is ignored, because
 *    the delegate no longer reads the params datum.
 *  - `V0_5_0_ALPHA_2` — `{ params_idx, registry_node_idx, outputs_start_idx }`.
 *  - Before the PLG split there was no such validator: this was the coordinator's
 *    `ThirdPartyAct` arm.
 *
 *  We do not BUILD seizure transactions — this exists so a caller assembling one, and our
 *  differential harness, share one encoder. */
export const thirdPartyRedeemer = (
  indices: DelegateIndices,
  version: Cip113Version = LATEST
): Effect.Effect<string, Cip113Error> =>
  op("cip113ThirdPartyRedeemer", () => delegateIndicesSync(indices, version))

/** Encode `UnfrackingRedeemer` — the holder-driven same-owner PLB restructuring withdraw-0.
 *  Same wire shape as `thirdPartyRedeemer` at every version; kept separate because they are
 *  distinct on-chain types. */
export const unfrackingRedeemer = (
  indices: DelegateIndices,
  version: Cip113Version = LATEST
): Effect.Effect<string, Cip113Error> =>
  op("cip113UnfrackingRedeemer", () => delegateIndicesSync(indices, version))

// ── decode: RegistryNode from an inline datum ───────────────────────────────────

/** What a decoded item IS, for an error message that names the shape it found. */
const kindOf = (d: PlutusDataCodec.Data): string =>
  d instanceof Uint8Array
    ? "bytes"
    : typeof d === "bigint"
    ? "int"
    : d instanceof globalThis.Map
    ? "map"
    : Array.isArray(d)
    ? "list"
    : d instanceof PlutusDataCodec.Constr
    ? "constr"
    : typeof d

const asBytesHex = (pd: PlutusDataCodec.Data): string => {
  if (!(pd instanceof Uint8Array)) throw new Error(`expected plutus bytes, got ${kindOf(pd)}`)
  return Bytes.toHex(pd)
}

/** The widest integer a canonical CBOR uint / nint carries. Anything outside needs the
 *  tag 2/3 bignum form. */
const UINT64_MAX = (1n << 64n) - 1n
const NINT64_MIN = -(1n << 64n)

/**
 * A plutus integer.
 *
 * The >64-bit form (CBOR tag 2/3) is impossible for the one integer field the protocol
 * carries, so it is rejected rather than silently reinterpreted.
 *
 * ⚠️ The refusal is on MAGNITUDE here, not on the encoding. Evolution's CBOR reader resolves
 * tag 2 and tag 3 to `bigint` inside the decoder, so above it the encoding form is not
 * observable at all — which means a tag-2 encoding of a SMALL number is accepted here and
 * refused by the decoder this was lifted from. Every value that actually requires the bignum
 * form is still refused by both. The difference is asserted in the port differential rather
 * than left to be discovered.
 */
const asInt = (pd: PlutusDataCodec.Data): bigint => {
  if (typeof pd !== "bigint") throw new Error(`expected plutus int, got ${kindOf(pd)}`)
  if (pd > UINT64_MAX || pd < NINT64_MIN) throw new Error(`expected plutus int, got bigint`)
  return pd
}

const asConstr = (pd: PlutusDataCodec.Data): PlutusDataCodec.Constr => {
  if (!(pd instanceof PlutusDataCodec.Constr)) throw new Error(`expected plutus constr, got ${kindOf(pd)}`)
  return pd
}

const asCredential = (pd: PlutusDataCodec.Data): Credential => {
  if (!(pd instanceof PlutusDataCodec.Constr) || pd.fields.length !== 1) {
    throw new Error("expected Credential Constr with 1 field")
  }
  if (pd.index !== 0n && pd.index !== 1n) throw new Error(`Credential alt must be 0 or 1, got ${pd.index}`)
  return { kind: pd.index === 1n ? "script" : "key", hashHex: asBytesHex(pd.fields[0]!) }
}

/** Decode an Aiken `Option<Credential>`: `Some(c)` = `Constr 0 [cred]`, `None` = `Constr 1 []`.
 *  Returns `null` for `None` — the field exists and nominates nobody, which is not the same
 *  fact as the field being absent. */
const asOptionCredential = (pd: PlutusDataCodec.Data): Credential | null => {
  if (!(pd instanceof PlutusDataCodec.Constr)) throw new Error(`expected Option Constr, got ${kindOf(pd)}`)
  if (pd.index === 1n && pd.fields.length === 0) return null
  if (pd.index === 0n && pd.fields.length === 1) return asCredential(pd.fields[0]!)
  throw new Error(`not an Option<Credential>: Constr ${pd.index} with ${pd.fields.length} field(s)`)
}

/**
 * Decode a `RegistryNode` inline datum (raw plutus_data hex) for `version` (default
 * `LATEST` = the 7-field post-audit shape). Fields are read at this version's positions;
 * fields absent in the version (`minting_logic_script` / `unfracking_logic_script` in older
 * schemas) come back as `ABSENT_CRED`. A datum with MORE than the version's field count
 * still decodes (the on-chain code only reads leading positional fields); fewer fails.
 * Pass `Cip113.V0_3_0` to read the live easy1staking/CF preprod deployment.
 */
export const decodeRegistryNode = (
  datumHex: string,
  version: Cip113Version = LATEST
): Effect.Effect<RegistryNode, Analyze.DecodeError> =>
  Effect.try({
    try: (): RegistryNode => {
      const L = version.node
      const pd = asConstr(PlutusDataCodec.fromCBORHex(datumHex))
      if (pd.index !== 0n) throw new Error("RegistryNode must be Constr 0")
      const f = pd.fields
      if (f.length < L.fieldCount) {
        throw new Error(`RegistryNode (${version.id}) needs ${L.fieldCount} fields, got ${f.length}`)
      }
      return {
        keyHex: asBytesHex(f[L.key]!),
        nextHex: asBytesHex(f[L.next]!),
        mintingLogicScript: L.mintingLogic === null ? ABSENT_CRED : asCredential(f[L.mintingLogic]!),
        transferLogicScript: asCredential(f[L.transferLogic]!),
        thirdPartyTransferLogicScript: asCredential(f[L.thirdParty]!),
        unfrackingLogicScript: L.unfrackingLogic === null ? ABSENT_CRED : asCredential(f[L.unfrackingLogic]!),
        globalStateCsHex: asBytesHex(f[L.globalStateCs]!)
      }
    },
    catch: (e) =>
      new Analyze.DecodeError({
        op: "cip113DecodeRegistryNode",
        message: e instanceof Error ? e.message : String(e)
      })
  })

/** The protocol-params inline datum carried by the params UTxO (`ProgrammableLogicGlobalParams`
 *  up to `0.5.0-alpha.2`, `ProtocolParams` from `0.5.0-alpha.4`).
 *
 *  EVERY field is optional, including the two that were mandatory for the protocol's whole
 *  history: `0.5.0-alpha.4` removed `registry_node_cs` and `prog_logic_cred` from the datum
 *  outright, because neither had an on-chain reader left. Which fields exist, and at which
 *  index, is the version's `GlobalParamsLayout`. */
export interface GlobalParamsDatum {
  /** currency symbol of the registry-node NFTs. Absent from `LATEST` — the merged `registry`
   *  reads the policy off its own address. Take it from the deployment record instead. */
  readonly registryNodeCsHex?: string
  /** the PLB payment credential. Absent from `LATEST` — a compile-time parameter of the
   *  delegates now. Take it from the deployment record instead. */
  readonly progLogicCred?: Credential
  /** the DISPATCHER's withdraw-0 credential (`LATEST`, field 0) — the one credential PLB
   *  reads, and the one every programmable spend must withdraw from. */
  readonly plgCred?: Credential
  /** the replaceable `issuance_logic` withdraw-0 credential (`LATEST`, field 1). */
  readonly issuanceLogicCred?: Credential
  /** the `transfer` withdraw-0 credential — the live, swappable transfer delegate. */
  readonly transferCred?: Credential
  /** the standalone `third_party` (seize / clawback / freeze) withdraw-0 credential. */
  readonly thirdPartyCred?: Credential
  readonly unfrackingCred?: Credential
  /** the upgrade-authority withdraw-0 credential (read only on an upgrade transaction). */
  readonly upgradeCred?: Credential
  /** the NOMINATED next upgrade authority. `null` = the field exists and is `None` (no
   *  handover in flight); `undefined` = this version has no such field at all. The two are
   *  different facts and are not collapsed. */
  readonly pendingUpgradeCred?: Credential | null
  /** max serialised bytes of an inline datum on a PLB output (issue #106 vector 3). Absent
   *  from `LATEST`: it is a compile-time parameter of the four output-creating validators, so
   *  it is a property of the DEPLOYMENT, not of chain state. */
  readonly maxInlineDatumBytes?: bigint
}

/**
 * Decode the protocol-params inline datum (raw plutus_data hex) for `version` (default
 * `LATEST`). Every field is read at the version's declared index. A datum with MORE fields
 * than the version declares still decodes — the on-chain code reads by index too, and a live
 * deployment may be a later revision than the descriptor asked for.
 *
 * ⚠️ **NO field is stable across revisions, and a successful decode proves nothing.** Not even
 * field 0: revisions APPENDED up to `f16c857`, the PLG split REORDERED the tail, and
 * `0.5.0-alpha.4` REMOVED four fields and re-sorted the rest by read frequency. Two concrete
 * misreads, both real:
 *
 *  - `V0_4_0` against an `alpha.2` datum decodes fine and returns `transfer_cred` labelled
 *    `unfrackingCred` (index 2 changed meaning).
 *  - `alpha.2` against an `alpha.4` datum is loud — but on ARITY, not on a field: alpha.4
 *    removed four fields, so the datum carries 6 where alpha.2 wants 7. ⚠️ That is an
 *    accident of this pair of revisions, and the next one to APPEND a field undoes it. What
 *    stands behind the count is field 0's type check (a `Credential` where a `ByteArray` was
 *    expected), which only catches a reorder that also changed a type.
 *
 * Pick the descriptor from the deployment record, never from whether the decode threw.
 */
export const decodeGlobalParams = (
  datumHex: string,
  version: Cip113Version = LATEST
): Effect.Effect<GlobalParamsDatum, Analyze.DecodeError> =>
  Effect.try({
    try: (): GlobalParamsDatum => {
      const P = version.params
      const pd = asConstr(PlutusDataCodec.fromCBORHex(datumHex))
      if (pd.index !== 0n) throw new Error("ProgrammableLogicGlobalParams must be Constr 0")
      const f = pd.fields
      if (f.length < P.fieldCount) {
        throw new Error(`ProgrammableLogicGlobalParams (${version.id}) needs ${P.fieldCount} fields, got ${f.length}`)
      }
      const credAt = (i: number | null): Credential | undefined => (i === null ? undefined : asCredential(f[i]!))
      const bound = P.maxInlineDatumBytes === null ? undefined : asInt(f[P.maxInlineDatumBytes]!)
      const pending = P.pendingUpgradeCred === null ? undefined : asOptionCredential(f[P.pendingUpgradeCred]!)
      return {
        ...optional("registryNodeCsHex", P.registryNodeCs === null ? undefined : asBytesHex(f[P.registryNodeCs]!)),
        ...optional("progLogicCred", credAt(P.progLogicCred)),
        ...optional("plgCred", credAt(P.plgCred)),
        ...optional("issuanceLogicCred", credAt(P.issuanceLogicCred)),
        ...optional("transferCred", credAt(P.transferCred)),
        ...optional("thirdPartyCred", credAt(P.thirdPartyCred)),
        ...optional("unfrackingCred", credAt(P.unfrackingCred)),
        ...optional("upgradeCred", credAt(P.upgradeCred)),
        ...optional("pendingUpgradeCred", pending),
        ...optional("maxInlineDatumBytes", bound)
      }
    },
    catch: (e) =>
      new Analyze.DecodeError({
        op: "cip113DecodeGlobalParams",
        message: e instanceof Error ? e.message : String(e)
      })
  })

/** Spread-in an optional property only when it has a value (keeps `exactOptionalPropertyTypes` happy). */
const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

// ── smart-wallet address + PLG reward account (pure header-byte construction) ────

/**
 * Smart-wallet (PLB) address bytes (hex): PAYMENT credential = the PLB script hash,
 * STAKE credential = the user's own credential (a base address). The stake cred is
 * what identifies the real owner. `stakeCred.kind` selects the header type (key →
 * type 1, script → type 3).
 */
export const smartWalletAddressHex = (
  net: Network,
  plbScriptHashHex: string,
  stakeCred: Credential
): Brands.AddressHex => Encode.baseScriptHex(net, plbScriptHashHex, stakeCred)

/** A delegate's reward account (hex) — the withdrawals-map key for the withdraw-zero that
 *  forces that stake validator to run (`rewardScriptHex` over its script hash). Used for
 *  the `transfer` / `third_party` / `unfracking` delegates and for each substandard's
 *  `transfer_logic`. */
export const delegateRewardAccountHex = (net: Network, scriptHashHex: string): string =>
  Encode.rewardScriptHex(net, scriptHashHex)

/** @deprecated The PLG coordinator was dissolved upstream (`342c47d`); for a transfer this
 *  is the `transfer` validator's account. Identical behaviour — prefer
 *  `delegateRewardAccountHex`, which is not named after a validator that no longer exists. */
export const plgRewardAccountHex = delegateRewardAccountHex

// ── ledger withdrawal ordering (pure) ───────────────────────────────────────────
//
// `wdrl_idx` in a `BaseSpendRedeemer` is a position in the withdrawal set AS THE PLUTUS
// SCRIPT CONTEXT SEES IT, and that is NOT the order the withdrawals map is serialised in.
//
//   - the tx body's withdrawals map is canonical CBOR: sorted by the encoded reward-account
//     BYTES, so a key-stake account (header 0xe…) sorts before a script-stake one (0xf…);
//   - the script context's `withdrawals` is built from the ledger's `Map RewardAccount Coin`,
//     ordered by `Ord RewardAccount` = network, then `Ord Credential`. `Credential`'s
//     constructors are `ScriptHashObj | KeyHashObj` in that order, so SCRIPT credentials
//     sort BEFORE key credentials, bytewise within each kind.
//
// The two orders coincide only when every withdrawal is the same kind — which is true of
// every transfer we build (all delegates are scripts), and is exactly why getting it wrong
// would stay invisible until the first tx that mixes a signature-gated hook in.
// Upstream states the same rule for `wdrl_idx` derivation (PR #110 review follow-ups).

/** Kind + hash of a withdrawal's stake credential, as the ledger orders them. */
export interface WithdrawalKey {
  readonly rewardAcctHex: string
  readonly cred: Credential
}

/** Order two withdrawal keys the way the ledger's `Map RewardAccount Coin` does: script
 *  credentials before key credentials, bytewise within each kind. Returns <0 / 0 / >0. */
export const compareWithdrawalKeys = (a: WithdrawalKey, b: WithdrawalKey): number => {
  if (a.cred.kind !== b.cred.kind) return a.cred.kind === 'script' ? -1 : 1
  return compareHexBytes(a.cred.hashHex, b.cred.hashHex)
}

/**
 * The position of `rewardAcctHex` in the ledger-ordered withdrawal set — the `wdrl_idx` a
 * `BaseSpendRedeemer` witnesses. Returns -1 if the account is not in the set.
 *
 * Pass the COMPLETE withdrawal set of the transaction, not just the framework's own: the
 * index is over everything the script context will contain.
 */
export const withdrawalIndexOf = (withdrawals: ReadonlyArray<WithdrawalKey>, rewardAcctHex: string): number =>
  [...withdrawals].sort(compareWithdrawalKeys).findIndex((w) => w.rewardAcctHex === rewardAcctHex)

// ── covering-node selection (pure) ──────────────────────────────────────────────

/**
 * Compare two hex-encoded bytestrings with Plutus `less_than_bytearray` semantics:
 * lexicographic by byte, and on a shared-prefix tie the SHORTER string is smaller.
 * Returns <0 / 0 / >0. Empty (`ORIGIN_NODE_KEY`) is smallest; `SENTINEL_NEXT_KEY`
 * (30 bytes) is greater than any 28-byte policy id.
 */
export const compareHexBytes = (a: string, b: string): number => {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 2) {
    const x = parseInt(a.slice(i, i + 2), 16)
    const y = parseInt(b.slice(i, i + 2), 16)
    if (x !== y) return x - y
  }
  return a.length - b.length
}

/** The registry node that proves membership (`exists`) or non-membership (`notExists`,
 *  the covering node) of `tokenPolicyHex`. */
export interface CoveringSelection {
  readonly kind: 'exists' | 'notExists'
  readonly node: RegistryNode
}

/**
 * Select the registry node proving where `tokenPolicyHex` sits in the sorted linked
 * list: the exact node if the policy is registered, else the covering node
 * (`node.key < policy < node.next`). Throws if the supplied `nodes` don't cover it
 * (an incomplete registry view).
 */
export const selectCoveringNode = (nodes: ReadonlyArray<RegistryNode>, tokenPolicyHex: string): CoveringSelection => {
  const exact = nodes.find((n) => n.keyHex === tokenPolicyHex)
  if (exact) return { kind: 'exists', node: exact }
  const covering = nodes.find(
    (n) => compareHexBytes(n.keyHex, tokenPolicyHex) < 0 && compareHexBytes(tokenPolicyHex, n.nextHex) < 0,
  )
  if (!covering) throw new Error(`no covering registry node for policy ${tokenPolicyHex}`)
  return { kind: 'notExists', node: covering }
}

/** The reference-input node set + per-policy proofs a `TransferAct` needs. */
export interface TransferProofPlan {
  /** The distinct registry nodes to include as reference inputs, in this order. */
  readonly refNodes: ReadonlyArray<RegistryNode>
  /** One proof per moved policy (aligned to `movedPolicies`); `nodeIdx` indexes
   *  `refNodes`. NOTE: the ledger canonically sorts `reference_inputs` by outpoint,
   *  so the tx-assembly step must REMAP each `nodeIdx` to the node's absolute index
   *  in the final sorted reference-input list once the outpoints are known. */
  readonly proofs: ReadonlyArray<RegistryProof>
}

/**
 * Plan the registry proofs for a transfer moving `movedPolicies`. Selects the
 * covering node for each policy, deduplicates the nodes into a minimal reference-input
 * set, and emits one `RegistryProof` per moved policy (in `movedPolicies` order) with
 * `nodeIdx` into `refNodes`. See `TransferProofPlan.proofs` for the index-remap caveat.
 */
export const planTransferProofs = (
  nodes: ReadonlyArray<RegistryNode>,
  movedPolicies: ReadonlyArray<string>,
): TransferProofPlan => {
  const refNodes: Array<RegistryNode> = []
  const proofs: Array<RegistryProof> = []
  for (const policy of movedPolicies) {
    const sel = selectCoveringNode(nodes, policy)
    let idx = refNodes.indexOf(sel.node)
    if (idx < 0) {
      idx = refNodes.length
      refNodes.push(sel.node)
    }
    proofs.push({ kind: sel.kind, nodeIdx: idx })
  }
  return { refNodes, proofs }
}

// ════════════════════════════════════════════════════════════════════════════════
// buildTransferTx — assemble an UNSIGNED CIP-113 transfer transaction (Phase 1).
//
// Composes the plan engine into the withdraw-zero shape the on-chain validators
// require (verified against the Aiken source):
//   - each spent PLB "smart-wallet" UTxO is a mandatory input with a spend redeemer
//     (tag 0) carrying `BaseSpendRedeemer { params_idx, wdrl_idx }` — where the DISPATCHER's
//     credential sits in the withdrawal set as the SCRIPT CONTEXT orders it (script creds
//     before key creds, bytewise within each), which is not the map's serialisation order;
//   - a 0-coin withdrawal from the dispatcher's stake account with the field-less
//     `TransferAct` reward redeemer (tag 3);
//   - a 0-coin withdrawal from the `transfer` validator's stake account with the
//     `TransferRedeemer { proofs }` reward redeemer (tag 3), carrying one `RegistryProof`
//     per moved policy;
//   - a 0-coin withdrawal from each moved-AND-registered policy's `transfer_logic`
//     script, each with the caller-supplied substandard reward redeemer;
//   - reference inputs = the protocol-params UTxO + the covering registry nodes; each
//     proof's `node_idx` — and `params_idx` — is an absolute position in the
//     LEDGER-SORTED reference-input list (sorted by outpoint), which this facade computes;
//   - required_signers (body 14) for every PLB input owned by a key credential;
//   - every PLB output stays seizable: no datum hash, no reference script, inline datum
//     within `max_inline_datum_bytes` (upstream #106).
//
// On `V0_5_0_ALPHA_2` the same facade emits the PLB-dispatch shape: no dispatcher
// withdrawal, a three-arm PLB redeemer whose `wdrl_idx` names the transfer delegate, and a
// `TransferRedeemer { params_idx, proofs }`. On `V0_4_0` / `V0_3_0` it emits the pre-split
// shape: a unit PLB redeemer and a `TransferAct { proofs }` withdrawal against the PLG
// coordinator.
//
// SCOPE (Phase 1): unsigned assembly only. Scripts are consumed PRE-APPLIED (caller
// supplies the CBOR, in the witness set here). Ex-units are CALLER-SUPPLIED (the
// ex-units seam is Phase 2). Registry/PLB UTxOs are caller-supplied (query seam is
// Phase 2). A signer/hardware device completes the returned unsigned tx.
// ════════════════════════════════════════════════════════════════════════════════

/** A PLB "smart-wallet" UTxO being spent (payment cred = the PLB script; stake cred =
 *  its owner). `owner` key → must sign (goes into required_signers); script → must be
 *  withdrawn (the caller lists it among `substandards` / it is the token's transfer_logic). */
export interface PlbInput {
  readonly txHash: Brands.TxHashHex
  readonly index: number
  readonly assets: Assets.Assets
  readonly owner: Credential
  /** ex-units for this PLB spend redeemer (PLB is trivial; a small budget). */
  readonly exUnits: readonly [bigint, bigint]
  /** the UTxO's inline datum, if any (PLB datum is `Option<Data>`; usually absent). */
  readonly datumHex?: PlutusDataHex
}

/** A recipient PLB output — the moved value re-locked at the recipient's smart wallet
 *  (payment cred = the PLB script, stake cred = `recipient`). */
export interface PlbOutput {
  readonly recipient: Credential
  readonly assets: Assets.Assets
  readonly datumHex?: PlutusDataHex
}

/** A registry node UTxO available as a reference input (its outpoint + decoded content). */
export interface RegistryNodeRef {
  readonly txHash: Brands.TxHashHex
  readonly index: number
  readonly node: RegistryNode
}

/** A substandard `transfer_logic` withdraw-zero invocation invocation, keyed by its script hash
 *  (matched to a moved policy's `transferLogicScript`). Pre-applied script + redeemer. */
export interface Substandard {
  readonly scriptHashHex: string
  readonly scriptHex: ScriptHex
  readonly redeemerDataHex: string
  readonly exUnits: readonly [bigint, bigint]
}

/** An outpoint (reference input / collateral). */
export interface OutPoint {
  readonly txHash: Brands.TxHashHex
  readonly index: number
}

export interface TransferRequest {
  readonly network: Network
  readonly params: Plan.ProtocolParams
  /** PLB payment credential (`prog_logic_cred`) + its pre-applied spend script (V3). */
  readonly plbScriptHashHex: string
  readonly plbScriptHex: ScriptHex
  /**
   * The `transfer` withdraw-0 validator: its stake credential (the withdraw-zero account)
   * + its pre-applied stake script (V3).
   *
   * ⚠️ RENAMED from `plgScriptHashHex` / `plgScriptHex` / `plgExUnits`. Upstream dissolved
   * the PLG coordinator (`342c47d`), and this is the validator that replaced it on the
   * transfer path. The rename is deliberately a COMPILE ERROR rather than an alias: PLB's
   * hash also changed, so every programmable-token address moved and every measured budget
   * is stale — a caller must revisit its deployment, not just its field names.
   *
   * For `V0_4_0` / `V0_3_0` these carry the PLG coordinator, unchanged.
   */
  readonly transferScriptHashHex: string
  readonly transferScriptHex: ScriptHex
  /** ex-units for the transfer withdraw-0 reward redeemer. */
  readonly transferExUnits: readonly [bigint, bigint]
  /**
   * The `programmable_logic_global` DISPATCHER — its stake credential, its pre-applied stake
   * script (V3), and the ex-units for its withdraw-0.
   *
   * REQUIRED when `version.dispatch === 'plg-dispatcher'` (`LATEST`), rejected otherwise. This
   * is the extra withdrawal `0.5.0-alpha.4` puts in every programmable transaction, and it is
   * what PLB's `wdrl_idx` witnesses — the transfer delegate is now reached THROUGH it.
   *
   * Take the hash from the params datum's `plgCred`, not from the deployment record: the
   * dispatcher is swappable in place, so the chain is its authority (`Cip113Deployment
   * .plgScriptHashHex` is the expectation to compare against, not the input to use).
   */
  readonly plgScriptHashHex?: string
  readonly plgScriptHex?: ScriptHex
  readonly plgExUnits?: readonly [bigint, bigint]
  /** the protocol-params UTxO (reference input; carries the `ProgrammableLogicGlobalParams` datum). */
  readonly protocolParamsRef: OutPoint
  /**
   * Extra reference inputs the transaction needs for reasons of its own — above all CIP-33
   * reference scripts, so the framework validators need not travel in the witness set.
   *
   * They join the canonical sort with everything else, which SHIFTS `params_idx` and every
   * proof's `node_idx`; this facade recomputes both, so a caller only lists the outpoints.
   *
   * Unavailable until now for a specific reason: before upstream `9db7e06`, the params
   * lookup scanned `reference_inputs` and ABORTED on the first Ada-only one, so a reference
   * script that happened to sort before the params UTxO bricked the transaction — ordering
   * no builder controls (upstream #103). The index-based lookup removed the hazard; ⚠️ nothing
   * here holds it removed, because the harness that did was never part of this repository.
   */
  readonly extraReferenceInputs?: ReadonlyArray<OutPoint>
  /** registry nodes available to prove membership/non-membership of the moved policies. */
  readonly registryNodes: ReadonlyArray<RegistryNodeRef>
  /** the policy ids being moved (one `RegistryProof` is emitted per entry, in this order). */
  readonly movedPolicies: ReadonlyArray<string>
  /** transfer_logic substandards for the moved-and-registered policies (deduped by script hash). */
  readonly substandards: ReadonlyArray<Substandard>
  readonly plbInputs: ReadonlyArray<PlbInput>
  readonly plbOutputs: ReadonlyArray<PlbOutput>
  /** ordinary key UTxOs funding the fee + collateral. */
  readonly fundingInputs: ReadonlyArray<Plan.PlanInput>
  readonly collateral: ReadonlyArray<OutPoint>
  readonly changeAddressHex: Brands.AddressHex
  /** Plutus cost models (flattened) for the script_data_hash + fee. */
  readonly costModels: ReadonlyArray<{ readonly language: number; readonly costs: ReadonlyArray<bigint> }>
  /** on-chain schema revision to build for (default `LATEST`). Decides PLB's redeemer and
   *  the transfer redeemer's wire shape. */
  readonly version?: Cip113Version
  /**
   * `max_inline_datum_bytes` from the live params datum (`LATEST` field 6). When supplied,
   * every PLB output's inline datum is checked against it and an over-bound datum fails as
   * a `Plan.BuildError` here rather than as a phase-2 script failure on the node.
   *
   * Omit only if you do not have the params datum: the bound is then unchecked, and an
   * over-bound datum builds fine and is rejected on submission.
   */
  readonly maxInlineDatumBytes?: bigint
}

// Ledger canonical reference-input ordering: by txHash bytes then index.
const byOutpoint = (a: OutPoint, b: OutPoint): number =>
  a.txHash < b.txHash ? -1 : a.txHash > b.txHash ? 1 : a.index - b.index

/** `Constr(0, [])` — the void inline datum a programmable output normally carries. */
const VOID_INLINE_DATUM = "d87980"

/**
 * Assemble the unsigned CIP-113 `TransferAct` transaction. The returned `Plan.UnsignedPlanTx`
 * (body + witness companions) is completed by a signer/hardware device. Throws (typed
 * `Plan.BuildError`) if a moved policy has no covering registry node or a registered policy's
 * `transfer_logic` has no matching substandard.
 */
export const buildTransferTx = (
  req: TransferRequest
): Effect.Effect<Plan.UnsignedPlanTx, Plan.BuildError | Cip113Error> =>
  Effect.gen(function* () {
    const net = req.network
    const version = req.version ?? LATEST

    // ── reference inputs: protocol-params + the covering registry nodes ──
    // Select each moved policy's covering node, dedup to the reference-node set, then
    // sort ALL reference inputs (params + nodes) by outpoint to match the ledger, and
    // read each node's absolute index back out for its RegistryProof.
    // ⚠️ `selectCoveringNode` THROWS on an uncovered policy, and an incomplete registry view is
    // the realistic way to get one (a paged indexer, a node registered between pages). Unwrapped,
    // the throw escaped this Effect as a defect, so the `Plan.BuildError` this function's type
    // promises was not what a caller got and `Effect.either` / `catchTag` did not see it.
    const selections = yield* planAttempt(() =>
      req.movedPolicies.map((p) => ({ policy: p, sel: selectCoveringNode(req.registryNodes.map((r) => r.node), p) }))
    )
    const refNodeByPolicy = new Map<string, RegistryNodeRef>()
    for (const { policy, sel } of selections) {
      const ref = req.registryNodes.find((r) => r.node === sel.node)!
      refNodeByPolicy.set(policy, ref)
    }
    const distinctRefs = [...new Set([...refNodeByPolicy.values()])]
    const allRefInputs: Array<OutPoint> = [
      req.protocolParamsRef,
      ...distinctRefs.map((r) => ({ txHash: Brands.TxHashHex(r.txHash), index: r.index })),
      ...(req.extraReferenceInputs ?? []),
    ]
    const sortedRefInputs = [...allRefInputs].sort(byOutpoint)
    const refIndexOf = (o: OutPoint): number => sortedRefInputs.findIndex((x) => x.txHash === o.txHash && x.index === o.index)

    // ── registry proofs: node_idx = the node's absolute position in sorted ref inputs ──
    const proofs: Array<RegistryProof> = selections.map(({ policy, sel }) => {
      const ref = refNodeByPolicy.get(policy)!
      return { kind: sel.kind, nodeIdx: refIndexOf({ txHash: Brands.TxHashHex(ref.txHash), index: ref.index }) }
    })
    // `params_idx` — the same derivation the delegates use: a direct `list.expect_at` into
    // the ledger-sorted reference inputs, authenticated by the params NFT. Ignored by
    // `V0_4_0`, which scanned for it (and aborted on a token-less input — upstream #103).
    const paramsIdx = refIndexOf(req.protocolParamsRef)
    if (paramsIdx < 0) return yield* Effect.fail(new Plan.BuildError({ reason: 'protocol-params reference input missing from the reference-input set' }))
    const transferRedeemerHex = yield* transferRedeemer({ paramsIdx, proofs }, version)

    // ── withdrawals (0-coin): [the dispatcher +] the transfer delegate + each transfer_logic ──
    // On `'plg-dispatcher'` versions the chain is PLB -> params[plg_cred] -> PLG -> transfer,
    // so the transaction carries BOTH the dispatcher's withdraw-0 and the delegate's. The
    // dispatcher's redeemer is the field-less arm naming the action; the delegate's carries
    // the registry proofs. Adding a withdrawal shifts every ledger-ordered index, which is why
    // `wdrlIdx` is computed from the finished set below rather than assumed.
    const dispatching = version.dispatch === 'plg-dispatcher'
    const transferRewardAcct = delegateRewardAccountHex(net, req.transferScriptHashHex)
    const withdrawals: Array<Plan.PlanWithdrawal> = [{ rewardAcctHex: transferRewardAcct, amount: 0n }]
    const withdrawalKeys: Array<WithdrawalKey> = [{ rewardAcctHex: transferRewardAcct, cred: { kind: 'script', hashHex: req.transferScriptHashHex } }]
    const rewardRedeemers: Array<Plan.PlanRedeemer> = [
      { tag: 3, index: 0n, dataHex: PlutusDataHex(transferRedeemerHex), mem: req.transferExUnits[0], steps: req.transferExUnits[1], withdrawalRewardAcctHex: transferRewardAcct },
    ]
    if (dispatching && (req.plgScriptHashHex === undefined || req.plgScriptHex === undefined || req.plgExUnits === undefined)) {
      return yield* Effect.fail(
        new Plan.BuildError({
          reason: `version ${version.id} dispatches through programmable_logic_global: plgScriptHashHex, plgScriptHex and plgExUnits are all required`,
        }),
      )
    }
    if (!dispatching && req.plgScriptHashHex !== undefined) {
      return yield* Effect.fail(new Plan.BuildError({ reason: `version ${version.id} has no dispatcher, but plgScriptHashHex was supplied` }))
    }
    const plgRewardAcct = dispatching ? delegateRewardAccountHex(net, req.plgScriptHashHex!) : undefined
    if (plgRewardAcct !== undefined) {
      withdrawals.push({ rewardAcctHex: plgRewardAcct, amount: 0n })
      withdrawalKeys.push({ rewardAcctHex: plgRewardAcct, cred: { kind: 'script', hashHex: req.plgScriptHashHex! } })
      rewardRedeemers.push({
        tag: 3,
        index: 0n,
        dataHex: PlutusDataHex(yield* plgDispatchRedeemer('transfer')),
        mem: req.plgExUnits![0],
        steps: req.plgExUnits![1],
        withdrawalRewardAcctHex: plgRewardAcct,
      })
    }
    // distinct transfer_logic scripts of the registered (exists) moved policies
    const substandardByHash = new Map(req.substandards.map((s) => [s.scriptHashHex, s]))
    const usedTransferLogic = new Set<string>()
    for (const { policy, sel } of selections) {
      if (sel.kind !== 'exists') continue
      const tl = sel.node.transferLogicScript
      if (tl.kind !== 'script') return yield* Effect.fail(new Plan.BuildError({ reason: `registered policy ${policy} has a non-script transfer_logic` }))
      if (usedTransferLogic.has(tl.hashHex)) continue
      usedTransferLogic.add(tl.hashHex)
      const sub = substandardByHash.get(tl.hashHex)
      if (!sub) return yield* Effect.fail(new Plan.BuildError({ reason: `no substandard supplied for transfer_logic ${tl.hashHex} (policy ${policy})` }))
      const acct = Encode.rewardScriptHex(net, tl.hashHex)
      withdrawals.push({ rewardAcctHex: acct, amount: 0n })
      withdrawalKeys.push({ rewardAcctHex: acct, cred: tl })
      rewardRedeemers.push({ tag: 3, index: 0n, dataHex: PlutusDataHex(sub.redeemerDataHex), mem: sub.exUnits[0], steps: sub.exUnits[1], withdrawalRewardAcctHex: acct })
    }

    // ── PLB inputs (mandatory) + their spend redeemers + key-owner required_signers ──
    // PLB now dispatches: its redeemer names the `transfer` arm and witnesses where the
    // transfer credential sits in the withdrawal set AS THE SCRIPT CONTEXT ORDERS IT (see
    // `withdrawalIndexOf` — not the order the withdrawals map is serialised in). The data
    // is identical for every PLB input, so it is encoded once.
    // WHICH credential `wdrl_idx` witnesses moved with the trust chain: the dispatcher's on
    // `'plg-dispatcher'`, the delegate's before it. Same field, different target — and the same
    // bytes either way, which is exactly why this is picked off the descriptor and not assumed.
    const wdrlIdx = withdrawalIndexOf(withdrawalKeys, plgRewardAcct ?? transferRewardAcct)
    const plbRedeemerHex = yield* plbSpendRedeemer({ arm: 'transfer', paramsIdx, wdrlIdx }, version)
    // ⚠️⚠️ A programmable input carrying a NON-VOID inline datum is REFUSED here, not carried
    // forward and not dropped.
    //
    // This builder never writes a datum a caller did not supply, so it cannot overwrite one — the
    // failure measured in the reference SDK, where a CIP-68 (100) reference token's metadata came
    // out of the transfer as `d87980` and the ledger accepted it, leaving the reference NFT at an
    // address its issuer no longer controlled. What this builder CAN do is quieter and ends the
    // same way: a caller who moves such an input and supplies no datum for the output gets
    // `NoDatum`, and the metadata is gone from the live UTxO set just as permanently.
    //
    // Refusing rather than carrying it forward is deliberate. Whether the on-chain transfer
    // validator accepts a non-void datum on a programmable output is untested here, so a
    // carry-forward would trade silent data loss for a submission failure nobody can read. The
    // refusal is the part provable offline, and a caller who means to move metadata can say so by
    // supplying the output datum explicitly.
    for (const [i, input] of req.plbInputs.entries()) {
      if (input.datumHex !== undefined && input.datumHex.toLowerCase() !== VOID_INLINE_DATUM) {
        return yield* Effect.fail(new Plan.BuildError({
          reason:
            `PLB input ${i} (${input.txHash}:${input.index}) carries a non-void inline datum ` +
            `(${input.datumHex.slice(0, 16)}…): transferring it would drop that datum, which for a ` +
            "CIP-68 reference token is its metadata. Supply the output's datum explicitly to move it.",
        }))
      }
    }
    const mandatoryInputs: Array<Plan.PlanInput> = req.plbInputs.map((i) => ({ txHash: Brands.TxHashHex(i.txHash), index: i.index, assets: i.assets }))
    const spendRedeemers: Array<Plan.PlanRedeemer> = req.plbInputs.map((i) => ({
      tag: 0, index: 0n, dataHex: plbRedeemerHex, mem: i.exUnits[0], steps: i.exUnits[1],
      spendOutpoint: { txHash: Brands.TxHashHex(i.txHash), index: i.index },
    }))
    const keyOwnerHashes = [...new Set(req.plbInputs.filter((i) => i.owner.kind === 'key').map((i) => KeyHashHex(i.owner.hashHex)))]

    // ── outputs: recipient smart wallets ──
    // Every PLB output must stay SEIZABLE — upstream's `is_seizable_output_shape_bounded`: no
    // datum hash, no reference script, and an inline datum within `max_inline_datum_bytes`.
    // ⚠️ `NoDatum` OR an inline datum of any content is allowed, bounded; the protocol does not
    // require a void datum and names CIP-68 reference tokens as the example of a legitimate large
    // one. The first two parts are structural here — this builder emits inline datums and never a
    // reference script — so only the bound needs checking, and only when the caller supplied it.
    if (req.maxInlineDatumBytes !== undefined) {
      const bound = req.maxInlineDatumBytes
      for (const [i, o] of req.plbOutputs.entries()) {
        if (o.datumHex === undefined) continue
        const bytes = BigInt(o.datumHex.length / 2)
        if (bytes > bound) {
          return yield* Effect.fail(new Plan.BuildError({ reason: `PLB output ${i} inline datum is ${bytes} B, over max_inline_datum_bytes ${bound}` }))
        }
      }
    }
    // ⚠️ Annotated. Inferred, the array widens and excess-property checking never fires, so a
    // field the plan stopped reading goes on being passed and nothing says so.
    const plbOutputs: Array<Plan.PlanOutput> = req.plbOutputs.map((o) => ({
      addressHex: smartWalletAddressHex(net, req.plbScriptHashHex, o.recipient),
      assets: o.assets,
      ...(o.datumHex !== undefined ? { datumHex: o.datumHex } : {}),
    }))

    // ── witness scripts (pre-applied V3): PLB + transfer + the used transfer_logic scripts ──
    const scriptsV3 = [
      req.plbScriptHex,
      req.transferScriptHex,
      ...(dispatching ? [req.plgScriptHex!] : []),
      ...req.substandards.filter((s) => usedTransferLogic.has(s.scriptHashHex)).map((s) => s.scriptHex),
    ]
    const datums = req.plbInputs.flatMap((i) => (i.datumHex !== undefined ? [i.datumHex] : []))

    const bodyExtra = keyOwnerHashes.length ? ([[14, yield* requiredSignersHex(keyOwnerHashes)]] as const) : []

    return yield* planAttempt(() => Plan.buildUnsigned({
      mandatoryInputs,
      inputs: req.fundingInputs,
      outputs: plbOutputs,
      changeAddressHex: req.changeAddressHex,
      params: req.params,
      withdrawals,
      bodyExtra: [...bodyExtra],
      plutus: {
        scriptsV3,
        ...(datums.length ? { datums } : {}),
        redeemers: [...spendRedeemers, ...rewardRedeemers],
        costModels: req.costModels,
        collateral: req.collateral.map((c) => ({ txHash: Brands.TxHashHex(c.txHash), index: c.index })),
        referenceInputs: sortedRefInputs.map((r) => ({ txHash: Brands.TxHashHex(r.txHash), index: r.index })),
      },
      // key owners of PLB inputs sign; funding inputs are keyed too (handled by the signer)
      signerCount: keyOwnerHashes.length + 1
    }))
  })

const requiredSignersHex = (hashHexes: ReadonlyArray<KeyHashHex>): Effect.Effect<string, Cip113Error> =>
  op("cip113RequiredSigners", () => Encode.requiredSigners(hashHexes))

// ════════════════════════════════════════════════════════════════════════════════
// Query seam — where the on-chain state a transfer needs comes from (Phase 2).
//
// buildTransferTx consumes registry nodes, the protocol-params reference UTxO, and the
// spender's smart-wallet (PLB) UTxOs. Fetching them requires a chain index (the sorted
// registry linked list, UTxOs by the PLB payment credential, the params NFT), which is
// off-chain infra — strictly out of the byte-core's scope. So it is a swappable service:
// an app wires its indexer (Koios / Ogmios / Blockfrost / Kupo) into `QueryTag`; tests
// use `staticQuery`. A real implementation decodes datums itself and closes over its own
// deps, so the seam methods require nothing.
// ════════════════════════════════════════════════════════════════════════════════

/** A chain query for CIP-113 state failed (indexer error, missing params UTxO, …). */
export class QueryError extends Data.TaggedError("QueryError")<{ readonly reason: string }> {}

/** The protocol-params reference UTxO + the datum it carries. Field-for-field the same
 *  optionality as `GlobalParamsDatum` — which fields exist is the version's business. */
export interface ProtocolParamsInfo {
  readonly txHash: Brands.TxHashHex
  readonly index: number
  /** currency symbol of the registry-node NFTs. Gone from the datum at `LATEST` (the merged
   *  `registry` reads it off its own address) — use the deployment record's. */
  readonly registryNodeCsHex?: string
  /** the PLB payment credential (`prog_logic_cred`) all smart wallets share. Gone from the
   *  datum at `LATEST` — use the deployment record's. */
  readonly progLogicCred?: Credential
  /** the live DISPATCHER credential (`LATEST`) — the withdraw-0 every programmable spend must
   *  carry, and what PLB's `wdrl_idx` points at. Swappable in place by the upgrade authority,
   *  so the CHAIN is the authority for it, not our record. */
  readonly plgCred?: Credential
  /** the live `issuance_logic` withdraw-0 credential (`LATEST`) — required by every mint and
   *  burn alongside the token's own `minting_logic`. */
  readonly issuanceLogicCred?: Credential
  /** the live `transfer` withdraw-0 credential — what a transfer withdraws from, and what
   *  an in-place upgrade rewrites. Absent before the PLG split, where PLB's parameter
   *  named the coordinator instead. */
  readonly transferCred?: Credential
  /** the live `third_party` (seize / clawback / freeze) withdraw-0 credential. */
  readonly thirdPartyCred?: Credential
  /** the unfracking withdraw-0 credential (only that branch reads it; gone at `LATEST`). */
  readonly unfrackingCred?: Credential
  /** the upgrade-authority withdraw-0 credential. */
  readonly upgradeCred?: Credential
  /** the standing nomination for the next upgrade authority — `null` = none in flight. */
  readonly pendingUpgradeCred?: Credential | null
  /** max serialised bytes of an inline datum on a PLB output — pass to `buildTransferTx`
   *  as `maxInlineDatumBytes` so an over-bound datum fails at build time. Gone from the datum
   *  at `LATEST`: it is a compile-time parameter of four validators, so it comes from the
   *  deployment record (`Cip113Deployment.maxInlineDatumBytes`) instead of from chain. */
  readonly maxInlineDatumBytes?: bigint
}

/** A spendable smart-wallet (PLB) UTxO — shaped to drop straight into a `PlbInput`. */
export interface SmartWalletUtxo {
  readonly txHash: Brands.TxHashHex
  readonly index: number
  readonly assets: Assets.Assets
  readonly owner: Credential
  readonly datumHex?: PlutusDataHex
}

/** The CIP-113 chain-query seam. */
export interface Query {
  /** The registry linked list as reference-input candidates (any order; selection sorts). */
  readonly registryNodes: Effect.Effect<ReadonlyArray<RegistryNodeRef>, QueryError>
  /** The protocol-params reference UTxO. */
  readonly protocolParams: Effect.Effect<ProtocolParamsInfo, QueryError>
  /** The smart-wallet UTxOs owned by `owner` (its stake credential). */
  readonly smartWalletUtxos: (owner: Credential) => Effect.Effect<ReadonlyArray<SmartWalletUtxo>, QueryError>
}

/** The CIP-113 query service tag. Provide `staticQuery(...)` in tests, or an indexer-backed Layer. */
export class QueryTag extends Context.Tag("@evolution-sdk/Cip113Query")<QueryTag, Query>() {}

/**
 * A fixed, in-memory query — TESTS/DEMOS and app-supplied snapshots. A production app
 * wires its indexer into `QueryTag` instead. `smartWalletUtxos` filters the supplied set
 * by the requested owner credential.
 */
export const staticQuery = (state: {
  readonly registryNodes: ReadonlyArray<RegistryNodeRef>
  readonly protocolParams: ProtocolParamsInfo
  readonly smartWalletUtxos: ReadonlyArray<SmartWalletUtxo>
}): Layer.Layer<QueryTag> =>
  Layer.succeed(QueryTag, {
    registryNodes: Effect.succeed(state.registryNodes),
    protocolParams: Effect.succeed(state.protocolParams),
    smartWalletUtxos: (owner) =>
      Effect.succeed(state.smartWalletUtxos.filter((u) => u.owner.kind === owner.kind && u.owner.hashHex === owner.hashHex)),
  })
