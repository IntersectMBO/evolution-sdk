import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as AddressEras from "./AddressEras.js"
import * as BaseAddress from "./BaseAddress.js"
import * as Bytes from "./Bytes.js"
import * as PlutusData from "./Data.js"
import * as DatumHash from "./DatumHash.js"
import * as DatumOption from "./DatumOption.js"
import * as EnterpriseAddress from "./EnterpriseAddress.js"
import * as InlineDatum from "./InlineDatum.js"
import * as ScriptRef from "./ScriptRef.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"
import * as Value from "./Value.js"

// Pre-bind frequently used ParseResult helpers for hot paths

/**
 * Shelley-era transaction output format
 *
 * CDDL:
 * ```
 * shelley_transaction_output = [address, amount : value, ? Bytes32]
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class ShelleyTransactionOutput extends Schema.TaggedClass<ShelleyTransactionOutput>()(
  "ShelleyTransactionOutput",
  {
    address: AddressEras.FromBech32,
    // Schema.Union(BaseAddress.BaseAddress, EnterpriseAddress.EnterpriseAddress),
    amount: Value.Value,
    datumHash: Schema.optional(DatumHash.DatumHash)
  }
) {
  toJSON() {
    return {
      _tag: this._tag,
      address: this.address,
      amount: this.amount,
      datumHash: this.datumHash
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
      that instanceof ShelleyTransactionOutput &&
      Equal.equals(this.address, that.address) &&
      Equal.equals(this.amount, that.amount) &&
      Equal.equals(this.datumHash, that.datumHash)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.address) ^ Hash.hash(this.amount) ^ Hash.hash(this.datumHash))
  }
}

/**
 * Babbage-era transaction output format
 *
 * CDDL:
 * ```
 * babbage_transaction_output =
 *   {0 : address, 1 : value, ? 2 : datum_option, ? 3 : script_ref}
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class BabbageTransactionOutput extends Schema.TaggedClass<BabbageTransactionOutput>()(
  "BabbageTransactionOutput",
  {
    address: AddressEras.FromBech32,
    amount: Value.Value, // 1
    datumOption: Schema.optional(DatumOption.DatumOptionSchema), // 2
    scriptRef: Schema.optional(ScriptRef.ScriptRef) // 3
  }
) {
  toJSON() {
    return {
      _tag: this._tag,
      address: this.address,
      amount: this.amount,
      datumOption: this.datumOption,
      scriptRef: this.scriptRef
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
      that instanceof BabbageTransactionOutput &&
      Equal.equals(this.address, that.address) &&
      Equal.equals(this.amount, that.amount) &&
      Equal.equals(this.datumOption, that.datumOption) &&
      Equal.equals(this.scriptRef, that.scriptRef)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.hash(this.address) ^ Hash.hash(this.amount) ^ Hash.hash(this.datumOption) ^ Hash.hash(this.scriptRef)
    )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

// Inline address write: dispatch on _tag to BaseAddress or EnterpriseAddress
const writeAddress = (w: CborWriter, v: AddressEras.AddressEras): void => {
  switch (v._tag) {
    case "BaseAddress": BaseAddress.write(w, v); break
    case "EnterpriseAddress": EnterpriseAddress.write(w, v); break
    default: {
      // Fallback for other address types — encode via Schema
      const bytes = Schema.encodeSync(AddressEras.FromBytes)(v)
      w.writeBytes(bytes)
    }
  }
}

const readAddress = (r: CborReader): AddressEras.AddressEras => {
  const bytes = r.readBytesView()
  const header = bytes[0]
  const addressType = header >> 4
  switch (addressType) {
    case 0b0000: case 0b0001: case 0b0010: case 0b0011:
      return Schema.decodeSync(BaseAddress.FromBytes)(bytes)
    case 0b0110: case 0b0111:
      return Schema.decodeSync(EnterpriseAddress.FromBytes)(bytes)
    default:
      return Schema.decodeSync(AddressEras.FromBytes)(bytes)
  }
}

// Inline DatumOption write/read: [0, Bytes32] / [1, #6.24(bytes)]
const writeDatumOption = (w: CborWriter, v: DatumOption.DatumOption): void => {
  w.writeArrayHeader(2)
  if (v._tag === "DatumHash") {
    w.writeSmallUint(0)
    w.writeBytes(v.hash)
  } else {
    w.writeSmallUint(1)
    w.writeTagHeader(24)
    w.writeBytes(PlutusData.toCBORBytes(v.data))
  }
  w.writeArrayBreak()
}

const readDatumOption = (r: CborReader): DatumOption.DatumOption => {
  const count = r.readArrayHeader()
  const tag = r.readSmallUint()
  let result: DatumOption.DatumOption
  if (tag === 0) {
    result = new DatumHash.DatumHash({ hash: r.readBytesView() })
  } else {
    const cborTag = r.readTagHeader()
    if (cborTag !== 24) throw new Error(`DatumOption: expected tag 24, got ${cborTag}`)
    const dataBytes = r.readBytes()
    result = new InlineDatum.InlineDatum({ data: PlutusData.fromCBORBytes(dataBytes) })
  }
  if (count === -1) r.isBreak()
  return result
}

export const writeShelley = (w: CborWriter, v: ShelleyTransactionOutput): void => {
  w.writeArrayHeader(v.datumHash !== undefined ? 3 : 2)
  writeAddress(w, v.address)
  Value.write(w, v.amount)
  if (v.datumHash !== undefined) DatumHash.write(w, v.datumHash)
  w.writeArrayBreak()
}

export const readShelley = (r: CborReader): ShelleyTransactionOutput => {
  const count = r.readArrayHeader()
  const address = readAddress(r)
  const amount = Value.read(r)
  let datumHash: DatumHash.DatumHash | undefined
  // Check if there's a third element (datum hash)
  if (count === -1) {
    if (!r.isBreak()) {
      datumHash = DatumHash.read(r)
      r.isBreak() // consume break
    }
  } else if (count >= 3) {
    datumHash = DatumHash.read(r)
  }
  return new ShelleyTransactionOutput({ address, amount, datumHash })
}

export const writeBabbage = (w: CborWriter, v: BabbageTransactionOutput): void => {
  let count = 2
  if (v.datumOption !== undefined) count++
  if (v.scriptRef !== undefined) count++
  w.writeMapHeader(count)
  w.writeSmallUint(0); writeAddress(w, v.address)
  w.writeSmallUint(1); Value.write(w, v.amount)
  if (v.datumOption !== undefined) { w.writeSmallUint(2); writeDatumOption(w, v.datumOption) }
  if (v.scriptRef !== undefined) { w.writeSmallUint(3); ScriptRef.write(w, v.scriptRef) }
  w.writeMapBreak()
}

export const readBabbage = (r: CborReader): BabbageTransactionOutput => {
  const mapCount = r.readMapHeader()
  let address: AddressEras.AddressEras | undefined
  let amount: Value.Value | undefined
  let datumOption: DatumOption.DatumOption | undefined
  let scriptRef: ScriptRef.ScriptRef | undefined
  const readEntry = () => {
    const key = r.readSmallUint()
    switch (key) {
      case 0: address = readAddress(r); break
      case 1: amount = Value.read(r); break
      case 2: datumOption = readDatumOption(r); break
      case 3: scriptRef = ScriptRef.read(r); break
      default: r.skip(); break
    }
  }
  if (mapCount === -1) {
    while (!r.isBreak()) readEntry()
  } else {
    for (let i = 0; i < mapCount; i++) readEntry()
  }
  return new BabbageTransactionOutput({
    address: address!,
    amount: amount!,
    datumOption,
    scriptRef
  })
}

export const write = (w: CborWriter, v: ShelleyTransactionOutput | BabbageTransactionOutput): void => {
  if (v._tag === "ShelleyTransactionOutput") writeShelley(w, v)
  else writeBabbage(w, v)
}

export const read = (r: CborReader): ShelleyTransactionOutput | BabbageTransactionOutput => {
  const mt = r.peekMajorType()
  if (mt === 4) return readShelley(r)
  if (mt === 5) return readBabbage(r)
  throw new Error(`TransactionOutput: expected array (4) or map (5), got major type ${mt}`)
}

/**
 * Union type for transaction outputs
 *
 * CDDL:
 * ```
 * transaction_output = shelley_transaction_output / babbage_transaction_output
 * ```
 *
 * @since 2.0.0
 * @category schemas
 */
