// CIP-113 schema versions — EXPLICIT, isolated, extensible.
//
// CIP-113 is Proposed / mid-audit, and its on-chain shapes have changed across revisions
// (the datum field layouts, the parameter arities of the parameterized validators, and —
// as of upstream `9db7e06` — the validator SET and the redeemer wire formats). We must
// (a) keep the LATEST shape the clean default so legacy support never introduces bugs
// into current code, and (b) still interoperate with already-deployed older versions, and
// (c) make adding a FUTURE version trivial.
//
// The mechanism: every version is a self-contained DESCRIPTOR here — pure data. The codec,
// derivation, and tx builders take an optional `version` argument that DEFAULTS to `LATEST`
// and read the descriptor; they never branch on a version id. Supporting another version =
// adding one descriptor object; the LATEST path is not touched. Consumers that don't care
// about old deployments simply never pass a version and get LATEST behavior verbatim.
//
// ⚠️ THE IDS ARE LABELS, NOT IDENTIFICATION. Upstream's `plutus.json` preamble has lied
// repeatedly: both `main` and the upgradability branch declared 0.4.0; the branch later said
// 0.5.0-alpha.1; `main` then said 0.5.0-alpha.2 while being a different shape again; and at
// the `v0.0.1` tag the string went BACKWARDS from 0.5.0-alpha.4 over a forwards change.
// Never identify a deployment's shape by a version string — key off the observable facts
// this file encodes: PLB's parameter, the params-datum arity, and the validator titles.

/** Field indices of a `RegistryNode` Constr-0 datum for a given version. `null` = the field
 *  does not exist in this version (older schemas omit `minting_logic_script` /
 *  `unfracking_logic_script` and shift the remaining fields). */
export interface RegistryNodeLayout {
  readonly fieldCount: number
  readonly key: number
  readonly next: number
  readonly mintingLogic: number | null
  readonly transferLogic: number
  readonly thirdParty: number
  readonly unfrackingLogic: number | null
  readonly globalStateCs: number
}

/**
 * Field indices of the protocol-params Constr-0 datum — `ProgrammableLogicGlobalParams`
 * up to `0.5.0-alpha.2`, renamed `ProtocolParams` at `0.5.0-alpha.4`. `null` = the field
 * does not exist in this version.
 *
 * **NOTHING in this datum is stable, including field 0.** Revisions only APPENDED up to
 * `f16c857`; upstream `342c47d` (PR #110) REORDERED the tail; and #117/#129 then REMOVED
 * four fields and reordered what was left by read frequency, so `registry_node_cs` —
 * field 0 since the beginning — is simply gone and `plg_cred` sits there instead. That is
 * why this is a full index map and not a field count plus one offset: a positional parser
 * aimed at the wrong revision mostly does not fail, it returns the wrong credential.
 *
 * Only ONE of the two reads is loud, and ⚠️ not for the reason this comment used to give.
 * Reading an `alpha.4` datum with the `alpha.2` descriptor fails on the FIELD COUNT (6 against
 * the 7 it wants) — measured in `test/Cip113Codec.test.ts` — and only when the count happens to
 * agree does field 0's type check (a `Credential` where a `ByteArray` was expected) do the work.
 * Reading with a descriptor that agrees on TYPES and disagrees on POSITIONS is silent either way:
 * `V0_4_0` against an `alpha.2` datum returns `transfer_cred` under the name `unfrackingCred`,
 * which is a credential whose withdraw-0 every programmable spend carries, so it builds cleanly
 * and fails in phase 2.
 */
