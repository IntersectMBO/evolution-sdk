import { Effect as Eff, Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as AuxiliaryData from "./AuxiliaryData.js"
import * as Bytes from "./Bytes.js"
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
export const CDDLSchema = Schema.declare(
  (input: unknown): input is readonly [Map<bigint, CBOR.CBOR>, Map<bigint, CBOR.CBOR>, boolean, CBOR.CBOR | null] =>
    Array.isArray(input)
).annotations({ identifier: "Transaction.CDDLSchema", description: "Transaction tuple structure" })

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
      const result = [body, witnessSet, isValid, auxiliaryData] as const
      return result
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

// An array of encoded items, definite or indefinite as `options` writes an array
const encodeArray = (items: ReadonlyArray<Uint8Array>, options: CBOR.CodecOptions): Uint8Array =>
  options.mode === "custom" && options.useIndefiniteArrays && items.length > 0
    ? CBOR.encodeArrayAsIndefinite(items)
    : CBOR.encodeArrayAsDefinite(items)

/**
 * CBOR bytes transformation schema for Transaction. The body and the witness
 * set are written as `TransactionBody.FromCBORBytes(options)` and
 * `TransactionWitnessSet.FromCBORBytes(options)` write them, the rest with
 * the `ledger` options. Plain options are read as `CBOR.toTxCodecOptions`
 * reads them.
 */
export const FromCBORBytes = (options: CBOR.TxCodecOptions | CBOR.CodecOptions = CBOR.TX_DEFAULT_OPTIONS) => {
  const txOptions = CBOR.toTxCodecOptions(options)
  const { ledger } = txOptions
  return Schema.transformOrFail(Schema.Uint8ArrayFromSelf, Schema.typeSchema(Transaction), {
    strict: true,
    decode: (bytes, parseOptions) =>
      ParseResult.decode(Schema.compose(CBOR.FromBytes(ledger), FromCDDL))(bytes, parseOptions),
    encode: (tx, parseOptions, ast) =>
      Eff.flatMap(ParseResult.encode(FromCDDL)(tx, parseOptions), (tuple) =>
        ParseResult.try({
          // The tuple is joined from its encoded items rather than encoded as a whole, because
          // two of the four have to be written by the module that owns them: the witness set
          // writes its Plutus data with its own options, and the BODY replays the bytes it was
          // decoded from.
          //
          // ⚠️ The body is why this is not cosmetic. Encoding the body's CBOR map structurally
          // reinstates the `#6.258` input-set tag on a body that arrived with a bare array —
          // three bytes, a different transaction id, under a signature covering the other one.
          // `TransactionBody.toCBORBytes` consults the arrival record; `CBOR.toCBORBytes` on the
          // already-decoded map cannot.
          try: () =>
            encodeArray(
              tuple.map((item, i) => {
                if (i === 0) return TransactionBody.toCBORBytes(tx.body, txOptions)
                if (i === 1) return TransactionWitnessSet.toCBORBytes(tx.witnessSet, txOptions)
                return CBOR.toCBORBytes(item, ledger)
              }),
              ledger
            ),
          catch: (error) =>
            new ParseResult.Type(
              ast,
              tx,
              `Failed to encode CBOR value: ${error instanceof Error ? error.message : String(error)}`
            )
        })
      )
  }).annotations({
    identifier: "Transaction.FromCBORBytes",
    description: "Decode Transaction from CBOR bytes per Conway CDDL"
  })
}

/**
 * CBOR hex transformation schema for Transaction, as in {@link FromCBORBytes}.
 */
export const FromCBORHex = (options: CBOR.TxCodecOptions | CBOR.CodecOptions = CBOR.TX_DEFAULT_OPTIONS) =>
  Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes(options)).annotations({
    identifier: "Transaction.FromCBORHex",
    description: "Decode Transaction from CBOR hex per Conway CDDL"
  })

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

/**
 * The codec options a transaction is MEANT to be serialized with.
 *
 * ⚠️ Set by the builder when `BuildOptions.codecOptions` asks for an encoding other than the CML
 * defaults, and consulted by the default `toCBORBytes` / `toCBORHex` path. Without it, a
 * transaction built for canonical encoding would still be serialized with the CML defaults by
 * every caller that does not pass options — including all four providers on submit, which call
 * `toCBORBytes(tx)` — and the `script_data_hash` and `auxiliary_data_hash` computed during the
 * build would be hashes over bytes nobody ever sends. The node rejects that.
 *
 * WeakMap, so it is collected with the Transaction.
 *
 * @since 2.2.0
 */
