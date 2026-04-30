import { blake2b } from "@noble/hashes/blake2"
import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"
import type { NonEmptyArray } from "effect/Array"

import * as Anchor from "./Anchor.js"
import * as AuxiliaryDataHash from "./AuxiliaryDataHash.js"
import * as Bytes from "./Bytes.js"
import * as CBOR from "./CBOR.js"
import * as Certificate from "./Certificate.js"
import * as Coin from "./Coin.js"
import * as GovernanceAction from "./GovernanceAction.js"
import * as KeyHash from "./KeyHash.js"
import * as Mint from "./Mint.js"
import * as NetworkId from "./NetworkId.js"
import * as PositiveCoin from "./PositiveCoin.js"
import * as ProposalProcedure from "./ProposalProcedure.js"
import * as ProposalProcedures from "./ProposalProcedures.js"
import * as RewardAccount from "./RewardAccount.js"
import * as ScriptDataHash from "./ScriptDataHash.js"
import * as TransactionHash from "./TransactionHash.js"
import * as TransactionInput from "./TransactionInput.js"
import * as TxOut from "./TxOut.js"
import { CborReader } from "./v2/CborReader.js"
import {
  capture,
  CborWriter,
  type EncodingProfile,
  type FieldFormat,
  type FormatHint,
  getFieldFormat,
  getFormat,
} from "./v2/CborWriter.js"
import * as VotingProcedures from "./VotingProcedures.js"
import * as Withdrawals from "./Withdrawals.js"

// Helper functions for array comparison
const arrayEquals = <A>(a: ReadonlyArray<A> | undefined, b: ReadonlyArray<A> | undefined): boolean => {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Equal.equals(a[i], b[i])) return false
  }
  return true
}

// Helper function for array hashing
const arrayHash = <A>(arr: ReadonlyArray<A> | undefined): number => {
  if (arr === undefined) return 0
  let hash = Hash.number(arr.length)
  for (const item of arr) {
    hash = Hash.combine(hash)(Hash.hash(item))
  }
  return hash
}