export interface GlobalParamsLayout {
  readonly fieldCount: number
  /** currency symbol of the registry-node NFTs. REMOVED from the datum by the registry
   *  merge (`0.5.0-alpha.4`): the merged `registry` reads the policy off its own input's
   *  payment credential, and the field lost its last on-chain reader. */
  readonly registryNodeCs: number | null
  /** the PLB payment credential. REMOVED from the datum by the dispatcher reintroduction
   *  (`0.5.0-alpha.4`): it is a compile-time parameter of the delegates now. */
  readonly progLogicCred: number | null
  /** the `programmable_logic_global` DISPATCHER's withdraw-0 credential — the one credential
   *  PLB reads, once per programmable input, which is why it sits at field 0 where the
   *  accessor is a bare `head_list`. Only `0.5.0-alpha.4` and later have it: the coordinator
   *  era named PLG in PLB's PARAMETER, and the PLB-dispatch era had no dispatcher at all. */
  readonly plgCred: number | null
  /** the replaceable `issuance_logic` withdraw-0 credential (`0.5.0-alpha.4`, upstream #129).
   *  Rewriting it changes the issuance rules for every token without moving a policy id. */
  readonly issuanceLogicCred: number | null
  /** the `transfer` withdraw-0 credential. Pre-split (`f16c857` and earlier) the transfer
   *  coordinator's credential was NOT in the datum — it was baked into PLB's parameter. */
  readonly transferCred: number | null
  /** the standalone `third_party` withdraw-0 credential (post-split only; before, seizure
   *  ran inside the coordinator and had no credential of its own). */
  readonly thirdPartyCred: number | null
  /** the `unfracking` withdraw-0 credential. REMOVED from the datum by `0.5.0-alpha.4` —
   *  the dispatcher names all three delegates by compile-time hash instead. */
  readonly unfrackingCred: number | null
  /** the upgrade-authority withdraw-0 credential. */
  readonly upgradeCred: number | null
  /** the NOMINATED next upgrade authority, `Option<Credential>` — `None` at rest, `Some(c)`
   *  while a two-phase handover is in flight (`0.5.0-alpha.4`, upstream #125). */
  readonly pendingUpgradeCred: number | null
  /** max serialised bytes of the inline datum a PLB output may carry (issue #106 vector 3).
   *  REMOVED from the datum by `0.5.0-alpha.4`: it is a compile-time parameter of each of the
   *  four output-creating validators now, which is why the deployment must apply ONE value to
   *  all four — see `Cip113Deployment.maxInlineDatumBytes`. */
  readonly maxInlineDatumBytes: number | null
}

export type PlbParam = 'plg-stake-cred' | 'params-policy'

/**
 * PLB's spend-redeemer wire shape.
 *
 *  - `'unit'` — ignored `Data`; we send a Plutus unit. PLB scanned the withdrawals itself.
 *  - `'dispatch'` — `BaseSpendRedeemer { SpendViaTransfer | SpendViaThirdParty |
 *    SpendViaUnfracking }` (constructors 0/1/2), each `{ params_idx: Int, wdrl_idx: Int }`:
 *    the redeemer names WHICH delegate to trampoline to and WHERE its credential sits in
 *    the ledger-ordered withdrawal map.
 *  - `'params-wdrl'` — a plain RECORD `{ params_idx: Int, wdrl_idx: Int }` (`Constr 0`), and
 *    `wdrl_idx` names the DISPATCHER's withdrawal, not a delegate's. PLB chooses nothing any
 *    more: it reads `plg_cred` out of the params datum and requires that one withdraw-0.
 *
 * ⚠️ `'dispatch'`'s transfer arm and `'params-wdrl'` are THE SAME BYTES — constructor 0 with
 * two integers. A builder left on the old shape does not fail to decode; it fails as a
 * withdrawal-index mismatch, because index it computed points at the transfer delegate and
 * the validator compares against the dispatcher. The seize/unfracking arms (constructors
 * 1/2) do fail to decode outright. Upstream flags this as the sharper of its two silent
 * breaks.
 */
export type PlbSpendRedeemer = 'unit' | 'dispatch' | 'params-wdrl'

/**
 * The transfer withdraw-0 validator's redeemer wire shape.
 *
 *  - `'transfer-act'` — `TransferAct { proofs }`, constructor 0 of a sum type that also
 *    held `ThirdPartyAct` / `UnfrackingAct`.
 *  - `'params-indexed'` — `TransferRedeemer { params_idx, proofs }`, a single constructor.
 *    Byte-compatible with `TransferAct` apart from the leading `params_idx`.
 *  - `'proofs-only'` — `TransferRedeemer { proofs }`. The `params_idx` is gone again: at
 *    `0.5.0-alpha.4` the delegate does not read the params datum at all (its three former
 *    reads are compile-time parameters), so it has nothing to index.
 *
 * `'proofs-only'` and `'transfer-act'` encode to the SAME BYTES (`Constr 0 [list]`). They are
 * kept apart because they are different upstream types reached by different dispatch paths,
 * and conflating them would hide the next divergence rather than the current agreement.
 */
export type TransferRedeemerShape = 'transfer-act' | 'params-indexed' | 'proofs-only'

/**
 * The `third_party` / `unfracking` delegate redeemer wire shape. The two types are distinct
 * upstream but have always had identical fields.
 *
 *  - `'params-node-outputs'` — `{ params_idx, registry_node_idx, outputs_start_idx }`.
 *  - `'node-outputs'` — `{ registry_node_idx, outputs_start_idx }`. `params_idx` dropped at
 *    `0.5.0-alpha.4` for the same reason the transfer redeemer lost it.
 */
