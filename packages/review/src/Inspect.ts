/**
 * The full typed view of a Conway transaction body, span-preserving.
 *
 * Where `Analyze` answers "what does this transaction do" for four structured fields, `Inspect`
 * decodes the WHOLE body — inputs, outputs (address credentials, value, datum, script), fee,
 * ttl, withdrawals, collateral, required signers, auxiliary-data hash, script-data hash, network
 * id, reference inputs, votes, proposals — which is what a hardware sign-request builder and a
 * review screen both need.
 *
 * ⚠️ The walk is **positional**, not a decode-to-value-tree, because the slices it returns
 * (`txBodyFromTx`, `witnessSetFromTx`, `auxFromTx`) must be the exact original bytes of each
 * part. A span that differs by one byte is a different transaction id, so re-encoding a decoded
 * tree would make review-before-sign dishonest.
 *
 * ⚠️ Two facts no schema decoder preserves are reported here and must not be dropped:
 * `unknownKeys`, the body-map keys this view does not model, and `inputsSetTagged`, whether the
 * input set arrived `#6.258` or bare. A decoder that silently discards what it does not
 * recognise cannot power review-before-sign.
 *
 * Synchronous under the hood; the facade wraps a throw on malformed input into a typed
 * `CborError`. Every scalar is surfaced as hex or bigint so consumers never touch raw bytes.
 *
 * @since 0.1.0
 */

import { AddressEras, AddressTag } from "@evolution-sdk/evolution"
import { Effect } from "effect"

import {
  AddressHex,
  AssetNameHex,
  AuxiliaryDataHashHex,
  Bech32,
  DatumHashHex,
  KeyHashHex,
  PlutusDataHex,
  PolicyIdHex,
  PublicKeyHex,
  ScriptDataHashHex,
  ScriptHex,
  SignatureHex,
  TxHashHex
} from "./Brands.js"
import { CborError } from "./Errors.js"
import { CborType, collectionDone, Deserializer, itemLen, readBstr, readHead, skipItem } from "./internal/Cursor.js"
import {
  certificatesFromSpan,
  mintFromSpan,
  proposalProceduresFromSpan,
  votingProceduresFromSpan
} from "./internal/EvolutionDecode.js"
import { bytesToHex, hexToBytes } from "./internal/Hex.js"
import type { Certificate, Mint, ProposalProcedure, VotingProcedures } from "./Types.js"

export type {
  Anchor,
  Certificate,
  Credential,
  DRep,
  GovActionId,
  Mint,
  ProposalProcedure,
  Vote,
  Voter,
  VotingProcedure,
  VotingProcedures
} from "./Types.js"

const hx = (b: Uint8Array): string => bytesToHex(b)

/** A key/script credential, hex-encoded (28-byte hash). */
export type CredentialView = { readonly hashHex: KeyHashHex; readonly isScript: boolean }

/** A decoded address: raw bytes + (when non-Byron) bech32, plus its credentials. */
export type AddressView = {
  readonly hex: AddressHex
  readonly bech32?: Bech32
  readonly kind?: "Base" | "Pointer" | "Enterprise" | "Reward" | "Byron"
  readonly network?: number
  readonly payment?: CredentialView
  readonly stake?: CredentialView
}

/** A single native-asset entry (asset name / policy id hex-encoded). */
export type TokenView = {
  readonly policyIdHex: PolicyIdHex
  readonly assetNameHex: AssetNameHex
  readonly amount: bigint
}

/** An output/collateral-return value: lovelace + native assets. */
export type ValueView = { readonly amount: bigint; readonly tokens: ReadonlyArray<TokenView> }

/** A transaction input / reference input / collateral input. */
export type InputView = { readonly txHashHex: TxHashHex; readonly index: number }

/** A transaction output (legacy array or Babbage map form). */
export type OutputView = {
  readonly address: AddressView
  readonly value: ValueView
  /** true = Conway/Babbage map output; false = pre-Babbage legacy array output. */
  readonly map: boolean
  readonly datumHashHex?: DatumHashHex
  readonly inlineDatumHex?: PlutusDataHex
  readonly referenceScriptHex?: ScriptHex
}

/** A reward withdrawal: the reward account + its credential + amount. */
export type WithdrawalView = {
  readonly rewardAddress: AddressView
  readonly credential: CredentialView
  readonly amount: bigint
}

/** Collateral group (Conway keys 13 / 16 / 17). */
export type CollateralView = {
  readonly inputs: ReadonlyArray<InputView>
  readonly output?: OutputView
  readonly balance?: bigint
}

