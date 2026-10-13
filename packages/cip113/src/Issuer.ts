// CIP-113 ISSUER orchestration (effect layer) — deploy-time script derivation, on the
// CLI/desktop path only. This composes the isolated Rust attachment
// (`cores/rust/attachments/cip113`, which provides `applyParamsToScript` + the Plutus
// script hash via aiken's `uplc`) with the ordinary plan engine.
//
// NOT exported from the RN barrel (`index.ts`): deep-import this module only where the
// attachment is available (Node/CLI). The attachment is INJECTED as `IssuerTag` — this
// file never imports the wasm package, so the RN/pure-ts bundle can never pull `uplc`.
//
// The base CIP-113 framework is parameterized once per deployment. `deriveDeployment`
// applies the deploy parameters to the blueprint validators in dependency order and
// returns every derived script hash / policy id + the protocol-params datum. The actual
// bootstrap / registration / issuance TRANSACTIONS are then ordinary tx building via the
// existing Plan engine (a follow-on). Param encodings verified byte-exact against the
// aiken CLI (`aiken blueprint apply`): Credential = Constr 0/1 [hash], OutputReference =
// Constr 0 [bytes(txid), int(index)] (Plutus V3), PolicyId / ByteArray = plutus bytes.

import type { Assets } from "@evolution-sdk/evolution"
import { Bytes } from "@evolution-sdk/evolution"
import { Plan } from "@evolution-sdk/plan"
import { Brands } from "@evolution-sdk/review"
import { Context, Data, Effect, Layer } from "effect"

import {
  ABSENT_CRED,
  ORIGIN_NODE_KEY,
  type ProtocolParamsInfo,
  type RegistryNode,
  registryNodeDatum,
  SENTINEL_NEXT_KEY,
  smartWalletAddressHex
} from "./Cip113.js"
import type { Cip113Error} from "./internal/Effects.js";
import { op, planAttempt } from "./internal/Effects.js"
import * as Encode from "./internal/Encode.js"
import type { Credential, Network } from "./Types.js"
import { PlutusDataHex, ScriptHex } from "./Types.js"
import { type Cip113Version, LATEST } from "./Versions.js"

/** A deploy-time derivation / evaluation via the attachment failed. */
export class IssuerError extends Data.TaggedError('IssuerError')<{ readonly reason: string }> {}

/** One redeemer's locally-computed ex-units (from the attachment's Plutus VM). */
export interface RedeemerCost {
  readonly tag: number
  readonly index: number
  readonly mem: bigint
  readonly steps: bigint
}

/** The subset of the attachment wasm module this layer needs (injected — see the
 *  module header). Matches `cores/rust/attachments/cip113/pkg` exports. */
export interface AttachmentModule {
  readonly cip113_apply_params: (scriptHex: string, paramDataHexes: Array<string>) => string
  readonly cip113_plutus_script_hash_v3: (scriptHex: string) => string
  readonly cip113_eval_tx?: (
    txHex: string,
    utxoInputs: Array<string>,
    utxoOutputs: Array<string>,
    costModelsHex: string | undefined,
    maxMem: bigint,
    maxSteps: bigint,
    slotZeroTime: bigint,
    slotZeroSlot: bigint,
    slotLength: number,
  ) => Array<string>
}

/** The attachment-backed issuer primitives. */
export interface IssuerBackend {
  /** Apply pre-encoded params to a blueprint script → the applied `compiledCode` hex. */
  readonly applyParams: (scriptHex: string, paramDataHexes: ReadonlyArray<string>) => Effect.Effect<string, IssuerError>
  /** Plutus V3 script hash (script credential) of a `compiledCode`-form script. */
  readonly scriptHashV3: (scriptHex: string) => Effect.Effect<string, IssuerError>
  /** Local ex-units evaluation of a built tx (offline Plutus VM; for measuring presets). */
  readonly evalTx: (args: {
    readonly txHex: string
    readonly utxos: ReadonlyArray<readonly [string, string]>
    readonly costModelsHex?: string
    readonly maxMem: bigint
    readonly maxSteps: bigint
    readonly slot: readonly [bigint, bigint, number]
  }) => Effect.Effect<ReadonlyArray<RedeemerCost>, IssuerError>
}

/** The issuer service tag. Provide `attachmentBackend(pkg)` in CLI/desktop tooling. */
export class IssuerTag extends Context.Tag("@evolution-sdk/Cip113Issuer")<IssuerTag, IssuerBackend>() {}

/** Build the issuer backend from the attachment wasm module (Node/CLI). */
export const attachmentBackend = (mod: AttachmentModule): Layer.Layer<IssuerTag> =>
  Layer.succeed(IssuerTag, {
    applyParams: (scriptHex, paramDataHexes) =>
      Effect.try({
        try: () => mod.cip113_apply_params(scriptHex, [...paramDataHexes]),
        catch: (e) => new IssuerError({ reason: `applyParams: ${e instanceof Error ? e.message : String(e)}` }),
      }),
    scriptHashV3: (scriptHex) =>
      Effect.try({
        try: () => mod.cip113_plutus_script_hash_v3(scriptHex),
        catch: (e) => new IssuerError({ reason: `scriptHashV3: ${e instanceof Error ? e.message : String(e)}` }),
      }),
    evalTx: (a) =>
      Effect.try({
        try: () => {
          if (!mod.cip113_eval_tx) throw new Error('attachment has no cip113_eval_tx export')
          const rows = mod.cip113_eval_tx(
            a.txHex,
            a.utxos.map(([i]) => i),
            a.utxos.map(([, o]) => o),
            a.costModelsHex,
            a.maxMem,
            a.maxSteps,
            a.slot[0],
            a.slot[1],
            a.slot[2],
          )
          return rows.map((r) => {
            const [tag, index, mem, steps] = r.split(',')
            return { tag: Number(tag), index: Number(index), mem: BigInt(mem!), steps: BigInt(steps!) }
          })
        },
        catch: (e) => new IssuerError({ reason: `evalTx: ${e instanceof Error ? e.message : String(e)}` }),
      }),
  })

// ── deploy-parameter encoders (PlutusData via the Codec) ─────────────────────────
// Verified byte-exact against `aiken blueprint apply` (see module header).

/** A `Credential` param — `Constr 0 [hash]` (key) / `Constr 1 [hash]` (script). */
export const credentialParam = (cred: Credential): Effect.Effect<PlutusDataHex, Cip113Error> =>
  op("cip113CredentialParam", () => Encode.plutusDataConstr(cred.kind === 'script' ? 1n : 0n, [Encode.plutusDataBytes(cred.hashHex)]))

/** A `PolicyId` / `ByteArray` param — plutus bytes. */
export const byteArrayParam = (hex: string): Effect.Effect<PlutusDataHex, Cip113Error> =>
  op("cip113ByteArrayParam", () => Encode.plutusDataBytes(hex))

/** An `OutputReference` param (Plutus V3) — `Constr 0 [bytes(txid), int(index)]`. */
export const outputRefParam = (txHash: string, index: number): Effect.Effect<PlutusDataHex, Cip113Error> =>
  op("cip113OutputRefParam", () => Encode.plutusDataConstr(0n, [Encode.plutusDataBytes(txHash), Encode.plutusDataInt(String(index))]))

/** An `Int` param — plutus integer (`upgrade_multisig`'s threshold, `max_inline_datum_bytes`). */
export const intParam = (value: bigint): Effect.Effect<PlutusDataHex, Cip113Error> =>
  op("cip113IntParam", () => Encode.plutusDataInt(String(value)))

/** A `List<ByteArray>` param — plutus list of bytes (`upgrade_multisig`'s signer set). */
export const byteArrayListParam = (hexes: ReadonlyArray<string>): Effect.Effect<PlutusDataHex, Cip113Error> =>
  op("cip113ByteArrayListParam", () => Encode.plutusDataList(hexes.map((h) => Encode.plutusDataBytes(h))))

/** Unique 28-byte marker for splitting the issuance template (see `deriveDeployment`). */
const TEMPLATE_PLACEHOLDER = 'ee'.repeat(28)

const script = (kind: 'script', hashHex: string): Credential => ({ kind, hashHex })