export type DelegateRedeemerShape = 'params-node-outputs' | 'node-outputs'

/**
 * How a PLB spend reaches the validator that enforces the action. This is the protocol's
 * trust chain, and it has now been all three shapes:
 *
 *  - `'plg-coordinator'` — PLB requires ONE `programmable_logic_global` coordinator's
 *    withdraw-0 (named by PLB's own compile-time parameter); the coordinator hosts transfer,
 *    seizure and unfracking as arms of one redeemer.
 *  - `'plb-direct'` — the coordinator is dissolved; PLB's redeemer names one of three
 *    standalone delegates directly, and reads its credential out of the params datum.
 *  - `'plg-dispatcher'` — PLB reads ONE credential (`plg_cred`) and requires its withdraw-0;
 *    that dispatcher, parameterised by the three delegate hashes, requires the delegate the
 *    ACTION names. PLB -> params -> PLG -> delegate.
 *
 * For a tx builder the difference is concrete: `'plg-dispatcher'` puts one MORE withdraw-0 in
 * every programmable transaction (so every `wdrl_idx` shifts), and PLB's `wdrl_idx` witnesses
 * the dispatcher's position rather than the delegate's.
 */
export type DispatchShape = 'plg-coordinator' | 'plb-direct' | 'plg-dispatcher'

/**
 * What the three delegates take as compile-time parameters — which is also the question of
 * whether they read the params datum at run time.
 *
 *  - `'params-policy'` — `(params_policy: PolicyId)`; everything else is read live from the
 *    params datum, so a delegate can be swapped by rewriting that datum.
 *  - `'plb-cs-bound'` — `(programmable_logic_base_cred, registry_node_cs, max_inline_datum_bytes)`;
 *    the delegate reads no datum at all. Swapping one now means recompiling the dispatcher too,
 *    because the dispatcher names delegates by hash.
 */
export type DelegateParams = 'params-policy' | 'plb-cs-bound'

/** One `issuance_mint` compile-time parameter, named rather than counted — the arity has been
 *  2, 3 and 4, and at one point the 4th changed TYPE (`Credential` → `PolicyId`) without the
 *  arity moving, which an arity check cannot see. */
export type IssuanceMintParam = 'plb-cred' | 'registry-node-cs' | 'minting-logic-cred' | 'plg-stake-cred' | 'params-policy'

/** Whether the registry's mint and spend halves are two validators or one.
 *  `'merged'` (`0.5.0-alpha.4`) means the node POLICY ID and the node ADDRESS's payment
 *  credential are the same hash — two derivations collapse into one. */
export type RegistryShape = 'split' | 'merged'

/** Whether the protocol-params mint and spend halves are two validators or one, and what
 *  locks the params UTxO.
 *
 *  - `'split-always-fail'` — `protocol_params_mint` + an always-fail lock; the datum is frozen
 *    forever.
 *  - `'split-coordination'` — `protocol_params_mint` + `coordination_spend`; rewritable through
 *    the upgrade rail.
 *  - `'merged-self'` — one `protocol_params` validator whose mint handler locks the NFT at its
 *    own script hash. Policy id and address payment credential are the same hash.
 */
export type ProtocolParamsShape = 'split-always-fail' | 'split-coordination' | 'merged-self'

/** The reference upgrade authority.
 *
 *  - `'none'` — no upgrade rail at all (the params datum is frozen).
 *  - `'flat-multisig'` — `upgrade_multisig(signers, threshold)`, an M-of-N baked into the
 *    script's parameters, so rotating the membership is a new script.
 *  - `'config-tree'` — `upgrade_multisig(utxo_ref)` owning a one-shot `UpgradeMultisig` NFT
 *    whose inline datum is a `MultisigScript` tree the authority can rotate in place.
 */
export type UpgradeAuthorityShape = 'none' | 'flat-multisig' | 'config-tree'

/** Blueprint title PREFIXES (`<module>.<validator>`) per validator, for looking entries up in
 *  a `plutus.json`. Merges and renames land here and nowhere else: `registry_mint`/
 *  `registry_spend` became `registry`, `protocol_params_mint`/`protocol_params_spend` became
 *  `protocol_params`, and `programmable_logic_global` has meant two different validators. */
