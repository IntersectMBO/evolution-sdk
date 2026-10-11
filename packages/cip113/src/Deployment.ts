// CIP-113 deployment records — WHERE a programmable-token protocol instance lives.
//
// Everything in `cip113.ts` is a fact about the CIP-113 SHAPES (datum layouts, redeemers,
// the withdraw-zero structure). Nothing there says which script hashes are in play: those
// are chosen at deploy time, differ per network, and — while the standard is pre-release —
// change whenever the reference implementation is redeployed. So they are DATA, held here,
// never constants baked into logic.
//
// Why this matters more than usual for CIP-113: the PLB script hash IS the payment
// credential of every programmable-token address. A redeploy moves every user's smart
// wallet. Code that hardcodes a hash does not merely go stale, it silently looks at the
// wrong addresses and reports a zero balance. Hence: one record, passed in.
//
// ── the trust rule ──────────────────────────────────────────────────────────────
// A deployment record is OUR configuration, and it is the only authority on which
// scripts a protocol instance is made of. Chain data is checked AGAINST it, never the
// other way around: a registry node tells us a policy's RULES, it never tells us a UTxO
// is ours or that a script is the real PLB. `cip113-query.ts` verifies every script it
// fetches against these hashes for exactly that reason.

import { Brands } from "@evolution-sdk/review"

import { Network } from "./Types.js"
import type { Cip113Version } from "./Versions.js"
import { V0_0_1 } from "./Versions.js"

/** A transaction output reference. */
export interface DeploymentOutPoint {
  readonly txHash: Brands.TxHashHex
  readonly index: number
}

/**
 * One deployed CIP-113 protocol instance.
 *
 * Optional fields are genuinely absent, never `''` — an empty hash is a valid-looking
 * credential that silently matches nothing (`ABSENT_CRED` exists in `cip113.ts` precisely
 * because the ON-CHAIN sentinel is a distinct concept, and the two must not be conflated).
 */
export interface Cip113Deployment {
  /** Stable identifier for this instance, e.g. `'cf-preview-2026-08-26'`. Appears in errors. */
  readonly id: string
  /** Address-header network — what a bech32 address for this deployment encodes. */
  readonly network: Network
  /**
   * CIP-142 network magic — WHICH CHAIN this instance lives on. 764824073 mainnet, 1 preprod,
   * 2 preview.
   *
   * Required, and not derivable from `network`: preview and preprod are both `Network.Testnet`,
   * because the address header has one bit for mainnet-or-not and nothing that separates two
   * testnets. They are nonetheless different chains running different protocol instances whose
   * script hashes share nothing, so `network` alone cannot pick a record — and picking the wrong
   * one is the failure this file exists to prevent: a smart-wallet address derived from the
   * other chain's PLB is well-formed, resolves, and holds nothing.
   */
  readonly protocolMagic: number
  /** On-chain schema revision these scripts were built from. Drives datum layouts. */
  readonly version: Cip113Version

  /** `programmable_logic_base` — the PAYMENT credential of every smart wallet here. */
  readonly plbScriptHashHex: string
  /** The transfer withdraw-zero stake validator — `transfer` on the PLB-dispatch shape,
   *  `programmable_logic_global` on every earlier one. RENAMED from `plgScriptHashHex`
   *  when upstream dissolved the coordinator (`342c47d`). */
  readonly transferScriptHashHex: string
  /** Standalone `third_party` (seize / clawback / freeze) withdraw-zero validator, where the
   *  deployment's shape has one (`version.hasThirdPartyValidator`). */
  readonly thirdPartyScriptHashHex?: string

  /**
   * `programmable_logic_global` — the DISPATCHER, on `'plg-dispatcher'` deployments only
   * (`0.5.0-alpha.4` and later). Every programmable transaction carries its withdraw-0, and
   * PLB's `wdrl_idx` points at it.
   *
   * Recorded here as an EXPECTATION, not as an input: the live value is `plg_cred` in the
   * params datum, which the upgrade authority may rewrite in place without moving a token.
   * Build from the chain's value and use this to notice that an upgrade has happened.
   */
  readonly plgScriptHashHex?: string