const intendedOptionsCache = new WeakMap<Transaction, CBOR.CodecOptions>()

/**
 * Record the options this transaction is meant to be serialized with.
 *
 * Intended for builders: a transaction whose hashes were computed under non-default options must
 * be encoded under those same options wherever it goes next.
 *
 * @since 2.2.0
 * @category encoding
 */
export const setIntendedCodecOptions = (data: Transaction, options: CBOR.CodecOptions): void => {
  intendedOptionsCache.set(data, options)
}

/**
 * The options this transaction is meant to be serialized with, if any were recorded.
 *
 * @since 2.2.0
 * @category encoding
 */
export const getIntendedCodecOptions = (data: Transaction): CBOR.CodecOptions | undefined =>
  intendedOptionsCache.get(data)

/**
 * Assemble a signed transaction from a body and auxiliary data that are already encoded.
 *
 * The body arrives as bytes because that is what was hashed and signed: decoding it and
 * re-encoding it is how a co-signed transaction acquires a different id than the one its first
 * signature covers. {@link fromCBORBytes} on `TransactionBody` records the arrival bytes, so the
 * body this carries re-encodes exactly, and `isValid` defaults to the only value a wallet submits.
 *
 * @since 2.8.0
 * @category constructors
 */
export const fromEncoded = (input: {
  readonly body: Uint8Array
  readonly witnessSet: TransactionWitnessSet.TransactionWitnessSet
  readonly auxiliaryData?: Uint8Array
  readonly isValid?: boolean
}): Transaction =>
  new Transaction({
    body: TransactionBody.fromCBORBytes(input.body),
    witnessSet: input.witnessSet,
    isValid: input.isValid ?? true,
    auxiliaryData: input.auxiliaryData === undefined ? null : AuxiliaryData.fromCBORBytes(input.auxiliaryData)
  })

// `CBOR.CML_DEFAULT_OPTIONS` passed explicitly acts as the default
const isDefault = (options: CBOR.TxCodecOptions | CBOR.CodecOptions): boolean =>
  options === CBOR.TX_DEFAULT_OPTIONS || options === CBOR.CML_DEFAULT_OPTIONS

export const fromCBORBytes = (bytes: Uint8Array, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS): Transaction => {
  // When caller passes non-default codec options, honor them via the legacy
  // decode path and skip format caching — custom options typically imply the
  // caller wants re-canonicalization, which is incompatible with preserving
  // the original encoding.
  if (!isDefault(options)) {
    return Schema.decodeSync(FromCBORBytes(options))(bytes)
  }
  const { format, value } = fromCBORBytesWithFormat(bytes)
  formatCache.set(value, format)
  return value
}

export const fromCBORHex = (hex: string, options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS): Transaction => {
  if (!isDefault(options)) {
    return Schema.decodeSync(FromCBORHex(options))(hex)
  }
  const { format, value } = fromCBORHexWithFormat(hex)
  formatCache.set(value, format)
  return value
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
  const value = Schema.decodeSync(FromCDDL)(
    decoded.value as readonly [Map<bigint, CBOR.CBOR>, Map<bigint, CBOR.CBOR>, boolean, CBOR.CBOR | null]
  )
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
  const decoded = CBOR.fromCBORHexWithFormat(hex)
  const value = Schema.decodeSync(FromCDDL)(
    decoded.value as readonly [Map<bigint, CBOR.CBOR>, Map<bigint, CBOR.CBOR>, boolean, CBOR.CBOR | null]
  )
  return { value, format: decoded.format }
}

export const toCBORBytes = (
  data: Transaction,
  options: CBOR.TxCodecOptions | CBOR.CodecOptions = CBOR.TX_DEFAULT_OPTIONS
): Uint8Array => {
  // Non-default options signal an explicit re-encode request — bypass the
  // cached format so the caller's options actually take effect.
  if (!isDefault(options)) {
    return Schema.encodeSync(FromCBORBytes(options))(data)
  }
  // A transaction built for a specific encoding carries hashes computed under it, so the default
  // path must honour that rather than silently re-encoding with the CML defaults.
  const intended = intendedOptionsCache.get(data)
  if (intended !== undefined) return Schema.encodeSync(FromCBORBytes(intended))(data)
  const cached = formatCache.get(data)
  if (cached) return toCBORBytesWithFormat(data, cached)
  return Schema.encodeSync(FromCBORBytes(options))(data)
}