export interface BlueprintTitles {
  readonly alwaysFail: string
  readonly programmableLogicBase: string
  /** the transfer withdraw-0 delegate. */
  readonly transfer: string
  /** the standalone seize/clawback/freeze delegate, where the version has one. */
  readonly thirdParty: string | null
  readonly unfracking: string
  /** the dispatcher, on `'plg-dispatcher'` versions only. */
  readonly programmableLogicGlobal: string | null
  /** registry mint handler — the same title as `registrySpend` once merged. */
  readonly registryMint: string
  readonly registrySpend: string
  /** protocol-params mint handler — the same title as `protocolParamsSpend` once merged. */
  readonly protocolParamsMint: string
  /** the params UTxO's spender: `always_fail`, `coordination_spend`, or the merged validator. */
  readonly protocolParamsSpend: string
  readonly issuanceCborHexMint: string
  readonly issuanceMint: string
  /** the replaceable issuance rules, on `0.5.0-alpha.4` and later. */
  readonly issuanceLogic: string | null
  readonly upgradeMultisig: string | null
}

/** A CIP-113 on-chain schema revision. */
export interface Cip113Version {
  /** stable LABEL, e.g. `"v0.5.0-alpha.4"` — see the file header: not identification. */
  readonly id: string
  /** `RegistryNode` datum layout. */
  readonly node: RegistryNodeLayout
  /** protocol-params datum layout. */
  readonly params: GlobalParamsLayout
  /** blueprint title prefixes — where merges and renames are recorded. */
  readonly titles: BlueprintTitles
  /** `registry_mint` is parameterized by `(utxo_ref, issuance_cbor_hex_cs [, registry_spend_cred])`.
   *  `true` = the trailing `registry_spend_cred` param exists (added post-v0.3.0, removed by the
   *  merge, which has no spend credential to name because it IS the spend script). */
  readonly registryMintTakesSpendCred: boolean
  /** whether the registry's two halves are one validator. */
  readonly registry: RegistryShape
  /** whether the protocol-params halves are one validator, and what locks the params UTxO. */
  readonly protocolParams: ProtocolParamsShape
  /** `issuance_mint`'s compile-time parameters, in order. */
  readonly issuanceMintParams: ReadonlyArray<IssuanceMintParam>
  /** issuance is split into a permanent policy and a replaceable `issuance_logic` withdraw-0
   *  (`0.5.0-alpha.4`, upstream #129). Every mint and burn carries that withdrawal too. */
  readonly hasIssuanceLogic: boolean
  /** what `programmable_logic_base` takes as its single parameter. */
  readonly plbParam: PlbParam
  /** PLB's spend-redeemer wire shape. */
  readonly plbSpendRedeemer: PlbSpendRedeemer
  /** how a PLB spend reaches the enforcing validator. */
  readonly dispatch: DispatchShape
  /** what the three delegates take as compile-time parameters. */
  readonly delegateParams: DelegateParams
  /** the transfer withdraw-0 validator's redeemer wire shape. */
  readonly transferRedeemer: TransferRedeemerShape
  /** the `third_party` / `unfracking` redeemer wire shape. */
  readonly delegateRedeemer: DelegateRedeemerShape
  /** blueprint title prefix of the transfer withdraw-0 validator.
   *  @deprecated use `titles.transfer`; kept because it is the one title consumers already read. */
  readonly transferTitle: string
  /** seizure lives in a standalone `third_party` withdraw-0 validator (post-split) rather
   *  than inside the transfer coordinator. */
  readonly hasThirdPartyValidator: boolean
  /** the params datum is rewritable through an upgrade rail (rather than locked at always-fail
   *  forever), and an upgrade authority is deployed alongside it. */
  readonly hasCoordination: boolean
  /** the shape of that upgrade authority. */
  readonly upgradeAuthority: UpgradeAuthorityShape
  /** where `max_inline_datum_bytes` lives: in the params datum (readable from chain), or baked
   *  into the four output-creating validators as a compile-time parameter (readable only from
   *  the deployment record / the applied blueprint). `null` = the bound does not exist yet. */
  readonly maxInlineDatumBytesSource: 'params-datum' | 'script-param' | null
  /** `protocol_params.mint` requires the datum's `upgrade_cred` withdraw-0 IN THE GENESIS
   *  TRANSACTION (upstream #143, `v0.0.1`). The point is to prove that the exact authority
   *  the datum names can run and consent, so a typo or the hash of a script nobody deployed
   *  cannot be born as the authority. A bootstrap built without that withdrawal builds
   *  cleanly and dies in phase 2, which is why `buildBootstrapTx` refuses to emit one. */
  readonly paramsGenesisAuthorityWithdrawal: boolean
}