/**
 * TransactionBody
 *
 * ```
 * transaction_body =
 *   {   0  : set<transaction_input>
 *   ,   1  : [* transaction_output]
 *   ,   2  : coin
 *   , ? 3  : slot_no
 *   , ? 4  : certificates
 *   , ? 5  : withdrawals
 *   , ? 7  : auxiliary_data_hash
 *   , ? 8  : slot_no
 *   , ? 9  : mint
 *   , ? 11 : script_data_hash
 *   , ? 13 : nonempty_set<transaction_input>
 *   , ? 14 : required_signers
 *   , ? 15 : network_id
 *   , ? 16 : transaction_output
 *   , ? 17 : coin
 *   , ? 18 : nonempty_set<transaction_input>
 *   , ? 19 : voting_procedures
 *   , ? 20 : proposal_procedures
 *   , ? 21 : coin
 *   , ? 22 : positive_coin
 *   }
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class TransactionBody extends Schema.TaggedClass<TransactionBody>()("TransactionBody", {
  inputs: Schema.Array(TransactionInput.TransactionInput), // 0
  outputs: Schema.Array(TxOut.TransactionOutput), // 1
  fee: Coin.Coin, // 2
  ttl: Schema.optional(Schema.BigInt), // 3 - slot_no
  certificates: Schema.optional(Schema.NonEmptyArray(Certificate.Certificate)), // 4
  withdrawals: Schema.optional(Withdrawals.Withdrawals), // 5
  auxiliaryDataHash: Schema.optional(AuxiliaryDataHash.AuxiliaryDataHash), // 7
  validityIntervalStart: Schema.optional(Schema.BigInt), // 8 - slot_no
  mint: Schema.optional(Mint.Mint), // 9
  scriptDataHash: Schema.optional(ScriptDataHash.ScriptDataHash), // 11
  collateralInputs: Schema.optional(Schema.NonEmptyArray(TransactionInput.TransactionInput)), // 13
  requiredSigners: Schema.optional(Schema.NonEmptyArray(KeyHash.KeyHash)), // 14
  networkId: Schema.optional(NetworkId.NetworkId), // 15
  collateralReturn: Schema.optional(TxOut.TransactionOutput), // 16
  totalCollateral: Schema.optional(Coin.Coin), // 17
  referenceInputs: Schema.optional(Schema.NonEmptyArray(TransactionInput.TransactionInput)), // 18
  votingProcedures: Schema.optional(VotingProcedures.VotingProcedures), // 19
  proposalProcedures: Schema.optional(ProposalProcedures.ProposalProcedures), // 20
  currentTreasuryValue: Schema.optional(Coin.Coin), // 21
  donation: Schema.optional(PositiveCoin.PositiveCoinSchema) // 22
}) {
  toJSON() {
    return {
      _tag: this._tag,
      inputs: this.inputs.map((i) => i.toJSON()),
      outputs: this.outputs.map((o) => o.toJSON()),
      fee: this.fee.toString(),
      ttl: this.ttl?.toString(),
      certificates: this.certificates?.map((c) => c.toJSON()),
      withdrawals: this.withdrawals?.toJSON(),
      auxiliaryDataHash: this.auxiliaryDataHash?.toJSON(),
      validityIntervalStart: this.validityIntervalStart?.toString(),
      mint: this.mint?.toJSON(),
      scriptDataHash: this.scriptDataHash?.toJSON(),
      collateralInputs: this.collateralInputs?.map((i) => i.toJSON()),
      requiredSigners: this.requiredSigners,
      networkId: this.networkId,
      collateralReturn: this.collateralReturn?.toJSON(),
      totalCollateral: this.totalCollateral?.toString(),
      referenceInputs: this.referenceInputs?.map((i) => i.toJSON()),
      votingProcedures: this.votingProcedures?.toJSON(),
      proposalProcedures: this.proposalProcedures?.toJSON(),
      currentTreasuryValue: this.currentTreasuryValue?.toString(),
      donation: this.donation?.toString()
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    if (!(that instanceof TransactionBody)) return false
    return (
      arrayEquals(this.inputs, that.inputs) &&
      arrayEquals(this.outputs, that.outputs) &&
      Equal.equals(this.fee, that.fee) &&
      this.ttl === that.ttl &&
      arrayEquals(this.certificates, that.certificates) &&
      Equal.equals(this.withdrawals, that.withdrawals) &&
      Equal.equals(this.auxiliaryDataHash, that.auxiliaryDataHash) &&
      this.validityIntervalStart === that.validityIntervalStart &&
      Equal.equals(this.mint, that.mint) &&
      Equal.equals(this.scriptDataHash, that.scriptDataHash) &&
      arrayEquals(this.collateralInputs, that.collateralInputs) &&
      arrayEquals(this.requiredSigners, that.requiredSigners) &&
      Equal.equals(this.networkId, that.networkId) &&
      Equal.equals(this.collateralReturn, that.collateralReturn) &&
      this.totalCollateral === that.totalCollateral &&
      arrayEquals(this.referenceInputs, that.referenceInputs) &&
      Equal.equals(this.votingProcedures, that.votingProcedures) &&
      Equal.equals(this.proposalProcedures, that.proposalProcedures) &&
      this.currentTreasuryValue === that.currentTreasuryValue &&
      Equal.equals(this.donation, that.donation)
    )
  }

  /**
   * Custom hash implementation for TransactionBody.
   * Only hashes frequently-changing fields for performance.
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    // Hash only the most frequently changing fields
    // inputs, outputs, and fee are the most common changes
    return Hash.cached(
      this,
      Hash.combine(Hash.combine(Hash.hash(this.fee))(arrayHash(this.inputs)))(arrayHash(this.outputs))
    )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: TransactionBody): void => {
  const hint = getFormat(v)

  // Count non-empty optional fields
  let count = 3 // inputs, outputs, fee
  if (v.ttl !== undefined) count++
  if (v.certificates && v.certificates.length > 0) count++
  if (v.withdrawals) count++
  if (v.auxiliaryDataHash) count++
  if (v.validityIntervalStart !== undefined) count++
  if (v.mint) count++
  if (v.scriptDataHash) count++
  if (v.collateralInputs && v.collateralInputs.length > 0) count++
  if (v.requiredSigners && v.requiredSigners.length > 0) count++
  if (v.networkId !== undefined) count++
  if (v.collateralReturn) count++
  if (v.totalCollateral !== undefined) count++
  if (v.referenceInputs && v.referenceInputs.length > 0) count++
  if (v.votingProcedures) count++
  if (v.proposalProcedures && v.proposalProcedures.procedures.length > 0) count++
  if (v.currentTreasuryValue !== undefined) count++
  if (v.donation !== undefined) count++

  // Write map header with format preservation
  if (hint?.indefinite) { w.writeIndefiniteMapHeader() }
  else { w.writeHeaderPreserving(5, count, hint?.headerWidth) }

  // Helper for writing key with format preservation
  const writeKey = (key: bigint) => {
    const ff = getFieldFormat(v, key)
    w.writeUintPreserving(key, ff?.byteSize)
  }

  // Use keyOrder from hint if available, else insertion order
  const keyOrder: ReadonlyArray<unknown> = hint?.keyOrder ?? [
    0n, 1n, 2n, 3n, 4n, 5n, 7n, 8n, 9n, 11n, 13n, 14n, 15n, 16n, 17n, 18n, 19n, 20n, 21n, 22n
  ]

  for (const rawKey of keyOrder) {
    const key = rawKey as bigint
    switch (key) {
      case 0n: {
        // inputs — tag 258 set
        writeKey(0n)
        w.writeTagHeader(258)
        w.writeArrayHeader(v.inputs.length)
        for (const inp of v.inputs) TransactionInput.write(w, inp)
        w.writeArrayBreak()
        break
      }
      case 1n: {
        // outputs
        writeKey(1n)
        w.writeArrayHeader(v.outputs.length)
        for (const out of v.outputs) TxOut.write(w, out)
        w.writeArrayBreak()
        break
      }
      case 2n: {
        // fee
        writeKey(2n)
        const ff = getFieldFormat(v, "fee" as unknown as bigint)
        w.writeUintPreserving(v.fee, ff?.byteSize)
        break
      }
      case 3n: {
        if (v.ttl === undefined) continue
        writeKey(3n)
        const ff = getFieldFormat(v, "ttl" as unknown as bigint)
        w.writeUintPreserving(v.ttl, ff?.byteSize)
        break
      }
      case 4n: {
        if (!v.certificates || v.certificates.length === 0) continue
        writeKey(4n)
        w.writeTagHeader(258)
        w.writeArrayHeader(v.certificates.length)
        for (const cert of v.certificates) Certificate.write(w, cert)
        w.writeArrayBreak()
        break
      }
      case 5n: {
        if (!v.withdrawals) continue
        writeKey(5n)
        Withdrawals.write(w, v.withdrawals)
        break
      }
      case 7n: {
        if (!v.auxiliaryDataHash) continue
        writeKey(7n)
        AuxiliaryDataHash.write(w, v.auxiliaryDataHash)
        break
      }
      case 8n: {
        if (v.validityIntervalStart === undefined) continue
        writeKey(8n)
        const ff = getFieldFormat(v, "validityIntervalStart" as unknown as bigint)
        w.writeUintPreserving(v.validityIntervalStart, ff?.byteSize)
        break
      }
      case 9n: {
        if (!v.mint) continue
        writeKey(9n)
        Mint.write(w, v.mint)
        break
      }
      case 11n: {
        if (!v.scriptDataHash) continue
        writeKey(11n)
        ScriptDataHash.write(w, v.scriptDataHash)
        break
      }
      case 13n: {
        if (!v.collateralInputs || v.collateralInputs.length === 0) continue
        writeKey(13n)
        w.writeTagHeader(258)
        w.writeArrayHeader(v.collateralInputs.length)
        for (const inp of v.collateralInputs) TransactionInput.write(w, inp)
        w.writeArrayBreak()
        break
      }
      case 14n: {
        if (!v.requiredSigners || v.requiredSigners.length === 0) continue
        writeKey(14n)
        w.writeTagHeader(258)
        w.writeArrayHeader(v.requiredSigners.length)
        for (const signer of v.requiredSigners) KeyHash.write(w, signer)
        w.writeArrayBreak()
        break
      }
      case 15n: {
        if (v.networkId === undefined) continue
        writeKey(15n)
        w.writeSmallUint(v.networkId)
        break
      }
      case 16n: {
        if (!v.collateralReturn) continue
        writeKey(16n)
        TxOut.write(w, v.collateralReturn)
        break
      }
      case 17n: {
        if (v.totalCollateral === undefined) continue
        writeKey(17n)
        w.writeUint(v.totalCollateral)
        break
      }
      case 18n: {
        if (!v.referenceInputs || v.referenceInputs.length === 0) continue
        writeKey(18n)
        w.writeTagHeader(258)
        w.writeArrayHeader(v.referenceInputs.length)
        for (const inp of v.referenceInputs) TransactionInput.write(w, inp)
        w.writeArrayBreak()
        break
      }
      case 19n: {
        if (!v.votingProcedures) continue
        writeKey(19n)
        VotingProcedures.write(w, v.votingProcedures)
        break
      }
      case 20n: {
        if (!v.proposalProcedures || v.proposalProcedures.procedures.length === 0) continue
        writeKey(20n)
        w.writeTagHeader(258)
        w.writeArrayHeader(v.proposalProcedures.procedures.length)
        for (const pp of v.proposalProcedures.procedures) ProposalProcedure.write(w, pp)
        w.writeArrayBreak()
        break
      }
      case 21n: {
        if (v.currentTreasuryValue === undefined) continue
        writeKey(21n)
        w.writeUint(v.currentTreasuryValue)
        break
      }
      case 22n: {
        if (v.donation === undefined) continue
        writeKey(22n)
        w.writeUint(v.donation)
        break
      }
    }
  }

  if (hint?.indefinite) w.writeBreak()
}

export const read = (r: CborReader): TransactionBody => {
  const start = r.position()
  const [mapCount, mapFmt] = r.readMapHeaderAnnotated()
  const keyOrder: Array<bigint> = []
  const fields = new Map<string | number | bigint, FieldFormat>()

  let inputs: Array<TransactionInput.TransactionInput> = []
  let outputs: Array<TxOut.TransactionOutput> = []
  let fee: Coin.Coin = 0n as Coin.Coin
  let ttl: bigint | undefined
  let certificates: NonEmptyArray<Certificate.Certificate> | undefined
  let withdrawals: Withdrawals.Withdrawals | undefined
  let auxiliaryDataHash: AuxiliaryDataHash.AuxiliaryDataHash | undefined
  let validityIntervalStart: bigint | undefined
  let mint: Mint.Mint | undefined
  let scriptDataHash: ScriptDataHash.ScriptDataHash | undefined
  let collateralInputs: NonEmptyArray<TransactionInput.TransactionInput> | undefined
  let requiredSigners: NonEmptyArray<KeyHash.KeyHash> | undefined
  let networkId: NetworkId.NetworkId | undefined
  let collateralReturn: TxOut.TransactionOutput | undefined
  let totalCollateral: Coin.Coin | undefined
  let referenceInputs: NonEmptyArray<TransactionInput.TransactionInput> | undefined
  let votingProcedures: VotingProcedures.VotingProcedures | undefined
  let proposalProcedures: ProposalProcedures.ProposalProcedures | undefined
  let currentTreasuryValue: Coin.Coin | undefined
  let donation: Coin.Coin | undefined

  const readTaggedArray = <T>(readEl: (r: CborReader) => T): Array<T> => {
    // Accept tag 258 or plain array
    if (r.peekMajorType() === 6) {
      const tag = r.readTagHeader()
      if (tag !== 258) throw new Error(`Expected tag 258, got ${tag}`)
    }
    const count = r.readArrayHeader()
    const arr: Array<T> = []
    if (count === -1) { while (!r.isBreak()) arr.push(readEl(r)) }
    else { for (let i = 0; i < count; i++) arr.push(readEl(r)) }
    return arr
  }

  const readEntry = () => {
    const [key, keyWidth] = r.readUintAnnotated()
    keyOrder.push(key)
    fields.set(key, { byteSize: keyWidth })

    switch (key) {
      case 0n: inputs = readTaggedArray(TransactionInput.read); break
      case 1n: {
        const count = r.readArrayHeader()
        outputs = []
        if (count === -1) { while (!r.isBreak()) outputs.push(TxOut.read(r)) }
        else { for (let i = 0; i < count; i++) outputs.push(TxOut.read(r)) }
        break
      }
      case 2n: { const [v, w] = r.readUintAnnotated(); fee = v as Coin.Coin; fields.set("fee" as unknown as bigint, { byteSize: w }); break }
      case 3n: { const [v, w] = r.readUintAnnotated(); ttl = v; fields.set("ttl" as unknown as bigint, { byteSize: w }); break }
      case 4n: certificates = readTaggedArray(Certificate.read) as NonEmptyArray<Certificate.Certificate>; break
      case 5n: withdrawals = Withdrawals.read(r); break
      case 7n: auxiliaryDataHash = AuxiliaryDataHash.read(r); break
      case 8n: { const [v, w] = r.readUintAnnotated(); validityIntervalStart = v; fields.set("validityIntervalStart" as unknown as bigint, { byteSize: w }); break }
      case 9n: mint = Mint.read(r); break
      case 11n: scriptDataHash = ScriptDataHash.read(r); break
      case 13n: collateralInputs = readTaggedArray(TransactionInput.read) as NonEmptyArray<TransactionInput.TransactionInput>; break
      case 14n: requiredSigners = readTaggedArray(KeyHash.read) as NonEmptyArray<KeyHash.KeyHash>; break
      case 15n: networkId = Number(r.readUint()) as NetworkId.NetworkId; break
      case 16n: collateralReturn = TxOut.read(r); break
      case 17n: totalCollateral = r.readUint() as Coin.Coin; break
      case 18n: referenceInputs = readTaggedArray(TransactionInput.read) as NonEmptyArray<TransactionInput.TransactionInput>; break
      case 19n: votingProcedures = VotingProcedures.read(r); break
      case 20n: {
        const arr = readTaggedArray(ProposalProcedure.read)
        proposalProcedures = new ProposalProcedures.ProposalProcedures({ procedures: arr })
        break
      }
      case 21n: currentTreasuryValue = r.readUint() as Coin.Coin; break
      case 22n: donation = r.readUint() as Coin.Coin; break
      default: r.skip(); break
    }
  }

  if (mapCount === -1) { while (!r.isBreak()) readEntry() }
  else { for (let i = 0; i < mapCount; i++) readEntry() }

  const body = new TransactionBody({
    inputs, outputs, fee, ttl, certificates, withdrawals,
    auxiliaryDataHash, validityIntervalStart, mint, scriptDataHash,
    collateralInputs, requiredSigners, networkId, collateralReturn,
    totalCollateral, referenceInputs, votingProcedures, proposalProcedures,
    currentTreasuryValue, donation
  })

  // Capture raw bytes + format hint for hash-preserving re-encoding
  const rawBytes = r.buffer().subarray(start, r.position())
  const hint: FormatHint = {
    indefinite: mapFmt.indefinite,
    headerWidth: mapFmt.headerWidth,
    keyOrder,
    fields
  }
  capture(body, rawBytes, hint)

  return body
}

// Pre-bind hot ParseResult helpers (sync)



/**
 * CBOR bytes transformation schema for TransactionBody.
 * Transforms between CBOR bytes and TransactionBody using Conway CDDL specification.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(TransactionBody),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "TransactionBody.FromCBORBytes" })

/**
 * CBOR hex transformation schema for TransactionBody.
 * Transforms between CBOR hex string and TransactionBody using Conway CDDL specification.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "TransactionBody.FromCBORHex" })

export const isTransactionBody = Schema.is(TransactionBody)

/**
 * Convert CBOR bytes to TransactionBody.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Convert CBOR hex string to TransactionBody.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Convert TransactionBody to CBOR bytes.
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORBytes = (data: TransactionBody, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(512, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Convert TransactionBody to CBOR hex string.
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORHex = (data: TransactionBody, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))

/**
 * Parse a TransactionBody from CBOR bytes and return the root format tree.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORBytesWithFormat = (
  bytes: Uint8Array
): CBOR.DecodedWithFormat<TransactionBody> => {
  const decoded = CBOR.fromCBORBytesWithFormat(bytes)
  const value = read(new CborReader(bytes))
  return { value, format: decoded.format }
}

/**
 * Parse a TransactionBody from CBOR hex string and return the root format tree.
 *
 * @since 2.0.0
 * @category conversion
 */