/**
 * `issuance_mint`'s compile-time parameters for `version`, in order, with the
 * minting-logic credential supplied by the caller (a real hash when applying for a token, the
 * split placeholder when building the deployment's template).
 *
 * Selected BY NAME, never by counting: the arity has been 2, 3 and 4, one parameter once
 * changed TYPE (`Credential` → `PolicyId`) without the arity moving, and `0.5.0-alpha.4`
 * dropped two AND reordered what was left so the minting-logic credential is now FIRST. Every
 * one of those is invisible to an arity check and produces a wrong policy id rather than an
 * error. Shared by `deriveDeployment` (which builds the split template) and
 * `deriveTokenPolicy` (which applies it for real), so the two can never disagree.
 */
const issuanceMintParams = (
  version: Cip113Version,
  hashes: {
    readonly plbCred: string
    readonly registryNodeCs: string
    readonly mintingLogicCred: string
    readonly transferCred: string
    readonly protocolParamsCs: string
  },
): Effect.Effect<ReadonlyArray<string>, Cip113Error> =>
  Effect.all(
    version.issuanceMintParams.map((name) => {
      switch (name) {
        case 'plb-cred':
          return credentialParam(script('script', hashes.plbCred))
        case 'registry-node-cs':
          return byteArrayParam(hashes.registryNodeCs)
        case 'minting-logic-cred':
          return credentialParam(script('script', hashes.mintingLogicCred))
        case 'plg-stake-cred':
          return credentialParam(script('script', hashes.transferCred))
        case 'params-policy':
          return byteArrayParam(hashes.protocolParamsCs)
      }
    }),
  )

// ── deployment derivation ────────────────────────────────────────────────────────

/** An outpoint used to seed a one-shot minting policy. */
export interface OutPoint {
  readonly txHash: Brands.TxHashHex
  readonly index: number
}

/** The unapplied `compiledCode` (hex) of each base-framework validator, from the blueprint. */
export interface Blueprint {
  readonly alwaysFail: string
  readonly protocolParamsMint: string
  readonly issuanceCborHexMint: string
  readonly registrySpend: string
  readonly registryMint: string
  /** the transfer withdraw-0 validator. Titled `transfer.transfer.withdraw` on `LATEST`
   *  and `programmable_logic_global.…withdraw` on `V0_4_0` — see `version.transferTitle`. */
  readonly transfer: string
  readonly programmableLogicBase: string
  readonly unfracking: string
  /** the per-token issuance minting policy template (parameterized per substandard). */
  readonly issuanceMint: string
  /** the standalone seize / clawback / freeze withdraw-0. Required when
   *  `version.hasThirdPartyValidator` (post-PLG-split); absent before. */
  readonly thirdParty?: string
  /** the coordination UTxO's spend validator — the params datum's rewritable home.
   *  Required when `version.hasCoordination`. */
  readonly coordinationSpend?: string
  /** the reference upgrade authority. `upgrade_multisig(signers, threshold)` on
   *  `'flat-multisig'` versions, `upgrade_multisig(utxo_ref)` on `'config-tree'` ones.
   *  Required whenever `version.upgradeAuthority !== 'none'`. */
  readonly upgradeMultisig?: string
  /** the `programmable_logic_global` DISPATCHER. Required when
   *  `version.dispatch === 'plg-dispatcher'`; on `V0_4_0` the same TITLE names the old
   *  coordinator, which is a different validator and belongs in `transfer`. */
  readonly programmableLogicGlobal?: string
  /** the replaceable issuance rules. Required when `version.hasIssuanceLogic`. */
  readonly issuanceLogic?: string
}

/** Where the merged versions land: on `'merged'` / `'merged-self'` shapes the mint and spend
 *  entries of a pair carry the SAME `compiledCode`, because they are handlers of one
 *  validator. `registryMint`/`registrySpend` and `protocolParamsMint`/`coordinationSpend`
 *  keep both slots so the split versions stay expressible; a merged blueprint simply repeats
 *  itself, and `deriveDeployment` applies the parameters once. */

/** The federated upgrade authority's parameters (`upgrade_multisig(signers, threshold)`). */
export interface UpgradeAuthority {
  /** verification-key hashes (hex) allowed to authorise an upgrade. */
  readonly signers: ReadonlyArray<string>
  /** how many of them a single upgrade transaction needs. */
  readonly threshold: number
}

/** The one-per-deployment inputs: a nonce + three seed outpoints for the NFT policies. */
export interface DeployConfig {
  readonly blueprint: Blueprint
  /** `always_fail` nonce (any bytes) — makes the always-fail instance unique. */
  readonly nonceHex: string
  /**
   * The `always_fail` script hash, supplied DIRECTLY instead of derived from `nonceHex`.
   *
   * For reproducing an EXISTING deployment whose nonce was never published. That hash is not
   * cosmetic: it parameterises `issuance_cbor_hex_mint`, whose policy id parameterises
   * `registry_mint`, so guessing it wrong silently yields the wrong registry policy — which
   * presents as an empty registry rather than as an error. CF's preview bootstrap publishes
   * the hash but not the nonce, which is exactly this case.
   */
  readonly alwaysFailHashHex?: string
  /** `coordination_spend` nonce, where the version has one. Defaults to `nonceHex`.
   *
   *  Separate because real deployments use separate values: CF's preview bootstrap
   *  (`528bf46`) has an always-fail lock at `5ff3439a…` and a coordination nonce of
   *  `76bf5880…`, and a single shared nonce cannot reproduce both. Deriving a deployment
   *  with the wrong one yields a params NFT policy that matches nothing on chain. */
  readonly coordinationNonceHex?: string
  /** seed outpoint spent by `protocol_params_mint` (one-shot params NFT). */
  readonly protocolParamsSeed: OutPoint
  /** seed outpoint spent by `issuance_cbor_hex_mint`. */
  readonly issuanceCborHexSeed: OutPoint
  /** seed outpoint spent by `registry_mint` (RegistryInit). */
  readonly registrySeed: OutPoint
  /** seed outpoint spent by `upgrade_multisig`'s one-shot config NFT. REQUIRED when
   *  `version.upgradeAuthority === 'config-tree'` (`0.5.0-alpha.4`), where the authority is a
   *  rotatable `MultisigScript` tree in a UTxO the authority itself owns, rather than an M-of-N
   *  baked into the script's parameters. */
  readonly upgradeMultisigSeed?: OutPoint
  /** the initial upgrade authority. REQUIRED when `version.hasCoordination` — its
   *  credential goes into the params datum as `upgrade_cred` and is who may rewrite that
   *  datum. Deliberately not defaulted: an accidental single-signer or threshold-0
   *  authority is a silent takeover of the whole deployment. */
  readonly upgrade?: UpgradeAuthority
  /**
   * `max_inline_datum_bytes` — the bound every holder-created PLB output's inline datum
   * must satisfy (upstream #106 vector 3). REQUIRED when the version's params datum has the
   * field, and also when the version bakes it into the delegates
   * (`maxInlineDatumBytesSource === 'script-param'`, `0.5.0-alpha.4`).
   *
   * ⚑ On `'script-param'` versions this ONE value is applied to FOUR scripts — `transfer`,
   * `third_party`, `unfracking` and `issuance_logic` — each bounding only the outputs it
   * creates, with nothing on chain comparing them. A UTxO born under a laxer bound than the
   * one `transfer` later enforces is frozen AND unseizable, so the invariant is "one N for
   * all four", and it holds here by construction: this field is the only source.
   *
   * Not defaulted either: 0 forbids inline datums outright and a large value re-opens the
   * seizure-bloat vector, so the deployment has to choose. It stays retunable in place
   * through the upgrade rail.
   */
  readonly maxInlineDatumBytes?: bigint
}

/** The fully-derived deployment: every framework script hash / policy id + the applied
 *  scripts + the protocol-params datum (Constr 0 of the `ProgrammableLogicGlobalParams`). */
