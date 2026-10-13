/**
 * Build a Trezor Cardano sign request from a reviewed transaction body.
 *
 * Takes `@evolution-sdk/review`'s `Inspect.TxBodyView` and produces the parameter shape
 * `@trezor/connect` expects.
 *
 * ⚠️ Every body field must be representable in the request, because **the firmware recomputes
 * the body hash from it**. Silently dropping a field would produce a signature over a different
 * transaction than the one the user approved, so anything Trezor cannot represent — governance
 * certificates beyond vote delegation, voting procedures, treasury fields, Byron outputs,
 * unmodelled body keys — throws instead.
 *
 * @since 0.1.0
 */

import { KeyHash, VKey } from "@evolution-sdk/evolution"
import type { Inspect } from "@evolution-sdk/review"
import { KeyHashHex } from "@evolution-sdk/review/Brands"

import { bytesToHex } from "./internal/Hex.js"
import { parseDerivationPath } from "./internal/Path.js"
import type {
  CIP36RegistrationParams,
  TrezorCardanoAddressParams,
  TrezorCardanoAssetGroup,
  TrezorCardanoCertificate,
  TrezorCardanoDRep,
  TrezorCardanoInput,
  TrezorCardanoOutput,
  TrezorCardanoSignTxRequest,
  TrezorCardanoWithdrawal
} from "./TrezorTypes.js"
import {
  CardanoAddressType,
  CardanoCertificateType,
  CardanoDerivationType,
  CardanoDRepType,
  CardanoTxSigningMode
} from "./TrezorTypes.js"

/** See the note on the Ledger side: one key-hash function, and a validated input. */
const keyHashOf = (publicKeyHex: string): string => KeyHash.toHex(KeyHash.fromVKey(VKey.fromHex(publicKeyHex)))

const MAP_BABBAGE = 1 // CardanoTxOutputSerializationFormat.MAP_BABBAGE

type FlatToken = { readonly policyIdHex: string; readonly assetNameHex: string; readonly amount: bigint }

// Canonical CBOR multiasset order: policy ids bytewise, asset names length-first
// then bytewise — Trezor firmware re-serializes and requires canonical order.
const compareHex = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const compareAssetNameHex = (a: string, b: string): number =>
  a.length !== b.length ? a.length - b.length : compareHex(a, b)

const toTokenBundle = (tokens: ReadonlyArray<FlatToken>): Array<TrezorCardanoAssetGroup> | undefined => {
  if (tokens.length === 0) return undefined
  const grouped = new Map<string, Array<{ assetNameBytes: string; amount: string }>>()
  for (const token of tokens) {
    const existing = grouped.get(token.policyIdHex) ?? []
    existing.push({ assetNameBytes: token.assetNameHex, amount: token.amount.toString() })
    grouped.set(token.policyIdHex, existing)
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => compareHex(a, b))
    .map(([policyId, tokenAmounts]) => ({
      policyId,
      tokenAmounts: tokenAmounts.sort((a, b) => compareAssetNameHex(a.assetNameBytes, b.assetNameBytes))
    }))
}

// Mint bundles use the protobuf `mint_amount` field (sint64) — supports negative
// amounts for burning, unlike output token `amount` (uint64).
const toMintBundle = (mint: Inspect.Mint): Array<TrezorCardanoAssetGroup> | undefined => {
  const grouped = new Map<string, Array<{ assetNameBytes: string; mintAmount: string }>>()
  for (const [policy, assets] of mint) {
    const policyIdHex = bytesToHex(policy)
    for (const [name, amount] of assets) {
      const existing = grouped.get(policyIdHex) ?? []
      existing.push({ assetNameBytes: bytesToHex(name), mintAmount: amount.toString() })
      grouped.set(policyIdHex, existing)
    }
  }
  if (grouped.size === 0) return undefined
  return Array.from(grouped.entries())
    .sort(([a], [b]) => compareHex(a, b))
    .map(([policyId, tokenAmounts]) => ({
      policyId,
      tokenAmounts: tokenAmounts.sort((a, b) => compareAssetNameHex(a.assetNameBytes, b.assetNameBytes))
    }))
}

