import { Equal, FastCheck, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Anchor from "./Anchor.js"
import * as Bytes from "./Bytes.js"
import * as Coin from "./Coin.js"
import * as GovernanceAction from "./GovernanceAction.js"
import * as ProposalProcedure from "./ProposalProcedure.js"
import * as RewardAccount from "./RewardAccount.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Helper for array equality using element-by-element comparison.
 */
const arrayEquals = <A>(a: ReadonlyArray<A>, b: ReadonlyArray<A>): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Equal.equals(a[i], b[i])) return false
  }
  return true
}

/**
 * Helper for array hashing using element hashes.
 */
const arrayHash = <A>(arr: ReadonlyArray<A>): number => {
  let hash = 0
  for (const item of arr) {
    hash = Hash.combine(hash)(Hash.hash(item))
  }
  return hash
}

/**
 * ProposalProcedures based on Conway CDDL specification.
 *
 * ```
 * CDDL: proposal_procedures = nonempty_set<proposal_procedure>
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class ProposalProcedures extends Schema.TaggedClass<ProposalProcedures>()("ProposalProcedures", {
  procedures: Schema.Array(ProposalProcedure.ProposalProcedure).pipe(
    Schema.filter((arr) => arr.length > 0, {
      message: () => "ProposalProcedures must contain at least one procedure"
    })
  )
}) {
  toJSON() {
    return {
      _tag: "ProposalProcedures" as const,
      procedures: this.procedures.map((p) => p.toJSON())
    }
  }

  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof ProposalProcedures && arrayEquals(this.procedures, that.procedures)
  }

  [Hash.symbol](): number {
    return Hash.cached(this, arrayHash(this.procedures))
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: ProposalProcedures): void => {
  w.writeArrayHeader(v.procedures.length)
  for (const p of v.procedures) ProposalProcedure.write(w, p)
  w.writeArrayBreak()
}

export const read = (r: CborReader): ProposalProcedures => {
  const count = r.readArrayHeader()
  const procedures: Array<ProposalProcedure.ProposalProcedure> = []
  if (count === -1) { while (!r.isBreak()) procedures.push(ProposalProcedure.read(r)) }
  else { for (let i = 0; i < count; i++) procedures.push(ProposalProcedure.read(r)) }
  return new ProposalProcedures({ procedures })
}

/**
 * CBOR bytes transformation schema for ProposalProcedures.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(ProposalProcedures),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "ProposalProcedures.FromCBORBytes" })

/**
 * CBOR hex transformation schema for ProposalProcedures.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "ProposalProcedures.FromCBORHex" })

/**
 * FastCheck arbitrary for ProposalProcedures.
 *
 * @since 2.0.0
 * @category arbitrary
 */
export const arbitrary = FastCheck.record({
  procedures: FastCheck.array(
    FastCheck.record({
      deposit: Coin.arbitrary,
      rewardAccount: RewardAccount.arbitrary,
      governanceAction: GovernanceAction.arbitrary,
      anchor: FastCheck.option(Anchor.arbitrary, { nil: null })
    }).map((params) => new ProposalProcedure.ProposalProcedure(params)),
    { minLength: 1, maxLength: 5 }
  )
}).map((params) => new ProposalProcedures(params))

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse ProposalProcedures from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse ProposalProcedures from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode ProposalProcedures to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (data: ProposalProcedures, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(256, profile)
  write(w, data)
  return w.finishView()
}

/**
 * Encode ProposalProcedures to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (data: ProposalProcedures, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(data, profile))

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create ProposalProcedures for a single proposal.
 *
 * Convenience function for the common case of submitting one governance action.
 *
 * @since 2.0.0
 * @category helpers
 */
export const single = (
  deposit: Coin.Coin,
  rewardAccount: RewardAccount.RewardAccount,
  governanceAction: GovernanceAction.GovernanceAction,
  anchor: Anchor.Anchor | null
): ProposalProcedures => {
  return new ProposalProcedures({
    procedures: [
      new ProposalProcedure.ProposalProcedure({
        deposit,
        rewardAccount,
        governanceAction,
        anchor
      })
    ]
  })
}