export interface Deployment {
  readonly alwaysFailHash: string
  readonly protocolParamsCs: string
  readonly issuanceCborHexCs: string
  readonly registrySpendCred: string
  readonly registryNodeCs: string
  /** the transfer withdraw-0 credential. On `V0_4_0` this is the PLG coordinator, which
   *  also parameterizes PLB; on `LATEST` it is the standalone `transfer` validator, named
   *  by the params datum and swappable without moving a single token. */
  readonly transferCred: string
  /** the PLB payment credential (`prog_logic_cred`) shared by every smart wallet. */
  readonly plbCred: string
  readonly unfrackingCred: string
  /** the standalone `third_party` credential — present iff `version.hasThirdPartyValidator`. */
  readonly thirdPartyCred?: string
  /** the coordination UTxO's spend credential (the params NFT's lock target) — present iff
   *  `version.hasCoordination`. Before, that lock target was `always_fail`. */
  readonly coordinationCred?: string
  /** the upgrade authority's withdraw-0 credential — present iff the version has one. */
  readonly upgradeCred?: string
  /** the `programmable_logic_global` dispatcher credential — present iff
   *  `version.dispatch === 'plg-dispatcher'`. What PLB reads out of the params datum, and
   *  what every programmable transaction withdraws from. */
  readonly plgCred?: string
  /** the `issuance_logic` withdraw-0 credential — present iff `version.hasIssuanceLogic`. */
  readonly issuanceLogicCred?: string
  /** applied `compiledCode` (hex) per validator, ready for the witness set / reference scripts. */
  readonly applied: {
    readonly protocolParamsMint: string
    readonly issuanceCborHexMint: string
    readonly registrySpend: string
    readonly registryMint: string
    readonly transfer: string
    readonly programmableLogicBase: string
    readonly unfracking: string
    readonly alwaysFail: string
    readonly thirdParty?: string
    readonly coordinationSpend?: string
    readonly upgradeMultisig?: string
    readonly programmableLogicGlobal?: string
    readonly issuanceLogic?: string
  }
  /** `ProgrammableLogicGlobalParams` inline datum (raw plutus_data hex) for the params UTxO. */
  readonly protocolParamsDatumHex: string
  /** the params-datum fields, as `Cip113.ProtocolParamsInfo` (minus the outpoint the mint tx sets). */
  readonly protocolParamsInfo: Omit<ProtocolParamsInfo, 'txHash' | 'index'>
  /** the `issuance_mint` template split around the minting-logic-credential hole — the
   *  `IssuanceCborHex` datum a substandard registration reads. A token's policy id is then
   *  `blake2b224(0x03 ‖ prefixHex ‖ mintingLogicHash ‖ postfixHex)` (see `deriveTokenPolicy`). */
  readonly issuanceTemplate: {
    readonly prefixHex: string
    readonly postfixHex: string
  }
}

/**
 * Derive a complete CIP-113 deployment from the blueprint + one-per-deployment seeds.
 * Applies deploy parameters in dependency order (no cycles: the params-NFT policy does
 * not depend on the later script hashes; only the params DATUM does). Returns every
 * derived hash/policy, the applied scripts, and the protocol-params datum. Requires the
 * injected attachment (`IssuerTag`) + the `Codec` (for the parameter PlutusData).
 */
