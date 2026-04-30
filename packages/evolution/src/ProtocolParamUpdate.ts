import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Bytes from "./Bytes.js"
import * as Coin from "./Coin.js"
import * as CostModel from "./CostModel.js"
import * as NonnegativeInterval from "./NonnegativeInterval.js"
import * as Numeric from "./Numeric.js"
import * as UnitInterval from "./UnitInterval.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * ex_unit_prices (domain) = [mem_price : NonnegativeInterval, step_price : NonnegativeInterval]
 */
export class ExUnitPrices extends Schema.Class<ExUnitPrices>("ExUnitPrices")({
  memPrice: NonnegativeInterval.NonnegativeInterval,
  stepPrice: NonnegativeInterval.NonnegativeInterval
}) {
  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof ExUnitPrices &&
      Equal.equals(this.memPrice, that.memPrice) &&
      Equal.equals(this.stepPrice, that.stepPrice)
    )
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.memPrice))
  }
}

export const ExUnitPricesCDDL = Schema.Tuple(
  NonnegativeInterval.NonnegativeInterval,
  NonnegativeInterval.NonnegativeInterval
).annotations({ identifier: "ExUnitPricesCDDL" })

/**
 * ex_units = [mem : uint, steps : uint]
 */
export class ExUnits extends Schema.Class<ExUnits>("ExUnits")({
  mem: Numeric.Uint64Schema,
  steps: Numeric.Uint64Schema
}) {
  [Equal.symbol](that: unknown): boolean {
    return that instanceof ExUnits && this.mem === that.mem && this.steps === that.steps
  }

  [Hash.symbol](): number {
    return Hash.cached(this, Hash.hash(this.mem))
  }
}

export const ExUnitsCDDL = Schema.Tuple(Numeric.Uint64Schema, Numeric.Uint64Schema).annotations({
  identifier: "ExUnitsCDDL"
})

/**
 * pool_voting_thresholds (domain) = [u,u,u,u,u] (5 unit_intervals)
 */
export class PoolVotingThresholds extends Schema.Class<PoolVotingThresholds>("PoolVotingThresholds")({
  t1: UnitInterval.UnitInterval,
  t2: UnitInterval.UnitInterval,
  t3: UnitInterval.UnitInterval,
  t4: UnitInterval.UnitInterval,
  t5: UnitInterval.UnitInterval
}) {
  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof PoolVotingThresholds &&
      Equal.equals(this.t1, that.t1) &&
      Equal.equals(this.t2, that.t2) &&
      Equal.equals(this.t3, that.t3) &&
      Equal.equals(this.t4, that.t4) &&
      Equal.equals(this.t5, that.t5)
    )
  }

  [Hash.symbol](): number {
    // Only hash first threshold for performance
    return Hash.cached(this, Hash.hash(this.t1))
  }
}

export const PoolVotingThresholdsCDDL = Schema.Tuple(
  UnitInterval.UnitInterval,
  UnitInterval.UnitInterval,
  UnitInterval.UnitInterval,
  UnitInterval.UnitInterval,
  UnitInterval.UnitInterval
).annotations({ identifier: "PoolVotingThresholdsCDDL" })

/**
 * drep_voting_thresholds (domain) = [10 unit_intervals]
 */
export class DRepVotingThresholds extends Schema.Class<DRepVotingThresholds>("DRepVotingThresholds")({
  t1: UnitInterval.UnitInterval,
  t2: UnitInterval.UnitInterval,
  t3: UnitInterval.UnitInterval,
  t4: UnitInterval.UnitInterval,
  t5: UnitInterval.UnitInterval,
  t6: UnitInterval.UnitInterval,
  t7: UnitInterval.UnitInterval,
  t8: UnitInterval.UnitInterval,
  t9: UnitInterval.UnitInterval,
  t10: UnitInterval.UnitInterval
}) {
  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof DRepVotingThresholds &&
      Equal.equals(this.t1, that.t1) &&
      Equal.equals(this.t2, that.t2) &&
      Equal.equals(this.t3, that.t3) &&
      Equal.equals(this.t4, that.t4) &&
      Equal.equals(this.t5, that.t5) &&
      Equal.equals(this.t6, that.t6) &&
      Equal.equals(this.t7, that.t7) &&
      Equal.equals(this.t8, that.t8) &&
      Equal.equals(this.t9, that.t9) &&
      Equal.equals(this.t10, that.t10)
    )
  }

  [Hash.symbol](): number {
    // Only hash first threshold for performance
    return Hash.cached(this, Hash.hash(this.t1))
  }
}