  /**
   * `max_inline_datum_bytes` — the bound every PLB output's inline datum must satisfy.
   *
   * Chain state up to `0.5.0-alpha.2` (params datum field 6) and a DEPLOYMENT property from
   * `0.5.0-alpha.4`, where it is a compile-time parameter of `transfer`, `third_party`,
   * `unfracking` and `issuance_logic`. Upstream's rule for that era: ONE value applied to all
   * four, asserted by the deploy tooling from the applied blueprints — four scripts each
   * bounding only the outputs it creates, with nothing on chain comparing them, means a
   * mismatch mints UTxOs that are frozen and unseizable.
   */
  readonly maxInlineDatumBytes?: bigint

  /** `issuance_logic` — the replaceable half of issuance (`0.5.0-alpha.4`, upstream #129).
   *  Every mint and burn carries its withdraw-0. Like `plgScriptHashHex`, an expectation:
   *  the live value is params datum field 1. */
  readonly issuanceLogicScriptHashHex?: string

  /**
   * Policy id of the protocol-params NFT.
   *
   * Permanent *within* a deployment — it is the one thing the upgradability-era PLB is
   * parameterised by, so it can never be re-pointed while that deployment lives. It is NOT
   * permanent *across* deployments, and must not be used as a cross-deployment trust anchor:
   * the policy is one-shot, minted from a seed UTxO, so a fresh bootstrap necessarily
   * produces a new one. Measured against CF's own preview redeploy (platform `12637c7c` →
   * `84d9fcd1`): the params policy moved (`42bce424…` → `a4addfe8…`) along with every other
   * hash in the record. There is no on-chain value that survives a redeploy — this record is
   * the anchor, and following a redeploy means shipping a new one.
   */
  readonly paramsPolicyHex: string
  /** Asset name (hex) of that NFT. */
  readonly paramsAssetNameHex: string
  /** Address holding the params UTxO. Always-fail in older deployments; the guarded
   *  `coordination_spend` in upgradability-era ones. Either way we only READ it. */
  readonly paramsAddressBech32: Brands.Bech32

  /** Policy id of the registry-node NFTs (`registry_mint`; the merged `registry` from
   *  `0.5.0-alpha.4`). */
  readonly registryPolicyHex: string
  /** `registry_spend` — the address every registry node sits at.
   *
   *  From `0.5.0-alpha.4` the registry's two halves are ONE validator, so this is the SAME
   *  hash as `registryPolicyHex`: the minting policy names itself as the lock. Two fields are
   *  kept rather than one because they are two different roles that only coincide on some
   *  versions, and `validateDeployment` asserts the coincidence where the version implies it. */
  readonly registrySpendScriptHashHex: string

  /**
   * `issuance_cbor_hex_mint` policy id — the one-shot NFT whose datum carries the
   * `issuance_mint` TEMPLATE a registration reads. Not needed to read or transfer.
   *
   * RENAMED from `issuancePolicyHex`, which described it as the `issuance_mint` policy id.
   * That was wrong: in CF's bootstrap records the value comes from `issuanceParams.scriptHash`,
   * which feeds `directoryMintParams.issuanceScriptHash` — i.e. `registry_mint`'s
   * `issuance_cbor_hex_cs` parameter. Established by re-deriving it from the seed outpoint and
   * always-fail hash, in the `alpha.2` era. ⚠️ That re-derivation NO LONGER RUNS: it went through
   * the `coordination_spend` the merge removed, so it cannot be ported to `v0.0.1`. The rename
   * stands on reading the live records back off chain, not on a re-derivation. There is no single
   * `issuance_mint` policy id to record: that script is parameterised per substandard.
   */
  readonly issuanceCborHexPolicyHex?: string
  /** Standalone `unfracking` validator, where the deployment has one. */
  readonly unfrackingScriptHashHex?: string

  /** Script hashes known to be always-fail in this deployment. A `third_party_transfer
   *  _logic_script` pointing at one of these means the issuer cannot seize — a fact worth
   *  telling a holder, and one that can only be established per deployment. */
  readonly alwaysFailScriptHashHexes?: ReadonlyArray<string>

