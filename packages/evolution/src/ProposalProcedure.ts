import { Equal, Hash, Inspectable, ParseResult, Schema } from "effect"

import * as Anchor from "./Anchor.js"
import * as Bytes from "./Bytes.js"
import * as Coin from "./Coin.js"
import * as GovernanceAction from "./GovernanceAction.js"
import * as RewardAccount from "./RewardAccount.js"
import { CborReader } from "./v2/CborReader.js"
import { CborWriter, type EncodingProfile } from "./v2/CborWriter.js"

/**
 * Schema for a single proposal procedure based on Conway CDDL specification.
 *
 * ```
 * proposal_procedure = [
 *   deposit : coin,
 *   reward_account : reward_account,
 *   governance_action : governance_action,
 *   anchor : anchor / null
 * ]
 *
 * governance_action = [action_type, action_data]
 * ```
 *
 * @since 2.0.0
 * @category model
 */
export class ProposalProcedure extends Schema.Class<ProposalProcedure>("ProposalProcedure")({
  deposit: Coin.Coin,
  rewardAccount: RewardAccount.FromBech32,
  governanceAction: GovernanceAction.GovernanceAction,
  anchor: Schema.NullOr(Anchor.Anchor)
}) {
  /**
   * Convert to JSON representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toJSON() {
    return {
      _tag: "ProposalProcedure",
      deposit: this.deposit.toString(),
      rewardAccount: this.rewardAccount,
      governanceAction: this.governanceAction.toJSON ? this.governanceAction.toJSON() : this.governanceAction,
      anchor: this.anchor?.toJSON ? this.anchor.toJSON() : this.anchor
    }
  }

  /**
   * Convert to string representation.
   *
   * @since 2.0.0
   * @category conversions
   */
  toString(): string {
    return Inspectable.format(this.toJSON())
  }

  /**
   * Custom inspect for Node.js REPL.
   *
   * @since 2.0.0
   * @category conversions
   */
  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  /**
   * Structural equality check.
   *
   * @since 2.0.0
   * @category equality
   */
  [Equal.symbol](that: unknown): boolean {
    return (
      that instanceof ProposalProcedure &&
      Equal.equals(this.deposit, that.deposit) &&
      Equal.equals(this.rewardAccount, that.rewardAccount) &&
      Equal.equals(this.governanceAction, that.governanceAction) &&
      Equal.equals(this.anchor, that.anchor)
    )
  }

  /**
   * Hash code generation.
   *
   * @since 2.0.0
   * @category hashing
   */
  [Hash.symbol](): number {
    return Hash.cached(
      this,
      Hash.combine(
        Hash.combine(Hash.combine(Hash.hash(this.deposit))(Hash.hash(this.rewardAccount)))(
          Hash.hash(this.governanceAction)
        )
      )(Hash.hash(this.anchor))
    )
  }
}

// ============================================================================
// Write / Read (CborReader/CborWriter — for composition in parent types)
// ============================================================================

export const write = (w: CborWriter, v: ProposalProcedure): void => {
  w.writeArrayHeader(4)
  w.writeUint(v.deposit)
  RewardAccount.write(w, v.rewardAccount)
  GovernanceAction.write(w, v.governanceAction)
  if (v.anchor) Anchor.write(w, v.anchor); else w.writeNull()
  w.writeArrayBreak()
}

export const read = (r: CborReader): ProposalProcedure => {
  const count = r.readArrayHeader()
  const deposit = r.readUint() as Coin.Coin
  const rewardAccount = RewardAccount.read(r)
  const governanceAction = GovernanceAction.read(r)
  const anchor = r.peekMajorType() === 7 ? (r.readNull(), null) : Anchor.read(r)
  if (count === -1) r.isBreak()
  return new ProposalProcedure({ deposit, rewardAccount, governanceAction, anchor })
}
/**
 * CBOR bytes transformation schema for individual ProposalProcedure.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORBytes = Schema.transformOrFail(
  Schema.Uint8ArrayFromSelf,
  Schema.typeSchema(ProposalProcedure),
  {
    strict: true,
    decode: (bytes, _, ast) => ParseResult.try({
      try: () => read(new CborReader(bytes)),
      catch: (e) => new ParseResult.Type(ast, bytes, e instanceof Error ? e.message : String(e))
    }),
    encode: (_, __, ast) => ParseResult.fail(new ParseResult.Type(ast, _, "Use toCBORBytes instead"))
  }
).annotations({ identifier: "ProposalProcedure.FromCBORBytes" })

/**
 * CBOR hex transformation schema for individual ProposalProcedure.
 *
 * @since 2.0.0
 * @category schemas
 */
export const FromCBORHex = Schema.compose(Schema.Uint8ArrayFromHex, FromCBORBytes)
  .annotations({ identifier: "ProposalProcedure.FromCBORHex" })

// ============================================================================
// Root Functions
// ============================================================================

/**
 * Parse individual ProposalProcedure from CBOR bytes.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORBytes = Schema.decodeSync(FromCBORBytes)

/**
 * Parse individual ProposalProcedure from CBOR hex string.
 *
 * @since 2.0.0
 * @category parsing
 */
export const fromCBORHex = Schema.decodeSync(FromCBORHex)

/**
 * Encode individual ProposalProcedure to CBOR bytes.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORBytes = (procedure: ProposalProcedure, profile?: EncodingProfile): Uint8Array => {
  const w = new CborWriter(128, profile)
  write(w, procedure)
  return w.finishView()
}

/**
 * Encode individual ProposalProcedure to CBOR hex string.
 *
 * @since 2.0.0
 * @category encoding
 */
export const toCBORHex = (procedure: ProposalProcedure, profile?: EncodingProfile): string =>
  Bytes.toHex(toCBORBytes(procedure, profile))