/**
 * ProtocolParamUpdate CDDL record with optional fields keyed by indexes.
 * Mirrors Conway CDDL `protocol_param_update`.
 */

/**
 * Convenience domain class mirroring the same structure.
 */
export class ProtocolParamUpdate extends Schema.TaggedClass<ProtocolParamUpdate>()("ProtocolParamUpdate", {
  minfeeA: Schema.optional(Coin.Coin), // 0
  minfeeB: Schema.optional(Coin.Coin), // 1
  maxBlockBodySize: Schema.optional(Numeric.Uint32Schema), // 2
  maxTxSize: Schema.optional(Numeric.Uint32Schema), // 3
  maxBlockHeaderSize: Schema.optional(Numeric.Uint16Schema), // 4
  keyDeposit: Schema.optional(Coin.Coin), // 5
  poolDeposit: Schema.optional(Coin.Coin), // 6
  maxEpoch: Schema.optional(Numeric.Uint32Schema), // 7
  nOpt: Schema.optional(Numeric.Uint16Schema), // 8
  poolPledgeInfluence: Schema.optional(NonnegativeInterval.NonnegativeInterval), // 9
  expansionRate: Schema.optional(UnitInterval.UnitInterval), // 10
  treasuryGrowthRate: Schema.optional(UnitInterval.UnitInterval), // 11
  minPoolCost: Schema.optional(Coin.Coin), // 16
  adaPerUtxoByte: Schema.optional(Coin.Coin), // 17
  costModels: Schema.optional(CostModel.CostModels), // 18
  exUnitPrices: Schema.optional(ExUnitPrices), // 19
  maxTxExUnits: Schema.optional(ExUnits), // 20
  maxBlockExUnits: Schema.optional(ExUnits), // 21
  maxValueSize: Schema.optional(Numeric.Uint32Schema), // 22
  collateralPercentage: Schema.optional(Numeric.Uint16Schema), // 23
  maxCollateralInputs: Schema.optional(Numeric.Uint16Schema), // 24
  poolVotingThresholds: Schema.optional(PoolVotingThresholds), // 25
  drepVotingThresholds: Schema.optional(DRepVotingThresholds), // 26
  minCommitteeSize: Schema.optional(Numeric.Uint16Schema), // 27
  committeeTermLimit: Schema.optional(Numeric.Uint32Schema), // 28
  governanceActionValidity: Schema.optional(Numeric.Uint32Schema), // 29
  governanceActionDeposit: Schema.optional(Coin.Coin), // 30
  drepDeposit: Schema.optional(Coin.Coin), // 31
  drepInactivityPeriod: Schema.optional(Numeric.Uint32Schema), // 32
  minfeeRefScriptCoinsPerByte: Schema.optional(NonnegativeInterval.NonnegativeInterval) // 33
}) {
  toJSON() {
    return {
      _tag: this._tag,
      minfeeA: this.minfeeA,
      minfeeB: this.minfeeB,
      maxBlockBodySize: this.maxBlockBodySize,
      maxTxSize: this.maxTxSize,
      maxBlockHeaderSize: this.maxBlockHeaderSize,
      keyDeposit: this.keyDeposit,
      poolDeposit: this.poolDeposit,
      maxEpoch: this.maxEpoch,
      nOpt: this.nOpt,
      poolPledgeInfluence: this.poolPledgeInfluence,
      expansionRate: this.expansionRate,
      treasuryGrowthRate: this.treasuryGrowthRate,
      minPoolCost: this.minPoolCost,
      adaPerUtxoByte: this.adaPerUtxoByte,
      costModels: this.costModels,
      exUnitPrices: this.exUnitPrices,
      maxTxExUnits: this.maxTxExUnits,
      maxBlockExUnits: this.maxBlockExUnits,
      maxValueSize: this.maxValueSize,
      collateralPercentage: this.collateralPercentage,
      maxCollateralInputs: this.maxCollateralInputs,
      poolVotingThresholds: this.poolVotingThresholds,
      drepVotingThresholds: this.drepVotingThresholds,
      minCommitteeSize: this.minCommitteeSize,
      committeeTermLimit: this.committeeTermLimit,
      governanceActionValidity: this.governanceActionValidity,
      governanceActionDeposit: this.governanceActionDeposit,
      drepDeposit: this.drepDeposit,
      drepInactivityPeriod: this.drepInactivityPeriod,
      minfeeRefScriptCoinsPerByte: this.minfeeRefScriptCoinsPerByte
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
      that instanceof ProtocolParamUpdate &&
      Equal.equals(this.minfeeA, that.minfeeA) &&
      Equal.equals(this.minfeeB, that.minfeeB) &&
      Equal.equals(this.maxBlockBodySize, that.maxBlockBodySize) &&
      Equal.equals(this.maxTxSize, that.maxTxSize) &&
      Equal.equals(this.maxBlockHeaderSize, that.maxBlockHeaderSize) &&
      Equal.equals(this.keyDeposit, that.keyDeposit) &&
      Equal.equals(this.poolDeposit, that.poolDeposit) &&
      Equal.equals(this.maxEpoch, that.maxEpoch) &&
      Equal.equals(this.nOpt, that.nOpt) &&
      Equal.equals(this.poolPledgeInfluence, that.poolPledgeInfluence) &&
      Equal.equals(this.expansionRate, that.expansionRate) &&
      Equal.equals(this.treasuryGrowthRate, that.treasuryGrowthRate) &&
      Equal.equals(this.minPoolCost, that.minPoolCost) &&
      Equal.equals(this.adaPerUtxoByte, that.adaPerUtxoByte) &&
      Equal.equals(this.costModels, that.costModels) &&
      Equal.equals(this.exUnitPrices, that.exUnitPrices) &&
      Equal.equals(this.maxTxExUnits, that.maxTxExUnits) &&
      Equal.equals(this.maxBlockExUnits, that.maxBlockExUnits) &&
      Equal.equals(this.maxValueSize, that.maxValueSize) &&
      Equal.equals(this.collateralPercentage, that.collateralPercentage) &&
      Equal.equals(this.maxCollateralInputs, that.maxCollateralInputs) &&
      Equal.equals(this.poolVotingThresholds, that.poolVotingThresholds) &&
      Equal.equals(this.drepVotingThresholds, that.drepVotingThresholds) &&
      Equal.equals(this.minCommitteeSize, that.minCommitteeSize) &&
      Equal.equals(this.committeeTermLimit, that.committeeTermLimit) &&
      Equal.equals(this.governanceActionValidity, that.governanceActionValidity) &&
      Equal.equals(this.governanceActionDeposit, that.governanceActionDeposit) &&
      Equal.equals(this.drepDeposit, that.drepDeposit) &&
      Equal.equals(this.drepInactivityPeriod, that.drepInactivityPeriod) &&
      Equal.equals(this.minfeeRefScriptCoinsPerByte, that.minfeeRefScriptCoinsPerByte)
    )
  }

  [Hash.symbol](): number {
    // Only hash 1-2 most frequently changing fields for performance
    // This allows hash collisions to trigger full equality check
    // Most common updates are fee-related parameters and cost models
    return Hash.cached(this, Hash.combine(Hash.hash(this.minfeeA))(Hash.hash(this.costModels)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

// Inline helpers for interval types: #6.30([uint, uint])
const writeUnitInterval = (w: CborWriter, v: UnitInterval.UnitInterval): void => {
  w.writeTagHeader(30)
  w.writeArrayHeader(2)
  w.writeUint(v.numerator)
  w.writeUint(v.denominator)
  w.writeArrayBreak()
}

const readUnitInterval = (r: CborReader): UnitInterval.UnitInterval => {
  const tag = r.readTagHeader()
  if (tag !== 30) throw new Error(`UnitInterval: expected tag 30, got ${tag}`)
  const count = r.readArrayHeader()
  const result = new UnitInterval.UnitInterval({
    numerator: r.readUint(),
    denominator: r.readUint()
  })
  if (count === -1) r.isBreak()
  return result
}

const writeNonnegativeInterval = (w: CborWriter, v: NonnegativeInterval.NonnegativeInterval): void => {
  w.writeTagHeader(30)
  w.writeArrayHeader(2)
  w.writeUint(v.numerator)
  w.writeUint(v.denominator)
  w.writeArrayBreak()
}

const readNonnegativeInterval = (r: CborReader): NonnegativeInterval.NonnegativeInterval => {
  const tag = r.readTagHeader()
  if (tag !== 30) throw new Error(`NonnegativeInterval: expected tag 30, got ${tag}`)
  const count = r.readArrayHeader()
  const result = new NonnegativeInterval.NonnegativeInterval({
    numerator: r.readUint(),
    denominator: r.readUint()
  })
  if (count === -1) r.isBreak()
  return result
}

// Inline helpers for ExUnits: [uint, uint]
const writeExUnits = (w: CborWriter, v: ExUnits): void => {
  w.writeArrayHeader(2)
  w.writeUint(v.mem)
  w.writeUint(v.steps)
  w.writeArrayBreak()
}

const readExUnits = (r: CborReader): ExUnits => {
  const count = r.readArrayHeader()
  const result = new ExUnits({ mem: r.readUint(), steps: r.readUint() })
  if (count === -1) r.isBreak()
  return result
}

// Inline helpers for ExUnitPrices: [NonnegativeInterval, NonnegativeInterval]
const writeExUnitPrices = (w: CborWriter, v: ExUnitPrices): void => {
  w.writeArrayHeader(2)
  writeNonnegativeInterval(w, v.memPrice)
  writeNonnegativeInterval(w, v.stepPrice)
  w.writeArrayBreak()
}

const readExUnitPrices = (r: CborReader): ExUnitPrices => {
  const count = r.readArrayHeader()
  const result = new ExUnitPrices({
    memPrice: readNonnegativeInterval(r),
    stepPrice: readNonnegativeInterval(r)
  })
  if (count === -1) r.isBreak()
  return result
}

// Inline helpers for PoolVotingThresholds: [5 unit_intervals]
const writePoolVotingThresholds = (w: CborWriter, v: PoolVotingThresholds): void => {
  w.writeArrayHeader(5)
  writeUnitInterval(w, v.t1)
  writeUnitInterval(w, v.t2)
  writeUnitInterval(w, v.t3)
  writeUnitInterval(w, v.t4)
  writeUnitInterval(w, v.t5)
  w.writeArrayBreak()
}

const readPoolVotingThresholds = (r: CborReader): PoolVotingThresholds => {
  const count = r.readArrayHeader()
  const result = new PoolVotingThresholds({
    t1: readUnitInterval(r),
    t2: readUnitInterval(r),
    t3: readUnitInterval(r),
    t4: readUnitInterval(r),
    t5: readUnitInterval(r)
  })
  if (count === -1) r.isBreak()
  return result
}

// Inline helpers for DRepVotingThresholds: [10 unit_intervals]
const writeDRepVotingThresholds = (w: CborWriter, v: DRepVotingThresholds): void => {
  w.writeArrayHeader(10)
  writeUnitInterval(w, v.t1)
  writeUnitInterval(w, v.t2)
  writeUnitInterval(w, v.t3)
  writeUnitInterval(w, v.t4)
  writeUnitInterval(w, v.t5)
  writeUnitInterval(w, v.t6)
  writeUnitInterval(w, v.t7)
  writeUnitInterval(w, v.t8)
  writeUnitInterval(w, v.t9)
  writeUnitInterval(w, v.t10)
  w.writeArrayBreak()
}

const readDRepVotingThresholds = (r: CborReader): DRepVotingThresholds => {
  const count = r.readArrayHeader()
  const result = new DRepVotingThresholds({
    t1: readUnitInterval(r),
    t2: readUnitInterval(r),
    t3: readUnitInterval(r),
    t4: readUnitInterval(r),
    t5: readUnitInterval(r),
    t6: readUnitInterval(r),
    t7: readUnitInterval(r),
    t8: readUnitInterval(r),
    t9: readUnitInterval(r),
    t10: readUnitInterval(r)
  })
  if (count === -1) r.isBreak()
  return result
}

// Inline helper for CostModels: { uint => [* int] }
const writeCostModels = (w: CborWriter, v: CostModel.CostModels): void => {
  let count = 0
  if (v.PlutusV1.costs.length > 0) count++
  if (v.PlutusV2.costs.length > 0) count++
  if (v.PlutusV3.costs.length > 0) count++
  w.writeMapHeader(count)
  const writeCostArray = (lang: number, costs: ReadonlyArray<bigint>) => {
    w.writeSmallUint(lang)
    w.writeArrayHeader(costs.length)
    for (const c of costs) {
      if (c >= 0n) w.writeUint(c)
      else w.writeNint(c)
    }
    w.writeArrayBreak()
  }
  if (v.PlutusV1.costs.length > 0) writeCostArray(0, v.PlutusV1.costs)
  if (v.PlutusV2.costs.length > 0) writeCostArray(1, v.PlutusV2.costs)
  if (v.PlutusV3.costs.length > 0) writeCostArray(2, v.PlutusV3.costs)
  w.writeMapBreak()
}

const readCostModels = (r: CborReader): CostModel.CostModels => {
  const mapCount = r.readMapHeader()
  let v1: Array<bigint> = []
  let v2: Array<bigint> = []
  let v3: Array<bigint> = []
  const readEntry = () => {
    const key = r.readUint()
    const arrCount = r.readArrayHeader()
    const costs: Array<bigint> = []
    if (arrCount === -1) {
      while (!r.isBreak()) costs.push(r.readInt())
    } else {
      for (let i = 0; i < arrCount; i++) costs.push(r.readInt())
    }
    switch (key) {
      case 0n: v1 = costs; break
      case 1n: v2 = costs; break
      case 2n: v3 = costs; break
    }
  }
  if (mapCount === -1) {
    while (!r.isBreak()) readEntry()
  } else {
    for (let i = 0; i < mapCount; i++) readEntry()
  }
  return new CostModel.CostModels({
    PlutusV1: new CostModel.CostModel({ costs: v1 }),
    PlutusV2: new CostModel.CostModel({ costs: v2 }),
    PlutusV3: new CostModel.CostModel({ costs: v3 })
  })
}

// Field definitions: [fieldName, cborKey, writeFn, readFn]
type PPField = {
  name: string & keyof ProtocolParamUpdate
  key: number
  write: (w: CborWriter, v: any) => void
  read: (r: CborReader) => any
}

const ppFields: ReadonlyArray<PPField> = [
  { name: "minfeeA", key: 0, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "minfeeB", key: 1, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "maxBlockBodySize", key: 2, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "maxTxSize", key: 3, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "maxBlockHeaderSize", key: 4, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "keyDeposit", key: 5, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "poolDeposit", key: 6, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "maxEpoch", key: 7, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "nOpt", key: 8, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "poolPledgeInfluence", key: 9, write: (w, v) => writeNonnegativeInterval(w, v), read: (r) => readNonnegativeInterval(r) },
  { name: "expansionRate", key: 10, write: (w, v) => writeUnitInterval(w, v), read: (r) => readUnitInterval(r) },
  { name: "treasuryGrowthRate", key: 11, write: (w, v) => writeUnitInterval(w, v), read: (r) => readUnitInterval(r) },
  { name: "minPoolCost", key: 16, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "adaPerUtxoByte", key: 17, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "costModels", key: 18, write: (w, v) => writeCostModels(w, v), read: (r) => readCostModels(r) },
  { name: "exUnitPrices", key: 19, write: (w, v) => writeExUnitPrices(w, v), read: (r) => readExUnitPrices(r) },
  { name: "maxTxExUnits", key: 20, write: (w, v) => writeExUnits(w, v), read: (r) => readExUnits(r) },
  { name: "maxBlockExUnits", key: 21, write: (w, v) => writeExUnits(w, v), read: (r) => readExUnits(r) },
  { name: "maxValueSize", key: 22, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "collateralPercentage", key: 23, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "maxCollateralInputs", key: 24, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "poolVotingThresholds", key: 25, write: (w, v) => writePoolVotingThresholds(w, v), read: (r) => readPoolVotingThresholds(r) },
  { name: "drepVotingThresholds", key: 26, write: (w, v) => writeDRepVotingThresholds(w, v), read: (r) => readDRepVotingThresholds(r) },
  { name: "minCommitteeSize", key: 27, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "committeeTermLimit", key: 28, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "governanceActionValidity", key: 29, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "governanceActionDeposit", key: 30, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "drepDeposit", key: 31, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "drepInactivityPeriod", key: 32, write: (w, v) => w.writeUint(v), read: (r) => r.readUint() },
  { name: "minfeeRefScriptCoinsPerByte", key: 33, write: (w, v) => writeNonnegativeInterval(w, v), read: (r) => readNonnegativeInterval(r) },
]

// Build lookup from CBOR key to field def for read
const ppFieldsByKey = new Map<number, PPField>(ppFields.map((f) => [f.key, f]))

export const write = (w: CborWriter, v: ProtocolParamUpdate): void => {
  // Count present fields
  let count = 0
  for (const f of ppFields) {
    if ((v as any)[f.name] !== undefined) count++
  }
  w.writeMapHeader(count)
  for (const f of ppFields) {
    const val = (v as any)[f.name]
    if (val !== undefined) {
      w.writeSmallUint(f.key)
      f.write(w, val)
    }
  }
  w.writeMapBreak()
}

export const read = (r: CborReader): ProtocolParamUpdate => {
  const mapCount = r.readMapHeader()
  const model: Record<string, unknown> = {}
  const readEntry = () => {
    const key = Number(r.readUint())
    const field = ppFieldsByKey.get(key)
    if (field) {
      model[field.name] = field.read(r)
    } else {
      r.skip()
    }
  }
  if (mapCount === -1) {
    while (!r.isBreak()) readEntry()
  } else {
    for (let i = 0; i < mapCount; i++) readEntry()
  }
  return new ProtocolParamUpdate(model as any)
}
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(ProtocolParamUpdate),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "ProtocolParamUpdate.FromCBORBytes" })

export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "ProtocolParamUpdate.FromCBORHex" })