  /** Published reference scripts, when the deployment publishes them. `cip113-query.ts`
   *  sources the pre-applied CBOR from these instead of a local blueprint. */
  readonly refScripts?: {
    readonly plb?: DeploymentOutPoint
    /** the transfer delegate (`plg` before the split). */
    readonly transfer?: DeploymentOutPoint
    /** the `programmable_logic_global` dispatcher (`0.5.0-alpha.4` and later). Required in
     *  practice on those deployments: every programmable transaction runs it. */
    readonly plg?: DeploymentOutPoint
    readonly thirdParty?: DeploymentOutPoint
    readonly unfracking?: DeploymentOutPoint
    /** `issuance_logic` (`0.5.0-alpha.4` and later). Every mint and burn carries its withdraw-0. */
    readonly issuanceLogic?: DeploymentOutPoint
  }

  /** PLB credentials of SUPERSEDED generations of this same protocol instance.
   *
   *  A redeploy strands tokens at the old PLB, so a holder can have UTxOs under a
   *  credential that is no longer current. Recording the ones we can substantiate lets a
   *  consumer say "a previous deployment" instead of "unrecognised" — the two mean very
   *  different things to someone looking for their tokens.
   *
   *  Only ever populate this with generations traced to a source (an operator's published
   *  bootstrap record, a deploy transaction). An unexplained script credential sharing a
   *  user's stake credential is NOT evidence of a prior generation — a DEX, escrow or
   *  multisig address looks identical from the outside. */
  readonly priorGenerations?: ReadonlyArray<PriorGeneration>
}

/** A superseded deployment generation, and how we know. */
export interface PriorGeneration {
  readonly id: string
  readonly plbScriptHashHex: string
  /** Where this attribution comes from. Required: an unsourced entry is a guess that
   *  will be read as a fact by everything downstream. */
  readonly source: string
}

/** `ProtocolParams` — the params NFT asset name, hex-encoded. */
export const PARAMS_ASSET_NAME_HEX = '50726f746f636f6c506172616d73'

/** CIP-142 network magic for mainnet. The testnets' magics are deployment data, not constants:
 *  preprod is 1 and preview is 2 today, and a new testnet picks its own. */
export const MAINNET_MAGIC = 764824073

/**
 * The Cardano Foundation's reference deployment on **preview**, bootstrapped 2026-10-02.
 *
 * Supersedes `cf-preview-2026-09-28` and shares not one hash with it — the fourth preview instance
 * in six months. CF re-bootstraps rather than upgrades, so each generation is a different protocol
 * and every holder's smart-wallet address moves with the PLB; the superseded PLBs live in
 * `priorGenerations` so a stranded holder is told "a previous deployment" instead of "unrecognised".
 *
 * Bootstrap tx `8e9668a6…3d00f9` (block 4,717,846, epoch 1438); reference scripts published one
 * block later in `f543e7b8…ccb6dd`. Transcribed from CF's `protocol-bootstraps-preview.json` at
 * platform `4f90d04` (`schemaVersion: 3`) and then CHECKED AGAINST CHAIN: the bootstrap and
 * reference-script transactions are both confirmed, the params NFT has supply 1 and was minted in
 * the bootstrap, and `paramsAddressBech32` below is DERIVED through `Encode.enterpriseScriptHex`
 * rather than transcribed, then confirmed to hold that NFT — so it is the address production
 * resolves, not one that merely looks right.
 *
 * ⚠️ **`programmable_logic_global` was applied with an ALL-ZERO unfracking parameter**, where
 * `cf-preview-2026-09-28` named the real `unfracking` hash. Every CF bootstrap from 2026-09-30
 * onward does this, on all three chains. `unfrackingScriptHashHex` below is the deployed script,
 * which is real and published, but the dispatcher does not name it: treat unfracking as
 * unavailable until CF re-bootstraps. Transfers never route through it and are unaffected.
 */
