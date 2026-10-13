/**
 * Build a Ledger Cardano sign request from a reviewed transaction body.
 *
 * Takes `@evolution-sdk/review`'s `Inspect.TxBodyView` — the span-preserving view — and
 * produces the parameter shape the Ledger Cardano app expects.
 *
 * ⚠️ Every body field must be representable in the request, because **the device recomputes the
 * body hash from it**. Silently dropping a field would produce a signature over a different
 * transaction than the one the user approved, so anything unrepresentable throws instead. That
 * is also why `unknownKeys` is a hard refusal rather than a warning: a key this view cannot
 * name is a key the device cannot reproduce.
 *
 * @since 0.1.0
 */

import { KeyHash, VKey } from "@evolution-sdk/evolution"
import type { Inspect } from "@evolution-sdk/review"
import { KeyHashHex } from "@evolution-sdk/review/Brands"

import { bytesToHex } from "./internal/Hex.js"
import { parseDerivationPath } from "./internal/Path.js"
import type {
  LedgerAnchorParams,
  LedgerAssetGroup,
  LedgerAuxiliaryData,
  LedgerCertificate,
  LedgerCredentialParams,
  LedgerDatum,
  LedgerDRepParams,
  LedgerRequiredSigner,
  LedgerSignTxRequest,
  LedgerToken,
  LedgerTxInput,
  LedgerTxOutput,
  LedgerTxOutputDestination,
  LedgerVote,
  LedgerVoterVotes,
  LedgerWithdrawal
} from "./LedgerTypes.js"

/**
 * The 28-byte key hash of a public key, hex.
 *
 * ⚠️ Goes through Evolution's `KeyHash` rather than calling blake2b directly, so this package
 * cannot drift from the function the rest of the ecosystem derives credentials with — and so a
 * value that is not a 32-byte public key is rejected rather than hashed into a credential that
 * can never match anything.
 */
const keyHashOf = (publicKeyHex: string): string => KeyHash.toHex(KeyHash.fromVKey(VKey.fromHex(publicKeyHex)))

// Numeric values mirror the @cardano-foundation/ledgerjs-hw-app-cardano enums
// (documented on the request types in ./types.ts).
const ADDRESS_TYPE = { BASE_PAYMENT_KEY_STAKE_KEY: 0, ENTERPRISE_KEY: 6 } as const
const CREDENTIAL = { KEY_PATH: 0, KEY_HASH: 1, SCRIPT_HASH: 2 } as const
const DATUM = { HASH: 0, INLINE: 1 } as const
const DREP = { KEY_HASH: 1, SCRIPT_HASH: 2, ABSTAIN: 3, NO_CONFIDENCE: 4 } as const
const OUTPUT_FORMAT = { ARRAY_LEGACY: 0, MAP_BABBAGE: 1 } as const
const VOTER = {
  COMMITTEE_KEY_HASH: 0,
  COMMITTEE_KEY_PATH: 100,
  COMMITTEE_SCRIPT_HASH: 1,
  DREP_KEY_HASH: 2,
  DREP_KEY_PATH: 102,
  DREP_SCRIPT_HASH: 3,
  STAKE_POOL_KEY_HASH: 4,
  STAKE_POOL_KEY_PATH: 104
} as const

type FlatToken = { readonly policyIdHex: string; readonly assetNameHex: string; readonly amount: bigint }

// Canonical CBOR multiasset order: policy ids bytewise, asset names length-first
// then bytewise — the device re-serializes and rejects non-canonical order.
const compareHex = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const compareAssetNameHex = (a: string, b: string): number =>
  a.length !== b.length ? a.length - b.length : compareHex(a, b)

const toAssetGroups = (tokens: ReadonlyArray<FlatToken>): Array<LedgerAssetGroup> | undefined => {
  if (tokens.length === 0) return undefined
  const grouped = new Map<string, Array<LedgerToken>>()
  for (const token of tokens) {
    const existing = grouped.get(token.policyIdHex) ?? []
    existing.push({ assetNameHex: token.assetNameHex, amount: token.amount.toString() })
    grouped.set(token.policyIdHex, existing)
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => compareHex(a, b))
    .map(([policyIdHex, groupTokens]) => ({
      policyIdHex,
      tokens: groupTokens.sort((a, b) => compareAssetNameHex(a.assetNameHex, b.assetNameHex))
    }))
}

