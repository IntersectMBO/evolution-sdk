import { Equal, FastCheck, Hash, Inspectable, Schema } from "effect"

import * as Natural from "./Natural.js"
import type { CborReader } from "./v2/CborReader.js"
import type { CborWriter } from "./v2/CborWriter.js"

/**
 * Schema for pointer to a stake registration certificate
 * Contains slot, transaction index, and certificate index information
 *
 * @since 2.0.0
 * @category schemas
 */
export class Pointer extends Schema.TaggedClass<Pointer>("Pointer")("Pointer", {
  slot: Natural.Natural,
  txIndex: Natural.Natural,
  certIndex: Natural.Natural
}) {
  toJSON() {
    return {
      _tag: "Pointer" as const,
      slot: this.slot,
      txIndex: this.txIndex,
      certIndex: this.certIndex
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
      that instanceof Pointer &&
      Equal.equals(this.slot, that.slot) &&
      Equal.equals(this.txIndex, that.txIndex) &&
      Equal.equals(this.certIndex, that.certIndex)
    )
  }

  [Hash.symbol](): number {
    return Hash.combine(Hash.hash(this.slot))(Hash.combine(Hash.hash(this.txIndex))(Hash.hash(this.certIndex)))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: Pointer): void => {
  w.writeArrayHeader(3)
  w.writeUint(BigInt(v.slot))
  w.writeUint(BigInt(v.txIndex))
  w.writeUint(BigInt(v.certIndex))
  w.writeArrayBreak()
}

export const read = (r: CborReader): Pointer => {
  const count = r.readArrayHeader()
  const pointer = new Pointer({
    slot: Number(r.readUint()),
    txIndex: Number(r.readUint()),
    certIndex: Number(r.readUint())
  })
  if (count === -1) r.isBreak()
  return pointer
}

/**
 * Check if the given value is a valid Pointer
 *
 *
 * @since 2.0.0
 * @category predicates
 */
export const isPointer = Schema.is(Pointer)

/**
 * FastCheck arbitrary for generating random Pointer instances
 *
 * @since 2.0.0
 * @category generators
 */
export const arbitrary = FastCheck.tuple(Natural.arbitrary, Natural.arbitrary, Natural.arbitrary).map(
  ([slot, txIndex, certIndex]) => new Pointer({ slot, txIndex, certIndex })
)