/** Finds the role-2 (staking) signing path, else derives one from the first path. */
const findStakePath = (signingPaths: ReadonlyArray<string>): string => {
  for (const path of signingPaths) {
    const parsed = parseDerivationPath(path)
    if (parsed.length >= 4 && parsed[3] === 2) return path
  }
  // Single-account fallback: replace the first path's role/index components.
  const first = signingPaths[0]
  if (first) {
    const parts = first.replace(/^m\//, "").split("/")
    if (parts.length === 5) return `m/${[...parts.slice(0, 3), "2", "0"].join("/")}`
  }
  return "m/1852'/1815'/0'/2/0"
}

const convertTrezorDRep = (drep: Inspect.DRep): TrezorCardanoDRep => {
  switch (drep.kind) {
    case "key":
      return { type: CardanoDRepType.KEY_HASH, keyHash: bytesToHex(drep.hash) }
    case "script":
      return { type: CardanoDRepType.SCRIPT_HASH, scriptHash: bytesToHex(drep.hash) }
    case "abstain":
      return { type: CardanoDRepType.ABSTAIN }
    case "no_confidence":
      return { type: CardanoDRepType.NO_CONFIDENCE }
  }
}

type TrezorConvertOptions = {
  /** Whether the original CBOR used tag 258 for sets */
  readonly tagCborSets?: boolean
  /** CIP-36 registration parameters */
  readonly cip36Registration?: CIP36RegistrationParams
  /** Protocol magic override (764824073=mainnet, 1=preprod, 2=preview) */
  readonly protocolMagic?: number
  /** Public keys by derivation path — used to match own credentials */
  readonly publicKeys?: Readonly<Record<string, string>>
  /**
   * One co-signer's share of a native-script spend. Stated by the caller rather
   * than inferred: a CIP-1854 spend carries a single signing path and names its
   * keys in the script, not in the body, so nothing in the transaction
   * distinguishes it from an ordinary one.
   */
  readonly multisig?: boolean
}

/**
 * Builds a Trezor sign transaction request from a parsed Cardano transaction body.
 *
 * @throws Error when the body contains features Trezor firmware cannot represent
 *   (committee/DRep/pool/combined certificates, voting procedures, proposal
 *   procedures, treasury fields, Byron outputs, unmodeled body keys).
 */
export const buildTrezorSignRequest = (
  body: Inspect.TxBodyView,
  networkId: number,
  signingPaths: ReadonlyArray<string>,
  options?: TrezorConvertOptions
): TrezorCardanoSignTxRequest => {
  if (body.unknownKeys.length > 0) {
    throw new Error(
      `Transaction body contains unsupported field keys (${body.unknownKeys.join(", ")}) — ` +
        "the device cannot reproduce the body hash."
    )
  }
  if (body.proposals && body.proposals.length > 0) {
    throw new Error("Transactions with proposal procedures are not supported by Trezor.")
  }
  if (body.votes && body.votes.length > 0) {
    throw new Error(
      "Transactions with voting procedures are not supported by Trezor. " +
        "Conway-era governance voting requires a Ledger device or updated Trezor firmware."
    )
  }
  if (body.treasury !== undefined || body.donation !== undefined) {
    throw new Error("Transactions with treasury value or donation fields are not supported by Trezor.")
  }

  const protocolMagic = options?.protocolMagic ?? (networkId === 1 ? 764824073 : 1)

  // PLUTUS mode is required for transaction-level Plutus features. Output-level
  // Babbage features (datum, reference script, map format) work in ORDINARY mode.
  let signingMode: number = CardanoTxSigningMode.ORDINARY_TRANSACTION
  if (body.witnessHash || body.collateral || (body.references?.length ?? 0) > 0) {
    signingMode = CardanoTxSigningMode.PLUTUS_TRANSACTION
  }
  // A declared multisig spend wins over both the default and the Plutus
  // escalation below: the escalations exist to find a mode that can represent
  // the transaction, and MULTISIG is the one that represents this.
  const isMultisig = options?.multisig === true
  if (isMultisig) signingMode = CardanoTxSigningMode.MULTISIG_TRANSACTION

  // keyHash → path map from all supplied public keys — detects device-owned outputs.
  const ownKeys = new Map<string, string>()
  if (options?.publicKeys) {
    for (const [path, pubKeyHex] of Object.entries(options.publicKeys)) {
      ownKeys.set(keyHashOf(pubKeyHex), path)
    }
  }

  // Certificates carry byte-level credentials, withdrawals carry hex views —
  // normalize both to the hex form.
  const credView = (cred: Inspect.Credential): Inspect.CredentialView => ({
    hashHex: KeyHashHex(bytesToHex(cred.hash)),
    isScript: cred.isScript
  })

  // The stake path's own key hash — certificate/withdrawal credential resolution
  // compares against this single credential.
  const stakePath = findStakePath(signingPaths)
  const stakePubKeyHex = options?.publicKeys?.[stakePath]
  const ownStakeKeyHash = stakePubKeyHex ? keyHashOf(stakePubKeyHex) : undefined

  // Trezor ORDINARY mode only accepts `path` credentials in certs/withdrawals —
  // escalate to PLUTUS when a credential is a script or a provably foreign key.
  if (!isMultisig && signingMode === CardanoTxSigningMode.ORDINARY_TRANSACTION) {
    const isNonOwn = (cred: Inspect.CredentialView): boolean => {
      if (cred.isScript) return true
      return ownStakeKeyHash !== undefined && cred.hashHex !== ownStakeKeyHash
    }
    const stakeCreds: Array<Inspect.CredentialView> = []
    for (const cert of body.certificates ?? []) {
      switch (cert.type) {
        case "stake_registration":
        case "stake_deregistration":
        case "stake_delegation":
        case "reg":
        case "unreg":
        case "vote_delegation":
          stakeCreds.push(credView(cert.cred))
          break
        default:
          break
      }
    }
    for (const w of body.withdrawals ?? []) stakeCreds.push(w.credential)
    if (stakeCreds.some(isNonOwn)) signingMode = CardanoTxSigningMode.PLUTUS_TRANSACTION
  }

  const inputs: Array<TrezorCardanoInput> = body.inputs.map((input) => ({
    prev_hash: input.txHashHex,
    prev_index: input.index
  }))

  // Outputs whose payment (and stake, for base addresses) credentials match own keys
  // are sent as addressParameters — Trezor recomputes and displays them as
  // device-owned. A wrong claim fails closed via body-hash mismatch.
  const tryDeviceOwnedAddressParameters = (
    address: Inspect.OutputView["address"]
  ): TrezorCardanoAddressParams | null => {
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
        return { addressType: CardanoAddressType.BASE, networkId, protocolMagic, spendingPath, stakingPath }
      }
    }
    if (address.kind === "Enterprise" && address.payment && !address.payment.isScript) {
      const spendingPath = ownKeys.get(address.payment.hashHex)
      if (spendingPath) {
        return { addressType: CardanoAddressType.ENTERPRISE, networkId, protocolMagic, spendingPath }
      }
    }
    return null
  }

  const convertOutput = (output: Inspect.OutputView, context: string): TrezorCardanoOutput => {
    const tokenBundle = toTokenBundle(
      output.value.tokens.map((t) => ({ policyIdHex: t.policyIdHex, assetNameHex: t.assetNameHex, amount: t.amount }))
    )
    const ownParams = tryDeviceOwnedAddressParameters(output.address)
    let addressField: Pick<TrezorCardanoOutput, "address" | "addressParameters">
    if (ownParams) {
      addressField = { addressParameters: ownParams }
    } else {
      if (output.address.bech32 === undefined) {
        throw new Error(`${context} uses a Byron-era address, which is not supported for Trezor signing.`)
      }
      addressField = { address: output.address.bech32 }
    }
    return {
      ...addressField,
      amount: output.value.amount.toString(),
      ...(tokenBundle !== undefined ? { tokenBundle } : {}),
      ...(output.datumHashHex ? { datumHash: output.datumHashHex } : {}),
      ...(output.inlineDatumHex ? { inlineDatum: output.inlineDatumHex } : {}),
      ...(output.referenceScriptHex ? { referenceScript: output.referenceScriptHex } : {}),
      ...(output.map ? { format: MAP_BABBAGE } : {})
    }
  }

  const outputs: Array<TrezorCardanoOutput> = body.outputs.map((o, i) => convertOutput(o, `Output at index ${i}`))

  // Certificate/withdrawal stake credential: own (or unverifiable) key → path;
  // foreign key/script → hash form, which requires PLUTUS mode.
  const resolveStakeCredential = (
    cred: Inspect.CredentialView
  ): Pick<TrezorCardanoCertificate, "path" | "keyHash" | "scriptHash"> => {
    if (!cred.isScript && (ownStakeKeyHash === undefined || cred.hashHex === ownStakeKeyHash))
      return { path: stakePath }
    if (signingMode !== CardanoTxSigningMode.PLUTUS_TRANSACTION) return { path: stakePath }
    return cred.isScript ? { scriptHash: cred.hashHex } : { keyHash: cred.hashHex }
  }

