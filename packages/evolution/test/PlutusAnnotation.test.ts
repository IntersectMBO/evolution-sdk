import { Option, Schema } from "effect"
import { describe, expect, it } from "vitest"

// Import PlutusAnnotation to activate module augmentation
import * as PA from "../src/PlutusAnnotation.js"

describe("PlutusAnnotation", () => {
  describe("annotation symbols", () => {
    it("symbols are globally unique via Symbol.for", () => {
      expect(PA.ConstrIndexId).toBe(Symbol.for("plutus/annotation/ConstrIndex"))
      expect(PA.EncodingId).toBe(Symbol.for("plutus/annotation/Encoding"))
      expect(PA.FlatInUnionId).toBe(Symbol.for("plutus/annotation/FlatInUnion"))
      expect(PA.FlatFieldsId).toBe(Symbol.for("plutus/annotation/FlatFields"))
      expect(PA.TagFieldId).toBe(Symbol.for("plutus/annotation/TagField"))
    })
  })

  describe("attach and read annotations", () => {
    it("ConstrIndex — attach to struct, read back", () => {
      const MyStruct = Schema.Struct({
        amount: Schema.BigIntFromSelf
      }).annotations({ [PA.ConstrIndexId]: 3 })

      const result = PA.getConstrIndex(MyStruct.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe(3)
    })

    it("ConstrIndex — missing returns None", () => {
      const MyStruct = Schema.Struct({
        amount: Schema.BigIntFromSelf
      })

      expect(Option.isNone(PA.getConstrIndex(MyStruct.ast))).toBe(true)
    })

    it("Encoding — attach strategy override", () => {
      const MySchema = Schema.BigIntFromSelf.annotations({
        [PA.EncodingId]: "integer" as const
      })

      const result = PA.getEncoding(MySchema.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe("integer")
    })

    it("FlatInUnion — mark union member as flat", () => {
      const Member = Schema.Struct({
        _tag: Schema.Literal("Mint"),
        amount: Schema.BigIntFromSelf
      }).annotations({ [PA.FlatInUnionId]: true })

      const result = PA.getFlatInUnion(Member.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe(true)
    })

    it("FlatFields — mark struct field as flat", () => {
      const Inner = Schema.Struct({
        x: Schema.BigIntFromSelf
      }).annotations({ [PA.FlatFieldsId]: true })

      const result = PA.getFlatFields(Inner.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe(true)
    })

    it("TagField — set custom tag field name", () => {
      const MyStruct = Schema.Struct({
        kind: Schema.Literal("Mint"),
        amount: Schema.BigIntFromSelf
      }).annotations({ [PA.TagFieldId]: "kind" })

      const result = PA.getTagField(MyStruct.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe("kind")
    })

    it("TagField — explicitly disable with false", () => {
      const MyStruct = Schema.Struct({
        _tag: Schema.Literal("Mint"),
        amount: Schema.BigIntFromSelf
      }).annotations({ [PA.TagFieldId]: false })

      const result = PA.getTagField(MyStruct.ast)
      expect(Option.isSome(result)).toBe(true)
      expect(Option.getOrThrow(result)).toBe(false)
    })
  })

  describe("multiple annotations on same node", () => {
    it("combines ConstrIndex + FlatInUnion + TagField", () => {
      const Member = Schema.Struct({
        _tag: Schema.Literal("PubKey"),
        hash: Schema.Uint8ArrayFromSelf
      }).annotations({
        [PA.ConstrIndexId]: 0,
        [PA.FlatInUnionId]: true,
        [PA.TagFieldId]: "_tag"
      })

      expect(Option.getOrThrow(PA.getConstrIndex(Member.ast))).toBe(0)
      expect(Option.getOrThrow(PA.getFlatInUnion(Member.ast))).toBe(true)
      expect(Option.getOrThrow(PA.getTagField(Member.ast))).toBe("_tag")
    })
  })

  describe("convenience helpers", () => {
    it("constrIndex() produces annotation object", () => {
      const ann = PA.constrIndex(5)
      expect(ann[PA.ConstrIndexId]).toBe(5)
    })

    it("encoding() produces annotation object", () => {
      const ann = PA.encoding("bytes")
      expect(ann[PA.EncodingId]).toBe("bytes")
    })

    it("flatInUnion() produces annotation object", () => {
      const ann = PA.flatInUnion()
      expect(ann[PA.FlatInUnionId]).toBe(true)
    })

    it("flatFields() produces annotation object", () => {
      const ann = PA.flatFields()
      expect(ann[PA.FlatFieldsId]).toBe(true)
    })

    it("tagField() produces annotation object", () => {
      const ann = PA.tagField("kind")
      expect(ann[PA.TagFieldId]).toBe("kind")
    })

    it("convenience helpers work with .annotations()", () => {
      const MyStruct = Schema.Struct({
        amount: Schema.BigIntFromSelf
      }).annotations({
        ...PA.constrIndex(2),
        ...PA.flatInUnion(),
        ...PA.tagField("_tag")
      })

      expect(Option.getOrThrow(PA.getConstrIndex(MyStruct.ast))).toBe(2)
      expect(Option.getOrThrow(PA.getFlatInUnion(MyStruct.ast))).toBe(true)
      expect(Option.getOrThrow(PA.getTagField(MyStruct.ast))).toBe("_tag")
    })
  })

  describe("module augmentation", () => {
    it("annotations with symbol keys flow through to AST", () => {
      // This tests that the module augmentation doesn't break annotation flow.
      // With the augmentation, symbol keys are typed on the Annotations interface,
      // so .annotations() accepts them with proper types.
      const MyStruct = Schema.Struct({
        amount: Schema.BigIntFromSelf
      }).annotations({
        [PA.ConstrIndexId]: 42,
        [PA.FlatInUnionId]: true,
        [PA.EncodingId]: "constr" as PA.PlutusEncoding,
        [PA.FlatFieldsId]: false,
        [PA.TagFieldId]: "_tag"
      })

      // Verify all annotations are readable from the AST
      expect(Option.getOrThrow(PA.getConstrIndex(MyStruct.ast))).toBe(42)
      expect(Option.getOrThrow(PA.getFlatInUnion(MyStruct.ast))).toBe(true)
      expect(Option.getOrThrow(PA.getEncoding(MyStruct.ast))).toBe("constr")
      expect(Option.getOrThrow(PA.getFlatFields(MyStruct.ast))).toBe(false)
      expect(Option.getOrThrow(PA.getTagField(MyStruct.ast))).toBe("_tag")
    })
  })
})