export const deriveDeployment = (cfg: DeployConfig, version: Cip113Version = LATEST): Effect.Effect<Deployment, IssuerError | Cip113Error, IssuerTag> =>
  Effect.gen(function* () {
    const be = yield* IssuerTag
    const bp = cfg.blueprint
    const applyHash = (scriptHex: string, params: ReadonlyArray<string>) =>
      be.applyParams(scriptHex, params).pipe(Effect.flatMap((applied) => Effect.map(be.scriptHashV3(applied), (hash) => ({ applied, hash }))))

    const need = <T>(value: T | undefined, what: string): Effect.Effect<T, IssuerError> =>
      value === undefined ? Effect.fail(new IssuerError({ reason: `${what} is required for version ${version.id}` })) : Effect.succeed(value)

    // 1. always_fail(nonce) → always_fail_hash (still the issuance_cbor_hex_mint lock), or the
    //    caller's published hash when reproducing a deployment whose nonce we do not have.
    const alwaysFail =
      cfg.alwaysFailHashHex !== undefined
        ? { applied: '', hash: cfg.alwaysFailHashHex }
        : yield* applyHash(bp.alwaysFail, [yield* byteArrayParam(cfg.nonceHex)])

    // 2-3. the protocol-params NFT policy, and whatever locks its UTxO. Three shapes:
    //
    //      - `'split-always-fail'` — `protocol_params_mint(seed, always_fail_hash)`; the datum
    //        is frozen at mint, forever.
    //      - `'split-coordination'` — the lock becomes `coordination_spend(nonce)`, so the
    //        datum is respendable by the upgrade authority (upstream #99). Same parameter
    //        arity and TYPE as the always-fail lock, a different VALUE, so the resulting hash
    //        change is one no arity check could catch.
    //      - `'merged-self'` — one `protocol_params(seed)` validator whose mint handler locks
    //        the NFT at its OWN script hash (#118). The cycle dissolves: there is no lock
    //        target to pass, no nonce to choose, and the policy id and the address's payment
    //        credential are the same hash.
    const merged = version.protocolParams === 'merged-self'
    const coordination =
      version.protocolParams === 'split-coordination'
        ? yield* applyHash(yield* need(bp.coordinationSpend, 'blueprint.coordinationSpend'), [
            yield* byteArrayParam(cfg.coordinationNonceHex ?? cfg.nonceHex),
          ])
        : undefined
    const protocolParamsMint = yield* applyHash(bp.protocolParamsMint, [
      yield* outputRefParam(cfg.protocolParamsSeed.txHash, cfg.protocolParamsSeed.index),
      ...(merged ? [] : [yield* byteArrayParam(coordination?.hash ?? alwaysFail.hash)]),
    ])

    // 4. issuance_cbor_hex_mint(seed, always_fail_hash) → issuance_cbor_hex_cs
    const issuanceCborHexMint = yield* applyHash(bp.issuanceCborHexMint, [
      yield* outputRefParam(cfg.issuanceCborHexSeed.txHash, cfg.issuanceCborHexSeed.index),
      yield* byteArrayParam(alwaysFail.hash),
    ])

    // 5-6. the registry. TWO validators up to `0.5.0-alpha.2` — `registry_spend(params_cs)`
    //      for the node ADDRESS and `registry_mint(seed, cbor_cs, spend_cred)` for the node
    //      POLICY — and ONE from `0.5.0-alpha.4`, where the merged `registry(seed, cbor_cs)`
    //      locks the origin node at its own script hash. On the merged shape the two
    //      derivations collapse: the policy id IS the address's payment credential, and the
    //      dependency on the params policy is gone entirely (the spend handler reads the
    //      policy off its own input instead of out of the params datum).
    const registry =
      version.registry === 'merged'
        ? yield* Effect.gen(function* () {
            const merged = yield* applyHash(bp.registryMint, [
              yield* outputRefParam(cfg.registrySeed.txHash, cfg.registrySeed.index),
              yield* byteArrayParam(issuanceCborHexMint.hash),
            ])
            return { mint: merged, spend: merged }
          })
        : yield* Effect.gen(function* () {
            const spend = yield* applyHash(bp.registrySpend, [yield* byteArrayParam(protocolParamsMint.hash)])
            const mintParams = [
              yield* outputRefParam(cfg.registrySeed.txHash, cfg.registrySeed.index),
              yield* byteArrayParam(issuanceCborHexMint.hash),
            ]
            if (version.registryMintTakesSpendCred) mintParams.push(yield* credentialParam(script('script', spend.hash)))
            return { mint: yield* applyHash(bp.registryMint, mintParams), spend }
          })
    const registryMint = registry.mint
    const registrySpend = registry.spend

    // 7. PLB and the three delegates — and the ORDER between them inverted at
    //    `0.5.0-alpha.4`, which is the whole shape of the change:
    //
    //      - `'params-policy'` delegates take only the params NFT policy and read everything
    //        else live from its datum, so they can be derived before PLB (and, on `V0_4_0`,
    //        must be: PLB took the coordinator's credential).
    //      - `'plb-cs-bound'` delegates take `(plb_cred, registry_node_cs, bound)` and read no
    //        datum at all, so PLB — anchored to the params policy, which nothing else depends
    //        on — must come FIRST, and swapping a delegate now also recompiles the dispatcher.
    //
    //    Either way the deployment has no cycle; what changes is which edge points where.
    const applyDelegate = (
      code: string,
      plbHash: string | undefined,
    ): Effect.Effect<{ applied: string; hash: string }, IssuerError | Cip113Error> =>
      Effect.gen(function* () {
        const params =
          version.delegateParams === 'params-policy'
            ? [yield* byteArrayParam(protocolParamsMint.hash)]
            : [
                // `need` rather than a fallback: a delegate applied with an empty credential
                // yields a real, wrong hash, and the deployment would look derived.
                yield* credentialParam(script('script', yield* need(plbHash, 'programmable_logic_base derivation (delegates take its credential)'))),
                yield* byteArrayParam(registryMint.hash),
                yield* intParam(yield* need(cfg.maxInlineDatumBytes, 'config.maxInlineDatumBytes')),
              ]
        return yield* applyHash(code, params)
      })

    const plbFirst = version.delegateParams === 'plb-cs-bound'
    // PLB's own parameter: the params NFT policy (an anchor that cannot change, which is what
    // makes everything above it swappable), or — pre-`#99` — the coordinator's credential,
    // which is why the coordinator could never be replaced.
    const plbFromParams = (): Effect.Effect<{ applied: string; hash: string }, IssuerError | Cip113Error> =>
      Effect.gen(function* () {
        return yield* applyHash(bp.programmableLogicBase, [yield* byteArrayParam(protocolParamsMint.hash)])
      })

    const plbEarly = plbFirst ? yield* plbFromParams() : undefined
    const transfer = yield* applyDelegate(bp.transfer, plbEarly?.hash)
    const unfracking = yield* applyDelegate(bp.unfracking, plbEarly?.hash)
    const thirdParty = version.hasThirdPartyValidator
      ? yield* applyDelegate(yield* need(bp.thirdParty, 'blueprint.thirdParty'), plbEarly?.hash)
      : undefined
    const plb =
      plbEarly ??
      (version.plbParam === 'params-policy'
        ? yield* plbFromParams()
        : yield* applyHash(bp.programmableLogicBase, [yield* credentialParam(script('script', transfer.hash))]))

    // 8. the dispatcher, where the version has one. Parameterised by the three delegate
    //    HASHES, so it is derived last of the programmable-logic group and any delegate swap
    //    implies a new dispatcher too — an upgrade-coherence rule nothing on chain can check
    //    (a script cannot read another script's parameters), so it belongs in the runbook.
    const plg =
      version.dispatch === 'plg-dispatcher'
        ? yield* applyHash(yield* need(bp.programmableLogicGlobal, 'blueprint.programmableLogicGlobal'), [
            yield* byteArrayParam(transfer.hash),
            yield* byteArrayParam((yield* need(thirdParty, 'third_party derivation')).hash),
            yield* byteArrayParam(unfracking.hash),
          ])
        : undefined

    // 9. `issuance_logic` — the REPLACEABLE half of issuance (upstream #129). The permanent
    //    per-token policy keeps only what can never change; every rule that may change with
    //    the protocol lives here, named by a params-datum field, so rewriting that field
    //    changes the issuance rules for every token without moving a single policy id.
    const issuanceLogic = version.hasIssuanceLogic
      ? yield* applyHash(yield* need(bp.issuanceLogic, 'blueprint.issuanceLogic'), [
          yield* credentialParam(script('script', plb.hash)),
          yield* byteArrayParam(registryMint.hash),
          yield* byteArrayParam(protocolParamsMint.hash),
          yield* intParam(yield* need(cfg.maxInlineDatumBytes, 'config.maxInlineDatumBytes')),
        ])
      : undefined

    // 10. the upgrade authority.
    //
    //     `'flat-multisig'` bakes an M-of-N into the script's parameters, so rotating the
    //     membership means a new script and therefore an authority handover. `'config-tree'`
    //     (#126/#127) takes only a seed outpoint and owns a one-shot `UpgradeMultisig` NFT
    //     whose inline datum is a `MultisigScript` tree the authority rotates in place — the
    //     tree is a bootstrap-transaction concern, not a derivation input, which is why only
    //     the seed appears here.
    const upgrade = yield* Effect.gen(function* () {
      switch (version.upgradeAuthority) {
        case 'none':
          return undefined
        case 'flat-multisig': {
          const auth = yield* need(cfg.upgrade, 'config.upgrade')
          return yield* applyHash(yield* need(bp.upgradeMultisig, 'blueprint.upgradeMultisig'), [
            yield* byteArrayListParam(auth.signers),
            yield* intParam(BigInt(auth.threshold)),
          ])
        }
        case 'config-tree': {
          const seed = yield* need(cfg.upgradeMultisigSeed, 'config.upgradeMultisigSeed')
          return yield* applyHash(yield* need(bp.upgradeMultisig, 'blueprint.upgradeMultisig'), [
            yield* outputRefParam(seed.txHash, seed.index),
          ])
        }
      }
    })

    // The protocol-params datum — built POSITIONALLY from the version's layout, because this
    // datum has been REORDERED and had fields REMOVED, not merely appended to. Same discipline
    // as `registryNodeDatum`: a field the version omits is simply never placed, and every
    // field the version DOES declare is filled, so a layout that names an index we cannot
    // supply fails here rather than emitting a hole.
    const P = version.params
    const paramsFields = new Array<PlutusDataHex>(P.fieldCount)
    if (P.registryNodeCs !== null) paramsFields[P.registryNodeCs] = yield* byteArrayParam(registryMint.hash)
    if (P.progLogicCred !== null) paramsFields[P.progLogicCred] = yield* credentialParam(script('script', plb.hash))
    if (P.plgCred !== null) paramsFields[P.plgCred] = yield* credentialParam(script('script', (yield* need(plg, 'programmable_logic_global derivation')).hash))
    if (P.issuanceLogicCred !== null) {
      paramsFields[P.issuanceLogicCred] = yield* credentialParam(script('script', (yield* need(issuanceLogic, 'issuance_logic derivation')).hash))
    }
    if (P.transferCred !== null) paramsFields[P.transferCred] = yield* credentialParam(script('script', transfer.hash))
    if (P.thirdPartyCred !== null) paramsFields[P.thirdPartyCred] = yield* credentialParam(script('script', (yield* need(thirdParty, 'third_party derivation')).hash))
    if (P.unfrackingCred !== null) paramsFields[P.unfrackingCred] = yield* credentialParam(script('script', unfracking.hash))
    if (P.upgradeCred !== null) paramsFields[P.upgradeCred] = yield* credentialParam(script('script', (yield* need(upgrade, 'upgrade_multisig derivation')).hash))
    // Genesis is born AT REST: the nomination field is `None`, never `Some`. Upstream enforces
    // it at mint, and a protocol that could be born mid-handover would be one whose first
    // authority change had already half-happened before anyone saw it.
    if (P.pendingUpgradeCred !== null) paramsFields[P.pendingUpgradeCred] = yield* op("cip113None", () => Encode.plutusDataConstr(1n, []))
    if (P.maxInlineDatumBytes !== null) paramsFields[P.maxInlineDatumBytes] = yield* intParam(yield* need(cfg.maxInlineDatumBytes, 'config.maxInlineDatumBytes'))
    const protocolParamsDatumHex = yield* op("cip113ParamsDatum", () => Encode.plutusDataConstr(0n, paramsFields))

    // issuance_mint template: apply this version's parameters with a unique PLACEHOLDER in the
    // minting-logic-credential slot, then split the applied bytes around the placeholder's 28.
    // A substandard's token policy id is then
    // blake2b224(0x03 ‖ prefix ‖ its_minting_logic_hash ‖ postfix) — the on-chain
    // `apply_hashed_parameter` — verified equal to the directly-applied policy id.
    //
    // The slot is no longer third: `0.5.0-alpha.4` cut the parameters to
    // `(minting_logic_cred, params_policy)`, so the placeholder is FIRST and the prefix is
    // short. Nothing here assumes a position — `issuanceMintParams` orders them by name.
    const templateParams = yield* issuanceMintParams(version, {
      plbCred: plb.hash,
      registryNodeCs: registryMint.hash,
      mintingLogicCred: TEMPLATE_PLACEHOLDER,
      transferCred: transfer.hash,
      protocolParamsCs: protocolParamsMint.hash,
    })
    const templateApplied = yield* be.applyParams(bp.issuanceMint, templateParams)
    const at = templateApplied.indexOf(TEMPLATE_PLACEHOLDER)
    if (at < 0 || templateApplied.indexOf(TEMPLATE_PLACEHOLDER, at + 1) >= 0) {
      return yield* Effect.fail(new IssuerError({ reason: 'issuance template placeholder not found exactly once' }))
    }

    return {
      alwaysFailHash: alwaysFail.hash,
      protocolParamsCs: protocolParamsMint.hash,
      issuanceCborHexCs: issuanceCborHexMint.hash,
      registrySpendCred: registrySpend.hash,
      registryNodeCs: registryMint.hash,
      transferCred: transfer.hash,
      plbCred: plb.hash,
      unfrackingCred: unfracking.hash,
      ...(thirdParty !== undefined ? { thirdPartyCred: thirdParty.hash } : {}),
      ...(coordination !== undefined ? { coordinationCred: coordination.hash } : {}),
      ...(upgrade !== undefined ? { upgradeCred: upgrade.hash } : {}),
      ...(plg !== undefined ? { plgCred: plg.hash } : {}),
      ...(issuanceLogic !== undefined ? { issuanceLogicCred: issuanceLogic.hash } : {}),
      applied: {
        protocolParamsMint: protocolParamsMint.applied,
        issuanceCborHexMint: issuanceCborHexMint.applied,
        registrySpend: registrySpend.applied,
        registryMint: registryMint.applied,
        transfer: transfer.applied,
        programmableLogicBase: plb.applied,
        unfracking: unfracking.applied,
        alwaysFail: alwaysFail.applied,
        ...(thirdParty !== undefined ? { thirdParty: thirdParty.applied } : {}),
        ...(coordination !== undefined ? { coordinationSpend: coordination.applied } : {}),
        ...(upgrade !== undefined ? { upgradeMultisig: upgrade.applied } : {}),
        ...(plg !== undefined ? { programmableLogicGlobal: plg.applied } : {}),
        ...(issuanceLogic !== undefined ? { issuanceLogic: issuanceLogic.applied } : {}),
      },
      protocolParamsDatumHex,
      // Mirror of the datum we just built — only the fields this version actually carries,
      // so a consumer reading it back gets the same picture the chain will hand them.
      protocolParamsInfo: {
        ...(P.registryNodeCs !== null ? { registryNodeCsHex: registryMint.hash } : {}),
        ...(P.progLogicCred !== null ? { progLogicCred: script('script', plb.hash) } : {}),
        ...(P.plgCred !== null && plg !== undefined ? { plgCred: script('script', plg.hash) } : {}),
        ...(P.issuanceLogicCred !== null && issuanceLogic !== undefined ? { issuanceLogicCred: script('script', issuanceLogic.hash) } : {}),
        ...(P.pendingUpgradeCred !== null ? { pendingUpgradeCred: null } : {}),
        ...(P.transferCred !== null ? { transferCred: script('script', transfer.hash) } : {}),
        ...(P.thirdPartyCred !== null && thirdParty !== undefined ? { thirdPartyCred: script('script', thirdParty.hash) } : {}),
        ...(P.unfrackingCred !== null ? { unfrackingCred: script('script', unfracking.hash) } : {}),
        ...(P.upgradeCred !== null && upgrade !== undefined ? { upgradeCred: script('script', upgrade.hash) } : {}),
        ...(P.maxInlineDatumBytes !== null && cfg.maxInlineDatumBytes !== undefined ? { maxInlineDatumBytes: cfg.maxInlineDatumBytes } : {}),
      },
      issuanceTemplate: {
        prefixHex: templateApplied.slice(0, at),
        postfixHex: templateApplied.slice(at + TEMPLATE_PLACEHOLDER.length),
      },
    }
  })