export const CF_PREVIEW_2026_10_02: Cip113Deployment = {
  id: 'cf-preview-2026-10-02',
  network: Network.Testnet,
  protocolMagic: 2,
  version: V0_0_1,

  plbScriptHashHex: '35622813d81ba2d6e068c7d52f6fdad5aa2a5d84b212ec3e28716c16',
  transferScriptHashHex: '5fe7c82a32a69e5839e9da77e1e9992c1e55f7d372c3d58d8f744ef7',
  thirdPartyScriptHashHex: '4c601638f4ee5ad3ba71d4d1b8a0b24b9117b7b3a679c66a96dfb7c6',
  plgScriptHashHex: '3b212b37b1a1fb334539c42e7473376a7fc15b60c26ae0fd4d06279e',
  issuanceLogicScriptHashHex: '621131d2df1acfdad5928a34572834cde904502441d6d41c642a10f6',
  maxInlineDatumBytes: 1024n,

  // `V0_0_1` is `protocolParams: 'merged-self'`, and chain agrees: the params UTxO sits at the
  // script address of the params policy itself, so these two hashes are one hash.
  paramsPolicyHex: '1d2026310c70f07ac25e39d591055723f5f8a84ac0de229eb0525720',
  paramsAssetNameHex: PARAMS_ASSET_NAME_HEX,
  paramsAddressBech32: Brands.Bech32('addr_test1wqwjqf33p3c0q7kztcuatyg92u3lt79gftqdug57kpf9wgqcmhu3w'),

  registryPolicyHex: 'e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a',
  registrySpendScriptHashHex: 'e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a',

  issuanceCborHexPolicyHex: 'aed824ff0432c6e40c4cc7381890496dd5bcb9e2fa39af7c8abd88c3',
  unfrackingScriptHashHex: '2798c1fcdc5f2b2b4ab9a72ce68add485d81915c5430e4ac79afc87b',

  alwaysFailScriptHashHexes: ['f56ecc476fe566d166e9f9cbf3eb935f2f939247abe44bf746a8d16a'],

  refScripts: {
    plb: { txHash: Brands.TxHashHex('f543e7b8126102afa7bae9e790d5616d8eff0671635900d9bf33c21a72ccb6dd'), index: 0 },
    plg: { txHash: Brands.TxHashHex('f543e7b8126102afa7bae9e790d5616d8eff0671635900d9bf33c21a72ccb6dd'), index: 1 },
    transfer: { txHash: Brands.TxHashHex('f543e7b8126102afa7bae9e790d5616d8eff0671635900d9bf33c21a72ccb6dd'), index: 2 },
    thirdParty: { txHash: Brands.TxHashHex('f543e7b8126102afa7bae9e790d5616d8eff0671635900d9bf33c21a72ccb6dd'), index: 3 },
    unfracking: { txHash: Brands.TxHashHex('f543e7b8126102afa7bae9e790d5616d8eff0671635900d9bf33c21a72ccb6dd'), index: 4 },
    issuanceLogic: { txHash: Brands.TxHashHex('f543e7b8126102afa7bae9e790d5616d8eff0671635900d9bf33c21a72ccb6dd'), index: 5 },
  },

  priorGenerations: [
    {
      id: 'cf-preview-2026-09-28',
      plbScriptHashHex: 'fed8a46eb192bebe99569904264d4be49f59894bd93ce880c6d56601',
      source: 'cardano-foundation/cip113-programmable-tokens-platform@1cf8025 protocol-bootstraps-preview.json (superseded by 4f90d04)',
    },
    {
      id: 'cf-preview-2026-08-26',
      plbScriptHashHex: '698c48a630206282690774aebcfa9410895c09f85bc103b19f9888dc',
      source: 'cardano-foundation/cip113-programmable-tokens-platform@528bf46 protocol-bootstraps-preview.json (superseded by 1cf8025)',
    },
    {
      id: 'cf-preview-2026-08',
      plbScriptHashHex: '33ceea92481cd6cc5b9ad1750302642042bb8ea5d028b830ad86fc31',
      source: 'cardano-foundation/cip113-programmable-tokens-platform@84d9fcd1 protocol-bootstraps-preview.json (superseded by 528bf46)',
    },
    {
      id: 'cf-preview-2026-04',
      plbScriptHashHex: 'd0c5433c422b815883b22ec43d4c512e92579b5dd5846e6b3aeafd6f',
      source: 'cardano-foundation/cip113-programmable-tokens-platform@12637c7c protocol-bootstraps-preview.json',
    },
  ],
}