/** The full typed view of a Conway transaction body. */
export type TxBodyView = {
  readonly inputs: ReadonlyArray<InputView>
  readonly outputs: ReadonlyArray<OutputView>
  readonly fee: bigint
  /** ttl (key 3). */
  readonly ttl?: bigint
  /** validity_interval_start (key 8). */
  readonly validityIntervalStart?: bigint
  readonly certificates?: ReadonlyArray<Certificate>
  readonly withdrawals?: ReadonlyArray<WithdrawalView>
  /** auxiliary_data_hash (key 7). */
  readonly auxiliaryDataHashHex?: AuxiliaryDataHashHex
  readonly mint?: Mint
  /** script_data_hash (key 11). */
  readonly witnessHash?: ScriptDataHashHex
  readonly collateral?: CollateralView
  /** required_signers (key 14), as 28-byte key-hash hexes. */
  readonly signers?: ReadonlyArray<KeyHashHex>
  /** network_id (key 15) — undefined when the field is absent. */
  readonly networkId?: number
  /** reference_inputs (key 18). */
  readonly references?: ReadonlyArray<InputView>
  /** voting_procedures (key 19). */
  readonly votes?: VotingProcedures
  /** proposal_procedures (key 20). */
  readonly proposals?: ReadonlyArray<ProposalProcedure>
  /** current_treasury_value (key 21). */
  readonly treasury?: bigint
  /** donation (key 22). */
  readonly donation?: bigint
  /** Body-map keys present that this view does not model (e.g. 6 update, future keys). */
  readonly unknownKeys: ReadonlyArray<number>
}

const startsWith258 = (span: Uint8Array): boolean => span[0] === 0xd9 && span[1] === 0x01 && span[2] === 0x02

/**
 * One `transaction_input` off the cursor: `[transaction_id, index]`.
 *
 * Inlined rather than taken from `cores/pure-ts`: it is eight lines of cursor work, and it was
 * the last thing in this module typed against our own `Deserializer`.
 */
const readInput = (rd: Deserializer): InputView => {
  const arr = rd.array()
  if (arr !== "indefinite" && arr.definite !== 2) {
    throw new Error(`transaction_input [hash, index]: ${arr.definite} elements`)
  }
  const hash = rd.bytes()
  if (hash.length !== 32) throw new Error(`transaction_id must be 32 bytes, got ${hash.length}`)
  return { txHashHex: TxHashHex(hx(hash)), index: Number(rd.unsignedInteger()) }
}

const decodeInputSet = (span: Uint8Array): Array<InputView> => {
  const rd = Deserializer.from(span)
  if (rd.cborType() === CborType.Tag) rd.tag() // optional #6.258 set tag
  const arrLen = rd.array()
  const out: Array<InputView> = []
  let i = 0
  while (!collectionDone(rd, arrLen, i)) {
    out.push(readInput(rd))
    i++
  }
  return out
}

const decodeValueParts = (span: Uint8Array): ValueView => {
  const rd = Deserializer.from(span)
  if (rd.cborType() === CborType.UnsignedInteger) return { amount: rd.unsignedInteger(), tokens: [] }
  rd.array()
  const amount = rd.unsignedInteger()
  const maLen = rd.map()
  const tokens: Array<TokenView> = []
  let i = 0
  while (!collectionDone(rd, maLen, i)) {
    const policyIdHex = PolicyIdHex(hx(rd.bytes()))
    const asLen = rd.map()
    let j = 0
    while (!collectionDone(rd, asLen, j)) {
      tokens.push({ policyIdHex, assetNameHex: AssetNameHex(hx(rd.bytes())), amount: rd.unsignedInteger() })
      j++
    }
    i++
  }
  return { amount, tokens }
}

/** Their `Credential` is a tagged `KeyHash | ScriptHash`; ours is `{hashHex, isScript}`. */
const credentialView = (
  c: { readonly _tag: string; readonly hash: Uint8Array } | undefined
): CredentialView | undefined =>
  c === undefined ? undefined : { hashHex: KeyHashHex(hx(c.hash)), isScript: c._tag === "ScriptHash" }

/**
 * An address decoded as far as it goes and no further.
 *
 * `AddressTag` is used rather than `AddressEras` for everything but the bech32 because review has
 * to render an address it cannot fully explain: a malformed or undefined-kind address still shows
 * its hex, its kind and whatever credential can be sliced out, where a validating decode would
 * throw and take the whole transaction with it.
 */