/**
 * A registered token's issuance policy for a substandard whose minting-logic credential
 * is `mintingLogicHash` (a script hash): applies `issuance_mint` with the deployment's
 * fixed params + this credential and returns the policy id + the applied minting script.
 * The policy id equals `blake2b224(0x03 ‖ prefix ‖ mintingLogicHash ‖ postfix)` from the
 * `issuanceTemplate` (the on-chain `apply_hashed_parameter`).
 */
export const deriveTokenPolicy = (
  blueprintIssuanceMint: string,
  deployment: Deployment,
  mintingLogicHash: string,
  version: Cip113Version = LATEST,
): Effect.Effect<{ readonly policyId: string; readonly appliedScript: string }, IssuerError | Cip113Error, IssuerTag> =>
  Effect.gen(function* () {
    const be = yield* IssuerTag
    // `issuance_mint`'s parameters are version-shaped in arity, type AND order — see
    // `issuanceMintParams`. Applying them by name here is what keeps this in step with the
    // template `deriveDeployment` splits, which is the whole point of sharing the builder:
    // the policy id derived two ways must agree, and a positional list would let them drift
    // silently on the next upstream reorder.
    const appliedScript = yield* be.applyParams(
      blueprintIssuanceMint,
      yield* issuanceMintParams(version, {
        plbCred: deployment.plbCred,
        registryNodeCs: deployment.registryNodeCs,
        mintingLogicCred: mintingLogicHash,
        transferCred: deployment.transferCred,
        protocolParamsCs: deployment.protocolParamsCs,
      }),
    )
    const policyId = yield* be.scriptHashV3(appliedScript)
    return { policyId, appliedScript }
  })

// ── deploy transactions (ordinary plan-engine tx building over the derived scripts) ──

/** The canonical origin `RegistryNode` (empty key, sentinel next, empty credentials) —
 *  mirrors `registry_node.origin_node`, whose four credential fields are all `empty_vkey`. */
const originNode = {
  keyHex: ORIGIN_NODE_KEY,
  nextHex: SENTINEL_NEXT_KEY,
  mintingLogicScript: ABSENT_CRED,
  transferLogicScript: ABSENT_CRED,
  thirdPartyTransferLogicScript: ABSENT_CRED,
  unfrackingLogicScript: ABSENT_CRED,
  globalStateCsHex: '',
}

/** `protocol_params.protocol_params_token` — the params NFT asset name. */
const PROTOCOL_PARAMS_TOKEN_HEX = Bytes.toHex(new TextEncoder().encode('ProtocolParams'))

export interface BootstrapConfig {
  readonly network: Network
  /** the derived deployment (from `deriveDeployment`) — its seeds MUST equal the ones below. */
  readonly deployment: Deployment
  /** the seed UTxO `protocol_params_mint` consumes (outpoint must match the deployment's). */
  readonly protocolParamsSeed: Plan.PlanInput
  /** the seed UTxO `registry_mint` (RegistryInit) consumes. */
  readonly registrySeed: Plan.PlanInput
  readonly fundingInputs: ReadonlyArray<Plan.PlanInput>
  readonly collateral: ReadonlyArray<OutPoint>
  readonly changeAddressHex: Brands.AddressHex
  readonly params: Plan.ProtocolParams
  readonly costModels: ReadonlyArray<{ readonly language: number; readonly costs: ReadonlyArray<bigint> }>
  readonly paramsMintExUnits: readonly [bigint, bigint]
  readonly registryMintExUnits: readonly [bigint, bigint]
  /** ada locked in each NFT (params + origin) output; default 2 ADA. */
  readonly nftOutputAda?: bigint
  /** schema revision (default `LATEST`) — decides the origin node's datum layout and where
   *  the params NFT must be locked. MUST match the version `deployment` was derived with. */
  readonly version?: Cip113Version
  /**
   * The upgrade authority's withdraw-0, which `protocol_params.mint` REQUIRES in the genesis
   * transaction from `v0.0.1` on (upstream #143): the authority the datum names must run and
   * consent right there, so a typo or an undeployed script hash can never be born as the
   * authority. For an `upgrade_multisig` authority this exercises the configured tree through
   * its real withdrawal handler, which is why minting a well-formed config tree is not enough.
   *
   * Required when `version.paramsGenesisAuthorityWithdrawal`; honoured on any version if
   * supplied (the withdrawal is part of the transaction the caller asked for either way).
   */
  readonly upgradeAuthorityActivation?: {
    /** the authority's reward account (hex) — must be the `upgrade_cred` in the params datum. */
    readonly rewardAcctHex: string
    /** the authority validator itself (the applied `upgrade_multisig`, or whatever stands in). */
    readonly scriptHex: string
    /** its withdraw-0 redeemer — for `upgrade_multisig`, the Sundae `MultisigScript` proof. */
    readonly redeemerHex: string
    readonly exUnits: readonly [bigint, bigint]
  }
}