/**
 * The **PLG-DISPATCHER** shape, as upstream `main` declared it before the `v0.0.1` tag.
 *
 * Tracks `cardano-foundation/cip113-programmable-tokens@7e8a631` (2026-09-10), which declares
 * `0.5.0-alpha.4` and is byte-identical to `d37ca8d` (the last commit that moved a hash; #135
 * renamed titles and #136 touched only tests).
 *
 * **No longer `LATEST`** — see `V0_0_1`, which is the same shape with one more genesis rail
 * and a different `protocol_params` hash. Everything below still describes both.
 *
 * **Nothing is deployed on this shape.** It was skipped: CF went from `alpha.2` straight to
 * `v0.0.1`, abandoning rather than upgrading the `alpha.2` instance. Kept first-class because
 * `V0_0_1` is a spread of it and every field below describes both.
 *
 * What moved from `V0_5_0_ALPHA_2`, and why each matters off-chain (upstream
 * `CONTRACT_SURFACE_CHANGES.md` is the authoritative map):
 *
 *  - **The dispatcher is back** (#117), as a separate validator this time. PLB no longer
 *    chooses a delegate: it reads `plg_cred` (field 0) and requires that withdraw-0, and
 *    `programmable_logic_global` — parameterised by the three delegate hashes — requires the
 *    delegate its own field-less redeemer names. Every programmable transaction therefore
 *    carries ONE MORE withdrawal, and every `wdrl_idx` shifts.
 *  - **PLB's redeemer stops being a sum type**: `BaseSpendRedeemer { params_idx, wdrl_idx }`.
 *    Its transfer arm was already `Constr 0 [int, int]`, so a stale builder still DECODES —
 *    see `PlbSpendRedeemer`.
 *  - **The delegates stop reading the params datum.** `transfer` / `third_party` /
 *    `unfracking` take `(programmable_logic_base_cred, registry_node_cs, max_inline_datum_bytes)`
 *    as compile-time parameters, so their redeemers lose `params_idx` and the datum loses
 *    three fields.
 *  - **Two validator pairs merged** (#117, #118): `registry_mint`+`registry_spend` → `registry`,
 *    `protocol_params_mint`+`protocol_params_spend` → `protocol_params`. In BOTH, one hash is
 *    now the policy id AND the address's payment credential — two derivations become one.
 *  - **Params datum 7 → 6 fields, reordered by read frequency and renamed** `ProtocolParams`
 *    (see `GlobalParamsLayout`). This is the change that misreads silently.
 *  - **Issuance split** (#129): `issuance_mint` keeps only what can never change (2 params),
 *    and the replaceable rules move to a new `issuance_logic` withdraw-0 named by params field
 *    1. Every mint and burn now carries TWO withdraw-0s and a params reference input.
 *  - **The upgrade authority became a rotatable `MultisigScript` tree** in its own config UTxO
 *    (#126/#127), and an authority handover became two transactions (#125).
 *  - `RegistryNode` is UNCHANGED again — 7 fields, same order. Upstream renamed field 4's
 *    title (`third_party_transfer_logic_script` → `third_party_logic_script`); the CBOR is
 *    identical.
 */
export const V0_5_0_ALPHA_4: Cip113Version = {
  id: 'v0.5.0-alpha.4',
  node: { fieldCount: 7, key: 0, next: 1, mintingLogic: 2, transferLogic: 3, thirdParty: 4, unfrackingLogic: 5, globalStateCs: 6 },
  params: {
    fieldCount: 6,
    registryNodeCs: null,
    progLogicCred: null,
    plgCred: 0,
    issuanceLogicCred: 1,
    transferCred: 2,
    thirdPartyCred: 3,
    unfrackingCred: null,
    upgradeCred: 4,
    pendingUpgradeCred: 5,
    maxInlineDatumBytes: null,
  },
  titles: {
    alwaysFail: 'always_fail',
    programmableLogicBase: 'programmable_logic_base',
    transfer: 'transfer',
    thirdParty: 'third_party',
    unfracking: 'unfracking',
    programmableLogicGlobal: 'programmable_logic_global',
    registryMint: 'registry',
    registrySpend: 'registry',
    protocolParamsMint: 'protocol_params',
    protocolParamsSpend: 'protocol_params',
    issuanceCborHexMint: 'issuance_cbor_hex_mint',
    issuanceMint: 'issuance_mint',
    issuanceLogic: 'issuance_logic',
    upgradeMultisig: 'upgrade_multisig',
  },
  registryMintTakesSpendCred: false,
  registry: 'merged',
  protocolParams: 'merged-self',
  issuanceMintParams: ['minting-logic-cred', 'params-policy'],
  hasIssuanceLogic: true,
  plbParam: 'params-policy',
  plbSpendRedeemer: 'params-wdrl',
  dispatch: 'plg-dispatcher',
  delegateParams: 'plb-cs-bound',
  transferRedeemer: 'proofs-only',
  delegateRedeemer: 'node-outputs',
  transferTitle: 'transfer',
  hasThirdPartyValidator: true,
  hasCoordination: true,
  upgradeAuthority: 'config-tree',
  maxInlineDatumBytesSource: 'script-param',
  paramsGenesisAuthorityWithdrawal: false,
}