const addressView = (bytes: Uint8Array): AddressView => {
  let bech32: Bech32 | undefined
  try {
    // Deliberately the VALIDATING path: a string that looks like an address is a claim about it,
    // so anything malformed gets no bech32 rather than a plausible-looking one.
    bech32 = Bech32(AddressEras.toBech32(AddressEras.fromBytes(bytes)))
  } catch {
    bech32 = undefined
  }
  const kind = AddressTag.fromBytes(bytes)
  const network = AddressTag.networkId(bytes)
  const payment = credentialView(AddressTag.paymentCredential(bytes))
  const stake = credentialView(AddressTag.stakeCredential(bytes))
  return {
    hex: AddressHex(hx(bytes)),
    ...(bech32 !== undefined ? { bech32 } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(network !== undefined ? { network } : {}),
    ...(payment !== undefined ? { payment } : {}),
    ...(stake !== undefined ? { stake } : {})
  }
}

/**
 * A transaction output, decoded far enough to view and **no further**: the address bytes and the
 * value, datum and script spans exactly as they arrived.
 *
 * Span-preserving on purpose. A value decode would give the same information in every field but
 * one — the inline datum, whose bytes are what a script consumer matches by hash. Re-encoding it
 * is how a review screen shows a datum the chain would not recognise.
 */
type RawOutput = {
  readonly addressBytes: Uint8Array
  readonly valueSpan: Uint8Array
  readonly babbage: boolean
  readonly datumHashSpan?: Uint8Array
  readonly extra: ReadonlyArray<readonly [bigint, Uint8Array]>
}

/** The content of a definite bytestring span, header stripped. */
const bytestringContent = (span: Uint8Array): Uint8Array => {
  const out = readBstr(span, { pos: 0 })
  if (out === undefined) throw new Error("expected a definite bytestring")
  return out
}

/** The span of the complete CBOR item at `pos`, bounds-checked. */
const spanAt = (bytes: Uint8Array, pos: number): Uint8Array => {
  const end = pos + itemLen(bytes, pos)
  if (end > bytes.length) throw new Error("cbor item span exceeds buffer")
  return bytes.slice(pos, end)
}

const readOutput = (bytes: Uint8Array): RawOutput => {
  const [head0, n, major] = readHead(bytes, 0)
  let pos = head0
  if (major === 4) {
    if (n < 2n || n > 3n) throw new Error(`legacy output [addr,value,?datum_hash]: ${n} elements`)
    const addressSpan = spanAt(bytes, pos)
    pos += addressSpan.length
    const valueSpan = spanAt(bytes, pos)
    pos += valueSpan.length
    const datumHashSpan = n === 3n ? spanAt(bytes, pos) : undefined
    return {
      addressBytes: bytestringContent(addressSpan),
      valueSpan,
      babbage: false,
      ...(datumHashSpan !== undefined ? { datumHashSpan } : {}),
      extra: []
    }
  }
  if (major !== 5) throw new Error(`transaction output (array or map): major ${major}`)
  let addressBytes: Uint8Array | undefined
  let valueSpan: Uint8Array | undefined
  const extra: Array<readonly [bigint, Uint8Array]> = []
  const seen = new Set<bigint>()
  for (let i = 0n; i < n; i++) {
    const [kl, key, km] = readHead(bytes, pos)
    if (km !== 0) throw new Error(`uint output key: major ${km}`)
    // Duplicate keys are rejected rather than last-wins — see readBodyMap.
    if (seen.has(key)) throw new Error(`distinct output keys: duplicate key ${key}`)
    seen.add(key)
    pos += kl
    const span = spanAt(bytes, pos)
    pos += span.length
    if (key === 0n) addressBytes = bytestringContent(span)
    else if (key === 1n) valueSpan = span
    else extra.push([key, span])
  }
  if (addressBytes === undefined || valueSpan === undefined) throw new Error("babbage output keys 0,1 missing")
  return { addressBytes, valueSpan, babbage: true, extra }
}

/**
 * The transaction body as `(key, exact span)` pairs, plus whether the input set carried `#6.258`.
 *
 * ⚠️ A duplicate body key is REJECTED, not last-wins. It is a review/execute divergence: a crafted
 * body could show one mint field to a reviewer and another to a decoder that takes the last. Conway
 * bodies are canonical maps, so this only refuses what the ledger refuses too.
 */
const readBodyMap = (
  bytes: Uint8Array
): { entries: ReadonlyArray<readonly [bigint, Uint8Array]>; inputsSetTagged: boolean } => {
  const [head0, n, major] = readHead(bytes, 0)
  if (major !== 5) throw new Error(`transaction body (cbor map): major type ${major}`)
  let pos = head0
  const entries: Array<readonly [bigint, Uint8Array]> = []
  const seen = new Set<bigint>()
  for (let i = 0n; i < n; i++) {
    const [klen, key, kmajor] = readHead(bytes, pos)
    if (kmajor !== 0) throw new Error(`uint body key: major ${kmajor}`)
    if (seen.has(key)) throw new Error(`distinct body keys: duplicate key ${key}`)
    seen.add(key)
    pos += klen
    const span = spanAt(bytes, pos)
    pos += span.length
    entries.push([key, span])
  }
  const inputs = entries.find(([k]) => k === 0n)
  return { entries, inputsSetTagged: inputs !== undefined && startsWith258(inputs[1]) }
}

const decodeOutput = (o: RawOutput): OutputView => {
  const value = decodeValueParts(o.valueSpan)
  const map = o.babbage
  let datumHashHex: DatumHashHex | undefined
  let inlineDatumHex: PlutusDataHex | undefined
  let referenceScriptHex: ScriptHex | undefined

  if (!o.babbage) {
    if (o.datumHashSpan !== undefined) datumHashHex = DatumHashHex(hx(Deserializer.from(o.datumHashSpan).bytes()))
  } else {
    for (const [k, v] of o.extra) {
      if (k === 2n) {
        // datum_option = [0, hash32] | [1, #6.24(bytes .cbor plutus_data)]
        const rd = Deserializer.from(v)
        rd.array()
        const t = rd.unsignedInteger()
        if (t === 0n) datumHashHex = DatumHashHex(hx(rd.bytes()))
        else if (t === 1n) {
          rd.tag() // 24
          inlineDatumHex = PlutusDataHex(hx(rd.bytes()))
        }
      } else if (k === 3n) {
        // script_ref = #6.24(bytes .cbor script)
        const rd = Deserializer.from(v)
        rd.tag() // 24
        referenceScriptHex = ScriptHex(hx(rd.bytes()))
      }
    }
  }

  return {
    address: addressView(o.addressBytes),
    value,
    map,
    ...(datumHashHex !== undefined ? { datumHashHex } : {}),
    ...(inlineDatumHex !== undefined ? { inlineDatumHex } : {}),
    ...(referenceScriptHex !== undefined ? { referenceScriptHex } : {})
  }
}

const decodeWithdrawals = (span: Uint8Array): Array<WithdrawalView> => {
  const rd = Deserializer.from(span)
  const mapLen = rd.map()
  const out: Array<WithdrawalView> = []
  let i = 0
  while (!collectionDone(rd, mapLen, i)) {
    const account = rd.bytes()
    const amount = rd.unsignedInteger()
    const sc = credentialView(AddressTag.stakeCredential(account))
    out.push({
      rewardAddress: addressView(account),
      credential: sc ?? { hashHex: KeyHashHex(hx(account.slice(1))), isScript: false },
      amount
    })
    i++
  }
  return out
}

const decodeRequiredSigners = (span: Uint8Array): Array<KeyHashHex> => {
  const rd = Deserializer.from(span)
  if (rd.cborType() === CborType.Tag) rd.tag()
  const arrLen = rd.array()
  const out: Array<KeyHashHex> = []
  let i = 0
  while (!collectionDone(rd, arrLen, i)) {
    out.push(KeyHashHex(hx(rd.bytes())))
    i++
  }
  return out
}

const readUint = (span: Uint8Array): bigint => Deserializer.from(span).unsignedInteger()
const readBytesHex = (span: Uint8Array): string => hx(Deserializer.from(span).bytes())

/** Body-map keys handled by typed fields / typed-view methods (never "unknown"). */
const KNOWN_KEYS = new Set<bigint>([
  0n,
  1n,
  2n,
  3n,
  4n,
  5n,
  7n,
  8n,
  9n,
  11n,
  13n,
  14n,
  15n,
  16n,
  17n,
  18n,
  19n,
  20n,
  21n,
  22n
])

/** Each element of a CBOR array, as its own exact span. */
const arrayElementSpans = (bytes: Uint8Array): Array<Uint8Array> => {
  const [head0, n, major] = readHead(bytes, 0)
  if (major !== 4) throw new Error(`cbor array: major ${major}`)
  let pos = head0
  const out: Array<Uint8Array> = []
  for (let i = 0n; i < n; i++) {
    const span = spanAt(bytes, pos)
    out.push(span)
    pos += span.length
  }
  return out
}

const buildView = (bodyHex: string): { body: TxBodyView; taggedSets: boolean } => {
  const { entries, inputsSetTagged } = readBodyMap(hexToBytes(bodyHex))
  const at = (key: bigint): Uint8Array | undefined => entries.find(([k]) => k === key)?.[1]

  const inputsSpan = at(0n)
  const outputsSpan = at(1n)
  const feeSpan = at(2n)
  if (inputsSpan === undefined || outputsSpan === undefined || feeSpan === undefined) {
    throw new Error("tx body with inputs+outputs+fee: missing required field")
  }

  const inputs: Array<InputView> = decodeInputSet(inputsSpan)
  const outputs: Array<OutputView> = arrayElementSpans(outputsSpan).map((span) => decodeOutput(readOutput(span)))
  const certificatesSpan = at(4n)
  const mintSpan = at(9n)
  const votesSpan = at(19n)
  const proposalsSpan = at(20n)
  const certificates: Array<Certificate> | undefined =
    certificatesSpan !== undefined ? certificatesFromSpan(certificatesSpan) : undefined
  const mint: Mint | undefined = mintSpan !== undefined ? mintFromSpan(mintSpan) : undefined
  const votes: VotingProcedures | undefined = votesSpan !== undefined ? votingProceduresFromSpan(votesSpan) : undefined
  const proposals: Array<ProposalProcedure> | undefined =
    proposalsSpan !== undefined ? proposalProceduresFromSpan(proposalsSpan) : undefined

  const ttlSpan = at(3n)
  const ttl: bigint | undefined = ttlSpan !== undefined ? readUint(ttlSpan) : undefined
  let validityIntervalStart: bigint | undefined
  let withdrawals: Array<WithdrawalView> | undefined
  let auxiliaryDataHashHex: AuxiliaryDataHashHex | undefined
  let witnessHash: ScriptDataHashHex | undefined
  let collateralInputs: Array<InputView> | undefined
  let collateralReturn: OutputView | undefined
  let totalCollateral: bigint | undefined
  let signers: Array<KeyHashHex> | undefined
  let networkId: number | undefined
  let references: Array<InputView> | undefined
  let treasury: bigint | undefined
  let donation: bigint | undefined
  const unknownKeys: Array<number> = []
  let taggedSets = inputsSetTagged

  for (const [k, v] of entries) {
    switch (k) {
      case 0n:
      case 1n:
      case 2n:
      case 3n:
        // read above from their spans
        break
      case 4n:
      case 9n:
      case 19n:
      case 20n:
        // handled by typed-view methods above; still contribute to set-tag detection
        if ((k === 4n || k === 20n) && startsWith258(v)) taggedSets = true
        break
      case 5n:
        withdrawals = decodeWithdrawals(v)
        break
      case 7n:
        auxiliaryDataHashHex = AuxiliaryDataHashHex(readBytesHex(v))
        break
      case 8n:
        validityIntervalStart = readUint(v)
        break
      case 11n:
        witnessHash = ScriptDataHashHex(readBytesHex(v))
        break
      case 13n:
        collateralInputs = decodeInputSet(v)
        if (startsWith258(v)) taggedSets = true
        break
      case 14n:
        signers = decodeRequiredSigners(v)
        if (startsWith258(v)) taggedSets = true
        break
      case 15n:
        networkId = Number(readUint(v))
        break
      case 16n:
        collateralReturn = decodeOutput(readOutput(v))
        break
      case 17n:
        totalCollateral = readUint(v)
        break
      case 18n:
        references = decodeInputSet(v)
        if (startsWith258(v)) taggedSets = true
        break
      case 21n:
        treasury = readUint(v)
        break
      case 22n:
        donation = readUint(v)
        break
      default:
        if (!KNOWN_KEYS.has(k)) unknownKeys.push(Number(k))
    }
  }

  const collateral: CollateralView | undefined =
    collateralInputs !== undefined || collateralReturn !== undefined || totalCollateral !== undefined
      ? {
          inputs: collateralInputs ?? [],
          ...(collateralReturn !== undefined ? { output: collateralReturn } : {}),
          ...(totalCollateral !== undefined ? { balance: totalCollateral } : {})
        }
      : undefined

  const body: TxBodyView = {
    inputs,
    outputs,
    fee: readUint(feeSpan),
    ...(ttl !== undefined ? { ttl } : {}),
    ...(validityIntervalStart !== undefined ? { validityIntervalStart } : {}),
    ...(certificates !== undefined ? { certificates } : {}),
    ...(withdrawals !== undefined ? { withdrawals } : {}),
    ...(auxiliaryDataHashHex !== undefined ? { auxiliaryDataHashHex } : {}),
    ...(mint !== undefined ? { mint } : {}),
    ...(witnessHash !== undefined ? { witnessHash } : {}),
    ...(collateral !== undefined ? { collateral } : {}),
    ...(signers !== undefined ? { signers } : {}),
    ...(networkId !== undefined ? { networkId } : {}),
    ...(references !== undefined ? { references } : {}),
    ...(votes !== undefined ? { votes } : {}),
    ...(proposals !== undefined ? { proposals } : {}),
    ...(treasury !== undefined ? { treasury } : {}),
    ...(donation !== undefined ? { donation } : {}),
    unknownKeys
  }

  return { body, taggedSets }
}

/**
 * Decode a CBOR transaction body (hex) into a typed {@link TxBodyView} plus a
 * `taggedSets` flag (true when any Conway set field used the #6.258 tag — the
 * device must re-emit tagged sets to reproduce the same body hash).
 */
export const txBody = (bodyHex: string): Effect.Effect<{ body: TxBodyView; taggedSets: boolean }, CborError> =>
  Effect.try({
    try: () => buildView(bodyHex),
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

const fromHex = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new Error(`invalid hex: ${hex.slice(0, 32)}…`)
  return hexToBytes(hex)
}

/** Decode a Value (`coin` or `[coin, multiasset]`) CBOR hex into a {@link ValueView}. */
export const value = (valueHex: string): Effect.Effect<ValueView, CborError> =>
  Effect.try({
    try: () => decodeValueParts(fromHex(valueHex)),
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

/** One decoded vkey witness (witness-set key 0 entry). */
export type VkeyWitnessView = { readonly vkeyHex: PublicKeyHex; readonly sigHex: SignatureHex }

const decodeWitnessVkeys = (bytes: Uint8Array): Array<VkeyWitnessView> => {
  const ref = { pos: 0 }
  const [h0, n, m] = readHead(bytes, ref.pos)
  if (m !== 5) throw new Error("witness set: expected a CBOR map")
  ref.pos += h0
  const out: Array<VkeyWitnessView> = []
  for (let i = 0n; i < n; i++) {
    const [kh, kval, km] = readHead(bytes, ref.pos)
    const isVkeyKey = km === 0 && kval === 0n
    if (isVkeyKey) {
      ref.pos += kh
      let [vh, vlen, vm] = readHead(bytes, ref.pos)
      if (vm === 6) {
        ref.pos += vh // #6.258 set tag
        ;[vh, vlen, vm] = readHead(bytes, ref.pos)
      }
      if (vm !== 4) throw new Error("witness set: vkey witnesses must be an array")
      ref.pos += vh
      for (let j = 0n; j < vlen; j++) {
        const [eh, elen, em] = readHead(bytes, ref.pos)
        if (em !== 4 || elen !== 2n) throw new Error("witness set: vkey witness must be [vkey, signature]")
        ref.pos += eh
        const vkey = readBstr(bytes, ref)
        const sig = readBstr(bytes, ref)
        if (vkey === undefined || sig === undefined) throw new Error("witness set: malformed vkey witness bytes")
        out.push({ vkeyHex: PublicKeyHex(hx(vkey)), sigHex: SignatureHex(hx(sig)) })
      }
    } else {
      skipItem(bytes, ref) // key
      skipItem(bytes, ref) // value
    }
  }
  return out
}

/** Decode the vkey witnesses (key 0) from a TransactionWitnessSet CBOR hex. */
export const witnessSetVkeys = (witnessSetHex: string): Effect.Effect<ReadonlyArray<VkeyWitnessView>, CborError> =>
  Effect.try({
    try: () => decodeWitnessVkeys(fromHex(witnessSetHex)),
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

const sliceTxBody = (bytes: Uint8Array): string => {
  const ref = { pos: 0 }
  let [h, , m] = readHead(bytes, ref.pos)
  if (m === 6) {
    ref.pos += h // defensive: unwrap an outer tag if one is present
    ;[h, , m] = readHead(bytes, ref.pos)
  }
  if (m !== 4) throw new Error("transaction: expected a CBOR array")
  ref.pos += h
  const start = ref.pos
  skipItem(bytes, ref) // element 0 = the transaction body
  return hx(bytes.slice(start, ref.pos))
}

const sliceWitnessSet = (bytes: Uint8Array): string => {
  const ref = { pos: 0 }
  let [h, , m] = readHead(bytes, ref.pos)
  if (m === 6) {
    ref.pos += h
    ;[h, , m] = readHead(bytes, ref.pos)
  }
  if (m !== 4) throw new Error("transaction: expected a CBOR array")
  ref.pos += h
  skipItem(bytes, ref) // element 0 = body
  const start = ref.pos
  skipItem(bytes, ref) // element 1 = witness set
  return hx(bytes.slice(start, ref.pos))
}

/**
 * Slice the transaction body (element 0) out of a full transaction CBOR
 * (`[body, witness_set, is_valid, aux_data]`) as its own hex. A byte-exact
 * slice — no re-encode — so `txBodyHash(result) === txHashFromFull(fullTx)`.
 * CIP-30 `signTx` hands over a full tx; the review + signing rails work on the
 * body, so this is the bridge between them.
 */
export const txBodyFromTx = (fullTxHex: string): Effect.Effect<string, CborError> =>
  Effect.try({
    try: () => sliceTxBody(fromHex(fullTxHex)),
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

/**
 * Slice the witness set (element 1) out of a full transaction CBOR as its own
 * hex — a byte-exact slice, no re-encode. The companion to {@link txBodyFromTx}
 * for reading redeemers / datums / scripts off a received tx via `Analyze.*`.
 */
export const witnessSetFromTx = (fullTxHex: string): Effect.Effect<string, CborError> =>
  Effect.try({
    try: () => sliceWitnessSet(fromHex(fullTxHex)),
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

/**
 * Byte-exact map entries of a TransactionWitnessSet, EXCLUDING the vkey
 * witnesses (key 0) — i.e. native scripts (1), plutus scripts (3/6/7), datums
 * (4) and redeemers (5), each as `[intKey, valueCborHex]`. This is the
 * `witnessExtra` shape `Tx.assemble` re-attaches when we add our own vkey
 * witness to an externally-built (dApp / DEX) tx and submit it ourselves. Value
 * slices are byte-exact — no re-encode — so ex-units, script hashes and datum
 * bytes are preserved verbatim.
 */
export const witnessSetEntries = (
  witnessSetHex: string
): Effect.Effect<ReadonlyArray<readonly [number, string]>, CborError> =>
  Effect.try({
    try: () => decodeWitnessEntries(fromHex(witnessSetHex)),
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

const decodeWitnessEntries = (bytes: Uint8Array): Array<readonly [number, string]> => {
  const ref = { pos: 0 }
  const [h0, n, m] = readHead(bytes, ref.pos)
  if (m !== 5) throw new Error("witness set: expected a CBOR map")
  ref.pos += h0
  const out: Array<readonly [number, string]> = []
  for (let i = 0n; i < n; i++) {
    const [kh, kval, km] = readHead(bytes, ref.pos)
    if (km !== 0) throw new Error("witness set: expected uint keys")
    ref.pos += kh
    const start = ref.pos
    skipItem(bytes, ref) // value
    // Key 0 = vkey witnesses; we produce our own set, so a stale one is dropped
    // to avoid a duplicate map key.
    if (kval !== 0n) out.push([Number(kval), hx(bytes.slice(start, ref.pos))])
  }
  return out
}

/**
 * Slice the auxiliary_data out of a full transaction CBOR as its own hex.
 * Which element that is depends on the transaction's shape (see `txLayout`):
 * element 3 of a Conway `[body, wits, is_valid, aux]`, element 2 of both a
 * 3-element tx and a Dijkstra `block_transaction` `[body, wits, aux, is_valid]`.
 * Returns `''` when the aux element is CBOR `null` — the empty value
 * `Tx.assemble` treats as "no aux". Byte-exact (no re-encode) so the aux-data
 * hash still matches.
 */
export const auxFromTx = (fullTxHex: string): Effect.Effect<string, CborError> =>
  Effect.try({
    try: () => sliceAux(fromHex(fullTxHex)),
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

/**
 * Read `is_valid` off a full transaction CBOR — the ledger's phase-2 verdict.
 * Element 2 of a Conway `[body, wits, is_valid, aux]`, element 3 of a Dijkstra
 * `block_transaction` `[body, wits, aux, is_valid]` (see `txLayout`). `false` means the
 * transaction's scripts failed and its collateral was consumed instead of its
 * inputs; it is on-chain either way. This is the authoritative source: an indexer
 * summary need not carry the flag at all.
 *
 * A 3-element transaction predates Alonzo, so it has no such element and no
 * phase-2 script to fail — it reads as valid.
 */
export const isValidFromTx = (fullTxHex: string): Effect.Effect<boolean, CborError> =>
  Effect.try({
    try: () => readIsValid(fromHex(fullTxHex)),
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

/**
 * Which element carries `is_valid` and which carries `auxiliary_data`. Three
 * shapes reach a wallet and they disagree about element 2:
 *
 *   `[body, wits, aux/nil]`            Shelley..Babbage, and Dijkstra's canonical form
 *   `[body, wits, is_valid, aux/nil]`  Alonzo..Conway, and Dijkstra's back-compat mempool form
 *   `[body, wits, aux/nil, is_valid]`  Dijkstra `block_transaction` — the producer APPENDS the flag
 *
 * A boolean at element 2 separates the second from the third: `auxiliary_data`
 * is a map, array or tag (or `nil`), never a bool.
 */
const txLayout = (bytes: Uint8Array): { auxIndex: number; isValidIndex: number | null } => {
  const ref = { pos: 0 }
  let [h, n, m] = readHead(bytes, ref.pos)
  if (m === 6) {
    ref.pos += h
    ;[h, n, m] = readHead(bytes, ref.pos)
  }
  if (m !== 4) throw new Error("transaction: expected a CBOR array")
  ref.pos += h
  const count = Number(n)
  if (count === 3) return { auxIndex: 2, isValidIndex: null }
  if (count !== 4) throw new Error(`transaction: expected 3 or 4 elements, got ${count}`)
  skipItem(bytes, ref) // 0 = body
  skipItem(bytes, ref) // 1 = witness set
  const [, v, vm] = readHead(bytes, ref.pos)
  const elementTwoIsBool = vm === 7 && (v === 20n || v === 21n)
  return elementTwoIsBool ? { auxIndex: 3, isValidIndex: 2 } : { auxIndex: 2, isValidIndex: 3 }
}

// Byte range of element `index` of the transaction array.
const txElement = (bytes: Uint8Array, index: number): { start: number; end: number } => {
  const ref = { pos: 0 }
  let [h, , m] = readHead(bytes, ref.pos)
  if (m === 6) {
    ref.pos += h
    ;[h, , m] = readHead(bytes, ref.pos)
  }
  if (m !== 4) throw new Error("transaction: expected a CBOR array")
  ref.pos += h
  for (let i = 0; i < index; i++) skipItem(bytes, ref)
  const start = ref.pos
  skipItem(bytes, ref)
  return { start, end: ref.pos }
}

const readIsValid = (bytes: Uint8Array): boolean => {
  const { isValidIndex } = txLayout(bytes)
  if (isValidIndex === null) return true
  const { start } = txElement(bytes, isValidIndex)
  const [, v, vm] = readHead(bytes, start)
  // Major 7 / values 20 and 21 are CBOR `false` and `true`. Anything else means
  // the element is not the flag, so refuse rather than coerce a verdict.
  if (vm !== 7 || (v !== 20n && v !== 21n)) throw new Error("transaction: is_valid is not a CBOR boolean")
  return v === 21n
}

const sliceAux = (bytes: Uint8Array): string => {
  const { auxIndex } = txLayout(bytes)
  const { end, start } = txElement(bytes, auxIndex)
  if (start >= bytes.length || bytes[start] === 0xf6) return "" // absent or CBOR null
  return hx(bytes.slice(start, end))
}

/**
 * A decoded transaction metadatum. `bytes` becomes `0x`-prefixed hex (lossless
 * and unambiguous against text), integers stay `bigint` so a 64-bit label or
 * amount survives, and a metadatum map becomes an object whose non-text keys are
 * stringified — CBOR permits any metadatum as a key, JSON does not.
 */
export type MetadatumView = bigint | string | ReadonlyArray<MetadatumView> | { readonly [k: string]: MetadatumView }

/** Transaction metadata: on-chain label → metadatum. Labels are decimal strings. */
export type MetadataView = { readonly [label: string]: MetadatumView }

const readMetadatum = (rd: Deserializer): MetadatumView => {
  switch (rd.cborType()) {
    case CborType.UnsignedInteger:
      return rd.unsignedInteger()
    case CborType.NegativeInteger:
      return rd.negativeInteger()
    case CborType.Bytes:
      return `0x${hx(rd.bytes())}`
    case CborType.Text:
      return rd.text()
    case CborType.Array: {
      const l = rd.array()
      const out: Array<MetadatumView> = []
      let i = 0
      while (!collectionDone(rd, l, i)) {
        out.push(readMetadatum(rd))
        i++
      }
      return out
    }
    case CborType.Map: {
      const l = rd.map()
      const out: Record<string, MetadatumView> = {}
      let i = 0
      while (!collectionDone(rd, l, i)) {
        // CBOR permits any metadatum as a key; JSON permits only strings. Scalars
        // become their plain text form, composites their JSON — either way nothing
        // silently disappears from a review.
        const key = readMetadatum(rd)
        const asKey =
          typeof key === "string"
            ? key
            : typeof key === "bigint"
              ? key.toString()
              : JSON.stringify(key, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
        out[asKey] = readMetadatum(rd)
        i++
      }
      return out
    }
    case CborType.Tag:
      // Metadatum has no tagged form; skip the tag and read what it wraps rather
      // than failing the whole decode over one exotic entry.
      rd.tag()
      return readMetadatum(rd)
    default:
      throw new Error("metadatum: unsupported CBOR type")
  }
}

/**
 * Decode the `metadata` map out of auxiliary_data CBOR.
 *
 * Auxiliary data has three historical shapes and all of them are still on chain:
 * a bare metadata map (Shelley), `[metadata, auxiliary_scripts]` (Shelley-MA),
 * and a tag-259 map keyed `0 = metadata, 1..4 = scripts` (Alonzo onward). Returns
 * `{}` for aux data that carries only scripts.
 */
export const metadata = (auxHex: string): Effect.Effect<MetadataView, CborError> =>
  Effect.try({
    try: () => decodeMetadata(fromHex(auxHex)),
    catch: (e) => new CborError({ message: e instanceof Error ? e.message : String(e) })
  })

const readMetadataMap = (rd: Deserializer): MetadataView => {
  const l = rd.map()
  const out: Record<string, MetadatumView> = {}
  let i = 0
  while (!collectionDone(rd, l, i)) {
    const label = rd.unsignedInteger()
    out[label.toString()] = readMetadatum(rd)
    i++
  }
  return out
}

const decodeMetadata = (bytes: Uint8Array): MetadataView => {
  const rd = Deserializer.from(bytes)
  // Alonzo+: tag 259 wrapping a map whose key 0 is the metadata.
  if (rd.cborType() === CborType.Tag) {
    rd.tag()
    const l = rd.map()
    let i = 0
    while (!collectionDone(rd, l, i)) {
      const key = rd.unsignedInteger()
      if (key === 0n) return readMetadataMap(rd)
      // Not the metadata entry (native / Plutus scripts) — step over its value.
      const ref = { pos: rd.position() }
      skipItem(bytes, ref)
      rd.skip(ref.pos - rd.position())
      i++
    }
    return {}
  }
  // Shelley-MA: [metadata, auxiliary_scripts].
  if (rd.cborType() === CborType.Array) {
    rd.array()
    return readMetadataMap(rd)
  }
  // Shelley: the metadata map on its own.
  return readMetadataMap(rd)
}