/**
 * Build the UNSIGNED CIP-113 bootstrap transaction — the one-time framework deploy:
 * spend the two seed UTxOs, MINT the ProtocolParams NFT (locked with the
 * `ProgrammableLogicGlobalParams` inline datum) and the registry ORIGIN node (RegistryInit;
 * locked at the registry-spend script address with the origin datum). Both are Plutus
 * minting policies (scripts in the witness, one mint redeemer each; index via
 * `mintPolicyHex`). Composes the plan engine; ex-units are caller-supplied (measure them
 * with the attachment's `evalTx`). Requires only the `Codec` (scripts are pre-derived).
 *
 * ⚠️ WHERE the params NFT is locked is version-dependent, and `protocol_params_mint`
 * enforces it: at `always_fail` before the upgrade rail existed, and at
 * `coordination_spend` once it did (upstream #99 — the datum is no longer frozen at mint,
 * it is respendable by the upgrade authority). Sending it to the old lock target on a
 * `hasCoordination` deployment fails phase 2 at the mint, not later.
 *
 * ⚠️ From `v0.0.1` the mint ALSO requires the datum's `upgrade_cred` withdraw-0 in this same
 * transaction (`paramsGenesisAuthorityWithdrawal`). Supply `upgradeAuthorityActivation`; a
 * bootstrap without it builds cleanly and dies in phase 2, so this refuses to emit one.
 */
export const buildBootstrapTx = (cfg: BootstrapConfig): Effect.Effect<Plan.UnsignedPlanTx, Plan.BuildError | Cip113Error> =>
  Effect.gen(function* () {
    const d = cfg.deployment
    const net = cfg.network
    const version = cfg.version ?? LATEST
    // Genesis authority activation (upstream #143): a 0-coin withdrawal from the datum's
    // `upgrade_cred`, its validator in the witness set, its own redeemer. Checked first so a
    // caller on a version that demands it is told before anything else can fail.
    const activation = cfg.upgradeAuthorityActivation
    if (version.paramsGenesisAuthorityWithdrawal && activation === undefined) {
      return yield* Effect.fail(
        new Plan.BuildError({
          reason: `version ${version.id} requires the upgrade authority's withdraw-0 in the genesis transaction (upstream #143): supply upgradeAuthorityActivation`,
        }),
      )
    }
    const ada = cfg.nftOutputAda ?? 2_000_000n
    const paramsAsset = `${d.protocolParamsCs}.${PROTOCOL_PARAMS_TOKEN_HEX}`
    const originAsset = `${d.registryNodeCs}.` // origin token name is the empty bytestring

    // Where the params NFT is locked, which is the same three-way split as its derivation:
    // always-fail (frozen forever), `coordination_spend` (the #99 upgrade rail), or — after the
    // #118 merge — the params validator's OWN hash, the minting policy naming itself.
    const paramsLockHash =
      version.protocolParams === 'merged-self'
        ? d.protocolParamsCs
        : version.protocolParams === 'split-coordination'
          ? d.coordinationCred
          : d.alwaysFailHash
    if (paramsLockHash === undefined) {
      return yield* Effect.fail(new Plan.BuildError({ reason: `deployment has no coordinationCred, required by version ${version.id}` }))
    }

    const paramsValue = yield* op("cip113BootstrapParamsValue", () => Encode.assetsOf(ada, [paramsAsset], [1n]))
    const originValue = yield* op("cip113BootstrapOriginValue", () => Encode.assetsOf(ada, [originAsset], [1n]))
    const originDatum = yield* registryNodeDatum(originNode, version)

    const redeemers: Array<Plan.PlanRedeemer> = [
      // protocol_params_mint ignores its redeemer data (unit); index resolved via mintPolicyHex.
      { tag: 1, index: 0n, dataHex: PlutusDataHex(PLB_UNIT), mem: cfg.paramsMintExUnits[0], steps: cfg.paramsMintExUnits[1], mintPolicyHex: d.protocolParamsCs },
      // registry_mint RegistryInit = Constr 0 [] (= unit CBOR d87980).
      { tag: 1, index: 0n, dataHex: PlutusDataHex(PLB_UNIT), mem: cfg.registryMintExUnits[0], steps: cfg.registryMintExUnits[1], mintPolicyHex: d.registryNodeCs },
    ]

    const withdrawals: Array<Plan.PlanWithdrawal> = []
    const scriptsV3 = [ScriptHex(d.applied.protocolParamsMint), ScriptHex(d.applied.registryMint)]
    if (activation !== undefined) {
      withdrawals.push({ rewardAcctHex: activation.rewardAcctHex, amount: 0n })
      scriptsV3.push(ScriptHex(activation.scriptHex))
      redeemers.push({
        tag: 3,
        index: 0n,
        dataHex: PlutusDataHex(activation.redeemerHex),
        mem: activation.exUnits[0],
        steps: activation.exUnits[1],
        withdrawalRewardAcctHex: activation.rewardAcctHex,
      })
    }

    return yield* planAttempt(() => Plan.buildUnsigned({
      mandatoryInputs: [cfg.protocolParamsSeed, cfg.registrySeed],
      inputs: cfg.fundingInputs,
      outputs: [
        { addressHex: Encode.enterpriseScriptHex(net, paramsLockHash), assets: paramsValue, datumHex: d.protocolParamsDatumHex },
        { addressHex: Encode.enterpriseScriptHex(net, d.registrySpendCred), assets: originValue, datumHex: originDatum },
      ],
      changeAddressHex: cfg.changeAddressHex,
      params: cfg.params,
      withdrawals,
      mint: [
        { assetId: paramsAsset, amount: 1n, policyScriptHex: '' }, // '' → Plutus policy (script below)
        { assetId: originAsset, amount: 1n, policyScriptHex: '' },
      ],
      plutus: {
        scriptsV3,
        redeemers,
        costModels: cfg.costModels,
        collateral: cfg.collateral.map((c) => ({ txHash: Brands.TxHashHex(c.txHash), index: c.index })),
      },
      signerCount: 1,
    }))
  })

/** Plutus unit `Constr 0 []` — the ignored/RegistryInit redeemer payload. */
const PLB_UNIT = 'd87980'

// ── issuance-cbor-hex deploy (creates the reference UTxO registration reads) ──────

const ISSUANCE_CBOR_HEX_TOKEN_HEX = Bytes.toHex(new TextEncoder().encode('IssuanceCborHex'))

export interface IssuanceCborHexConfig {
  readonly network: Network
  readonly deployment: Deployment
  /** the seed UTxO `issuance_cbor_hex_mint` consumes (outpoint must match the deployment's). */
  readonly issuanceCborHexSeed: Plan.PlanInput
  readonly fundingInputs: ReadonlyArray<Plan.PlanInput>
  readonly collateral: ReadonlyArray<OutPoint>
  readonly changeAddressHex: Brands.AddressHex
  readonly params: Plan.ProtocolParams
  readonly costModels: ReadonlyArray<{ readonly language: number; readonly costs: ReadonlyArray<bigint> }>
  readonly mintExUnits: readonly [bigint, bigint]
  readonly nftOutputAda?: bigint
}

/**
 * Build the UNSIGNED issuance-cbor-hex deploy transaction: mint the `IssuanceCborHex`
 * reference NFT and lock it at the always-fail script address with the
 * `IssuanceCborHex{prefix, postfix}` datum (the issuance template split — see
 * `deriveDeployment.issuanceTemplate`). A token registration later reads this UTxO as a
 * reference input to validate the new policy id. Plutus minting policy; Codec only.
 */
export const buildIssuanceCborHexTx = (cfg: IssuanceCborHexConfig): Effect.Effect<Plan.UnsignedPlanTx, Plan.BuildError | Cip113Error> =>
  Effect.gen(function* () {
    const d = cfg.deployment
    const ada = cfg.nftOutputAda ?? 2_000_000n
    const asset = `${d.issuanceCborHexCs}.${ISSUANCE_CBOR_HEX_TOKEN_HEX}`
    const value = yield* op("cip113IssuanceCborHexValue", () => Encode.assetsOf(ada, [asset], [1n]))
    // IssuanceCborHex datum = Constr 0 [bytes(prefix), bytes(postfix)]
    const datum = yield* op("cip113IssuanceCborHexDatum", () =>
      Encode.plutusDataConstr(0n, [Encode.plutusDataBytes(d.issuanceTemplate.prefixHex), Encode.plutusDataBytes(d.issuanceTemplate.postfixHex)]),
    )
    return yield* planAttempt(() => Plan.buildUnsigned({
      mandatoryInputs: [cfg.issuanceCborHexSeed],
      inputs: cfg.fundingInputs,
      outputs: [{ addressHex: Encode.enterpriseScriptHex(cfg.network, d.alwaysFailHash), assets: value, datumHex: datum }],
      changeAddressHex: cfg.changeAddressHex,
      params: cfg.params,
      mint: [{ assetId: asset, amount: 1n, policyScriptHex: '' }],
      plutus: {
        scriptsV3: [ScriptHex(d.applied.issuanceCborHexMint)],
        redeemers: [{ tag: 1, index: 0n, dataHex: PlutusDataHex(PLB_UNIT), mem: cfg.mintExUnits[0], steps: cfg.mintExUnits[1], mintPolicyHex: d.issuanceCborHexCs }],
        costModels: cfg.costModels,
        collateral: cfg.collateral.map((c) => ({ txHash: Brands.TxHashHex(c.txHash), index: c.index })),
      },
      signerCount: 1,
    }))
  })