export const TransactionOutput = Schema.Union(ShelleyTransactionOutput, BabbageTransactionOutput)

export type TransactionOutput = typeof TransactionOutput.Type

/**
 * CBOR bytes transformation schema for TransactionOutput.
 *
 * @since 2.0.0
 * @category transformer
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(TransactionOutput),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "TransactionOutput.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "TransactionOutput.FromCBORHex" })

/**
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.oneof(
  // Shelley TransactionOutput
  FastCheck.record({
    address: FastCheck.oneof(BaseAddress.arbitrary, EnterpriseAddress.arbitrary),
    amount: Value.arbitrary,
    datumHash: FastCheck.option(DatumHash.arbitrary, { nil: undefined })
  }).map((props) => new ShelleyTransactionOutput(props)),

  // Babbage TransactionOutput
  FastCheck.record({
    address: FastCheck.oneof(BaseAddress.arbitrary, EnterpriseAddress.arbitrary),
    amount: Value.arbitrary,
    datumOption: FastCheck.option(DatumOption.arbitrary, { nil: undefined }),
    scriptRef: FastCheck.option(ScriptRef.arbitrary, { nil: undefined })
  }).map((props) => new BabbageTransactionOutput(props))
)

/**
 * Convert TransactionOutput to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: TransactionOutput, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Convert TransactionOutput to CBOR hex.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: TransactionOutput, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))

/**
 * Parse TransactionOutput from CBOR bytes.
 *
 * @since 2.0.0
 * @category decoding
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse TransactionOutput from CBOR hex.
 *
 * @since 2.0.0
 * @category decoding
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)
