// CIP-113 chain reads — a real `Cip113.Query` over the `Provider` seam.
//
// `cip113.ts` declares the query seam and ships `staticQuery` for tests; this is the
// implementation that talks to a chain. It needs no indexer features beyond `utxosAt`:
// all three reads are UTxOs at ONE address.
//
//   registry nodes  → the `registry_spend` address (every node lives there)
//   protocol params → the params/coordination address, picked out by its NFT
//   smart wallet    → base(payment = PLB script, stake = the owner's credential)
//
// So any Provider satisfies it — Koios today, Ogmios/Kupo/Blockfrost unchanged.
//
// ── the trust rule ──────────────────────────────────────────────────────────────
// The deployment record is the authority; chain data is checked against it. Concretely:
// the params datum's `prog_logic_cred` must equal the deployment's PLB hash, and a
// fetched reference script must hash to the credential we asked for. Both are places
// where believing the chain over our own configuration would mean reading (or spending
// from) an address the operator never chose. A registry node tells us a policy's RULES;
// it never tells us a UTxO is ours.

import type {
  UTxO} from "@evolution-sdk/evolution";
import {
  Address,
  Assets,
  Bytes,
  InlineDatum,
  OriginalBytes,
  PlutusV3,
  Provider,
  Script,
  ScriptHash,
  TransactionHash,
  TransactionInput
} from "@evolution-sdk/evolution"
import { Brands } from "@evolution-sdk/review"
import { Effect, Layer } from "effect"

import {
  type Credential,
  decodeGlobalParams,
  decodeRegistryNode,
  type ProtocolParamsInfo,
  type Query,
  QueryError,
  QueryTag,
  type RegistryNodeRef,
  smartWalletAddressHex,
  type SmartWalletUtxo} from "./Cip113.js"
import type { Cip113Deployment, DeploymentOutPoint } from "./Deployment.js"
import * as Encode from "./internal/Encode.js"
import { PlutusDataHex } from "./Types.js"

// ── script hashing (pure; PlutusV3 language prefix) ──────────────────────────────

/**
 * `blake2b-224(0x03 || script_bytes)` — the PlutusV3 script hash.
 *
 * Evolution's own `ScriptHash.fromScript` does the tagging, so this is not a second
 * implementation of the Conway rule; a hash check against a fetched script is only worth
 * anything if it agrees with what the ledger computes.
 *
 * @since 0.1.0
 */
export const scriptHashV3 = (scriptHex: string): string =>
  ScriptHash.toHex(ScriptHash.fromScript(new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(scriptHex) })))

// ── helpers ──────────────────────────────────────────────────────────────────────

/**
 * Does this UTxO carry a positive quantity of the asset?
 *
 * ⚠️ `nameHex` omitted means ANY name under the policy — which is what authenticates a
 * registry node, whose NFT name is the node key. Narrowing it by default would make every
 * node look unauthenticated.
 */
const hasAsset = (u: UTxO.UTxO, policyHex: string, nameHex?: string): boolean => {
  if (nameHex !== undefined) return Assets.getByUnit(u.assets, policyHex + nameHex) > 0n
  return Assets.getUnits(u.assets).some((unit) => unit.startsWith(policyHex) && Assets.getByUnit(u.assets, unit) > 0n)
}

const txHashOf = (u: UTxO.UTxO): Brands.TxHashHex => Brands.TxHashHex(TransactionHash.toHex(u.transactionId))

const outpoint = (u: { txHash: string; index: number }): string => `${u.txHash}#${u.index}`

/** Their `index` is a `Uint16` schema and therefore a `bigint`; a CIP-113 record carries a
 *  `number`. The schema's own bound (0..65535) is what makes the narrowing total. */
const indexOf = (u: UTxO.UTxO): number => Number(u.index)

const utxoOutpoint = (u: UTxO.UTxO): string => `${txHashOf(u)}#${u.index}`

/**
 * The inline datum EXACTLY as it arrived.
 *
 * ⚠️ `raw` and not a re-encode of the parsed tree. An empty Plutus array comes back with
 * definite framing where the chain wrote it indefinite, and a datum that re-encodes
 * differently hashes differently — so a re-derived registry node is a different node.
 */