const mintToFlatTokens = (mint: Inspect.Mint): Array<FlatToken> => {
  const tokens: Array<FlatToken> = []
  for (const [policy, assets] of mint) {
    for (const [name, amount] of assets) {
      tokens.push({ policyIdHex: bytesToHex(policy), assetNameHex: bytesToHex(name), amount })
    }
  }
  return tokens
}

/** Finds the signing path with the given CIP-1852 role, else derives one from the first path. */
const findRolePath = (signingPaths: ReadonlyArray<string>, role: 0 | 2): ReadonlyArray<number> => {
  const parsed = signingPaths.map(parseDerivationPath)
  const match = parsed.find((p) => p.length >= 4 && p[3] === role)
  if (match) return match
  // Single-account fallback: mutate the first path's role/index components. The
  // derived path may not be in signingPaths but the device still derives its key.
  const first = parsed[0] ?? parseDerivationPath("m/1852'/1815'/0'/0/0")
  const components = [...first]
  if (components.length >= 4) components[3] = role
  if (components.length >= 5) components[4] = 0
  return components
}

const convertAnchor = (anchor: Inspect.Anchor | undefined): LedgerAnchorParams | null =>
  anchor ? { url: anchor.url, hashHex: bytesToHex(anchor.dataHash) } : null

const convertDRepParams = (drep: Inspect.DRep): LedgerDRepParams => {
  switch (drep.kind) {
    case "key":
      return { type: DREP.KEY_HASH, keyHashHex: bytesToHex(drep.hash) }
    case "script":
      return { type: DREP.SCRIPT_HASH, scriptHashHex: bytesToHex(drep.hash) }
    case "abstain":
      return { type: DREP.ABSTAIN }
    case "no_confidence":
      return { type: DREP.NO_CONFIDENCE }
  }
}

type LedgerConvertOptions = {
  /** Whether the original CBOR used tag 258 for sets */
  readonly tagCborSets?: boolean
  /** CIP-36 registration auxiliary data (already in Ledger format, from device.ts) */
  readonly cip36Registration?: LedgerAuxiliaryData
  /** Protocol magic override (764824073=mainnet, 1=preprod, 2=preview) */
  readonly protocolMagic?: number
  /** Public keys by derivation path — used to distinguish own vs foreign credentials */
  readonly publicKeys?: Readonly<Record<string, string>>
}

/**
 * Converts a parsed Cardano transaction body to the Ledger sign-request format.
 *
 * @throws Error when the body contains features the Ledger Cardano app cannot
 *   represent (pool/combined/deprecated certificates, proposal procedures,
 *   unmodeled body keys).
 */