export const toCBORHex = (data: Transaction, options: CBOR.TxCodecOptions | CBOR.CodecOptions = CBOR.TX_DEFAULT_OPTIONS): string => {
  if (!isDefault(options)) {
    return Schema.encodeSync(FromCBORHex(options))(data)
  }
  // A transaction built for a specific encoding carries hashes computed under it, so the default
  // path must honour that rather than silently re-encoding with the CML defaults.
  const intended = intendedOptionsCache.get(data)
  if (intended !== undefined) return Schema.encodeSync(FromCBORHex(intended))(data)
  const cached = formatCache.get(data)
  if (cached) return toCBORHexWithFormat(data, cached)
  return Schema.encodeSync(FromCBORHex(options))(data)
}

/**
 * Convert a Transaction to CBOR bytes using an explicit root format tree.
 *
 * The witness set is written as `TransactionWitnessSet.toCBORBytesWithFormat`
 * writes it.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytesWithFormat = (
  data: Transaction,
  format: CBOR.CBORFormat
): Uint8Array => {
  const cborTuple = Schema.encodeSync(FromCDDL)(data)
  if ((data.witnessSet.plutusData ?? []).length === 0 && (data.witnessSet.redeemers?.size ?? 0) === 0) {
    return CBOR.toCBORBytesWithFormat(cborTuple as unknown as CBOR.CBOR, format)
  }
  // The witness set's bytes, decoded with their format, replay exactly in
  // the tuple. A part the format does not cover is written with the defaults.
  const arrayFormat: CBOR.CBORFormat.Array = format._tag === "array" ? format : { _tag: "array", children: [] }
  const [bodyFormat = { _tag: "simple" }, witnessSetFormat = { _tag: "simple" }, ...rest] = arrayFormat.children
  const witnessSet = CBOR.fromCBORBytesWithFormat(
    TransactionWitnessSet.toCBORBytesWithFormat(data.witnessSet, witnessSetFormat)
  )
  return CBOR.toCBORBytesWithFormat([cborTuple[0], witnessSet.value, ...cborTuple.slice(2)], {
    ...arrayFormat,
    children: [bodyFormat, witnessSet.format, ...rest]
  })
}

/**
 * Convert a Transaction to CBOR hex string using an explicit root format tree,
 * as in {@link toCBORBytesWithFormat}.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHexWithFormat = (data: Transaction, format: CBOR.CBORFormat): string =>
  Bytes.toHex(toCBORBytesWithFormat(data, format))

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
  options: CBOR.CodecOptions = CBOR.CML_DEFAULT_OPTIONS
): Uint8Array => {
  // Decode wallet witness set to extract vkey witnesses
  const walletWs = TransactionWitnessSet.fromCBORBytes(walletWitnessSetBytes, options)
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

/**
 * The byte width of the CBOR item header at `offset`.
 *
 * Paired with {@link CBOR.decodeItemWithOffset} this is what slices an element out of a CBOR
 * array **byte-exactly** — `decodeItemWithOffset` gives the end of an item, this gives the start
 * of the first one inside a container. `extractBodyBytes` is one such slice; a wallet that
 * reviews a transaction before signing needs the same for the witness set and the auxiliary
 * data, and a re-encode is not a substitute because a span that differs by one byte is a
 * different transaction id.
 *
 * @since 2.2.0
 * @category utils
 */
export const cborHeaderSize = (data: Uint8Array, offset: number): number => {
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
  const newWs = new TransactionWitnessSet.TransactionWitnessSet(
    {
      ...oldWs,
      vkeyWitnesses: [...(oldWs.vkeyWitnesses ?? []), ...witnesses]
    },
    { disableValidation: true }
  )
  const result = new Transaction(
    { body: tx.body, witnessSet: newWs, isValid: tx.isValid, auxiliaryData: tx.auxiliaryData },
    { disableValidation: true }
  )
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