/**
 * The Cardano Foundation's reference deployment on **preprod**, bootstrapped 2026-10-02 — the
 * third instance on that chain in four days.
 *
 * Bootstrap tx `f4118e53…f5c896` (block 5,245,005, epoch 316); reference scripts in
 * `e24679be…267b59`. Transcribed from `protocol-bootstraps-preprod.json` at platform `075934e`
 * and verified against chain exactly as preview above, params address derived rather than
 * transcribed.
 *
 * ⚠️ Same all-zero unfracking parameter as every bootstrap since 2026-09-30. Preprod has never
 * had a dispatcher that names its unfracking script.
 */
export const CF_PREPROD_2026_10_02: Cip113Deployment = {
  id: 'cf-preprod-2026-10-02',
  network: Network.Testnet,
  protocolMagic: 1,
  version: V0_0_1,

  plbScriptHashHex: 'be59f7750a5d947bb649e70d574d066791ec34a1dfee2a087c8511e3',
  transferScriptHashHex: '5ff03dd084ec86a164dbf9bfe890605fe9fcba8d6657328eab8bb350',
  thirdPartyScriptHashHex: '4bd96a9082194ff43ddd10d3092167f5856375959ff0ca1e1478ef6a',
  plgScriptHashHex: 'b4e81fa9a3291025cd279067daf4e43578d4c3f759e5490958f58cf6',
  issuanceLogicScriptHashHex: '23b58b985141fe5ffd2eb93c5ee4fa0e11d46a934c2837c0230071fd',
  maxInlineDatumBytes: 1024n,

  paramsPolicyHex: 'b4a18f212ea3415750f709f3516357b1a72bd30346d194e563af3b00',
  paramsAssetNameHex: PARAMS_ASSET_NAME_HEX,
  paramsAddressBech32: Brands.Bech32('addr_test1wz62rrep9635z46s7uylx5tr27c6w27nqdrdr989vwhnkqqvhlg0n'),

  registryPolicyHex: '3083d387537f9318b6ff5aeab7de5f5629d26495319b8fafd409222a',
  registrySpendScriptHashHex: '3083d387537f9318b6ff5aeab7de5f5629d26495319b8fafd409222a',

  issuanceCborHexPolicyHex: 'aeb9c3fbfa1150f128f5806e797c84294cfb4936a061fcf5d3975ca7',
  unfrackingScriptHashHex: 'e0a7938719cf21dfb39454c6dfb180207c52b006c02293b9cce37f18',

  alwaysFailScriptHashHexes: ['4bbe11a924a833ea06b488439409365ec41e270046fd9bef59c8b02d'],

  refScripts: {
    plb: { txHash: Brands.TxHashHex('e24679be141c1b99a49f47fcdc3e46ad09571baf0f8fa0d5b0d6094d55267b59'), index: 0 },
    plg: { txHash: Brands.TxHashHex('e24679be141c1b99a49f47fcdc3e46ad09571baf0f8fa0d5b0d6094d55267b59'), index: 1 },
    transfer: { txHash: Brands.TxHashHex('e24679be141c1b99a49f47fcdc3e46ad09571baf0f8fa0d5b0d6094d55267b59'), index: 2 },
    thirdParty: { txHash: Brands.TxHashHex('e24679be141c1b99a49f47fcdc3e46ad09571baf0f8fa0d5b0d6094d55267b59'), index: 3 },
    unfracking: { txHash: Brands.TxHashHex('e24679be141c1b99a49f47fcdc3e46ad09571baf0f8fa0d5b0d6094d55267b59'), index: 4 },
    issuanceLogic: { txHash: Brands.TxHashHex('e24679be141c1b99a49f47fcdc3e46ad09571baf0f8fa0d5b0d6094d55267b59'), index: 5 },
  },

  priorGenerations: [
    {
      id: 'cf-preprod-2026-09-30',
      plbScriptHashHex: 'd255fd34ae145421b823481f5860b16af1ac2a5664e1b12dfdbeffb5',
      source: 'cardano-foundation/cip113-programmable-tokens-platform@31e3844 protocol-bootstraps-preprod.json (superseded by 075934e)',
    },
    {
      id: 'cf-preprod-2026-09-29',
      plbScriptHashHex: 'feae586b49b345c78cf110cb24bd380c65e9f2f346017543d52ec9ae',
      source: 'cardano-foundation/cip113-programmable-tokens-platform@a2446ad protocol-bootstraps-preprod.json (superseded by 31e3844)',
    },
  ],
}

