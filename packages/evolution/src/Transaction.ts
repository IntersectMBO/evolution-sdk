import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as AuxiliaryData from "./AuxiliaryData.js"
import * as Bytes from "./Bytes.js"
import * as CBOR from "./CBOR.js"
import * as TransactionBody from "./TransactionBody.js"
import * as TransactionWitnessSet from "./TransactionWitnessSet.js"
import { CborReader } from "./v2/CborReader.js"
import { capture, CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Transaction based on Conway CDDL specification
 *
 * CDDL: transaction =
 *   [transaction_body, transaction_witness_set, bool, auxiliary_data / nil]
 *
 * @since 2.0.0
 * @category model
 */
export class Transaction extends Schema.TaggedClass<Transaction>()("Transaction", {
  body: TransactionBody.TransactionBody,
  witnessSet: TransactionWitnessSet.TransactionWitnessSet,
  isValid: Schema.Boolean,
  auxiliaryData: Schema.NullOr(AuxiliaryData.AuxiliaryData)
}) {
  toJSON() {
    return {
      _tag: this._tag,
      body: this.body.toJSON(),
      witnessSet: this.witnessSet.toJSON(),
      isValid: this.isValid,
      auxiliaryData: this.auxiliaryData?.toJSON() ?? null
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof Transaction &&
      Equal.equals(this.body, that.body) &&
      Equal.equals(this.witnessSet, that.witnessSet) &&
      this.isValid === that.isValid &&
      Equal.equals(this.auxiliaryData, that.auxiliaryData)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(
        Hash.combine(Hash.combine(Hash.hash(this.body))(Hash.hash(this.witnessSet)))(Hash.hash(this.isValid))
      )(Hash.hash(this.auxiliaryData))
    )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Transaction): void => {
  w.writeArrayHeader(4)
  // Body: use raw bytes if preserved (critical for hash stability)
  w.writePreserved(v.body, () => TransactionBody.write(w, v.body))
  TransactionWitnessSet.write(w, v.witnessSet)
  w.writeBool(v.isValid)
  if (v.auxiliaryData === null) w.writeNull()
  else AuxiliaryData.write(w, v.auxiliaryData)
  w.writeArrayBreak()
}

export const read = (r: CborReader): Transaction => {
  const start = r.position()
  const count = r.readArrayHeader()
  const body = TransactionBody.read(r)
  const witnessSet = TransactionWitnessSet.read(r)
  const isValid = r.readBool()
  let auxiliaryData: AuxiliaryData.AuxiliaryData | null = null
  if (r.peekMajorType() === 7) { r.readNull() }
  else { auxiliaryData = AuxiliaryData.read(r) }
  if (count === -1) r.isBreak()

  const tx = new Transaction({ body, witnessSet, isValid, auxiliaryData })
  // Capture raw bytes for the full transaction
  capture(tx, r.buffer().subarray(start, r.position()))
  return tx
}

/**
 * CBOR bytes transformation schema for Transaction.
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(Transaction),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "Transaction.FromCBORBytes" })

/**
 * CBOR hex transformation schema for Transaction.
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "Transaction.FromCBORHex" })

// ============================================================================
// Parsing / Encoding Functions
// ============================================================================

/**
 * Internal cache that associates a Transaction with the CBORFormat tree
 * captured when it was decoded. This lets the default `toCBORHex` /
 * `toCBORBytes` path automatically preserve the original CBOR encoding
 * (indefinite-length arrays, map key ordering, etc.) without requiring
 * callers to use the explicit WithFormat API.
 *
 * WeakMap ensures the format is garbage-collected with the Transaction.
 */
const formatCache = new WeakMap<Transaction, CBOR.CBORFormat>()

export const fromCBORBytes = (bytes: Uint8Array): Transaction => {
  const value = read(new CborReader(bytes))
  // Attempt format capture for round-trip preservation (non-fatal if CBOR parser rejects)
  try {
    const decoded = CBOR.fromCBORBytesWithFormat(bytes)
    formatCache.set(value, decoded.format)
  } catch { /* format preservation is best-effort */ }
  return value
}

export const fromCBORHex = (hex: string): Transaction => {
  const bytes = Bytes.fromHex(hex)
  return fromCBORBytes(bytes)
}

/**
 * Parse a Transaction from CBOR bytes and return the root format tree.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytesWithFormat = (
  bytes: Uint8Array
): CBOR.DecodedWithFormat<Transaction> => {
  const decoded = CBOR.fromCBORBytesWithFormat(bytes)
  const value = read(new CborReader(bytes))
  return { value, format: decoded.format }
}

/**
 * Parse a Transaction from CBOR hex string and return the root format tree.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHexWithFormat = (
  hex: string
): CBOR.DecodedWithFormat<Transaction> => {
  return fromCBORBytesWithFormat(Bytes.fromHex(hex))
}

const toCBORBytesPlain = (data: Transaction, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(1024, profile)
  write(w, data)
  return w.finishView()
}

export const toCBORBytes = (data: Transaction, profile?: EncodingProfile): Uint8Array => {
  const cached = formatCache.get(data)
  if (cached) return toCBORBytesWithFormat(data, cached)
  return toCBORBytesPlain(data, profile)
}

export const toCBORHex = (data: Transaction, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))

/**
 * Convert a Transaction to CBOR bytes using an explicit root format tree.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytesWithFormat = (
  data: Transaction,
  format: CBOR.CBORFormat,
  profile?: EncodingProfile
): Uint8Array => {
  const plain = toCBORBytesPlain(data, profile)
  return CBOR.toCBORBytesWithFormat(CBOR.fromCBORBytes(plain) as unknown as CBOR.CBOR, format)
}

/**
 * Convert a Transaction to CBOR hex string using an explicit root format tree.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHexWithFormat = (
  data: Transaction,
  format: CBOR.CBORFormat,
  profile?: EncodingProfile
): string => {
  return Bytes.toHex(toCBORBytesWithFormat(data, format, profile))
}

// ============================================================================
// Witness merging via WithFormat round-trip
//
// Decode the full transaction with format preservation, merge witnesses at
// the domain level, then re-encode using the captured format tree. The format
// tree ensures body, redeemers, scripts, and all other entries maintain their
// original encoding — preserving txId and scriptDataHash.
//
// Reconciliation handles structural changes gracefully:
// - New map entries (key 0 absent → added) get default encoding
// - Extended arrays (more witnesses) encode extra children minimally
// - Surviving entries replay their captured format exactly
// ============================================================================

/**
 * Merge wallet vkey witnesses into a transaction, preserving CBOR encoding.
 *
 * Uses the WithFormat round-trip: decode with format capture, mutate at the
 * domain level, re-encode with the original format tree. Body encoding,
 * redeemer bytes, map key ordering, and all non-witness data are preserved
 * through the format tree reconciliation.
 *
 * `options` applies only to parsing the wallet witness set bytes. Transaction
 * decoding and re-encoding are governed by the captured format tree, making
 * codec options irrelevant for the transaction round-trip path.
 *
 * @since 2.0.0
 * @category encoding
 */
export const addVKeyWitnessesBytes = (
  txBytes: Uint8Array,
  walletWitnessSetBytes: Uint8Array,
  _options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS
): Uint8Array => {
  // Decode wallet witness set to extract vkey witnesses
  const walletWs = TransactionWitnessSet.fromCBORBytes(walletWitnessSetBytes)
  const walletVkeys = walletWs.vkeyWitnesses ?? []
  if (walletVkeys.length === 0) return txBytes

  // Decode transaction with full format preservation
  const { format, value: tx } = fromCBORBytesWithFormat(txBytes)

  // Add witnesses at the domain level
  const merged = addVKeyWitnesses(tx, walletVkeys)

  // Re-encode using the captured format tree — reconciliation handles
  // the added/extended witness entries while preserving everything else
  return toCBORBytesWithFormat(merged, format)
}

/**
 * Hex variant of `addVKeyWitnessesBytes`.
 *
 * @since 2.0.0
 * @category encoding
 */
export const addVKeyWitnessesHex = (
  txHex: string,
  walletWitnessSetHex: string,
  options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS
): string => {
  const txBytes = Schema.decodeSync(Schema.Uint8ArrayFromHex)(txHex)
  const wsBytes = Schema.decodeSync(Schema.Uint8ArrayFromHex)(walletWitnessSetHex)
  const result = addVKeyWitnessesBytes(txBytes, wsBytes, options)
  return Schema.encodeSync(Schema.Uint8ArrayFromHex)(result)
}

// ============================================================================
// Raw body bytes extraction
// ============================================================================

/** Skip a CBOR item header and return its byte width. */
const cborHeaderSize = (data: Uint8Array, offset: number): number => {
  const additionalInfo = data[offset] & 0x1f
  if (additionalInfo < 24) return 1
  if (additionalInfo === CBOR.CBOR_ADDITIONAL_INFO.DIRECT) return 2
  if (additionalInfo === CBOR.CBOR_ADDITIONAL_INFO.UINT16) return 3
  if (additionalInfo === CBOR.CBOR_ADDITIONAL_INFO.UINT32) return 5
  if (additionalInfo === CBOR.CBOR_ADDITIONAL_INFO.UINT64) return 9
  if (additionalInfo === CBOR.CBOR_ADDITIONAL_INFO.INDEFINITE) return 1
  throw new CBOR.CBORError({ message: `Unsupported additional info: ${additionalInfo}` })
}

/**
 * Extract the original body bytes from a raw transaction CBOR byte array.
 * A Cardano transaction is a 4-element CBOR array: `[body, witnessSet, isValid, auxiliaryData]`.
 * This returns the raw body bytes without decoding/re-encoding, preserving the exact CBOR encoding.
 *
 * @since 2.0.0
 * @category encoding
 */
export const extractBodyBytes = (txBytes: Uint8Array): Uint8Array => {
  const arrHdr = cborHeaderSize(txBytes, 0)
  const { newOffset: bodyEnd } = CBOR.decodeItemWithOffset(txBytes, arrHdr)
  return txBytes.subarray(arrHdr, bodyEnd)
}

// ============================================================================
// Domain-level witness addition
// ============================================================================

/**
 * Add VKey witnesses to a transaction at the domain level.
 *
 * This creates a new Transaction with the additional witnesses merged in.
 * All encoding metadata (body bytes, redeemers format, witness map structure)
 * is preserved so that txId and scriptDataHash remain stable.
 *
 * @since 2.0.0
 * @category encoding
 */
export const addVKeyWitnesses = (
  tx: Transaction,
  witnesses: ReadonlyArray<TransactionWitnessSet.VKeyWitness>
): Transaction => {
  if (witnesses.length === 0) return tx
  const oldWs = tx.witnessSet
  const newWs = new TransactionWitnessSet.TransactionWitnessSet({
    ...oldWs,
    vkeyWitnesses: [...(oldWs.vkeyWitnesses ?? []), ...witnesses]
  })
  const result = new Transaction({
    body: tx.body,
    witnessSet: newWs,
    isValid: tx.isValid,
    auxiliaryData: tx.auxiliaryData
  })
  // Transfer cached format so toCBORHex/toCBORBytes preserves encoding
  const fmt = formatCache.get(tx)
  if (fmt) formatCache.set(result, fmt)
  return result
}

// ============================================================================
// Arbitrary (FastCheck)
// ============================================================================

export const arbitrary: FastCheck.Arbitrary<Transaction> = FastCheck.record({
  body: TransactionBody.arbitrary,
  witnessSet: TransactionWitnessSet.arbitrary,
  isValid: FastCheck.boolean(),
  auxiliaryData: FastCheck.option(AuxiliaryData.arbitrary, { nil: null }).map((a) => (a === undefined ? null : a))
}).map((r) => new Transaction(r))