type InlineDatumRead =
  /** No inline datum on this output — a fact, not a failure. */
  | { readonly _tag: "absent" }
  | { readonly _tag: "hex"; readonly hex: string }
  /**
   * An inline datum with no recorded bytes. Recorded by the decoder, and absent only for a datum built from
   * scratch, which a provider's UTxO never is — so re-encoding `data` here would quietly
   * produce the fabrication the recorded bytes exist to prevent. Returned rather than thrown: a throw
   * inside the `Effect.gen` bodies below would escape as a DEFECT, bypassing every `QueryError`
   * handler, which is the opposite of what a malformed read should do.
   */
  | { readonly _tag: "no-raw" }

const inlineDatumHexOf = (u: UTxO.UTxO): InlineDatumRead => {
  const d = u.datumOption
  if (d === undefined || !InlineDatum.isInlineDatum(d)) return { _tag: "absent" }
  const raw = OriginalBytes.get(d)
  if (raw === undefined) return { _tag: "no-raw" }
  return { _tag: "hex", hex: Bytes.toHex(raw) }
}

/** The owner of a smart-wallet UTxO is its STAKE credential. We only ever query one
 *  owner's address at a time, so the owner is what we asked for — not something read
 *  back out of the address the provider echoed. */
const asQueryError = (reason: string) => new QueryError({ reason })

// ── the layer ────────────────────────────────────────────────────────────────────

/**
 * A `Cip113.Query` backed by a `Provider`, reading the given deployment.
 *
 * Requires only `ProviderEffect` — the codec and decoder seams are gone, so the chain
 * access is the single dependency. It is captured when the layer is built, so the resulting
 * `Query` methods carry no requirements of their own (per the seam's contract in
 * `Cip113.ts`).
 *
 * Every failure is a `QueryError` naming the deployment and the offending outpoint —
 * "empty balance" and "we are looking at the wrong address" must never look alike.
 */
export const providerQuery = (
  deployment: Cip113Deployment
): Layer.Layer<QueryTag, never, Provider.ProviderEffect> =>
  Layer.effect(
    QueryTag,
    Effect.gen(function* () {
      const provider = yield* Provider.ProviderEffect
      return makeQuery(deployment, provider)
    })
  )