export const fromCBORHexWithFormat = (
  hex: string
): CBOR.DecodedWithFormat<TransactionBody> => {
  const bytes = Bytes.fromHex(hex)
  const decoded = CBOR.fromCBORBytesWithFormat(bytes)
  const value = read(new CborReader(bytes))
  return { value, format: decoded.format }
}

/**
 * Convert a TransactionBody to CBOR bytes using an explicit root format tree.
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORBytesWithFormat = (
  data: TransactionBody,
  format: CBOR.CBORFormat
): Uint8Array => {
  const plain = toCBORBytes(data)
  return CBOR.toCBORBytesWithFormat(CBOR.fromCBORBytes(plain) as unknown as CBOR.CBOR, format)
}

/**
 * Convert a TransactionBody to CBOR hex string using an explicit root format tree.
 *
 * @since 2.0.0
 * @category conversion
 */
export const toCBORHexWithFormat = (
  data: TransactionBody,
  format: CBOR.CBORFormat
): string => {
  return Bytes.toHex(toCBORBytesWithFormat(data, format))
}

// ============================================================================
// FastCheck Arbitrary
// ============================================================================

/**
 * FastCheck arbitrary for generating random TransactionBody instances.
 * Used for property-based testing to generate valid test data.
 *
 * Generates basic TransactionBody instances with required fields (inputs, outputs, fee)
 * and optionally includes some other common fields.
 *
 * @since 2.0.0
 * @category arbitrary
 */
