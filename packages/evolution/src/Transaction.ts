import { Effect as Eff, Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as AuxiliaryData from "./AuxiliaryData.js"
import * as CBOR from "./CBOR.js"
import * as TransactionBody from "./TransactionBody.js"
import * as TransactionWitnessSet from "./TransactionWitnessSet.js"

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

/**
 * Conway CDDL schema for Transaction tuple structure.
 *
 * CDDL: transaction = [transaction_body, transaction_witness_set, bool, auxiliary_data / nil]
 */
export const CDDLSchema = Schema.Tuple(
  TransactionBody.CDDLSchema.annotations({ identifier: "TransactionBodyCDDL", description: "Transaction body" }),
  TransactionWitnessSet.CDDLSchema.annotations({
    identifier: "TransactionWitnessSetCDDL",
    description: "Transaction witness set"
  }),
  Schema.Boolean,
  // Auxiliary data is a CBOR value; CBOR schema already includes null in its domain
  CBOR.CBORSchema.annotations({ identifier: "AuxiliaryDataCDDL", description: "Auxiliary data as raw CBOR" })
).annotations({ identifier: "TransactionCDDL", description: "Transaction tuple structure" })

/**
 * Transform between CDDL tuple and Transaction class.
 */
export const FromCDDL = Schema.transformOrFail(CDDLSchema, Schema.typeSchema(Transaction), {
  strict: true,
  encode: (tx) =>
    Eff.gen(function* () {
      const bodyReadonly = yield* ParseResult.encode(TransactionBody.FromCDDL)(tx.body)
      const witnessReadonly = yield* ParseResult.encode(TransactionWitnessSet.FromCDDL)(tx.witnessSet)
      // Ensure mutable Map instances for tuple A-type compatibility
      const body = new Map<bigint, CBOR.CBOR>(bodyReadonly.entries())
      const witnessSet = new Map<bigint, CBOR.CBOR>(witnessReadonly.entries())
      const isValid = tx.isValid
      const auxiliaryData =
        tx.auxiliaryData === null ? null : yield* ParseResult.encode(AuxiliaryData.FromCDDL)(tx.auxiliaryData)
      return [body, witnessSet, isValid, auxiliaryData] as const
    }),
  decode: (tuple) =>
    Eff.gen(function* () {
      const [bodyCDDL, witnessSetCDDL, isValid, aux] = tuple
      const body = yield* ParseResult.decode(TransactionBody.FromCDDL)(bodyCDDL)
      const witnessSet = yield* ParseResult.decode(TransactionWitnessSet.FromCDDL)(witnessSetCDDL)
      const auxiliaryData = aux === null ? null : yield* ParseResult.decodeUnknownEither(AuxiliaryData.FromCDDL)(aux)
      return new Transaction({ body, witnessSet, isValid, auxiliaryData }, { disableValidation: true })
    })
})

/**
 * CBOR bytes transformation schema for Transaction.
 */
export const FromCBORBytes = (options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.compose(CBOR.FromBytes(options), FromCDDL).annotations({
    identifier: "Transaction.FromCBORBytes",
    description: "Decode Transaction from CBOR bytes per Conway CDDL"
  })

/**
 * CBOR hex transformation schema for Transaction.
 */
export const FromCBORHex = (options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.compose(CBOR.FromHex(options), FromCDDL).annotations({
    identifier: "Transaction.FromCBORHex",
    description: "Decode Transaction from CBOR hex per Conway CDDL"
  })

// ============================================================================
// Parsing / Encoding Functions
// ============================================================================

export const fromCBORBytes = (bytes: Uint8Array, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.decodeSync(FromCBORBytes(options))(bytes)

export const fromCBORHex = (hex: string, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.decodeSync(FromCBORHex(options))(hex)

export const toCBORBytes = (data: Transaction, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.encodeSync(FromCBORBytes(options))(data)

export const toCBORHex = (data: Transaction, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS) =>
  Schema.encodeSync(FromCBORHex(options))(data)

// ============================================================================
// Byte-level witness merging (CML-like approach)
//
// These functions operate directly on raw CBOR bytes. The full transaction is
// never decoded/re-encoded — only the vkey witnesses entry in the witness set
// map is spliced. Body, redeemers, datums, scripts, isValid, auxData, and
// even the map entry ordering are preserved byte-for-byte.
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

/** Read a definite-length count from a CBOR header. */
const readMapCount = (data: Uint8Array, offset: number): { count: number; hdrSize: number } => {
  const additionalInfo = data[offset] & 0x1f
  if (additionalInfo < 24) return { count: additionalInfo, hdrSize: 1 }
  if (additionalInfo === CBOR.CBOR_ADDITIONAL_INFO.DIRECT) return { count: data[offset + 1], hdrSize: 2 }
  if (additionalInfo === CBOR.CBOR_ADDITIONAL_INFO.UINT16)
    return { count: (data[offset + 1] << 8) | data[offset + 2], hdrSize: 3 }
  throw new CBOR.CBORError({ message: `Unsupported map count encoding: ${additionalInfo}` })
}

/** Encode a CBOR map header with a given entry count. */
const encodeMapHeader = (count: number): Uint8Array => {
  if (count < 24) return new Uint8Array([(0x05 << 5) | count])
  if (count < 256) return new Uint8Array([(0x05 << 5) | CBOR.CBOR_ADDITIONAL_INFO.DIRECT, count])
  return new Uint8Array([(0x05 << 5) | CBOR.CBOR_ADDITIONAL_INFO.UINT16, (count >> 8) & 0xff, count & 0xff])
}

/** Unwrap tag(258, [...]) or plain [...] to get the inner array. */
const unwrapVkeyArray = (val: CBOR.CBOR | undefined): Array<CBOR.CBOR> => {
  if (val === undefined) return []
  if (CBOR.isTag(val)) {
    const tag = val as { _tag: "Tag"; tag: number; value: unknown }
    if (tag.tag === 258 && Array.isArray(tag.value)) return tag.value as Array<CBOR.CBOR>
    return []
  }
  if (Array.isArray(val)) return val as Array<CBOR.CBOR>
  return []
}

/**
 * Merge wallet vkey witnesses into a transaction at the raw CBOR byte level.
 *
 * Works like CML: the entire transaction byte stream is preserved except for
 * the vkey witnesses value in the witness set map. Body, redeemers, datums,
 * scripts, isValid, auxiliaryData, and map entry ordering stay byte-for-byte
 * identical — preserving both the txId and scriptDataHash.
 *
 * @since 2.0.0
 * @category encoding
 */
export const addVKeyWitnessesBytes = (
  txBytes: Uint8Array,
  walletWitnessSetBytes: Uint8Array,
  options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS
): Uint8Array => {
  // --- Extract wallet vkey pairs (the only thing we decode) ---
  const walletWsDecoded = CBOR.fromCBORBytes(walletWitnessSetBytes)
  if (!(walletWsDecoded instanceof Map)) {
    throw new CBOR.CBORError({ message: "Wallet witness set must be a CBOR map" })
  }
  const walletPairs = unwrapVkeyArray(walletWsDecoded.get(0n))
  if (walletPairs.length === 0) return txBytes

  // --- Locate witness set in the raw transaction bytes ---
  //     transaction = [body, witness_set, is_valid, auxiliary_data]
  const arrHdr = cborHeaderSize(txBytes, 0)
  const { newOffset: bodyEnd } = CBOR.decodeItemWithOffset(txBytes, arrHdr, options)
  const wsStart = bodyEnd
  const { newOffset: wsEnd } = CBOR.decodeItemWithOffset(txBytes, wsStart, options)

  // --- Scan witness set map entries to find key 0 (vkeywitnesses) ---
  const { count: wsMapCount, hdrSize: wsHdrSize } = readMapCount(txBytes, wsStart)
  let offset = wsStart + wsHdrSize
  let key0ValueStart = -1
  let key0ValueEnd = -1
  let existingPairs: Array<CBOR.CBOR> = []

  for (let i = 0; i < wsMapCount; i++) {
    const { item: keyItem, newOffset: keyEnd } = CBOR.decodeItemWithOffset(txBytes, offset, options)
    const valStart = keyEnd
    const { item: valItem, newOffset: valEnd } = CBOR.decodeItemWithOffset(txBytes, valStart, options)

    if (keyItem === 0n) {
      key0ValueStart = valStart
      key0ValueEnd = valEnd
      existingPairs = unwrapVkeyArray(valItem)
    }
    offset = valEnd
  }

  // --- Encode merged vkeys: tag(258, [...existing, ...wallet]) ---
  const mergedPairs = [...existingPairs, ...walletPairs]
  const mergedBytes = CBOR.internalEncodeSync(CBOR.Tag.make({ tag: 258, value: mergedPairs }), options)

  if (key0ValueStart !== -1) {
    // Key 0 exists → splice new value in-place (header, key order, everything else untouched)
    const before = txBytes.slice(0, key0ValueStart)
    const after = txBytes.slice(key0ValueEnd)
    const result = new Uint8Array(before.length + mergedBytes.length + after.length)
    result.set(before, 0)
    result.set(mergedBytes, before.length)
    result.set(after, before.length + mergedBytes.length)
    return result
  } else {
    // Key 0 absent → append new entry, bump map count in header
    const newKeyBytes = CBOR.internalEncodeSync(0n, options)
    const newMapHeader = encodeMapHeader(wsMapCount + 1)

    const txBefore = txBytes.slice(0, wsStart) // [array hdr + body]
    const wsEntries = txBytes.slice(wsStart + wsHdrSize, wsEnd) // existing map entries (raw)
    const txAfter = txBytes.slice(wsEnd) // [isValid + aux]

    const result = new Uint8Array(
      txBefore.length +
        newMapHeader.length +
        wsEntries.length +
        newKeyBytes.length +
        mergedBytes.length +
        txAfter.length
    )
    let pos = 0
    result.set(txBefore, pos)
    pos += txBefore.length
    result.set(newMapHeader, pos)
    pos += newMapHeader.length
    result.set(wsEntries, pos)
    pos += wsEntries.length
    result.set(newKeyBytes, pos)
    pos += newKeyBytes.length
    result.set(mergedBytes, pos)
    pos += mergedBytes.length
    result.set(txAfter, pos)
    return result
  }
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
// Arbitrary (FastCheck)
// ============================================================================

export const arbitrary: FastCheck.Arbitrary<Transaction> = FastCheck.record({
  body: TransactionBody.arbitrary,
  witnessSet: TransactionWitnessSet.arbitrary,
  isValid: FastCheck.boolean(),
  auxiliaryData: FastCheck.option(AuxiliaryData.arbitrary, { nil: null }).map((a) => (a === undefined ? null : a))
}).map((r) => new Transaction(r))