/**
 * The current schema — upstream reference `main` at its **`v0.0.1`** tag.
 *
 * Tracks `cardano-foundation/cip113-programmable-tokens@6b75ba3` (2026-09-23), the repo's
 * first git tag. Two things happened at once, and only one of them is a shape change:
 *
 *  - **Upstream RENUMBERED.** The `plutus.json` preamble went `0.5.0-alpha.4` → `0.0.1` —
 *    the version string moved BACKWARDS across a forwards change. This file's header
 *    warning, arriving in its most literal form.
 *  - **Genesis demands authority activation** (#143): `protocol_params.mint` now requires
 *    the datum's `upgrade_cred` withdraw-0 in the same transaction, so an authority that
 *    cannot run cannot be born. That is the only behavioural change.
 *
 * **Measured, not read off a changelog:** hashing every validator's `compiledCode` either
 * side of the move, 33 of 34 are byte-identical and ONE moved — `protocol_params`
 * `355e7d7e…` → `81926958…`. Nothing was added or removed, the Aiken pin is unchanged
 * (`v1.1.23+8949565`), and since the params credential travels in the datum rather than as
 * a compile-time parameter of anything, no other hash moved with it.
 *
 * Every datum layout, redeemer wire format, parameter arity and blueprint title is therefore
 * identical to `V0_5_0_ALPHA_4`; this descriptor differs in its id and one flag.
 *
 * **This is the deployed shape on every chain.** CF has bootstrapped it onto preview, preprod and —
 * since 2026-10-06 — **mainnet**, re-bootstrapping rather than upgrading each time: the records we
 * ship are `CF_PREVIEW_2026_10_02`, `CF_PREPROD_2026_10_02` and `CF_MAINNET_2026_10_06`, and the
 * validators behind all three are the same `v0.0.1` code (contracts `6b75ba3`, unmoved since
 * 2026-09-23), differing only in applied parameters. Every bootstrap carries the genesis withdraw-0
 * this descriptor's `paramsGenesisAuthorityWithdrawal` demands, verified on chain by
 * `test/Deployment.live.test.ts`.
 */
export const V0_0_1: Cip113Version = { ...V0_5_0_ALPHA_4, id: 'v0.0.1', paramsGenesisAuthorityWithdrawal: true }

/** The current schema. Re-point this — and nothing else — when a new revision lands. */
export const LATEST: Cip113Version = V0_0_1

/**
 * The `9db7e06` schema (`0.5.0-alpha.2`, 2026-08-24 … 2026-09-03) — the **PLB-DISPATCH**
 * shape, where the coordinator was dissolved and PLB named one of three delegates directly.
 *
 * This was `LATEST` until upstream `main` moved on 2026-09-03…10, and it had the only live
 * deployment until CF replaced it on 2026-09-28. **Nothing we ship names it any more.** It stays
 * first-class because tokens stranded at that instance's PLB are still real — the credential
 * lives on in `CF_PREVIEW_2026_10_02.priorGenerations` (as `cf-preview-2026-08-26`), and reading
 * anything at the old deployment means passing this descriptor explicitly.
 */