/**
 * Compute the transaction body hash (blake2b-256 over CBOR of body).
 *
 * @since 2.0.0
 * @category hashing
 */
export const toHash = (body: TransactionBody): TransactionHash.TransactionHash => {
  const bytes = toCBORBytes(body)
  const digest = blake2b(bytes, { dkLen: 32 })
  return new TransactionHash.TransactionHash({ hash: digest })
}

/**
 * Compute the transaction body hash from raw CBOR bytes, preserving original encoding.
 *
 * @since 2.0.0
 * @category hashing
 */
export const toHashFromBytes = (bodyBytes: Uint8Array): TransactionHash.TransactionHash => {
  const digest = blake2b(bodyBytes, { dkLen: 32 })
  return new TransactionHash.TransactionHash({ hash: digest })
}

export const arbitrary: FastCheck.Arbitrary<TransactionBody> =
  // First, generate core fields
  FastCheck.record({
    inputs: FastCheck.uniqueArray(TransactionInput.arbitrary, {
      minLength: 1,
      maxLength: 5,
      selector: (i) => `${Bytes.toHex(i.transactionId.hash)}:${i.index.toString()}`
    }),
    outputs: FastCheck.array(TxOut.arbitrary, { minLength: 1, maxLength: 5 }),
    fee: Coin.arbitrary,
    networkId: FastCheck.option(FastCheck.integer({ min: 0, max: 1 }), { nil: undefined }),
    // Optional extra (added first for iterative hardening)
    auxiliaryDataHash: FastCheck.option(AuxiliaryDataHash.arbitrary, { nil: undefined }),
    // Second optional extra: donation (positive_coin)
    donation: FastCheck.option(PositiveCoin.arbitrary, { nil: undefined }),
    // Third optional extra: script_data_hash
    scriptDataHash: FastCheck.option(ScriptDataHash.arbitrary, { nil: undefined }),
    // Fourth optional extra: mint
    mint: FastCheck.option(Mint.arbitrary, { nil: undefined }),
    // Fifth optional extra: current_treasury_value (coin)
    currentTreasuryValue: FastCheck.option(Coin.arbitrary, { nil: undefined }),
    // Sixth optional extra: required_signers (nonempty unique KeyHash[])
    requiredSigners: FastCheck.option(
      FastCheck.uniqueArray(KeyHash.arbitrary, {
        minLength: 1,
        maxLength: 5,
        selector: (k) => Bytes.toHex(k.hash)
      }),
      { nil: undefined }
    ),
    // Seventh optional extra: withdrawals
    withdrawals: FastCheck.option(Withdrawals.arbitrary, { nil: undefined }),
    // Eighth optional extra: certificates
    certificates: FastCheck.option(FastCheck.array(Certificate.arbitrary, { minLength: 1, maxLength: 5 }), {
      nil: undefined
    }),
    // Ninth optional extra: collateral_inputs (nonempty unique set)
    collateralInputs: FastCheck.option(
      FastCheck.uniqueArray(TransactionInput.arbitrary, {
        minLength: 1,
        maxLength: 3,
        selector: (i) => `${Bytes.toHex(i.transactionId.hash)}:${i.index.toString()}`
      }),
      { nil: undefined }
    ),
    // Tenth optional extra: reference_inputs (nonempty unique set)
    referenceInputs: FastCheck.option(
      FastCheck.uniqueArray(TransactionInput.arbitrary, {
        minLength: 1,
        maxLength: 3,
        selector: (i) => `${Bytes.toHex(i.transactionId.hash)}:${i.index.toString()}`
      }),
      { nil: undefined }
    ),
    // Eleventh optional extra: collateral_return (transaction_output)
    collateralReturn: FastCheck.option(TxOut.arbitrary, { nil: undefined }),
    // Twelfth optional extra: total_collateral (coin)
    totalCollateral: FastCheck.option(Coin.arbitrary, { nil: undefined }),
    // Thirteenth optional extra: voting_procedures
    votingProcedures: FastCheck.option(VotingProcedures.arbitrary, { nil: undefined }),
    // Fourteenth optional extra: proposal_procedures (nonempty set) with non-null anchors per CML parity
    proposalProcedures: FastCheck.option(
      FastCheck.record({
        procedures: FastCheck.array(
          FastCheck.record({
            deposit: Coin.arbitrary,
            rewardAccount: RewardAccount.arbitrary,
            governanceAction: GovernanceAction.arbitrary,
            anchor: Anchor.arbitrary
          }).map((params) => new ProposalProcedure.ProposalProcedure(params)),
          { minLength: 1, maxLength: 3 }
        )
      }).map((params) => new ProposalProcedures.ProposalProcedures(params)),
      { nil: undefined }
    )
  })
    // Then, stitch in ttl/vis with the invariant ttl ≥ vis when both present
    .chain((base) => {
      const visArb = FastCheck.bigInt({ min: 0n, max: 10_000_000n })
      const ttlArb = FastCheck.bigInt({ min: 0n, max: 10_000_000n })

      const both = FastCheck.tuple(visArb, ttlArb).map(([vis, ttl]) => {
        // Ensure ttl >= vis
        return ttl < vis ? { ttl: vis, validityIntervalStart: ttl } : { ttl, validityIntervalStart: vis }
      })

      const onlyVis = visArb.map((vis) => ({ ttl: undefined as bigint | undefined, validityIntervalStart: vis }))
      const onlyTtl = ttlArb.map((ttl) => ({ ttl, validityIntervalStart: undefined as bigint | undefined }))
      const none = FastCheck.constant({
        ttl: undefined as bigint | undefined,
        validityIntervalStart: undefined as bigint | undefined
      })

      return FastCheck.oneof({ arbitrary: both, weight: 2 }, onlyVis, onlyTtl, none).map(
        ({ ttl, validityIntervalStart }) => ({
          ...base,
          ttl,
          validityIntervalStart
        })
      )
    })
    .map((props) => {
      return new TransactionBody({
        inputs: props.inputs,
        outputs: props.outputs,
        fee: props.fee,
        ttl: props.ttl,
        certificates: props.certificates as NonEmptyArray<Certificate.Certificate> | undefined,
        withdrawals: props.withdrawals,
        auxiliaryDataHash: props.auxiliaryDataHash,
        validityIntervalStart: props.validityIntervalStart,
        mint: props.mint,
        scriptDataHash: props.scriptDataHash,
        collateralInputs: props.collateralInputs as NonEmptyArray<TransactionInput.TransactionInput> | undefined,
        requiredSigners: props.requiredSigners as NonEmptyArray<KeyHash.KeyHash> | undefined,
        networkId: props.networkId as NetworkId.NetworkId | undefined,
        collateralReturn: props.collateralReturn,
        totalCollateral: props.totalCollateral,
        referenceInputs: props.referenceInputs as NonEmptyArray<TransactionInput.TransactionInput> | undefined,
        votingProcedures: props.votingProcedures,
        proposalProcedures: props.proposalProcedures,
        currentTreasuryValue: props.currentTreasuryValue,
        donation: props.donation
      })
    })
