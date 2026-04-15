/**
 * Phase 10: Real-World Validation
 *
 * Re-implements existing Cardano types using Plutus.data() and verifies
 * CBOR output matches byte-for-byte with existing TSchema versions.
 */
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import * as Data from "../src/Data.js"
import * as PA from "../src/PlutusAnnotation.js"
import * as Plutus from "../src/PlutusSchema.js"
import * as TSchema from "../src/TSchema.js"

// Existing TSchema modules for byte-for-byte comparison
import * as ExistingAddress from "../src/plutus/Address.js"
import * as ExistingCIP68 from "../src/plutus/CIP68Metadata.js"
import * as ExistingCredential from "../src/plutus/Credential.js"
import * as ExistingOutputRef from "../src/plutus/OutputReference.js"
import * as ExistingValue from "../src/plutus/Value.js"

// ============================================================
// Re-implementations using Plutus.data()
// ============================================================

// --- OutputReference ---

const TransactionId_v2 = Schema.Uint8ArrayFromSelf

const OutputReference_v2 = Plutus.data(Schema.Struct({
  transaction_id: Schema.Uint8ArrayFromSelf,
  output_index: Schema.BigIntFromSelf
}))

// --- Credential ---

const Credential_v2 = Plutus.data(Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("VerificationKey"), hash: Schema.Uint8ArrayFromSelf })
    .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
  Schema.Struct({ _tag: Schema.Literal("Script"), hash: Schema.Uint8ArrayFromSelf })
    .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
))

// PaymentCredential is same structure as Credential
const PaymentCredential_v2 = Plutus.data(Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("VerificationKey"), hash: Schema.Uint8ArrayFromSelf })
    .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
  Schema.Struct({ _tag: Schema.Literal("Script"), hash: Schema.Uint8ArrayFromSelf })
    .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
))

const StakeCredential_v2 = Plutus.data(Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Inline"), credential: Credential_v2 })
    .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
  Schema.Struct({
    _tag: Schema.Literal("Pointer"),
    slot_number: Schema.BigIntFromSelf,
    transaction_index: Schema.BigIntFromSelf,
    certificate_index: Schema.BigIntFromSelf
  })
    .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
))

// --- Address ---
// Address uses existing TSchema types for credential fields since
// Plutus.data() can mix with TSchema via the Transformation handler.
// But for pure Plutus.data() we use the v2 credential schemas.

const Address_v2 = Plutus.data(Schema.Struct({
  payment_credential: PaymentCredential_v2,
  stake_credential: Schema.UndefinedOr(StakeCredential_v2)
}))

// ============================================================
// Validation Tests
// ============================================================