export const buildLedgerSignRequest = (
  body: Inspect.TxBodyView,
  networkId: number,
  signingPaths: ReadonlyArray<string>,
  initialSigningMode: "ordinary_transaction" | "plutus_transaction" | "multisig_transaction" = "ordinary_transaction",
  options?: LedgerConvertOptions
): LedgerSignTxRequest => {
  if (body.unknownKeys.length > 0) {
    throw new Error(
      `Transaction body contains unsupported field keys (${body.unknownKeys.join(", ")}) — ` +
        "the device cannot reproduce the body hash."
    )
  }
  if (body.proposals && body.proposals.length > 0) {
    throw new Error("Transactions with proposal procedures are not supported by the Ledger Cardano app.")
  }

  const protocolMagic = options?.protocolMagic ?? (networkId === 1 ? 764824073 : 1)

  // keyHash → path map from supplied public keys, for own/foreign credential resolution.
  const ownKeys = new Map<string, string>()
  if (options?.publicKeys) {
    for (const [path, pubKeyHex] of Object.entries(options.publicKeys)) {
      ownKeys.set(keyHashOf(pubKeyHex), path)
    }
  }

  const resolveKeyHash = (hashHex: string): LedgerCredentialParams => {
    const path = ownKeys.get(hashHex)
    return path
      ? { type: CREDENTIAL.KEY_PATH, keyPath: parseDerivationPath(path) }
      : { type: CREDENTIAL.KEY_HASH, keyHashHex: hashHex }
  }

  // Certificates carry byte-level credentials, withdrawals carry hex views —
  // normalize both to the hex form.
  const credView = (cred: Inspect.Credential): Inspect.CredentialView => ({
    hashHex: KeyHashHex(bytesToHex(cred.hash)),
    isScript: cred.isScript
  })

  // Certificate/withdrawal stake credentials: without publicKeys, assume own
  // (KEY_PATH via the stake signing path) — the pre-publicKeys behaviour.
  const resolveStakeCredential = (cred: Inspect.CredentialView): LedgerCredentialParams => {
    if (cred.isScript) return { type: CREDENTIAL.SCRIPT_HASH, scriptHashHex: cred.hashHex }
    if (ownKeys.size === 0) return { type: CREDENTIAL.KEY_PATH, keyPath: findRolePath(signingPaths, 2) }
    return resolveKeyHash(cred.hashHex)
  }

  // DRep/committee credentials: hash-based unless the key is provably ours.
  const resolveHashCredential = (cred: Inspect.Credential): LedgerCredentialParams => {
    const view = credView(cred)
    return view.isScript ? { type: CREDENTIAL.SCRIPT_HASH, scriptHashHex: view.hashHex } : resolveKeyHash(view.hashHex)
  }

  // ORDINARY mode only accepts KEY_PATH credentials in certs/withdrawals/votes —
  // escalate to PLUTUS when any credential resolves foreign (script or non-own key).
  let signingMode = initialSigningMode
  if (ownKeys.size > 0 && signingMode === "ordinary_transaction") {
    const isForeignView = (cred: Inspect.CredentialView): boolean => cred.isScript || !ownKeys.has(cred.hashHex)
    const isForeign = (cred: Inspect.Credential): boolean => isForeignView(credView(cred))
    const hasForeign = (): boolean => {
      for (const w of body.withdrawals ?? []) {
        if (isForeignView(w.credential)) return true
      }
      for (const cert of body.certificates ?? []) {
        switch (cert.type) {
          case "stake_registration":
          case "stake_deregistration":
          case "stake_delegation":
          case "reg":
          case "unreg":
          case "vote_delegation":
          case "drep_registration":
          case "drep_deregistration":
          case "drep_update":
            if (isForeign(cert.cred)) return true
            break
          case "committee_hot_auth":
            if (isForeign(cert.cold) || isForeign(cert.hot)) return true
            break
          case "committee_cold_resign":
            if (isForeign(cert.cold)) return true
            break
          default:
            break
        }
      }
      for (const [voter] of body.votes ?? []) {
        if (voter.role === "drep" || voter.role === "committee_hot") {
          if (isForeign(voter.cred)) return true
        }
      }
      return false
    }
    if (hasForeign()) signingMode = "plutus_transaction"
  }

  // Paths already embedded in body fields — the device auto-extracts them in
  // ORDINARY/PLUTUS modes, so additionalWitnessPaths must not repeat them.
  const embeddedPaths = new Set<string>()
  const trackPath = (p: ReadonlyArray<number>) => embeddedPaths.add(p.join("/"))
  const trackCredential = (c: LedgerCredentialParams) => {
    if (c.type === CREDENTIAL.KEY_PATH) trackPath(c.keyPath)
  }

  const paymentPath = findRolePath(signingPaths, 0)
  const inputs: Array<LedgerTxInput> = body.inputs.map((input) => {
    const base = { txHashHex: input.txHashHex, outputIndex: input.index }
    if (signingMode === "ordinary_transaction") {
      trackPath(paymentPath)
      return { ...base, path: paymentPath }
    }
    return base
  })

  // Mark outputs whose payment (and stake, for base addresses) credentials are owned
  // by the device as device_owned — Ledger then displays them as the user's own
  // instead of a third-party recipient (change outputs, self-sends). A wrong claim
  // fails closed: the device recomputes the address, so the body hash would differ.
  const tryDeviceOwnedDestination = (address: Inspect.OutputView["address"]): LedgerTxOutputDestination | null => {
    if (ownKeys.size === 0) return null
    if (
      address.kind === "Base" &&
      address.payment &&
      !address.payment.isScript &&
      address.stake &&
      !address.stake.isScript
    ) {
      const spendingPath = ownKeys.get(address.payment.hashHex)
      const stakingPath = ownKeys.get(address.stake.hashHex)
      if (spendingPath && stakingPath) {
        return {
          type: "device_owned",
          params: {
            type: ADDRESS_TYPE.BASE_PAYMENT_KEY_STAKE_KEY,
            params: {
              spendingPath: parseDerivationPath(spendingPath),
              stakingPath: parseDerivationPath(stakingPath)
            }
          }
        }
      }
    }
    if (address.kind === "Enterprise" && address.payment && !address.payment.isScript) {
      const spendingPath = ownKeys.get(address.payment.hashHex)
      if (spendingPath) {
        return {
          type: "device_owned",
          params: { type: ADDRESS_TYPE.ENTERPRISE_KEY, params: { spendingPath: parseDerivationPath(spendingPath) } }
        }
      }
    }
    return null
  }

  const convertOutput = (output: Inspect.OutputView): LedgerTxOutput => {
    const tokenBundle = toAssetGroups(
      output.value.tokens.map((t) => ({ policyIdHex: t.policyIdHex, assetNameHex: t.assetNameHex, amount: t.amount }))
    )
    const destination: LedgerTxOutputDestination = tryDeviceOwnedDestination(output.address) ?? {
      type: "third_party",
      params: { addressHex: output.address.hex }
    }
    if (output.map) {
      const datum: LedgerDatum | undefined = output.inlineDatumHex
        ? { type: DATUM.INLINE, datumHex: output.inlineDatumHex }
        : output.datumHashHex
          ? { type: DATUM.HASH, datumHashHex: output.datumHashHex }
          : undefined
      return {
        format: OUTPUT_FORMAT.MAP_BABBAGE,
        destination,
        amount: output.value.amount.toString(),
        ...(tokenBundle !== undefined ? { tokenBundle } : {}),
        ...(datum !== undefined ? { datum } : {}),
        ...(output.referenceScriptHex ? { referenceScriptHex: output.referenceScriptHex } : {})
      }
    }
    return {
      format: OUTPUT_FORMAT.ARRAY_LEGACY,
      destination,
      amount: output.value.amount.toString(),
      ...(tokenBundle !== undefined ? { tokenBundle } : {}),
      ...(output.datumHashHex ? { datumHashHex: output.datumHashHex } : {})
    }
  }

  const outputs: Array<LedgerTxOutput> = body.outputs.map(convertOutput)

  const convertCertificate = (cert: Inspect.Certificate, index: number): LedgerCertificate => {
    switch (cert.type) {
      case "stake_registration":
        return { type: 0, params: { stakeCredential: resolveStakeCredential(credView(cert.cred)) } }
      case "stake_deregistration":
        return { type: 1, params: { stakeCredential: resolveStakeCredential(credView(cert.cred)) } }
      case "stake_delegation":
        return {
          type: 2,
          params: {
            stakeCredential: resolveStakeCredential(credView(cert.cred)),
            poolKeyHashHex: bytesToHex(cert.pool)
          }
        }
      case "reg":
        return {
          type: 7,
          params: { stakeCredential: resolveStakeCredential(credView(cert.cred)), deposit: cert.deposit.toString() }
        }
      case "unreg":
        return {
          type: 8,
          params: { stakeCredential: resolveStakeCredential(credView(cert.cred)), deposit: cert.deposit.toString() }
        }
      case "vote_delegation":
        return {
          type: 9,
          params: { stakeCredential: resolveStakeCredential(credView(cert.cred)), dRep: convertDRepParams(cert.drep) }
        }
      case "committee_hot_auth":
        return {
          type: 14,
          params: { coldCredential: resolveHashCredential(cert.cold), hotCredential: resolveHashCredential(cert.hot) }
        }
      case "committee_cold_resign":
        return {
          type: 15,
          params: { coldCredential: resolveHashCredential(cert.cold), anchor: convertAnchor(cert.anchor) }
        }
      case "drep_registration":
        return {
          type: 16,
          params: {
            dRepCredential: resolveHashCredential(cert.cred),
            deposit: cert.deposit.toString(),
            anchor: convertAnchor(cert.anchor)
          }
        }
      case "drep_deregistration":
        return {
          type: 17,
          params: { dRepCredential: resolveHashCredential(cert.cred), deposit: cert.deposit.toString() }
        }
      case "drep_update":
        return {
          type: 18,
          params: { dRepCredential: resolveHashCredential(cert.cred), anchor: convertAnchor(cert.anchor) }
        }
      case "stake_vote_delegation":
      case "stake_reg_delegation":
      case "vote_reg_delegation":
      case "stake_vote_reg_delegation":
        throw new Error(
          `Certificate at index ${index} uses a combined staking+governance type ` +
            "that CIP-21 forbids in a hardware-wallet transaction (the Ledger Cardano app does " +
            "not accept one either). Build it as separate certificates instead."
        )
      case "pool_registration":
      case "pool_retirement":
        throw new Error(`Certificate at index ${index}: pool certificates are not supported.`)
      case "other":
        throw new Error(
          `Certificate at index ${index} has unsupported type tag ${cert.tag} ` +
            "(deprecated or unknown certificate kind)."
        )
    }
  }

  const certificates: Array<LedgerCertificate> | undefined = body.certificates?.map(convertCertificate)
  if (certificates) {
    for (const cert of certificates) {
      const params = cert.params as Record<string, unknown>
      for (const field of ["stakeCredential", "coldCredential", "hotCredential", "dRepCredential"]) {
        const cred = params[field] as LedgerCredentialParams | undefined
        if (cred) trackCredential(cred)
      }
    }
  }

  const withdrawals: Array<LedgerWithdrawal> | undefined = body.withdrawals?.map((w) => {
    const stakeCredential = resolveStakeCredential(w.credential)
    trackCredential(stakeCredential)
    return { stakeCredential, amount: w.amount.toString() }
  })

  const mint = body.mint ? toAssetGroups(mintToFlatTokens(body.mint)) : undefined

  const collateralInputs: Array<LedgerTxInput> | undefined = body.collateral?.inputs.map((input) => ({
    txHashHex: input.txHashHex,
    outputIndex: input.index
  }))

  const requiredSigners: Array<LedgerRequiredSigner> | undefined = body.signers?.map((hashHex) => {
    const path = ownKeys.get(hashHex)
    if (path) {
      const parsed = parseDerivationPath(path)
      trackPath(parsed)
      return { type: "required_signer_path", path: parsed }
    }
    return { type: "required_signer_hash", hashHex }
  })

  const collateralOutput: LedgerTxOutput | undefined = body.collateral?.output
    ? convertOutput(body.collateral.output)
    : undefined

  const referenceInputs: Array<LedgerTxInput> | undefined = body.references?.map((input) => ({
    txHashHex: input.txHashHex,
    outputIndex: input.index
  }))

  const convertVoter = (voter: Inspect.Voter): LedgerVoterVotes["voter"] => {
    switch (voter.role) {
      case "committee_hot": {
        if (voter.cred.isScript)
          return { type: VOTER.COMMITTEE_SCRIPT_HASH, scriptHashHex: bytesToHex(voter.cred.hash) }
        const hashHex = bytesToHex(voter.cred.hash)
        const path = ownKeys.get(hashHex)
        return path
          ? { type: VOTER.COMMITTEE_KEY_PATH, keyPath: parseDerivationPath(path) }
          : { type: VOTER.COMMITTEE_KEY_HASH, keyHashHex: hashHex }
      }
      case "drep": {
        if (voter.cred.isScript) return { type: VOTER.DREP_SCRIPT_HASH, scriptHashHex: bytesToHex(voter.cred.hash) }
        const hashHex = bytesToHex(voter.cred.hash)
        const path = ownKeys.get(hashHex)
        return path
          ? { type: VOTER.DREP_KEY_PATH, keyPath: parseDerivationPath(path) }
          : { type: VOTER.DREP_KEY_HASH, keyHashHex: hashHex }
      }
      case "pool": {
        const hashHex = bytesToHex(voter.keyHash)
        const path = ownKeys.get(hashHex)
        return path
          ? { type: VOTER.STAKE_POOL_KEY_PATH, keyPath: parseDerivationPath(path) }
          : { type: VOTER.STAKE_POOL_KEY_HASH, keyHashHex: hashHex }
      }
    }
  }

  const VOTE_VALUE = { no: 0, yes: 1, abstain: 2 } as const
  const votingProcedures: Array<LedgerVoterVotes> | undefined = body.votes?.map(([voter, votes]) => {
    const ledgerVoter = convertVoter(voter)
    if ("keyPath" in ledgerVoter) trackPath(ledgerVoter.keyPath)
    const ledgerVotes: Array<LedgerVote> = votes.map(([govActionId, procedure]) => ({
      govActionId: { txHashHex: bytesToHex(govActionId.txId), govActionIndex: Number(govActionId.index) },
      votingProcedure: {
        vote: VOTE_VALUE[procedure.vote],
        ...(procedure.anchor
          ? { anchor: { url: procedure.anchor.url, hashHex: bytesToHex(procedure.anchor.dataHash) } }
          : {})
      }
    }))
    return { voter: ledgerVoter, votes: ledgerVotes }
  })

  return {
    signingMode,
    tx: {
      network: { networkId, protocolMagic },
      inputs,
      outputs,
      fee: body.fee.toString(),
      ...(body.ttl !== undefined ? { ttl: body.ttl.toString() } : {}),
      ...(body.validityIntervalStart !== undefined
        ? { validityIntervalStart: body.validityIntervalStart.toString() }
        : {}),
      ...(certificates && certificates.length > 0 ? { certificates } : {}),
      ...(withdrawals && withdrawals.length > 0 ? { withdrawals } : {}),
      ...(options?.cip36Registration
        ? { auxiliaryData: options.cip36Registration }
        : body.auxiliaryDataHashHex !== undefined
          ? { auxiliaryData: { type: "arbitrary_hash" as const, params: { hashHex: body.auxiliaryDataHashHex } } }
          : {}),
      ...(mint && mint.length > 0 ? { mint } : {}),
      ...(body.witnessHash !== undefined ? { scriptDataHashHex: body.witnessHash } : {}),
      ...(collateralInputs && collateralInputs.length > 0 ? { collateralInputs } : {}),
      ...(requiredSigners && requiredSigners.length > 0 ? { requiredSigners } : {}),
      includeNetworkId: body.networkId !== undefined,
      ...(collateralOutput !== undefined ? { collateralOutput } : {}),
      ...(body.collateral?.balance !== undefined ? { totalCollateral: body.collateral.balance.toString() } : {}),
      ...(referenceInputs && referenceInputs.length > 0 ? { referenceInputs } : {}),
      ...(votingProcedures && votingProcedures.length > 0 ? { votingProcedures } : {}),
      ...(body.treasury !== undefined ? { treasury: body.treasury.toString() } : {}),
      ...(body.donation !== undefined ? { donation: body.donation.toString() } : {})
    },
    // MULTISIG mode: the device does NOT auto-extract witness paths from the body,
    // so additionalWitnessPaths is the only source — include every signing path.
    // ORDINARY/PLUTUS: the device auto-extracts embedded KEY_PATHs; only send the rest.
    additionalWitnessPaths:
      signingMode === "multisig_transaction"
        ? signingPaths.map(parseDerivationPath)
        : signingPaths.map(parseDerivationPath).filter((p) => !embeddedPaths.has(p.join("/"))),
    ...(options?.tagCborSets ? { options: { tagCborSets: true } } : {})
  }
}