/**
 * The Cardano Foundation's reference deployment on **mainnet**, bootstrapped 2026-10-06 — the
 * first CIP-113 instance on a chain carrying real value, which is why it has no
 * `priorGenerations`.
 *
 * Bootstrap tx `bfefbd22…0cdb72` (block 14,016,602, epoch 659); reference scripts in
 * `6f251261…d52d37`. Transcribed from `protocol-bootstraps-mainnet.json` at platform `e5c5cbe`
 * and verified against chain the same way as the testnets: the file existed and was an EMPTY
 * record from `593cd51` (2026-10-01) until that commit, so "no mainnet deployment" was true
 * rather than merely unrecorded.
 *
 * ⚠️ **CF's platform README still reads "Research & Development | Not Production Ready | Security
 * Audit Required"**, while the contracts repo gained audit reports on 2026-10-01 (`1715f82`). The
 * validators are the same `v0.0.1` code as both testnets — `6b75ba3`, unmoved since 2026-09-23 —
 * so this record differs from them only in applied parameters, and the inherited ex-unit
 * measurements still apply.
 *
 * ⚠️ All-zero unfracking parameter, as everywhere since 2026-09-30.
 */
export const CF_MAINNET_2026_10_06: Cip113Deployment = {
  id: 'cf-mainnet-2026-10-06',
  network: Network.Mainnet,
  protocolMagic: MAINNET_MAGIC,
  version: V0_0_1,

  plbScriptHashHex: 'd91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838',
  transferScriptHashHex: 'cb418959c00d6779e176fcf6227824a6ac3b5bea7a672ef66a216dae',
  thirdPartyScriptHashHex: '92e307862c5374ee78f3cfdaaa45447f7f0db6776d54fa5f8df1a85c',
  plgScriptHashHex: '46b61f0584f21481b22ea18f945e48ac4148f50fc3ade494a7762440',
  issuanceLogicScriptHashHex: 'ed3fb7e046b4f3387e0749fb46847dbc15e85e61aaa76558f968136d',
  maxInlineDatumBytes: 1024n,

  paramsPolicyHex: '3a511ec25af655c1aef31d0d9c0c6154eae7321045b1fa46fac55ecd',
  paramsAssetNameHex: PARAMS_ASSET_NAME_HEX,
  paramsAddressBech32: Brands.Bech32('addr1wya9z8kzttm9tsdw7vwsm8qvv92w4eejzpzmr7jxltz4angjdhxsc'),

  registryPolicyHex: '484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075',
  registrySpendScriptHashHex: '484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075',

  issuanceCborHexPolicyHex: '8151b7a3d4c17bfd1d3779c2726e76a06db47e36ba6c160d9a2d60f6',
  unfrackingScriptHashHex: 'd431d4cba00d664acb127bb391c211086ca72fe570fd85f139af578e',

  alwaysFailScriptHashHexes: ['75ca74b539789793532627e82c9a2368a9ebad577d797597a9f9a0d5'],

  refScripts: {
    plb: { txHash: Brands.TxHashHex('6f25126164d14e6675f5ec09e8e2a0addfe303d8f49879d74eeeccf9c7d52d37'), index: 0 },
    plg: { txHash: Brands.TxHashHex('6f25126164d14e6675f5ec09e8e2a0addfe303d8f49879d74eeeccf9c7d52d37'), index: 1 },
    transfer: { txHash: Brands.TxHashHex('6f25126164d14e6675f5ec09e8e2a0addfe303d8f49879d74eeeccf9c7d52d37'), index: 2 },
    thirdParty: { txHash: Brands.TxHashHex('6f25126164d14e6675f5ec09e8e2a0addfe303d8f49879d74eeeccf9c7d52d37'), index: 3 },
    unfracking: { txHash: Brands.TxHashHex('6f25126164d14e6675f5ec09e8e2a0addfe303d8f49879d74eeeccf9c7d52d37'), index: 4 },
    issuanceLogic: { txHash: Brands.TxHashHex('6f25126164d14e6675f5ec09e8e2a0addfe303d8f49879d74eeeccf9c7d52d37'), index: 5 },
  },
}