const makeQuery = (deployment: Cip113Deployment, provider: Provider.ProviderEffect): Query => {
  const where = `deployment ${deployment.id}`
  // ⚠️ The address is parsed inside the typed channel, not inside `Effect.suspend`: a throw
  // under `suspend` is a DEFECT, and a malformed deployment record would then bypass every
  // `QueryError` handler instead of being reported as the configuration error it is.
  const utxosAt = (addrHex: string): Effect.Effect<ReadonlyArray<UTxO.UTxO>, QueryError> =>
    Effect.try({
      try: () => Address.fromHex(addrHex),
      catch: (e) => asQueryError(`${where}: malformed address ${addrHex}: ${e instanceof Error ? e.message : String(e)}`)
    }).pipe(
      Effect.flatMap((addr) =>
        provider
          .getUtxos(addr)
          .pipe(Effect.mapError((e) => asQueryError(`${where}: getUtxos(${addrHex}) failed: ${e.message}`)))
      )
    )

  const registryAddress = Effect.try({
    try: () => Encode.enterpriseScriptHex(deployment.network, deployment.registrySpendScriptHashHex),
    catch: (e) => asQueryError(`${where}: cannot form the registry address: ${e instanceof Error ? e.message : String(e)}`)
  })

  const registryNodes: Effect.Effect<ReadonlyArray<RegistryNodeRef>, QueryError> = Effect.gen(function* () {
    const addr = yield* registryAddress
    const utxos = yield* utxosAt(addr)
    // A registry node is authenticated by its NFT, not by sitting at the address —
    // anyone can pay a junk UTxO to a script address, and a junk "node" that decoded
    // would corrupt covering-node selection.
    const nodes = utxos.filter((u) => hasAsset(u, deployment.registryPolicyHex))
    const refs: Array<RegistryNodeRef> = []
    for (const u of nodes) {
      const read = inlineDatumHexOf(u)
      if (read._tag === "absent") {
        // NFT-carrying but datum-less is protocol-violating, and the mint gate means it
        // should be unreachable. Fail loudly: silently dropping it would resurface later
        // as an unexplained "no covering registry node".
        return yield* Effect.fail(asQueryError(`${where}: registry node ${utxoOutpoint(u)} carries the registry NFT but has no inline datum`))
      }
      if (read._tag === "no-raw") {
        return yield* Effect.fail(asQueryError(`${where}: registry node ${utxoOutpoint(u)} carries no raw datum bytes — it was not decoded from the chain`))
      }
      const node = yield* decodeRegistryNode(read.hex, deployment.version).pipe(
        Effect.mapError((e) => asQueryError(`${where}: registry node ${utxoOutpoint(u)} did not decode as ${deployment.version.id}: ${e.message}`))
      )
      refs.push({ txHash: txHashOf(u), index: indexOf(u), node })
    }
    if (refs.length === 0) return yield* Effect.fail(asQueryError(`${where}: no registry nodes at ${addr} — wrong deployment record, or the deployment is gone`))
    return refs
  })

  // The record carries the params address in bech32, which is what a human checks it by;
  // the provider takes the decoded address.
  const paramsAddress = Effect.try({
    try: () => Address.toHex(Address.fromBech32(deployment.paramsAddressBech32)),
    catch: (e) =>
      asQueryError(
        `${where}: malformed paramsAddressBech32 ${deployment.paramsAddressBech32}: ${
          e instanceof Error ? e.message : String(e)
        }`
      )
  })

  const protocolParams: Effect.Effect<ProtocolParamsInfo, QueryError> = Effect.gen(function* () {
    const utxos = yield* utxosAt(yield* paramsAddress)
    const held = utxos.filter((u) => hasAsset(u, deployment.paramsPolicyHex, deployment.paramsAssetNameHex))
    if (held.length === 0) {
      return yield* Effect.fail(asQueryError(`${where}: no protocol-params UTxO at ${deployment.paramsAddressBech32} holding ${deployment.paramsPolicyHex}`))
    }
    // The params NFT is one-shot; more than one means we are not looking at what we think.
    if (held.length > 1) {
      return yield* Effect.fail(asQueryError(`${where}: ${held.length} UTxOs carry the params NFT (${held.map(utxoOutpoint).join(", ")}) — expected exactly one`))
    }
    const u = held[0]!
    const read = inlineDatumHexOf(u)
    if (read._tag === "absent") return yield* Effect.fail(asQueryError(`${where}: protocol-params UTxO ${utxoOutpoint(u)} has no inline datum`))
    if (read._tag === "no-raw") {
      return yield* Effect.fail(asQueryError(`${where}: protocol-params UTxO ${utxoOutpoint(u)} carries no raw datum bytes — it was not decoded from the chain`))
    }
    const params = yield* decodeGlobalParams(read.hex, deployment.version).pipe(
      Effect.mapError((e) => asQueryError(`${where}: protocol-params datum at ${utxoOutpoint(u)} did not decode as ${deployment.version.id}: ${e.message}`))
    )
    // Our record is the authority. If the chain names a different PLB, the record is
    // stale or wrong — following the chain here would silently read a different
    // protocol's smart wallets.
    //
    // Both cross-checks are CONDITIONAL on the field existing, and from `0.5.0-alpha.4`
    // neither does: upstream removed `prog_logic_cred` and `registry_node_cs` from the datum
    // once nothing on chain read them. Skipping a check that cannot run is not a weakening
    // here, and it is worth being precise about why, because "we used to verify this" is the
    // kind of thing that gets quietly reintroduced as a guess:
    //
    //   - PLB is parameterised by the params NFT POLICY, and this UTxO was located by that
    //     policy (`deployment.paramsPolicyHex`). So finding the params UTxO at all already
    //     establishes the same binding the equality used to: PLB's hash is a pure function of
    //     that policy and the blueprint. A record naming the wrong PLB finds no params UTxO.
    //   - the registry node policy IS the registry address's payment credential after the
    //     merge, so `registryPolicyHex` and `registrySpendScriptHashHex` check each other
    //     inside the record (`validateDeployment`), with no chain read needed.
    //
    // What genuinely has no on-chain cross-check any more is the DISPATCHER, and that is by
    // design: `plg_cred` is swappable in place, so the chain is its authority and disagreeing
    // with the record is the upgrade working as intended, not an error. It is returned, never
    // asserted.
    if (params.progLogicCred !== undefined && params.progLogicCred.hashHex !== deployment.plbScriptHashHex) {
      return yield* Effect.fail(
        asQueryError(
          `${where}: on-chain prog_logic_cred ${params.progLogicCred.hashHex} != configured PLB ${deployment.plbScriptHashHex} — the deployment record is stale (a redeploy moves every smart-wallet address)`,
        ),
      )
    }
    if (params.registryNodeCsHex !== undefined && params.registryNodeCsHex !== deployment.registryPolicyHex) {
      return yield* Effect.fail(
        asQueryError(`${where}: on-chain registry_node_cs ${params.registryNodeCsHex} != configured registry policy ${deployment.registryPolicyHex}`),
      )
    }
    // Pass the WHOLE datum through, not a two-field subset.
    //
    // The delegate credentials are deliberately live-resolved on chain: PLB reads
    // `transfer_cred` / `third_party_cred` / `unfracking_cred` out of THIS datum on every
    // dispatch, so the upgrade authority can swap a delegate in place without moving a single
    // token. That makes the chain — not our record — the authority for them, the exact
    // opposite of `prog_logic_cred`, which is baked into PLB's hash and therefore into every
    // address, and which is why the check above fails loudly instead.
    //
    // So a caller building a transfer should take `transferCred` from HERE and the PLB
    // credential from the record. The record's `transferScriptHashHex` is an expectation
    // worth asserting in a harness, not an input to a transaction.
    return {
      txHash: txHashOf(u),
      index: indexOf(u),
      ...(params.registryNodeCsHex !== undefined ? { registryNodeCsHex: params.registryNodeCsHex } : {}),
      ...(params.progLogicCred !== undefined ? { progLogicCred: params.progLogicCred } : {}),
      ...(params.plgCred !== undefined ? { plgCred: params.plgCred } : {}),
      ...(params.issuanceLogicCred !== undefined ? { issuanceLogicCred: params.issuanceLogicCred } : {}),
      ...(params.pendingUpgradeCred !== undefined ? { pendingUpgradeCred: params.pendingUpgradeCred } : {}),
      ...(params.transferCred !== undefined ? { transferCred: params.transferCred } : {}),
      ...(params.thirdPartyCred !== undefined ? { thirdPartyCred: params.thirdPartyCred } : {}),
      ...(params.unfrackingCred !== undefined ? { unfrackingCred: params.unfrackingCred } : {}),
      ...(params.upgradeCred !== undefined ? { upgradeCred: params.upgradeCred } : {}),
      // The bound is chain state up to `alpha.2` and a compile-time parameter from `alpha.4`,
      // so fall back to the record. A caller passes whichever it got to `buildTransferTx`
      // without caring which side it came from; what it must not do is silently get
      // `undefined` on a version where the bound exists and is enforced on chain.
      ...(params.maxInlineDatumBytes !== undefined
        ? { maxInlineDatumBytes: params.maxInlineDatumBytes }
        : deployment.maxInlineDatumBytes !== undefined
          ? { maxInlineDatumBytes: deployment.maxInlineDatumBytes }
          : {}),
    }
  })

  const smartWalletUtxos = (owner: Credential): Effect.Effect<ReadonlyArray<SmartWalletUtxo>, QueryError> =>
    Effect.gen(function* () {
      const addrHex = yield* Effect.try({
        try: () => smartWalletAddressHex(deployment.network, deployment.plbScriptHashHex, owner),
        catch: (e) => asQueryError(`${where}: cannot form the smart-wallet address: ${e instanceof Error ? e.message : String(e)}`)
      })
      const utxos = yield* utxosAt(addrHex)
      const out: Array<SmartWalletUtxo> = []
      for (const u of utxos) {
        const read = inlineDatumHexOf(u)
        if (read._tag === "no-raw") {
          return yield* Effect.fail(asQueryError(`${where}: smart-wallet UTxO ${utxoOutpoint(u)} carries no raw datum bytes — it was not decoded from the chain`))
        }
        out.push({
          txHash: txHashOf(u),
          index: indexOf(u),
          assets: u.assets,
          owner,
          ...(read._tag === "hex" ? { datumHex: PlutusDataHex(read.hex) } : {})
        })
      }
      return out
    })

  return { registryNodes, protocolParams, smartWalletUtxos }
}