/**
 * The Conway certificates that fold staking and governance together. CIP-21 lists all four among
 * the types that "are not supported and must not be included" in a hardware-wallet transaction,
 * so these are not a Trezor gap and no firmware release changes that — `Ledger.ts` refuses them
 * as well.
 */
const COMBINED_CERT_TYPES: ReadonlySet<string> = new Set([
  "stake_vote_delegation",
  "stake_reg_delegation",
  "vote_reg_delegation",
  "stake_vote_reg_delegation"
])

  const convertCertificate = (cert: Inspect.Certificate, index: number): TrezorCardanoCertificate => {
    switch (cert.type) {
      case "stake_registration":
        return { type: CardanoCertificateType.STAKE_REGISTRATION, ...resolveStakeCredential(credView(cert.cred)) }
      case "stake_deregistration":
        return { type: CardanoCertificateType.STAKE_DEREGISTRATION, ...resolveStakeCredential(credView(cert.cred)) }
      case "stake_delegation":
        return {
          type: CardanoCertificateType.STAKE_DELEGATION,
          ...resolveStakeCredential(credView(cert.cred)),
          pool: bytesToHex(cert.pool)
        }
      case "reg":
        return {
          type: CardanoCertificateType.STAKE_REGISTRATION_CONWAY,
          ...resolveStakeCredential(credView(cert.cred)),
          deposit: cert.deposit.toString()
        }
      case "unreg":
        return {
          type: CardanoCertificateType.STAKE_DEREGISTRATION_CONWAY,
          ...resolveStakeCredential(credView(cert.cred)),
          deposit: cert.deposit.toString()
        }
      case "vote_delegation":
        return {
          type: CardanoCertificateType.VOTE_DELEGATION,
          ...resolveStakeCredential(credView(cert.cred)),
          dRep: convertTrezorDRep(cert.drep)
        }
      default:
        // ⚠️ Two different refusals, and conflating them sent a 2026-10-08 Trezor report's author
        // to a Ledger that would also have refused. A DRep or committee certificate is a genuine
        // Trezor gap — Ledger's app implements those. The four COMBINED types are forbidden on
        // EVERY hardware wallet by CIP-21, and `Ledger.ts` refuses them too, so the only way
        // through is separate certificates.
        throw new Error(
          COMBINED_CERT_TYPES.has(cert.type)
            ? `Certificate at index ${index} (type '${cert.type}') combines staking and ` +
              "governance in one certificate, which CIP-21 forbids in a hardware-wallet " +
              "transaction. No device accepts one: build it as separate certificates " +
              "(registration, stake delegation, vote delegation)."
            : `Certificate at index ${index} (type '${cert.type}') is not supported by Trezor. ` +
              "DRep and committee certificates need a Ledger, whose Cardano app implements them."
        )
    }
  }

  const certificates: Array<TrezorCardanoCertificate> | undefined = body.certificates?.map(convertCertificate)

  const withdrawals: Array<TrezorCardanoWithdrawal> | undefined = body.withdrawals?.map((w) => ({
    amount: w.amount.toString(),
    ...resolveStakeCredential(w.credential)
  }))

  const mint = body.mint ? toMintBundle(body.mint) : undefined

  const collateralInputs: Array<TrezorCardanoInput> | undefined = body.collateral?.inputs.map((input) => ({
    prev_hash: input.txHashHex,
    prev_index: input.index
  }))

  const requiredSigners: Array<{ keyHash: string }> | undefined = body.signers?.map((hashHex) => ({ keyHash: hashHex }))

  const collateralReturn: TrezorCardanoOutput | undefined = body.collateral?.output
    ? convertOutput(body.collateral.output, "Collateral return output")
    : undefined

  const referenceInputs: Array<TrezorCardanoInput> | undefined = body.references?.map((input) => ({
    prev_hash: input.txHashHex,
    prev_index: input.index
  }))

  return {
    signingMode,
    protocolMagic,
    networkId,
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
      ? { auxiliaryData: buildCip36AuxiliaryData(options.cip36Registration, networkId, protocolMagic, stakePath) }
      : body.auxiliaryDataHashHex !== undefined
        ? { auxiliaryDataHash: body.auxiliaryDataHashHex }
        : {}),
    ...(mint && mint.length > 0 ? { mint } : {}),
    ...(body.witnessHash !== undefined ? { scriptDataHash: body.witnessHash } : {}),
    ...(collateralInputs && collateralInputs.length > 0 ? { collateralInputs } : {}),
    ...(requiredSigners && requiredSigners.length > 0 ? { requiredSigners } : {}),
    includeNetworkId: body.networkId !== undefined,
    ...(collateralReturn !== undefined ? { collateralReturn } : {}),
    ...(body.collateral?.balance !== undefined ? { totalCollateral: body.collateral.balance.toString() } : {}),
    ...(referenceInputs && referenceInputs.length > 0 ? { referenceInputs } : {}),
    additionalWitnessRequests: [...signingPaths],
    derivationType: CardanoDerivationType.ICARUS_TREZOR,
    ...(options?.tagCborSets ? { tagCborSets: true } : {})
  }
}