describe("real-world validation", () => {
  // ============================================================
  // OutputReference
  // ============================================================

  describe("OutputReference", () => {
    const txId = new Uint8Array(32).fill(0xab)

    it("matches TSchema CBOR for basic output reference", () => {
      const input = { transaction_id: txId, output_index: 0n }

      const existingCbor = ExistingOutputRef.Codec.toCBORHex(input)
      const v2Codec = Plutus.codec(OutputReference_v2)
      const v2Cbor = v2Codec.toCBORHex(input)

      expect(v2Cbor).toBe(existingCbor)
    })

    it("matches TSchema CBOR for output reference with large index", () => {
      const input = { transaction_id: txId, output_index: 999n }

      const existingCbor = ExistingOutputRef.Codec.toCBORHex(input)
      const v2Cbor = Plutus.codec(OutputReference_v2).toCBORHex(input)

      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips correctly", () => {
      const input = { transaction_id: txId, output_index: 42n }
      const codec = Plutus.codec(OutputReference_v2)

      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded.transaction_id).toEqual(txId)
      expect(decoded.output_index).toBe(42n)
    })

    it("migration example: TSchema → Plutus.data()", () => {
      // BEFORE (TSchema):
      // const OutputReference = TSchema.Struct({
      //   transaction_id: TSchema.ByteArray,
      //   output_index: TSchema.Integer
      // })

      // AFTER (Plutus.data):
      // const OutputReference = Plutus.data(Schema.Struct({
      //   transaction_id: Schema.Uint8ArrayFromSelf,
      //   output_index: Schema.BigIntFromSelf
      // }))

      // Both produce identical CBOR
      const input = { transaction_id: txId, output_index: 5n }
      expect(Plutus.codec(OutputReference_v2).toCBORHex(input))
        .toBe(ExistingOutputRef.Codec.toCBORHex(input))
    })
  })

  // ============================================================
  // Credential
  // ============================================================

  describe("Credential", () => {
    const hash28 = new Uint8Array(28).fill(0xcd)

    it("matches TSchema CBOR for VerificationKey credential", () => {
      const tschemaInput = { VerificationKey: { hash: hash28 } }
      const v2Input = { _tag: "VerificationKey" as const, hash: hash28 }

      const existingCbor = ExistingCredential.CredentialCodec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(Credential_v2).toCBORHex(v2Input)

      expect(v2Cbor).toBe(existingCbor)
    })

    it("matches TSchema CBOR for Script credential", () => {
      const tschemaInput = { Script: { hash: hash28 } }
      const v2Input = { _tag: "Script" as const, hash: hash28 }

      const existingCbor = ExistingCredential.CredentialCodec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(Credential_v2).toCBORHex(v2Input)

      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips VerificationKey correctly", () => {
      const codec = Plutus.codec(Credential_v2)
      const input = { _tag: "VerificationKey" as const, hash: hash28 }

      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded._tag).toBe("VerificationKey")
      expect(decoded.hash).toEqual(hash28)
    })

    it("roundtrips Script correctly", () => {
      const codec = Plutus.codec(Credential_v2)
      const input = { _tag: "Script" as const, hash: hash28 }

      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded._tag).toBe("Script")
      expect(decoded.hash).toEqual(hash28)
    })

    it("migration example: TSchema.Variant → Plutus.data(Schema.Union(...))", () => {
      // BEFORE (TSchema):
      // const Credential = TSchema.Variant({
      //   VerificationKey: { hash: TSchema.ByteArray },
      //   Script: { hash: TSchema.ByteArray }
      // })
      // Usage: { VerificationKey: { hash: bytes } }

      // AFTER (Plutus.data with annotations):
      // const Credential = Plutus.data(Schema.Union(
      //   Schema.Struct({ _tag: Schema.Literal("VerificationKey"), hash: Schema.Uint8ArrayFromSelf })
      //     .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
      //   Schema.Struct({ _tag: Schema.Literal("Script"), hash: Schema.Uint8ArrayFromSelf })
      //     .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
      // ))
      // Usage: { _tag: "VerificationKey", hash: bytes }

      // Note: API style differs (Variant uses {Name: {fields}} wrapper,
      // annotated union uses {_tag: "Name", ...fields} discriminated union)
      // but CBOR encoding is identical
    })
  })

  // ============================================================
  // StakeCredential
  // ============================================================

  describe("StakeCredential", () => {
    const hash28 = new Uint8Array(28).fill(0xef)

    it("matches TSchema CBOR for Inline stake credential", () => {
      // TSchema Variant: { Inline: { credential: { VerificationKey: { hash } } } }
      const tschemaInput = {
        Inline: {
          credential: { VerificationKey: { hash: hash28 } }
        }
      }
      // Plutus.data: { _tag: "Inline", credential: { _tag: "VerificationKey", hash } }
      const v2Input = {
        _tag: "Inline" as const,
        credential: { _tag: "VerificationKey" as const, hash: hash28 }
      }

      const existingCbor = ExistingCredential.StakeCredentialCodec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(StakeCredential_v2).toCBORHex(v2Input)

      expect(v2Cbor).toBe(existingCbor)
    })

    it("matches TSchema CBOR for Pointer stake credential", () => {
      const tschemaInput = {
        Pointer: {
          slot_number: 100n,
          transaction_index: 5n,
          certificate_index: 2n
        }
      }
      const v2Input = {
        _tag: "Pointer" as const,
        slot_number: 100n,
        transaction_index: 5n,
        certificate_index: 2n
      }

      const existingCbor = ExistingCredential.StakeCredentialCodec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(StakeCredential_v2).toCBORHex(v2Input)

      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips Pointer correctly", () => {
      const codec = Plutus.codec(StakeCredential_v2)
      const input = {
        _tag: "Pointer" as const,
        slot_number: 100n,
        transaction_index: 5n,
        certificate_index: 2n
      }

      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded._tag).toBe("Pointer")
      expect(decoded.slot_number).toBe(100n)
      expect(decoded.transaction_index).toBe(5n)
      expect(decoded.certificate_index).toBe(2n)
    })
  })

  // ============================================================
  // Address
  // ============================================================

  describe("Address", () => {
    const payHash = new Uint8Array(28).fill(0x11)
    const stakeHash = new Uint8Array(28).fill(0x22)

    it("matches TSchema CBOR for address without stake credential", () => {
      const tschemaInput = {
        payment_credential: { VerificationKey: { hash: payHash } },
        stake_credential: undefined
      }
      const v2Input = {
        payment_credential: { _tag: "VerificationKey" as const, hash: payHash },
        stake_credential: undefined
      }

      const existingCbor = ExistingAddress.Codec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(Address_v2).toCBORHex(v2Input)

      expect(v2Cbor).toBe(existingCbor)
    })

    it("matches TSchema CBOR for address with inline stake credential", () => {
      const tschemaInput = {
        payment_credential: { VerificationKey: { hash: payHash } },
        stake_credential: {
          Inline: {
            credential: { VerificationKey: { hash: stakeHash } }
          }
        }
      }
      const v2Input = {
        payment_credential: { _tag: "VerificationKey" as const, hash: payHash },
        stake_credential: {
          _tag: "Inline" as const,
          credential: { _tag: "VerificationKey" as const, hash: stakeHash }
        }
      }

      const existingCbor = ExistingAddress.Codec.toCBORHex(tschemaInput)
      const v2Cbor = Plutus.codec(Address_v2).toCBORHex(v2Input)

      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips address with stake credential", () => {
      const codec = Plutus.codec(Address_v2)
      const input = {
        payment_credential: { _tag: "Script" as const, hash: payHash },
        stake_credential: {
          _tag: "Pointer" as const,
          slot_number: 10n,
          transaction_index: 1n,
          certificate_index: 0n
        }
      }

      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded.payment_credential._tag).toBe("Script")
      expect(decoded.payment_credential.hash).toEqual(payHash)
      expect(decoded.stake_credential!._tag).toBe("Pointer")
      expect(decoded.stake_credential!.slot_number).toBe(10n)
    })

    it("migration example: TSchema.Struct + TSchema.UndefinedOr → Plutus.data()", () => {
      // BEFORE (TSchema):
      // const Address = TSchema.Struct({
      //   payment_credential: Credential.PaymentCredential,
      //   stake_credential: TSchema.UndefinedOr(Credential.StakeCredential)
      // })

      // AFTER (Plutus.data):
      // const Address = Plutus.data(Schema.Struct({
      //   payment_credential: PaymentCredential_v2,
      //   stake_credential: Schema.UndefinedOr(StakeCredential_v2)
      // }))

      // Identical CBOR output
    })
  })

  // ============================================================
  // Value (uses Map — TSchema only, documented limitation)
  // ============================================================

  describe("Value (Map limitation)", () => {
    it("Value uses TSchema.Map — not expressible via Plutus.data()", () => {
      // This is a documented Phase 9 limitation.
      // Value = Map<PolicyId, Map<AssetName, Integer>>
      // Plutus.data() doesn't auto-derive Map encoding.
      // Use TSchema.Map directly:

      const Value = Plutus.Map(Plutus.ByteArray, Plutus.Map(Plutus.ByteArray, Plutus.Integer))
      const codec = Plutus.codec(Value)

      const policyId = new Uint8Array(28).fill(0xaa)
      const assetName = new Uint8Array([0x41, 0x42, 0x43]) // "ABC"

      const input = new Map([
        [policyId, new Map([[assetName, 1000n]])]
      ])

      const cbor = codec.toCBORHex(input)
      const decoded = codec.fromCBORHex(cbor)

      // Verify structure
      const entries = [...decoded.entries()]
      expect(entries).toHaveLength(1)
      const innerEntries = [...(entries[0][1] as Map<any, any>).entries()]
      expect(innerEntries[0][1]).toBe(1000n)
    })

    it("Value CBOR matches existing TSchema version", () => {
      const policyId = new Uint8Array(28).fill(0xbb)
      const assetName = new Uint8Array([0x44])

      const input = new Map([
        [policyId, new Map([[assetName, 500n]])]
      ])

      const existingCbor = ExistingValue.Codec.toCBORHex(input)
      const v2Value = Plutus.Map(Plutus.ByteArray, Plutus.Map(Plutus.ByteArray, Plutus.Integer))
      const v2Cbor = Plutus.codec(v2Value).toCBORHex(input)

      expect(v2Cbor).toBe(existingCbor)
    })
  })

  // ============================================================
  // CIP68 Metadata
  // ============================================================

  describe("CIP68Metadata", () => {
    it("matches TSchema CBOR for simple CIP68 datum", () => {
      // CIP68Datum = Constr(0, [metadata, version, extra])
      // where metadata is opaque PlutusData, version is Integer, extra is Array<PlutusData>

      // Using TSchema directly (can't fully express opaque Data with Plutus.data)
      const CIP68_v2 = Plutus.data(Schema.Struct({
        metadata: Schema.Unknown,
        version: Schema.BigIntFromSelf,
        extra: Schema.Array(Schema.Unknown)
      }))

      const input = { metadata: 42n, version: 1n, extra: [] as unknown[] }

      const existingCbor = ExistingCIP68.Codec.toCBORHex(input)
      const v2Cbor = Plutus.codec(CIP68_v2).toCBORHex(input)

      expect(v2Cbor).toBe(existingCbor)
    })

    it("roundtrips CIP68 datum with metadata map", () => {
      const CIP68_v2 = Plutus.data(Schema.Struct({
        metadata: Schema.Unknown,
        version: Schema.BigIntFromSelf,
        extra: Schema.Array(Schema.Unknown)
      }))

      const codec = Plutus.codec(CIP68_v2)

      // Metadata as a simple bigint
      const input = { metadata: 100n, version: 2n, extra: [1n, 2n] }
      const decoded = codec.fromCBORHex(codec.toCBORHex(input))
      expect(decoded.version).toBe(2n)
    })
  })

  // ============================================================
  // Migration Summary
  // ============================================================

  describe("migration patterns summary", () => {
    it("TSchema.ByteArray → Schema.Uint8ArrayFromSelf", () => {
      // BEFORE: const Hash = TSchema.ByteArray
      // AFTER:  field type is Schema.Uint8ArrayFromSelf inside Plutus.data()
      // For standalone use: Plutus.ByteArray (re-export of TSchema.ByteArray)
    })

    it("TSchema.Integer → Schema.BigIntFromSelf", () => {
      // BEFORE: const Amount = TSchema.Integer
      // AFTER:  field type is Schema.BigIntFromSelf inside Plutus.data()
    })

    it("TSchema.Struct → Plutus.data(Schema.Struct(...))", () => {
      // BEFORE: TSchema.Struct({ field: TSchema.Integer })
      // AFTER:  Plutus.data(Schema.Struct({ field: Schema.BigIntFromSelf }))
    })

    it("TSchema.Variant → Plutus.data(Schema.Union(...)) with annotations", () => {
      // BEFORE: TSchema.Variant({ A: { x: TSchema.Integer }, B: { y: TSchema.ByteArray } })
      // AFTER:  Plutus.data(Schema.Union(
      //   Schema.Struct({ _tag: Schema.Literal("A"), x: Schema.BigIntFromSelf })
      //     .annotations({ [PA.ConstrIndexId]: 0, [PA.FlatInUnionId]: true }),
      //   Schema.Struct({ _tag: Schema.Literal("B"), y: Schema.Uint8ArrayFromSelf })
      //     .annotations({ [PA.ConstrIndexId]: 1, [PA.FlatInUnionId]: true })
      // ))
      // Note: API style changes from { A: { fields } } to { _tag: "A", ...fields }
    })

    it("TSchema.UndefinedOr → Schema.UndefinedOr inside Plutus.data()", () => {
      // BEFORE: TSchema.UndefinedOr(SomeSchema)
      // AFTER:  Schema.UndefinedOr(SomeSchemaV2) inside Plutus.data()
    })

    it("TSchema.Map → Plutus.Map (no change, use directly)", () => {
      // BEFORE: TSchema.Map(TSchema.ByteArray, TSchema.Integer)
      // AFTER:  Plutus.Map(Plutus.ByteArray, Plutus.Integer)
      // Map is not auto-derived, use the combinator directly
    })
  })
})