// ── W3: pre-applied scripts, sourced from the chain ──────────────────────────────

/** The pre-applied validator CBOR a transfer needs in its witness set. */
export interface DeploymentScripts {
  readonly plbScriptHex: string
  /** the transfer withdraw-0 delegate's pre-applied CBOR. */
  readonly transferScriptHex: string
  /** the dispatcher's pre-applied CBOR, on `'plg-dispatcher'` deployments — a transfer needs
   *  it in the witness set alongside the other two. Absent on earlier shapes, which have no
   *  dispatcher to witness. */
  readonly plgScriptHex?: string
}

/**
 * Fetch the deployment's PLB and transfer-delegate scripts from its published
 * reference-script UTxOs, and verify each hashes to the configured credential.
 *
 * This is why `buildTransferTx` needs no blueprint file and no `applyParamsToScript`: a
 * deployment that publishes its scripts on-chain has already told us their bytes. The
 * hash check is not ceremony — an unverified fetch would let whatever sits at that
 * outpoint today become a script we hand to the ledger.
 */
export const deploymentScripts = (
  deployment: Cip113Deployment
): Effect.Effect<DeploymentScripts, QueryError, Provider.ProviderEffect> =>
  Effect.gen(function* () {
    const provider = yield* Provider.ProviderEffect
    const plbRef = deployment.refScripts?.plb
    const transferRef = deployment.refScripts?.transfer
    if (plbRef === undefined || transferRef === undefined) {
      return yield* Effect.fail(
        asQueryError(`deployment ${deployment.id}: no published reference scripts for ${plbRef === undefined ? 'PLB' : 'transfer'} — supply the pre-applied CBOR another way`),
      )
    }
    // The dispatcher is a third framework script from `0.5.0-alpha.4`, and it is as mandatory
    // as the other two: PLB requires its withdraw-0 on every programmable spend.
    const dispatching = deployment.version.dispatch === 'plg-dispatcher'
    const plgRef = deployment.refScripts?.plg
    if (dispatching && (plgRef === undefined || deployment.plgScriptHashHex === undefined)) {
      return yield* Effect.fail(
        asQueryError(`deployment ${deployment.id}: version ${deployment.version.id} dispatches through programmable_logic_global, but the record publishes no plg reference script`),
      )
    }
    const wanted = plgRef !== undefined ? [plbRef, transferRef, plgRef] : [plbRef, transferRef]
    // ⚠️ `getUtxosByOutRef` answers with the LIVE outputs only — a consumed one is absent
    // rather than present-and-flagged, so membership IS the liveness signal here, and
    // `pick`'s "not found (spent, or wrong record)" already says exactly that.
    const resolved = yield* Effect.try({
      try: () =>
        wanted.map(
          (r) =>
            new TransactionInput.TransactionInput({
              transactionId: TransactionHash.fromHex(r.txHash),
              index: BigInt(r.index)
            })
        ),
      catch: (e) =>
        asQueryError(
          `deployment ${deployment.id}: malformed reference-script outpoint: ${e instanceof Error ? e.message : String(e)}`
        )
    }).pipe(
      Effect.flatMap((refs) =>
        provider
          .getUtxosByOutRef(refs)
          .pipe(
            Effect.mapError((e) =>
              asQueryError(`deployment ${deployment.id}: resolving reference scripts failed: ${e.message}`)
            )
          )
      )
    )

    const pick = (ref: DeploymentOutPoint, label: string, expectedHashHex: string): Effect.Effect<string, QueryError> =>
      Effect.gen(function* () {
        const row = resolved.find((r) => txHashOf(r) === ref.txHash && indexOf(r) === ref.index)
        if (row === undefined) return yield* Effect.fail(asQueryError(`deployment ${deployment.id}: ${label} reference UTxO ${outpoint(ref)} not found (spent, or wrong record)`))
        const script = row.scriptRef
        if (script === undefined) return yield* Effect.fail(asQueryError(`deployment ${deployment.id}: ${label} reference UTxO ${outpoint(ref)} carries no script bytes`))
        // Hashed through Evolution's own tagging, so every script KIND is hashed by its own
        // rule — a native script at this outpoint is not silently hashed as a Plutus V3 one.
        const actual = ScriptHash.toHex(ScriptHash.fromScript(script))
        const bytesHex = script._tag === "NativeScript" ? Script.toCBORHex(script) : Bytes.toHex(script.bytes)
        if (actual !== expectedHashHex) {
          return yield* Effect.fail(
            asQueryError(`deployment ${deployment.id}: ${label} reference script at ${outpoint(ref)} hashes to ${actual}, not the configured ${expectedHashHex}`),
          )
        }
        return bytesHex
      })

    const plbScriptHex = yield* pick(plbRef, 'PLB', deployment.plbScriptHashHex)
    const transferScriptHex = yield* pick(transferRef, 'transfer', deployment.transferScriptHashHex)
    if (dispatching) {
      const plgScriptHex = yield* pick(plgRef!, 'programmable_logic_global', deployment.plgScriptHashHex!)
      return { plbScriptHex, transferScriptHex, plgScriptHex }
    }
    return { plbScriptHex, transferScriptHex }
  })
