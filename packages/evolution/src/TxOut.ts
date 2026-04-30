import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Address from "./Address.js"
import * as AssetName from "./AssetName.js"
import * as Assets from "./Assets.js"
import * as Bytes from "./Bytes.js"
import type * as Coin from "./Coin.js"
import * as PlutusData from "./Data.js"
import * as DatumHash from "./DatumHash.js"
import * as DatumOption from "./DatumOption.js"
import * as InlineDatum from "./InlineDatum.js"
import * as MultiAsset from "./MultiAsset.js"
import * as PolicyId from "./PolicyId.js"
import type * as PositiveCoin from "./PositiveCoin.js"
import * as ScriptRef from "./ScriptRef.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

// Pre-bind frequently used ParseResult helpers for hot paths

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
export class TransactionOutput extends Schema.TaggedClass<TransactionOutput>()("TransactionOutput", {
  address: Address.Address,
  assets: Assets.Assets.pipe(
    Schema.filter(Assets.allPositive, {
      message: () => "Transaction output assets must have non-negative lovelace and positive token quantities"
    })
  ),
  datumOption: Schema.optional(DatumOption.DatumOptionSchema), // 2
  scriptRef: Schema.optional(ScriptRef.ScriptRef) // 3
}) {
  toJSON() {
    return {
      _tag: this._tag,
      address: this.address.toJSON(),
      assets: this.assets.toJSON(),
      datumOption: this.datumOption?.toJSON(),
      scriptRef: this.scriptRef?.toJSON()
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
      that instanceof TransactionOutput &&
      Equal.equals(this.address, that.address) &&
      Equal.equals(this.assets, that.assets) &&
      Equal.equals(this.datumOption, that.datumOption) &&
      Equal.equals(this.scriptRef, that.scriptRef)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.address))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

// Inline address write/read for Address.Address type
const writeAddress = (w: CborWriter, v: Address.Address): void => {
  w.writeBytes(Address.toBytes(v))
}

const readAddress = (r: CborReader): Address.Address => {
  return Address.fromBytes(r.readBytes())
}

// Inline Assets write/read (same as Value encoding: coin / [coin, multiasset])
const writeAssets = (w: CborWriter, v: Assets.Assets): void => {
  if (v.multiAsset === undefined) {
    w.writeUint(v.lovelace)
  } else {
    w.writeArrayHeader(2)
    w.writeUint(v.lovelace)
    // Write multiasset map
    w.writeMapHeader(v.multiAsset.map.size)
    for (const [policyId, assetMap] of v.multiAsset.map.entries()) {
      PolicyId.write(w, policyId)
      w.writeMapHeader(assetMap.size)
      for (const [assetName, amount] of assetMap.entries()) {
        AssetName.write(w, assetName)
        if (amount >= 0n) w.writeUint(amount)
        else w.writeNint(amount)
      }
      w.writeMapBreak()
    }
    w.writeMapBreak()
    w.writeArrayBreak()
  }
}

const readAssets = (r: CborReader): Assets.Assets => {
  const mt = r.peekMajorType()
  if (mt === 0) {
    return new Assets.Assets({ lovelace: r.readUint() as Coin.Coin })
  } else if (mt === 4) {
    const count = r.readArrayHeader()
    const lovelace = r.readUint() as Coin.Coin
    // Read multiasset map
    const outerCount = r.readMapHeader()
    const map = new Map<PolicyId.PolicyId, MultiAsset.AssetMap>()
    const readEntry = () => {
      const policyId = PolicyId.read(r)
      const innerCount = r.readMapHeader()
      const assetMap = new Map<AssetName.AssetName, PositiveCoin.PositiveCoin>()
      const readInner = () => {
        const assetName = AssetName.read(r)
        const amount = r.readInt() as PositiveCoin.PositiveCoin
        assetMap.set(assetName, amount)
      }
      if (innerCount === -1) { while (!r.isBreak()) readInner() }
      else { for (let i = 0; i < innerCount; i++) readInner() }
      map.set(policyId, assetMap)
    }
    if (outerCount === -1) { while (!r.isBreak()) readEntry() }
    else { for (let i = 0; i < outerCount; i++) readEntry() }
    if (count === -1) r.isBreak()
    return new Assets.Assets({ lovelace, multiAsset: new MultiAsset.MultiAsset({ map }) })
  }
  throw new Error(`Assets: expected integer (0) or array (4), got major type ${mt}`)
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

export const write = (w: CborWriter, v: TransactionOutput): void => {
  // Determine format: Shelley (array) vs Babbage (map)
  const canUseShelleyFormat =
    v.scriptRef === undefined && (v.datumOption === undefined || v.datumOption._tag === "DatumHash")

  if (canUseShelleyFormat) {
    // Shelley format: [address, amount, ?datum_hash]
    w.writeArrayHeader(v.datumOption !== undefined ? 3 : 2)
    writeAddress(w, v.address)
    writeAssets(w, v.assets)
    if (v.datumOption !== undefined && v.datumOption._tag === "DatumHash") {
      DatumHash.write(w, v.datumOption)
    }
    w.writeArrayBreak()
  } else {
    // Babbage format: {0: address, 1: value, ?2: datum_option, ?3: script_ref}
    let count = 2
    if (v.datumOption !== undefined) count++
    if (v.scriptRef !== undefined) count++
    w.writeMapHeader(count)
    w.writeSmallUint(0); writeAddress(w, v.address)
    w.writeSmallUint(1); writeAssets(w, v.assets)
    if (v.datumOption !== undefined) { w.writeSmallUint(2); writeDatumOption(w, v.datumOption) }
    if (v.scriptRef !== undefined) { w.writeSmallUint(3); ScriptRef.write(w, v.scriptRef) }
    w.writeMapBreak()
  }
}

export const read = (r: CborReader): TransactionOutput => {
  const mt = r.peekMajorType()
  if (mt === 4) {
    // Shelley format: [address, amount, ?datum_hash]
    const count = r.readArrayHeader()
    const address = readAddress(r)
    const assets = readAssets(r)
    let datumOption: DatumOption.DatumOption | undefined
    if (count === -1) {
      if (!r.isBreak()) {
        datumOption = new DatumHash.DatumHash({ hash: r.readBytesView() })
        r.isBreak()
      }
    } else if (count >= 3) {
      datumOption = new DatumHash.DatumHash({ hash: r.readBytesView() })
    }
    return new TransactionOutput({ address, assets, datumOption, scriptRef: undefined })
  } else if (mt === 5) {
    // Babbage format: map
    const mapCount = r.readMapHeader()
    let address: Address.Address | undefined
    let assets: Assets.Assets | undefined
    let datumOption: DatumOption.DatumOption | undefined
    let scriptRef: ScriptRef.ScriptRef | undefined
    const readEntry = () => {
      const key = r.readSmallUint()
      switch (key) {
        case 0: address = readAddress(r); break
        case 1: assets = readAssets(r); break
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
    return new TransactionOutput({ address: address!, assets: assets!, datumOption, scriptRef })
  }
  throw new Error(`TransactionOutput: expected array (4) or map (5), got major type ${mt}`)
}

// CDDL Schemas
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
export const arbitrary = FastCheck.record({
  address: Address.arbitrary,
  assets: Assets.arbitrary,
  datumOption: FastCheck.option(DatumOption.arbitrary, { nil: undefined }),
  scriptRef: FastCheck.option(ScriptRef.arbitrary, { nil: undefined })
}).map((props) => new TransactionOutput(props))

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