/**
 * The deployments we ship, by id. An app may supply its own record instead.
 *
 * **One record per CHAIN, and superseded deployments are not kept.** A record is somewhere to
 * transact; once CF redeploys, the old instance is not that, and maintaining two invites the
 * ambiguity consumers refuse to resolve: a consumer that has to choose should report a
 * misconfiguration when a chain has two records and its configuration names neither, because
 * guessing points every holder's smart-wallet address at the wrong protocol. What a superseded
 * deployment leaves behind is its PLB credential in the successor's `priorGenerations`, which is
 * enough to recognise stranded tokens without pretending they are somewhere to send more.
 *
 * ⚠️ The chain is `protocolMagic`, NOT `network`. Preview and preprod are both `Network.Testnet`
 * — the address header has no bit that separates them — so keying this rule on `network` would
 * make the two records below permanently ambiguous to every testnet caller. They are different
 * chains carrying different protocol instances, and only the magic says which.
 *
 * The value type is explicitly `| undefined` rather than relying on the consumer's
 * `noUncheckedIndexedAccess`: this repo has that flag on, but the published `.d.ts` is
 * compiled against whatever the CONSUMER sets, and a project without it would see a typo'd
 * id typed as a real deployment and get `undefined` at runtime. Prefer `deploymentById`.
 */
export const DEPLOYMENTS: Readonly<Record<string, Cip113Deployment | undefined>> = {
  [CF_PREVIEW_2026_10_02.id]: CF_PREVIEW_2026_10_02,
  [CF_PREPROD_2026_10_02.id]: CF_PREPROD_2026_10_02,
  [CF_MAINNET_2026_10_06.id]: CF_MAINNET_2026_10_06,
}

/** The result of resolving a deployment id. Never a deployment "close enough" to the ask. */
export type DeploymentLookup =
  | { readonly kind: 'found'; readonly deployment: Cip113Deployment }
  | { readonly kind: 'unknown-id'; readonly id: string; readonly known: ReadonlyArray<string> }
  | { readonly kind: 'network-mismatch'; readonly id: string; readonly expected: Network; readonly actual: Network }

/**
 * Resolve a deployment id, optionally asserting the network.
 *
 * **This never falls back.** An unknown id and an id whose network disagrees are both
 * reported, not silently resolved to the nearest record. The reason is specific to CIP-113
 * rather than general tidiness: during a redeploy there is a window where the old and the
 * new record are both shipped, and "resolve to something adjacent" there means picking one
 * of two LIVE protocols at random — reading a stale registry, or worse, building a transfer
 * against a PLB the user holds nothing at. A misconfiguration must surface as one.
 */
export const deploymentById = (id: string, expectedNetwork?: Network): DeploymentLookup => {
  const deployment = DEPLOYMENTS[id]
  if (deployment === undefined) return { kind: 'unknown-id', id, known: Object.keys(DEPLOYMENTS) }
  if (expectedNetwork !== undefined && deployment.network !== expectedNetwork) {
    return { kind: 'network-mismatch', id, expected: expectedNetwork, actual: deployment.network }
  }
  return { kind: 'found', deployment }
}

const HASH28 = /^[0-9a-f]{56}$/
const isHash28 = (s: string): boolean => HASH28.test(s)

/**
 * Structural check of a deployment record — every credential is a 28-byte lowercase hex
 * hash, the params asset name is hex, reference-script outpoints are well formed. Returns
 * the problems found (empty = well formed).
 *
 * Worth running on any record that did not come from this file: a typo in a script hash
 * produces no error at any layer, just an empty balance, which reads as "the user holds
 * nothing" rather than "we are looking in the wrong place".
 */