export const toCBOR = (data: ProtocolParamUpdate, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(256, profile)
  write(w, data)
  return w.finishView()
}

export const fromCBOR = Schema.decodeSync(FromCBORBytes)

export const toCBORBytes = toCBOR
export const fromCBORBytes = fromCBOR

export const toCBORHex = (data: ProtocolParamUpdate, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))

export const fromCBORHex = Schema.decodeSync(FromCBORHex)

const coinArb = Coin.arbitrary
const costModelsArb = FastCheck.record({
  PlutusV1: CostModel.arbitrary,
  PlutusV2: CostModel.arbitrary,
  PlutusV3: CostModel.arbitrary
}).map((o) => new CostModel.CostModels(o))

export const arbitrary: FastCheck.Arbitrary<ProtocolParamUpdate> = FastCheck.record({
  minfeeA: FastCheck.option(coinArb, { nil: undefined }),
  minfeeB: FastCheck.option(coinArb, { nil: undefined }),
  maxBlockBodySize: FastCheck.option(Numeric.Uint32Arbitrary, { nil: undefined }),
  maxTxSize: FastCheck.option(Numeric.Uint32Arbitrary, { nil: undefined }),
  maxBlockHeaderSize: FastCheck.option(Numeric.Uint16Arbitrary, { nil: undefined }),
  keyDeposit: FastCheck.option(coinArb, { nil: undefined }),
  poolDeposit: FastCheck.option(coinArb, { nil: undefined }),
  maxEpoch: FastCheck.option(Numeric.Uint32Arbitrary, { nil: undefined }),
  nOpt: FastCheck.option(Numeric.Uint16Arbitrary, { nil: undefined }),
  poolPledgeInfluence: FastCheck.option(NonnegativeInterval.arbitrary, { nil: undefined }),
  expansionRate: FastCheck.option(UnitInterval.arbitrary, { nil: undefined }),
  treasuryGrowthRate: FastCheck.option(UnitInterval.arbitrary, { nil: undefined }),
  minPoolCost: FastCheck.option(coinArb, { nil: undefined }),
  adaPerUtxoByte: FastCheck.option(coinArb, { nil: undefined }),
  costModels: FastCheck.option(costModelsArb, { nil: undefined }),
  exUnitPrices: FastCheck.option(
    FastCheck.tuple(NonnegativeInterval.arbitrary, NonnegativeInterval.arbitrary).map(
      ([memPrice, stepPrice]) => new ExUnitPrices({ memPrice, stepPrice })
    ),
    { nil: undefined }
  ),
  maxTxExUnits: FastCheck.option(
    FastCheck.tuple(Numeric.Uint64Arbitrary, Numeric.Uint64Arbitrary).map(
      ([mem, steps]) => new ExUnits({ mem, steps })
    ),
    { nil: undefined }
  ),
  maxBlockExUnits: FastCheck.option(
    FastCheck.tuple(Numeric.Uint64Arbitrary, Numeric.Uint64Arbitrary).map(
      ([mem, steps]) => new ExUnits({ mem, steps })
    ),
    { nil: undefined }
  ),
  maxValueSize: FastCheck.option(Numeric.Uint32Arbitrary, { nil: undefined }),
  collateralPercentage: FastCheck.option(Numeric.Uint16Arbitrary, { nil: undefined }),
  maxCollateralInputs: FastCheck.option(Numeric.Uint16Arbitrary, { nil: undefined }),
  poolVotingThresholds: FastCheck.option(
    FastCheck.tuple(
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary
    ).map(([t1, t2, t3, t4, t5]) => new PoolVotingThresholds({ t1, t2, t3, t4, t5 })),
    { nil: undefined }
  ),
  drepVotingThresholds: FastCheck.option(
    FastCheck.tuple(
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary,
      UnitInterval.arbitrary
    ).map(
      ([t1, t2, t3, t4, t5, t6, t7, t8, t9, t10]) =>
        new DRepVotingThresholds({ t1, t2, t3, t4, t5, t6, t7, t8, t9, t10 })
    ),
    { nil: undefined }
  ),
  minCommitteeSize: FastCheck.option(Numeric.Uint16Arbitrary, { nil: undefined }),
  committeeTermLimit: FastCheck.option(Numeric.Uint32Arbitrary, { nil: undefined }),
  governanceActionValidity: FastCheck.option(Numeric.Uint32Arbitrary, { nil: undefined }),
  governanceActionDeposit: FastCheck.option(coinArb, { nil: undefined }),
  drepDeposit: FastCheck.option(coinArb, { nil: undefined }),
  drepInactivityPeriod: FastCheck.option(Numeric.Uint32Arbitrary, { nil: undefined }),
  minfeeRefScriptCoinsPerByte: FastCheck.option(NonnegativeInterval.arbitrary, { nil: undefined })
}).map((r) => new ProtocolParamUpdate(r))