export const V0_5_0_ALPHA_2: Cip113Version = {
  id: 'v0.5.0-alpha.2',
  node: { fieldCount: 7, key: 0, next: 1, mintingLogic: 2, transferLogic: 3, thirdParty: 4, unfrackingLogic: 5, globalStateCs: 6 },
  params: {
    fieldCount: 7,
    registryNodeCs: 0,
    progLogicCred: 1,
    plgCred: null,
    issuanceLogicCred: null,
    transferCred: 2,
    thirdPartyCred: 3,
    unfrackingCred: 4,
    upgradeCred: 5,
    pendingUpgradeCred: null,
    maxInlineDatumBytes: 6,
  },
  titles: {
    alwaysFail: 'always_fail',
    programmableLogicBase: 'programmable_logic_base',
    transfer: 'transfer',
    thirdParty: 'third_party',
    unfracking: 'unfracking',
    programmableLogicGlobal: null,
    registryMint: 'registry_mint',
    registrySpend: 'registry_spend',
    protocolParamsMint: 'protocol_params_mint',
    protocolParamsSpend: 'coordination_spend',
    issuanceCborHexMint: 'issuance_cbor_hex_mint',
    issuanceMint: 'issuance_mint',
    issuanceLogic: null,
    upgradeMultisig: 'upgrade_multisig',
  },
  registryMintTakesSpendCred: true,
  registry: 'split',
  protocolParams: 'split-coordination',
  issuanceMintParams: ['plb-cred', 'registry-node-cs', 'minting-logic-cred', 'params-policy'],
  hasIssuanceLogic: false,
  plbParam: 'params-policy',
  plbSpendRedeemer: 'dispatch',
  dispatch: 'plb-direct',
  delegateParams: 'params-policy',
  transferRedeemer: 'params-indexed',
  delegateRedeemer: 'params-node-outputs',
  transferTitle: 'transfer',
  hasThirdPartyValidator: true,
  hasCoordination: true,
  upgradeAuthority: 'flat-multisig',
  maxInlineDatumBytesSource: 'params-datum',
  paramsGenesisAuthorityWithdrawal: false,
}

/**
 * The `f16c857` schema — post-audit reference `main` as it stood 2026-08-06 … 2026-08-21,
 * the PLG-COORDINATOR era (7-field `RegistryNode`, 3-field params, PLB parameterized by the
 * coordinator's credential, unit PLB redeemer, `TransferAct`).
 *
 * Kept as a first-class descriptor because our entire measured/differential corpus was
 * validated against it, and because it is the shape upstream issues #103 and #106 were
 * confirmed on. Opt-in: pass it explicitly.
 *
 * NOTE the field-5/6 churn inside the audit window: an earlier `main` (2026-06-24 …
 * 2026-07-30) had `global_state_cs` at 5 and a 7th `protected_prefixes: List<ByteArray>` at
 * 6. `protected_prefixes` was REMOVED (upstream `5e1d050`, AL issue #96) and
 * `unfracking_logic_script: Credential` inserted at 5, pushing `global_state_cs` to 6. That
 * intermediate shape was never deployed anywhere we know of, so it gets no descriptor; if
 * one is ever needed, it is `{fieldCount:7, …, unfrackingLogic:null, globalStateCs:5}` plus
 * a `protectedPrefixes:6` layout field.
 */
export const V0_4_0: Cip113Version = {
  id: 'v0.4.0',
  node: { fieldCount: 7, key: 0, next: 1, mintingLogic: 2, transferLogic: 3, thirdParty: 4, unfrackingLogic: 5, globalStateCs: 6 },
  params: {
    fieldCount: 3,
    registryNodeCs: 0,
    progLogicCred: 1,
    plgCred: null,
    issuanceLogicCred: null,
    transferCred: null,
    thirdPartyCred: null,
    unfrackingCred: 2,
    upgradeCred: null,
    pendingUpgradeCred: null,
    maxInlineDatumBytes: null,
  },
  titles: {
    alwaysFail: 'always_fail',
    programmableLogicBase: 'programmable_logic_base',
    transfer: 'programmable_logic_global',
    thirdParty: null,
    unfracking: 'unfracking',
    programmableLogicGlobal: null,
    registryMint: 'registry_mint',
    registrySpend: 'registry_spend',
    protocolParamsMint: 'protocol_params_mint',
    protocolParamsSpend: 'always_fail',
    issuanceCborHexMint: 'issuance_cbor_hex_mint',
    issuanceMint: 'issuance_mint',
    issuanceLogic: null,
    upgradeMultisig: null,
  },
  registryMintTakesSpendCred: true,
  registry: 'split',
  protocolParams: 'split-always-fail',
  issuanceMintParams: ['plb-cred', 'registry-node-cs', 'minting-logic-cred', 'plg-stake-cred'],
  hasIssuanceLogic: false,
  plbParam: 'plg-stake-cred',
  plbSpendRedeemer: 'unit',
  dispatch: 'plg-coordinator',
  delegateParams: 'params-policy',
  transferRedeemer: 'transfer-act',
  delegateRedeemer: 'params-node-outputs',
  transferTitle: 'programmable_logic_global',
  hasThirdPartyValidator: false,
  hasCoordination: false,
  upgradeAuthority: 'none',
  maxInlineDatumBytesSource: null,
  paramsGenesisAuthorityWithdrawal: false,
}