const buildCip36AuxiliaryData = (
  cip36Registration: CIP36RegistrationParams,
  networkId: number,
  protocolMagic: number,
  stakePath: string
): NonNullable<TrezorCardanoSignTxRequest["auxiliaryData"]> => {
  const dels = cip36Registration.delegations
  const delegations = Array.isArray(dels)
    ? dels.map((d: { readonly voteKeyHex: string; readonly weight: number }) => ({
        votingPublicKey: d.voteKeyHex,
        weight: d.weight
      }))
    : undefined

  let paymentAddressParameters: TrezorCardanoAddressParams
  if (cip36Registration.paymentDestination.type === "device_owned") {
    paymentAddressParameters = {
      addressType: CardanoAddressType.BASE,
      networkId,
      protocolMagic,
      spendingPath: cip36Registration.paymentDestination.addressParams.spendingPath,
      stakingPath: cip36Registration.paymentDestination.addressParams.stakingPath
    }
  } else {
    paymentAddressParameters = {
      addressType: CardanoAddressType.BASE,
      networkId,
      protocolMagic,
      spendingPath: stakePath
    }
  }

  const votingPublicKey = Array.isArray(dels)
    ? (dels[0]?.voteKeyHex ?? "")
    : (dels as { readonly voteKeyHex: string }).voteKeyHex

  return {
    cip36RegistrationParameters: {
      votingPublicKey,
      stakingPath: cip36Registration.stakingPath,
      nonce: cip36Registration.nonce,
      format: cip36Registration.votingPurpose ?? 0,
      paymentAddressParameters,
      ...(delegations && delegations.length > 1 ? { delegations } : {})
    }
  }
}