// ── register a token policy (RegistryInsert — the linked-list insert) ─────────────

/** A registry node UTxO being spent as the covering node of an insert. */
export interface CoveringNode {
  readonly txHash: Brands.TxHashHex
  readonly index: number
  /** the covering node's current on-chain value (its node NFT + ada). */
  readonly assets: Assets.Assets
  /** the covering node's current datum content. */
  readonly node: RegistryNode
}

/** The substandard's `transfer_logic` / `minting_logic` scripts + a withdraw-0 redeemer. */
export interface RegisterConfig {
  readonly network: Network
  readonly deployment: Deployment
  readonly coveringNode: CoveringNode
  /** the policy id being registered (= `deriveTokenPolicy(...).policyId`; 28-byte hex). */
  readonly newKey: string
  /** the substandard credentials that go into the new node (all 28-byte script hashes). */
  readonly mintingLogic: Credential
  readonly transferLogic: Credential
  readonly thirdPartyLogic: Credential
  /** the issuer-declared unfracking hook. Omit for default-DENY (`ABSENT_CRED` =
   *  `empty_vkey` = unfracking forbidden for this policy), which is what upstream
   *  `linked_list.ak` treats as the unset state. */
  readonly unfrackingLogic?: Credential
  readonly globalStateCsHex?: string
  /** the substandard minting-logic withdraw-0 (proof of instance): script + redeemer + units. */
  readonly substandard: { readonly scriptHex: ScriptHex; readonly redeemerDataHex: PlutusDataHex; readonly exUnits: readonly [bigint, bigint] }
  /** reference inputs: the protocol-params UTxO + the issuance-cbor-hex UTxO. */
  readonly protocolParamsRef: OutPoint
  readonly issuanceCborHexRef: OutPoint
  readonly fundingInputs: ReadonlyArray<Plan.PlanInput>
  readonly collateral: ReadonlyArray<OutPoint>
  readonly changeAddressHex: Brands.AddressHex
  readonly params: Plan.ProtocolParams
  readonly costModels: ReadonlyArray<{ readonly language: number; readonly costs: ReadonlyArray<bigint> }>
  readonly registrySpendExUnits: readonly [bigint, bigint]
  readonly registryMintExUnits: readonly [bigint, bigint]
  readonly nftOutputAda?: bigint
}

/**
 * Build the UNSIGNED RegistryInsert transaction — register a new programmable-token policy
 * by inserting a node into the sorted registry linked list: spend the covering node
 * (registry_spend), MINT the new node NFT (registry_mint, RegistryInsert), and emit TWO node
 * outputs — the updated covering node (`next → newKey`) and the new node
 * (`key = newKey`, `next = covering.next`, substandard credentials). The substandard's
 * minting-logic runs via a 0-coin withdrawal (proof of instance). References the params +
 * issuance-cbor-hex UTxOs. Requires the `Codec`.
 */
export const buildRegisterTx = (cfg: RegisterConfig): Effect.Effect<Plan.UnsignedPlanTx, Plan.BuildError | Cip113Error> =>
  Effect.gen(function* () {
    const d = cfg.deployment
    const net = cfg.network
    const ada = cfg.nftOutputAda ?? 2_000_000n
    const regAddr = Encode.enterpriseScriptHex(net, d.registrySpendCred)
    const coveringAsset = `${d.registryNodeCs}.${cfg.coveringNode.node.keyHex}`
    const newAsset = `${d.registryNodeCs}.${cfg.newKey}`

    // updated covering node (only `next` changes → newKey) keeps its NFT + ada
    const updatedCoveringDatum = yield* registryNodeDatum({ ...cfg.coveringNode.node, nextHex: cfg.newKey })
    const updatedCoveringValue = yield* op("cip113CoveringValue", () => Encode.assetsOf(ada, [coveringAsset], [1n]))
    // the new inserted node
    const newNode: RegistryNode = {
      keyHex: cfg.newKey,
      nextHex: cfg.coveringNode.node.nextHex,
      mintingLogicScript: cfg.mintingLogic,
      transferLogicScript: cfg.transferLogic,
      thirdPartyTransferLogicScript: cfg.thirdPartyLogic,
      unfrackingLogicScript: cfg.unfrackingLogic ?? ABSENT_CRED,
      globalStateCsHex: cfg.globalStateCsHex ?? '',
    }
    const newNodeDatum = yield* registryNodeDatum(newNode)
    const newNodeValue = yield* op("cip113NewNodeValue", () => Encode.assetsOf(ada, [newAsset], [1n]))

    // RegistryInsert{key, minting_logic_script} = Constr 1 [bytes, Credential]. The
    // `RegistrationMode` tag (RegisterOnly/RegisterAndMint) that used to be a third field
    // was removed upstream as redundant (re-audit R-06, `ca7864f`): whether the tx also
    // carries a first mint is now `issuance_mint`'s business, not registry_mint's.
    const mintingLogicData = yield* credentialParam(cfg.mintingLogic)
    const registryInsertRedeemer = yield* op("cip113RegistryInsert", () =>
      Encode.plutusDataConstr(1n, [Encode.plutusDataBytes(cfg.newKey), PlutusDataHex(mintingLogicData)]),
    )
    const substandardAcct = Encode.rewardScriptHex(net, cfg.mintingLogic.hashHex)

    const redeemers: Array<Plan.PlanRedeemer> = [
      // registry_spend of the covering node (ignores its redeemer data)
      { tag: 0, index: 0n, dataHex: PlutusDataHex(PLB_UNIT), mem: cfg.registrySpendExUnits[0], steps: cfg.registrySpendExUnits[1], spendOutpoint: { txHash: Brands.TxHashHex(cfg.coveringNode.txHash), index: cfg.coveringNode.index } },
      // registry_mint RegistryInsert
      { tag: 1, index: 0n, dataHex: registryInsertRedeemer, mem: cfg.registryMintExUnits[0], steps: cfg.registryMintExUnits[1], mintPolicyHex: d.registryNodeCs },
      // substandard minting-logic withdraw-0 (proof of instance)
      { tag: 3, index: 0n, dataHex: PlutusDataHex(cfg.substandard.redeemerDataHex), mem: cfg.substandard.exUnits[0], steps: cfg.substandard.exUnits[1], withdrawalRewardAcctHex: substandardAcct },
    ]

    return yield* planAttempt(() => Plan.buildUnsigned({
      mandatoryInputs: [{ txHash: Brands.TxHashHex(cfg.coveringNode.txHash), index: cfg.coveringNode.index, assets: cfg.coveringNode.assets }],
      inputs: cfg.fundingInputs,
      outputs: [
        { addressHex: regAddr, assets: updatedCoveringValue, datumHex: updatedCoveringDatum },
        { addressHex: regAddr, assets: newNodeValue, datumHex: newNodeDatum },
      ],
      changeAddressHex: cfg.changeAddressHex,
      params: cfg.params,
      mint: [{ assetId: newAsset, amount: 1n, policyScriptHex: '' }],
      withdrawals: [{ rewardAcctHex: substandardAcct, amount: 0n }],
      plutus: {
        scriptsV3: [ScriptHex(d.applied.registrySpend), ScriptHex(d.applied.registryMint), ScriptHex(cfg.substandard.scriptHex)],
        redeemers,
        costModels: cfg.costModels,
        collateral: cfg.collateral.map((c) => ({ txHash: Brands.TxHashHex(c.txHash), index: c.index })),
        referenceInputs: [cfg.protocolParamsRef, cfg.issuanceCborHexRef].map((r) => ({ txHash: Brands.TxHashHex(r.txHash), index: r.index })),
      },
      signerCount: 1,
    }))
  })

// ── issue (mint) programmable tokens into a smart wallet ──────────────────────────