/**
 * The pre-audit `v0.3.0` schema — what the easy1staking SDK / CF platform / dApp have DEPLOYED
 * (5-field `RegistryNode` = `[key, next, transfer_logic, third_party, global_state_cs]`, 2-field
 * params, `registry_mint`/`issuance_mint` take one fewer param). Opt-in only: pass this version
 * to interoperate with those live deployments. Our derivation reproduces every v0.3.0 script hash
 * on preprod when fed the v0.3.0 blueprint + this descriptor.
 */
export const V0_3_0: Cip113Version = {
  id: 'v0.3.0',
  node: { fieldCount: 5, key: 0, next: 1, mintingLogic: null, transferLogic: 2, thirdParty: 3, unfrackingLogic: null, globalStateCs: 4 },
  params: {
    fieldCount: 2,
    registryNodeCs: 0,
    progLogicCred: 1,
    plgCred: null,
    issuanceLogicCred: null,
    transferCred: null,
    thirdPartyCred: null,
    unfrackingCred: null,
    upgradeCred: null,
    pendingUpgradeCred: null,
    maxInlineDatumBytes: null,
  },
  titles: {
    alwaysFail: 'always_fail',
    programmableLogicBase: 'programmable_logic_base',
    transfer: 'programmable_logic_global',
    thirdParty: null,
    unfracking: 'unfracking',
    programmableLogicGlobal: null,
    registryMint: 'registry_mint',
    registrySpend: 'registry_spend',
    protocolParamsMint: 'protocol_params_mint',
    protocolParamsSpend: 'always_fail',
    issuanceCborHexMint: 'issuance_cbor_hex_mint',
    issuanceMint: 'issuance_mint',
    issuanceLogic: null,
    upgradeMultisig: null,
  },
  registryMintTakesSpendCred: false,
  registry: 'split',
  protocolParams: 'split-always-fail',
  issuanceMintParams: ['plb-cred', 'registry-node-cs', 'minting-logic-cred'],
  hasIssuanceLogic: false,
  plbParam: 'plg-stake-cred',
  plbSpendRedeemer: 'unit',
  dispatch: 'plg-coordinator',
  delegateParams: 'params-policy',
  transferRedeemer: 'transfer-act',
  delegateRedeemer: 'params-node-outputs',
  transferTitle: 'programmable_logic_global',
  hasThirdPartyValidator: false,
  hasCoordination: false,
  upgradeAuthority: 'none',
  maxInlineDatumBytesSource: null,
  paramsGenesisAuthorityWithdrawal: false,
}

/**
 * All known versions, by id. Add a descriptor here to support a future revision.
 *
 * ⚠️ **There is no longer a `'latest'` id.** It used to be the current descriptor's own id,
 * which made `versionById('latest')` a stored string that silently retargeted every time
 * upstream moved — the exact failure this file's header warns about, one layer down. Ids are
 * concrete now (`'v0.0.1'`, `'v0.5.0-alpha.4'`, …) and `versionById('latest')` returns
 * `unknown-id`. A persisted `'latest'` therefore fails loudly instead of resolving to a shape
 * nothing is deployed on. `LATEST` the BINDING still exists and still means "the newest
 * descriptor"; it is for code that tracks upstream, not for configuration.
 *
 * The value type is explicitly `| undefined` rather than relying on the consumer's
 * `noUncheckedIndexedAccess`: the published `.d.ts` is compiled against whatever the
 * CONSUMER sets, so without it an unknown id types as a real descriptor and is `undefined`
 * at runtime. Prefer `versionById`.
 */
export const VERSIONS: Readonly<Record<string, Cip113Version | undefined>> = {
  [V0_0_1.id]: V0_0_1,
  [V0_5_0_ALPHA_4.id]: V0_5_0_ALPHA_4,
  [V0_5_0_ALPHA_2.id]: V0_5_0_ALPHA_2,
  [V0_4_0.id]: V0_4_0,
  [V0_3_0.id]: V0_3_0,
}

/** The result of resolving a version id. Never a descriptor "close enough" to the ask. */
export type VersionLookup =
  | { readonly kind: 'found'; readonly version: Cip113Version }
  | { readonly kind: 'unknown-id'; readonly id: string; readonly known: ReadonlyArray<string> }

/**
 * Resolve a schema-version id. **Never falls back** — a wrong descriptor does not fail
 * loudly, it decodes a datum at the wrong field offsets and returns a plausible-looking
 * `RegistryNode` with the credentials shuffled. Defaulting to `LATEST` on an unknown id
 * would turn a typo into silently wrong protocol data.
 */
export const versionById = (id: string): VersionLookup => {
  const version = VERSIONS[id]
  return version === undefined ? { kind: 'unknown-id', id, known: Object.keys(VERSIONS) } : { kind: 'found', version }
}