export const validateDeployment = (d: Cip113Deployment): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const hash = (label: string, v: string): void => {
    if (!isHash28(v)) problems.push(`${label} is not a 28-byte lowercase hex hash: ${JSON.stringify(v)}`)
  }
  hash('plbScriptHashHex', d.plbScriptHashHex)
  hash('transferScriptHashHex', d.transferScriptHashHex)
  if (d.thirdPartyScriptHashHex !== undefined) hash('thirdPartyScriptHashHex', d.thirdPartyScriptHashHex)
  hash('paramsPolicyHex', d.paramsPolicyHex)
  hash('registryPolicyHex', d.registryPolicyHex)
  hash('registrySpendScriptHashHex', d.registrySpendScriptHashHex)
  if (d.issuanceCborHexPolicyHex !== undefined) hash('issuanceCborHexPolicyHex', d.issuanceCborHexPolicyHex)
  if (d.unfrackingScriptHashHex !== undefined) hash('unfrackingScriptHashHex', d.unfrackingScriptHashHex)
  if (d.plgScriptHashHex !== undefined) hash('plgScriptHashHex', d.plgScriptHashHex)
  if (d.issuanceLogicScriptHashHex !== undefined) hash('issuanceLogicScriptHashHex', d.issuanceLogicScriptHashHex)

  // Version-implied structure. These are the record's own consistency rules, and they are the
  // cheapest place to catch a record transcribed from the wrong generation of a protocol whose
  // validator set has now merged twice.
  if (d.version.registry === 'merged' && d.registryPolicyHex !== d.registrySpendScriptHashHex) {
    problems.push(
      `version ${d.version.id} has a merged registry, so registryPolicyHex and registrySpendScriptHashHex must be the same hash (got ${d.registryPolicyHex} and ${d.registrySpendScriptHashHex})`,
    )
  }
  if (d.version.dispatch === 'plg-dispatcher' && d.plgScriptHashHex === undefined) {
    problems.push(`version ${d.version.id} dispatches through programmable_logic_global, so plgScriptHashHex is required`)
  }
  if (d.version.dispatch !== 'plg-dispatcher' && d.plgScriptHashHex !== undefined) {
    problems.push(`version ${d.version.id} has no dispatcher, so plgScriptHashHex must be absent`)
  }
  if (d.version.hasIssuanceLogic && d.issuanceLogicScriptHashHex === undefined) {
    problems.push(`version ${d.version.id} splits issuance, so issuanceLogicScriptHashHex is required`)
  }
  // Where the bound is a compile-time parameter it cannot be read from chain, so a record that
  // omits it leaves `buildTransferTx` unable to reject an over-bound datum before submission.
  if (d.version.maxInlineDatumBytesSource === 'script-param' && d.maxInlineDatumBytes === undefined) {
    problems.push(
      `version ${d.version.id} bakes max_inline_datum_bytes into the delegates, so maxInlineDatumBytes is required here — it cannot be read from the params datum`,
    )
  }

  // A magic that disagrees with the address header is the transcription error that produces a
  // record for the wrong chain while every hash in it still looks perfectly well formed.
  if (!Number.isInteger(d.protocolMagic) || d.protocolMagic < 0) {
    problems.push(`protocolMagic must be a non-negative integer: ${JSON.stringify(d.protocolMagic)}`)
  } else if ((d.protocolMagic === MAINNET_MAGIC) !== (d.network === Network.Mainnet)) {
    problems.push(
      `protocolMagic ${d.protocolMagic} and network ${d.network} disagree about whether this is mainnet`,
    )
  }

  if (!/^([0-9a-f]{2})*$/.test(d.paramsAssetNameHex)) problems.push(`paramsAssetNameHex is not hex: ${JSON.stringify(d.paramsAssetNameHex)}`)
  if (d.paramsAddressBech32.length === 0) problems.push('paramsAddressBech32 is empty')
  if (d.id.length === 0) problems.push('id is empty')

  for (const [label, ref] of Object.entries(d.refScripts ?? {})) {
    if (ref === undefined) continue
    if (!/^[0-9a-f]{64}$/.test(ref.txHash)) problems.push(`refScripts.${label}.txHash is not a 32-byte hex hash`)
    if (!Number.isInteger(ref.index) || ref.index < 0) problems.push(`refScripts.${label}.index must be a non-negative integer`)
  }
  return problems
}