export interface IssuanceConfig {
  readonly network: Network
  readonly deployment: Deployment
  /** on-chain schema revision to build for (default `LATEST`). Decides whether the transaction
   *  carries the `issuance_logic` withdraw-0 and the params reference input. */
  readonly version?: Cip113Version
  /** the applied `issuance_mint` script + its policy id (from `deriveTokenPolicy`). */
  readonly tokenPolicyScriptHex: ScriptHex
  readonly tokenPolicyId: string
  /** the registry node for this policy, as a reference input. */
  readonly registryNodeRef: OutPoint
  /**
   * The protocol-params UTxO, as a reference input. REQUIRED when
   * `version.hasIssuanceLogic` (`0.5.0-alpha.4`): the permanent policy reads
   * `issuance_logic_cred` out of its datum at `params_idx` on EVERY mint, including the
   * `OutputIndex` path that previously needed no params reference at all.
   */
  readonly protocolParamsRef?: OutPoint
  /**
   * The applied `issuance_logic` script + its ex-units. REQUIRED when
   * `version.hasIssuanceLogic`.
   *
   * Issuance is two scripts from `0.5.0-alpha.4` (upstream #129): the token's PERMANENT policy,
   * which only proves that the substandard's minting logic ran and that the protocol's issuance
   * logic covered this policy, and the REPLACEABLE `issuance_logic`, which holds every rule
   * that may change with the protocol. Replacing the latter changes issuance for every token
   * at once and moves no policy id — which is the entire point, and why the withdrawal is not
   * optional.
   */
  readonly issuanceLogic?: { readonly scriptHex: ScriptHex; readonly exUnits: readonly [bigint, bigint] }
  readonly mintingLogic: Credential
  readonly substandard: { readonly scriptHex: ScriptHex; readonly redeemerDataHex: PlutusDataHex; readonly exUnits: readonly [bigint, bigint] }
  /** the recipient's own stake credential (the smart-wallet owner). */
  readonly recipient: Credential
  readonly assetNameHex: string
  readonly amount: bigint
  readonly fundingInputs: ReadonlyArray<Plan.PlanInput>
  readonly collateral: ReadonlyArray<OutPoint>
  readonly changeAddressHex: Brands.AddressHex
  readonly params: Plan.ProtocolParams
  readonly costModels: ReadonlyArray<{ readonly language: number; readonly costs: ReadonlyArray<bigint> }>
  readonly issuanceExUnits: readonly [bigint, bigint]
  readonly nftOutputAda?: bigint
}

/**
 * Build the UNSIGNED issuance transaction — mint programmable tokens of an already-registered
 * policy into the recipient's smart wallet (a PLB output). `issuance_mint` runs in `RefInput`
 * mode (the registry node is a reference input); the substandard minting-logic runs via a
 * 0-coin withdrawal. All minted tokens must land at the PLB address (a smart wallet), which
 * this builder emits. Requires the `Codec`.
 */
export const buildIssuanceTx = (cfg: IssuanceConfig): Effect.Effect<Plan.UnsignedPlanTx, Plan.BuildError | Cip113Error> =>
  Effect.gen(function* () {
    const d = cfg.deployment
    const net = cfg.network
    const ada = cfg.nftOutputAda ?? 2_000_000n
    const asset = `${cfg.tokenPolicyId}.${cfg.assetNameHex}`
    const walletValue = yield* op("cip113IssuanceWalletValue", () => Encode.assetsOf(ada, [asset], [cfg.amount]))
    const substandardAcct = Encode.rewardScriptHex(net, cfg.mintingLogic.hashHex)
    const version = cfg.version ?? LATEST
    const splitIssuance = version.hasIssuanceLogic

    // Reference inputs, ledger-sorted, because both index hints below are positions in THAT
    // list — not in the order they are listed here.
    const refInputs = [
      { txHash: Brands.TxHashHex(cfg.registryNodeRef.txHash), index: cfg.registryNodeRef.index },
      ...(splitIssuance && cfg.protocolParamsRef !== undefined
        ? [{ txHash: Brands.TxHashHex(cfg.protocolParamsRef.txHash), index: cfg.protocolParamsRef.index }]
        : []),
    ].sort((a, b) => (a.txHash < b.txHash ? -1 : a.txHash > b.txHash ? 1 : a.index - b.index))
    const refIdxOf = (o: OutPoint): number => refInputs.findIndex((r) => r.txHash === o.txHash && r.index === o.index)
    const nodeIdx = refIdxOf(cfg.registryNodeRef)

    if (splitIssuance && (cfg.protocolParamsRef === undefined || cfg.issuanceLogic === undefined)) {
      return yield* Effect.fail(
        new Plan.BuildError({ reason: `version ${version.id} splits issuance: protocolParamsRef and issuanceLogic are both required` }),
      )
    }

    // ⚠️ The mint redeemer is `Constr 0 [int]` on BOTH shapes and the integer means DIFFERENT
    // THINGS: `MintingRegistryProof::RefInput { index }` (the registry NODE's position) before,
    // `IssuanceMintRedeemer { params_idx }` (the params UTxO's position) after. A builder that
    // kept the old value produces a decodable redeemer pointing at the wrong reference input.
    const mintRedeemer = splitIssuance
      ? yield* op("cip113IssuanceMintRedeemer", () => Encode.plutusDataConstr(0n, [Encode.plutusDataInt(String(refIdxOf(cfg.protocolParamsRef!)))]))
      : yield* op("cip113RefInput", () => Encode.plutusDataConstr(0n, [Encode.plutusDataInt(String(nodeIdx))]))

    const redeemers: Array<Plan.PlanRedeemer> = [
      { tag: 1, index: 0n, dataHex: mintRedeemer, mem: cfg.issuanceExUnits[0], steps: cfg.issuanceExUnits[1], mintPolicyHex: cfg.tokenPolicyId },
      { tag: 3, index: 0n, dataHex: PlutusDataHex(cfg.substandard.redeemerDataHex), mem: cfg.substandard.exUnits[0], steps: cfg.substandard.exUnits[1], withdrawalRewardAcctHex: substandardAcct },
    ]
    const withdrawals: Array<Plan.PlanWithdrawal> = [{ rewardAcctHex: substandardAcct, amount: 0n }]
    const scriptsV3 = [cfg.tokenPolicyScriptHex, cfg.substandard.scriptHex]

    if (splitIssuance) {
      const logicCred = d.issuanceLogicCred
      if (logicCred === undefined) {
        return yield* Effect.fail(new Plan.BuildError({ reason: `deployment has no issuanceLogicCred, required by version ${version.id}` }))
      }
      // `IssuanceLogicRedeemer = Pairs<PolicyId, MintingRegistryProof>` — one entry per policy
      // issued in this transaction. The permanent policy decodes it as `Pairs<PolicyId, Data>`
      // and only requires its OWN policy among the keys; the values are issuance_logic's
      // business. That map-keyed-by-policy shape is the one thing about issuance upstream has
      // committed to never changing.
      const logicAcct = Encode.rewardScriptHex(net, logicCred)
      const logicRedeemer = yield* op("cip113IssuanceLogicRedeemer", () =>
        Encode.plutusDataMap(
          [Encode.plutusDataBytes(cfg.tokenPolicyId)],
          [Encode.plutusDataConstr(0n, [Encode.plutusDataInt(String(nodeIdx))])],
        ),
      )
      withdrawals.push({ rewardAcctHex: logicAcct, amount: 0n })
      redeemers.push({
        tag: 3,
        index: 0n,
        dataHex: logicRedeemer,
        mem: cfg.issuanceLogic!.exUnits[0],
        steps: cfg.issuanceLogic!.exUnits[1],
        withdrawalRewardAcctHex: logicAcct,
      })
      scriptsV3.push(cfg.issuanceLogic!.scriptHex)
    }

    return yield* planAttempt(() => Plan.buildUnsigned({
      inputs: cfg.fundingInputs,
      outputs: [{ addressHex: smartWalletAddressHex(net, d.plbCred, cfg.recipient), assets: walletValue }],
      changeAddressHex: cfg.changeAddressHex,
      params: cfg.params,
      mint: [{ assetId: asset, amount: cfg.amount, policyScriptHex: '' }],
      withdrawals,
      plutus: {
        scriptsV3,
        redeemers,
        costModels: cfg.costModels,
        collateral: cfg.collateral.map((c) => ({ txHash: Brands.TxHashHex(c.txHash), index: c.index })),
        referenceInputs: refInputs,
      },
      signerCount: 1,
    }))
  })
