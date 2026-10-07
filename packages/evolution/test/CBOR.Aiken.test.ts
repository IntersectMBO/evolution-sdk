import { describe, expect, it } from "vitest"

import * as Bytes from "../src/Bytes.js"
import * as CBOR from "../src/CBOR.js"
import * as Data from "../src/Data.js"
import * as Text from "../src/Text.js"
import * as TSchema from "../src/TSchema.js"

describe("Aiken CBOR Encoding Compatibility", () => {
  // Test #1: encode_int_small
  it("encode_int_small: should encode 42", () => {
    const value = 42n
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("182a")
  })

  // Test #2: encode_int_zero
  it("encode_int_zero: should encode 0", () => {
    const value = 0n
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("00")
  })

  // Test #3: encode_int_negative
  it("encode_int_negative: should encode -1", () => {
    const value = -1n
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("20")
  })

  // Test #4: encode_int_large
  it("encode_int_large: should encode 1000000", () => {
    const value = 1000000n
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("1a000f4240")
  })

  // Test #5: encode_bytearray_empty
  it("encode_bytearray_empty: should encode empty bytearray", () => {
    const value = new Uint8Array([])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("40")
  })

  // Test #6: encode_bytearray_small
  it("encode_bytearray_small: should encode small bytearray", () => {
    const value = Bytes.fromHex("a1b2")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("42a1b2")
  })

  // Test #7: encode_bytearray_long
  it("encode_bytearray_long: should encode longer bytearray", () => {
    const value = Bytes.fromHex("deadbeef")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("44deadbeef")
  })

  // Test #8: encode_list_empty
  it("encode_list_empty: should encode empty list", () => {
    const value = Data.list([])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("80")
  })

  // Test #9: encode_list_single
  it("encode_list_single: should encode single element list", () => {
    const value = Data.list([1n])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f01ff")
  })

  // Test #10: encode_list_multiple
  it("encode_list_multiple: should encode multiple element list", () => {
    const value = Data.list([1n, 2n, 3n])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f010203ff")
  })

  // Test #11: encode_list_nested
  it("encode_list_nested: should encode nested lists", () => {
    const value = Data.list([Data.list([1n, 2n]), Data.list([3n, 4n])])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f9f0102ff9f0304ffff")
  })

  // Test #12: encode_pair_ints
  it("encode_pair_ints: should encode pair of ints", () => {
    const value = Data.list([1n, 2n])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f0102ff")
  })

  // Test #13: encode_pair_mixed
  it("encode_pair_mixed: should encode mixed pair", () => {
    const value = Data.list([1n, Bytes.fromHex("ff")])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f0141ffff")
  })

  // Test #14: encode_triple
  it("encode_triple: should encode triple", () => {
    const value = Data.list([1n, Bytes.fromHex("ff"), 3n])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f0141ff03ff")
  })

  // Test #15: encode_nested_pairs
  it("encode_nested_pairs: should encode nested pairs", () => {
    const value = Data.list([Data.list([1n, 2n]), Data.list([3n, 4n])])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f9f0102ff9f0304ffff")
  })

  // Test #16: encode_tuples_empty
  it("encode_tuples_empty: should encode empty list of tuples", () => {
    const value = Data.list([])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("80")
  })

  // Test #17: encode_tuples_single_entry
  it("encode_tuples_single_entry: should encode [(1, #ff)] as a list of lists", () => {
    const value = Data.list([Data.list([1n, Bytes.fromHex("ff")])])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f9f0141ffffff")
  })

  // Test #18: encode_tuples_multiple_entries
  it("encode_tuples_multiple_entries: should encode list of tuples with multiple entries", () => {
    const value = Data.list([
      Data.list([Bytes.fromHex("01"), 1n]),
      Data.list([Bytes.fromHex("02"), 2n]),
      Data.list([Bytes.fromHex("03"), 3n])
    ])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f9f410101ff9f410202ff9f410303ffff")
  })

  // Test #19: encode_tuples_int_keys
  it("encode_tuples_int_keys: should encode list of tuples with int keys", () => {
    const value = Data.list([Data.list([1n, 100n]), Data.list([2n, 200n])])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f9f011864ff9f0218c8ffff")
  })

  // encode_pairs_single: Aiken Pairs encode as a definite-length CBOR map
  it("encode_pairs_single: should encode [Pair(1, #ff)] as a definite map", () => {
    const value = Data.map([[1n, Bytes.fromHex("ff")]])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("a10141ff")
  })

  // encode_pairs_empty
  it("encode_pairs_empty: should encode empty Pairs as an empty map", () => {
    const value = Data.map([])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("a0")
  })

  // Test #20: encode_option_some
  it("encode_option_some: should encode Some(42)", () => {
    const OptionInt = TSchema.UndefinedOr(TSchema.Integer)
    const value = Data.withSchema(OptionInt).toData(42n)
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f182aff")
  })

  // Test #21: encode_option_none
  it("encode_option_none: should encode None", () => {
    const OptionInt = TSchema.UndefinedOr(TSchema.Integer)
    const value = Data.withSchema(OptionInt).toData(undefined)
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d87a80")
  })

  // Test #22: encode_option_some_bytearray
  it("encode_option_some_bytearray: should encode Some(bytearray)", () => {
    const OptionBytes = TSchema.UndefinedOr(TSchema.ByteArray)
    const value = Data.withSchema(OptionBytes).toData(Bytes.fromHex("deadbeef"))
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f44deadbeefff")
  })

  // Test #23: encode_option_nested_some
  it("encode_option_nested_some: should encode Some(Some(42))", () => {
    const OptionInt = TSchema.UndefinedOr(TSchema.Integer)
    const OptionOption = TSchema.UndefinedOr(OptionInt)
    const value = Data.withSchema(OptionOption).toData(42n)
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799fd8799f182affff")
  })

  // Test #24: encode_custom_constructor_0
  it("encode_custom_constructor_0: should encode Variant0", () => {
    const SimpleEnum = TSchema.Literal("Variant0", "Variant1", "Variant2")
    const value = Data.withSchema(SimpleEnum).toData("Variant0")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d87980")
  })

  // Test #25: encode_custom_constructor_1
  it("encode_custom_constructor_1: should encode Variant1", () => {
    const SimpleEnum = TSchema.Literal("Variant0", "Variant1", "Variant2")
    const value = Data.withSchema(SimpleEnum).toData("Variant1")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d87a80")
  })

  // Test #26: encode_custom_constructor_2
  it("encode_custom_constructor_2: should encode Variant2", () => {
    const SimpleEnum = TSchema.Literal("Variant0", "Variant1", "Variant2")
    const value = Data.withSchema(SimpleEnum).toData("Variant2")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d87b80")
  })

  // Test #27: encode_constructor_with_one_field
  it("encode_constructor_with_one_field: should encode Single(42)", () => {
    const Single = TSchema.Struct({ value: TSchema.Integer })
    const value = Data.withSchema(Single).toData({ value: 42n })
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f182aff")
  })

  // Test #28: encode_pair_tuple
  it("encode_pair_tuple: should encode pair tuple (1, #ff)", () => {
    const value = Data.list([1n, Bytes.fromHex("ff")])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f0141ffff")
  })

  // Test #29: encode_constructor_with_three_fields
  it("encode_constructor_with_three_fields: should encode Triple(1, 2, 3)", () => {
    // Approach 1: Using Union with explicit indices
    const WithFieldsUnion = TSchema.Union(
      TSchema.Struct({ value: TSchema.Integer }, { flatInUnion: true, index: 0 }), // Single - index 0
      TSchema.Struct({ a: TSchema.Integer, b: TSchema.Integer, c: TSchema.Integer }, { flatInUnion: true, index: 1 }) // Triple - index 1
    )
    const valueUnion = Data.withSchema(WithFieldsUnion).toData({ a: 1n, b: 2n, c: 3n })
    const encodedUnion = Data.toCBORHex(valueUnion, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encodedUnion).toBe("d87a9f010203ff")

    // Approach 2: Using discriminated union with TaggedStruct
    const Single = TSchema.TaggedStruct("Single", { value: TSchema.Integer }, { flatInUnion: true, index: 0 })
    const Triple = TSchema.TaggedStruct(
      "Triple",
      { a: TSchema.Integer, b: TSchema.Integer, c: TSchema.Integer },
      { flatInUnion: true, index: 1 }
    )
    const WithFieldsTagged = TSchema.Union(Single, Triple)

    const valueTagged = Data.withSchema(WithFieldsTagged).toData({ _tag: "Triple" as const, a: 1n, b: 2n, c: 3n })
    const encodedTagged = Data.toCBORHex(valueTagged, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encodedTagged).toBe("d87a9f010203ff")

    // Approach 3: Using Variant helper
    const WithFieldsVariant = TSchema.Variant({
      Single: { value: TSchema.Integer },
      Triple: { a: TSchema.Integer, b: TSchema.Integer, c: TSchema.Integer }
    })
    const valueVariant = Data.withSchema(WithFieldsVariant).toData({ Triple: { a: 1n, b: 2n, c: 3n } })
    const encodedVariant = Data.toCBORHex(valueVariant, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encodedVariant).toBe("d87a9f010203ff")

    // Approach 4: Using Struct with flatInUnion option directly (equivalent to Variant)
    // This shows that Variant is just syntactic sugar over Struct with flatInUnion and flatFields
    const WithFieldsStructOnly = TSchema.Union(
      TSchema.Struct(
        { Single: TSchema.Struct({ value: TSchema.Integer }, { flatFields: true }) },
        { flatInUnion: true, index: 0 }
      ),
      TSchema.Struct(
        {
          Triple: TSchema.Struct({ a: TSchema.Integer, b: TSchema.Integer, c: TSchema.Integer }, { flatFields: true })
        },
        { flatInUnion: true, index: 1 }
      )
    )

    // Test both Single and Triple variants
    const valueSingleStructOnly = Data.withSchema(WithFieldsStructOnly).toData({ Single: { value: 999n } })
    const encodedSingleStructOnly = Data.toCBORHex(valueSingleStructOnly, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encodedSingleStructOnly).toBe("d8799f1903e7ff") // Single(999)

    const valueTripleStructOnly = Data.withSchema(WithFieldsStructOnly).toData({ Triple: { a: 1n, b: 2n, c: 3n } })
    const encodedTripleStructOnly = Data.toCBORHex(valueTripleStructOnly, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encodedTripleStructOnly).toBe("d87a9f010203ff")

    // Verify all approaches produce identical CBOR for Triple
    expect(encodedUnion).toBe(encodedTagged)
    expect(encodedTagged).toBe(encodedVariant)
    expect(encodedVariant).toBe(encodedTripleStructOnly)
  })

  // Test #30: encode_list_of_lists_of_ints
  it("encode_list_of_lists_of_ints: should encode nested list of lists", () => {
    const value = Data.list([Data.list([1n, 2n]), Data.list([3n, 4n]), Data.list([5n, 6n])])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f9f0102ff9f0304ff9f0506ffff")
  })

  // Test #31: encode_list_of_bytearrays
  it("encode_list_of_bytearrays: should encode list of bytearrays", () => {
    const value = Data.list([Bytes.fromHex("aa"), Bytes.fromHex("bb"), Bytes.fromHex("cc")])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f41aa41bb41ccff")
  })

  // Test #32: encode_nested_options
  it("encode_nested_options: should encode Some(Some(Some(1)))", () => {
    const OptionInt = TSchema.UndefinedOr(TSchema.Integer)
    const OptionOption = TSchema.UndefinedOr(OptionInt)
    const OptionOptionOption = TSchema.UndefinedOr(OptionOption)
    const value = Data.withSchema(OptionOptionOption).toData(1n)
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799fd8799fd8799f01ffffff")
  })

  // Test #33: encode_list_of_options
  it("encode_list_of_options: should encode list of options", () => {
    const OptionInt = TSchema.UndefinedOr(TSchema.Integer)
    const some1 = Data.withSchema(OptionInt).toData(1n)
    const none = Data.withSchema(OptionInt).toData(undefined)
    const some2 = Data.withSchema(OptionInt).toData(2n)
    const value = Data.list([some1, none, some2])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9fd8799f01ffd87a80d8799f02ffff")
  })

  // Test #34: encode_option_of_list
  it("encode_option_of_list: should encode Some([1, 2, 3])", () => {
    const ListInt = TSchema.Array(TSchema.Integer)
    const OptionListInt = TSchema.UndefinedOr(ListInt)
    const value = Data.withSchema(OptionListInt).toData([1n, 2n, 3n])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f9f010203ffff")
  })

  // Test #35: encode_tuples_with_option_values
  it("encode_tuples_with_option_values: should encode list of tuples with option values", () => {
    const OptionInt = TSchema.UndefinedOr(TSchema.Integer)
    const some100 = Data.withSchema(OptionInt).toData(100n)
    const none = Data.withSchema(OptionInt).toData(undefined)
    const value = Data.list([Data.list([1n, some100]), Data.list([2n, none])])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f9f01d8799f1864ffff9f02d87a80ffff")
  })

  // Test #36: encode_tuples_nested_as_value
  it("encode_tuples_nested_as_value: should encode list of tuples with a nested list of tuples", () => {
    const inner = Data.list([Data.list([2n, 3n])])
    const value = Data.list([Data.list([1n, inner])])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f9f019f9f0203ffffffff")
  })

  // Test #37: encode_empty_nested_lists
  it("encode_empty_nested_lists: should encode [[], [], []]", () => {
    const value = Data.list([Data.list([]), Data.list([]), Data.list([])])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f808080ff")
  })

  // Test #38: encode_deeply_nested_list
  it("encode_deeply_nested_list: should encode [[[1]]]", () => {
    const value = Data.list([Data.list([Data.list([1n])])])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9f9f9f01ffffff")
  })

  // Test #39: encode_constructor_with_list_field
  it("encode_constructor_with_list_field: should encode Container([1, 2, 3])", () => {
    const Container = TSchema.Struct({ items: TSchema.Array(TSchema.Integer) })
    const value = Data.withSchema(Container).toData({ items: [1n, 2n, 3n] })
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f9f010203ffff")
  })

  // Test #40: encode_constructor_with_option_field
  it("encode_constructor_with_option_field: should encode Wrapper(Some(42))", () => {
    const Wrapper = TSchema.Struct({ opt: TSchema.UndefinedOr(TSchema.Integer) })
    const value = Data.withSchema(Wrapper).toData({ opt: 42n })
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799fd8799f182affff")
  })

  // Test #41: encode_constructor_with_bytearray_field
  it("encode_constructor_with_bytearray_field: should encode Holder(#deadbeef)", () => {
    const Holder = TSchema.Struct({ data: TSchema.ByteArray })
    const value = Data.withSchema(Holder).toData({ data: Bytes.fromHex("deadbeef") })
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f44deadbeefff")
  })

  // Test #42: encode_tuple_with_nested_constructor
  it("encode_tuple_with_nested_constructor: should encode (Some(1), Some(2))", () => {
    const OptionInt = TSchema.UndefinedOr(TSchema.Integer)
    const some1 = Data.withSchema(OptionInt).toData(1n)
    const some2 = Data.withSchema(OptionInt).toData(2n)
    const value = Data.list([some1, some2])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9fd8799f01ffd8799f02ffff")
  })

  // Test #43: encode_list_all_same_constructor
  it("encode_list_all_same_constructor: should encode [Variant0, Variant0, Variant0]", () => {
    const SimpleEnum = TSchema.Literal("Variant0", "Variant1", "Variant2")
    const v0_1 = Data.withSchema(SimpleEnum).toData("Variant0")
    const v0_2 = Data.withSchema(SimpleEnum).toData("Variant0")
    const v0_3 = Data.withSchema(SimpleEnum).toData("Variant0")
    const value = Data.list([v0_1, v0_2, v0_3])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9fd87980d87980d87980ff")
  })

  // Test #44: encode_list_mixed_constructors
  it("encode_list_mixed_constructors: should encode [Variant0, Variant1, Variant2]", () => {
    const SimpleEnum = TSchema.Literal("Variant0", "Variant1", "Variant2")
    const v0 = Data.withSchema(SimpleEnum).toData("Variant0")
    const v1 = Data.withSchema(SimpleEnum).toData("Variant1")
    const v2 = Data.withSchema(SimpleEnum).toData("Variant2")
    const value = Data.list([v0, v1, v2])
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("9fd87980d87a80d87b80ff")
  })

  // Test #45: encode_constructor_index_6
  it("encode_constructor_index_6: should encode C6 with tag 127", () => {
    const ManyConstructors = TSchema.Literal("C0", "C1", "C2", "C3", "C4", "C5", "C6")
    const value = Data.withSchema(ManyConstructors).toData("C6")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d87f80")
  })

  // Test #46: encode_constructor_index_7
  it("encode_constructor_index_7: should encode C7 with tag 1280", () => {
    const ManyConstructors = TSchema.Literal("C0", "C1", "C2", "C3", "C4", "C5", "C6", "C7")
    const value = Data.withSchema(ManyConstructors).toData("C7")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d9050080")
  })

  // Test #47: encode_large_constructor_index - SKIPPED (placeholder test)

  // Test #48: encode_int_boundary_255
  it("encode_int_boundary_255: should encode 255", () => {
    const value = 255n
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("18ff")
  })

  // Test #49: encode_int_boundary_256
  it("encode_int_boundary_256: should encode 256", () => {
    const value = 256n
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("190100")
  })

  // Test #50: encode_int_boundary_65535
  it("encode_int_boundary_65535: should encode 65535", () => {
    const value = 65535n
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("19ffff")
  })

  // Test #51: encode_int_boundary_65536
  it("encode_int_boundary_65536: should encode 65536", () => {
    const value = 65536n
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("1a00010000")
  })

  // Test #52: encode_int_negative_large
  it("encode_int_negative_large: should encode -1000", () => {
    const value = -1000n
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("3903e7")
  })

  // Test #53: encode_bytearray_25_bytes
  it("encode_bytearray_25_bytes: should encode 25-byte bytearray", () => {
    const value = Bytes.fromHex("000102030405060708090a0b0c0d0e0f101112131415161718")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("5819000102030405060708090a0b0c0d0e0f101112131415161718")
  })

  // Test #54: encode_bytearray_max_inline
  it("encode_bytearray_max_inline: should encode 24-byte bytearray", () => {
    const value = Bytes.fromHex("000102030405060708090a0b0c0d0e0f1011121314151617")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("5818000102030405060708090a0b0c0d0e0f1011121314151617")
  })

  // Test #55: encode_string_empty
  it("encode_string_empty: should encode empty string as bytearray", () => {
    const value = Bytes.fromHex("")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("40")
  })

  // Test #56: encode_string_ascii
  it("encode_string_ascii: should encode 'hello' as bytearray", () => {
    const value = Text.toBytes("hello")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("4568656c6c6f")
  })

  // Test #57: encode_string_unicode
  it("encode_string_unicode: should encode 'café' as bytearray", () => {
    const value = Text.toBytes("café")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("45636166c3a9") // UTF-8 encoding of "café"
  })

  // Test #58: encode_bool_true
  it("encode_bool_true: should encode True", () => {
    const value = Data.withSchema(TSchema.Boolean).toData(true)
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d87a80")
  })

  // Test #59: encode_bool_false
  it("encode_bool_false: should encode False", () => {
    const value = Data.withSchema(TSchema.Boolean).toData(false)
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d87980")
  })

  // Test #60: encode_complex_datum
  it("encode_complex_datum: should encode Datum{owner: 28-byte hash, amount: 1000, beneficiaries: [], metadata: Some(#dead)}", () => {
    const owner = Bytes.fromHex("abababababababababababababababababababababababababababab")
    const amount = 1000n
    const beneficiaries: Array<[Uint8Array, bigint]> = []
    const metadata = Bytes.fromHex("dead")

    const Datum = TSchema.Struct({
      owner: TSchema.ByteArray,
      amount: TSchema.Integer,
      beneficiaries: TSchema.Array(TSchema.Tuple([TSchema.ByteArray, TSchema.Integer])),
      metadata: TSchema.UndefinedOr(TSchema.ByteArray)
    })

    const datum = Data.withSchema(Datum).toData({
      owner,
      amount,
      beneficiaries,
      metadata
    })
    const encoded = Data.toCBORHex(datum, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f581cabababababababababababababababababababababababababababab1903e880d8799f42deadffff")
  })

  // Test #61: encode_redeemer
  it("encode_redeemer: should encode Redeemer{action: 100, params: [#abcd]}", () => {
    const action = 100n
    const params = [Bytes.fromHex("abcd")]

    const Redeemer = TSchema.Struct({
      action: TSchema.Integer,
      params: TSchema.Array(TSchema.ByteArray)
    })

    const redeemer = Data.withSchema(Redeemer).toData({ action, params })
    const encoded = Data.toCBORHex(redeemer, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f18649f42abcdffff")
  })

  // Test #62: encode_script_context
  it("encode_script_context: should encode ScriptContext{inputs: [1,2], outputs: [3], fee: 170000, valid_range: (0, 100)}", () => {
    const inputs = [1n, 2n]
    const outputs = [3n]
    const fee = 170000n
    const valid_range: [bigint, bigint] = [0n, 100n]

    const ScriptContext = TSchema.Struct({
      inputs: TSchema.Array(TSchema.Integer),
      outputs: TSchema.Array(TSchema.Integer),
      fee: TSchema.Integer,
      valid_range: TSchema.Tuple([TSchema.Integer, TSchema.Integer])
    })

    const ctx = Data.withSchema(ScriptContext).toData({ inputs, outputs, fee, valid_range })
    const encoded = Data.toCBORHex(ctx, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f9f0102ff9f03ff1a000298109f001864ffff")
  })

  // Test #63: encode_pkh_credential
  it("encode_pkh_credential: should encode 28-byte payment key hash", () => {
    const value = Bytes.fromHex("abcdef1234567890abcdef1234567890abcdef1234567890abcdef12")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("581cabcdef1234567890abcdef1234567890abcdef1234567890abcdef12")
  })

  // Test #64: encode_script_hash
  it("encode_script_hash: should encode 26-byte script hash", () => {
    const value = Bytes.fromHex("1234567890abcdef1234567890abcdef1234567890abcdef1234")
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("581a1234567890abcdef1234567890abcdef1234567890abcdef1234")
  })

  // Test #65: encode_credential_verification_key
  it("encode_credential_verification_key: should encode Credential with VerificationKey", () => {
    const hash = Bytes.fromHex("abcdef1234567890abcdef1234567890abcdef1234567890abcdef12")

    const Credential = TSchema.Variant({
      VerificationKey: { hash: TSchema.ByteArray },
      Script: { hash: TSchema.ByteArray }
    })

    const credential = Data.withSchema(Credential).toData({
      VerificationKey: { hash }
    })
    const encoded = Data.toCBORHex(credential, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799f581cabcdef1234567890abcdef1234567890abcdef1234567890abcdef12ff")
  })

  // Test #66: encode_credential_script
  it("encode_credential_script: should encode Credential with Script", () => {
    const hash = Bytes.fromHex("1234567890abcdef1234567890abcdef1234567890abcdef1234ab")

    const Credential = TSchema.Variant({
      VerificationKey: { hash: TSchema.ByteArray },
      Script: { hash: TSchema.ByteArray }
    })

    const credential = Data.withSchema(Credential).toData({
      Script: { hash }
    })
    const encoded = Data.toCBORHex(credential, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d87a9f581b1234567890abcdef1234567890abcdef1234567890abcdef1234abff")
  })

  // Test #67: encode_referenced_inline
  it("encode_referenced_inline: should encode Referenced with Inline credential", () => {
    const hash = Bytes.fromHex("abcdef1234567890abcdef1234567890abcdef1234567890abcdef12")

    const Credential = TSchema.Variant({
      VerificationKey: { hash: TSchema.ByteArray },
      Script: { hash: TSchema.ByteArray }
    })

    const Referenced = TSchema.Variant({
      Inline: { credential: Credential },
      Pointer: {
        slot_number: TSchema.Integer,
        transaction_index: TSchema.Integer,
        certificate_index: TSchema.Integer
      }
    })

    const referenced = Data.withSchema(Referenced).toData({
      Inline: {
        credential: { VerificationKey: { hash } }
      }
    })
    const encoded = Data.toCBORHex(referenced, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d8799fd8799f581cabcdef1234567890abcdef1234567890abcdef1234567890abcdef12ffff")
  })

  // Test #68: encode_referenced_pointer
  it("encode_referenced_pointer: should encode Referenced with Pointer", () => {
    const Referenced = TSchema.Variant({
      Inline: {
        credential: TSchema.Variant({
          VerificationKey: { hash: TSchema.ByteArray },
          Script: { hash: TSchema.ByteArray }
        })
      },
      Pointer: {
        slot_number: TSchema.Integer,
        transaction_index: TSchema.Integer,
        certificate_index: TSchema.Integer
      }
    })

    const referenced = Data.withSchema(Referenced).toData({
      Pointer: {
        slot_number: 100n,
        transaction_index: 2n,
        certificate_index: 0n
      }
    })
    const encoded = Data.toCBORHex(referenced, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe("d87a9f18640200ff")
  })

  // Test #69: encode_address_payment_only
  it("encode_address_payment_only: should encode Address with payment credential only", () => {
    const hash = Bytes.fromHex("ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6")

    const Credential = TSchema.Variant({
      VerificationKey: { hash: TSchema.ByteArray },
      Script: { hash: TSchema.ByteArray }
    })

    const Address = TSchema.Struct({
      payment_credential: Credential,
      stake_credential: TSchema.UndefinedOr(
        TSchema.Variant({
          Inline: { credential: Credential },
          Pointer: {
            slot_number: TSchema.Integer,
            transaction_index: TSchema.Integer,
            certificate_index: TSchema.Integer
          }
        })
      )
    })

    const address = Data.withSchema(Address).toData({
      payment_credential: { VerificationKey: { hash } },
      stake_credential: undefined
    })
    const encoded = Data.toCBORHex(address, CBOR.AIKEN_DEFAULT_OPTIONS)
    // d87a80 is Some(None) - the Option wrapper for stake_credential
    expect(encoded).toBe("d8799fd8799f581cff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6ffd87a80ff")
  })

  // Test #70: encode_address_with_inline_stake_key
  it("encode_address_with_inline_stake_key: should encode Address with payment and inline stake (key)", () => {
    const paymentHash = Bytes.fromHex("ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6")
    const stakeHash = Bytes.fromHex("64ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507")

    const Credential = TSchema.Variant({
      VerificationKey: { hash: TSchema.ByteArray },
      Script: { hash: TSchema.ByteArray }
    })

    const Address = TSchema.Struct({
      payment_credential: Credential,
      stake_credential: TSchema.UndefinedOr(
        TSchema.Variant({
          Inline: { credential: Credential },
          Pointer: {
            slot_number: TSchema.Integer,
            transaction_index: TSchema.Integer,
            certificate_index: TSchema.Integer
          }
        })
      )
    })

    const address = Data.withSchema(Address).toData({
      payment_credential: { VerificationKey: { hash: paymentHash } },
      stake_credential: {
        Inline: {
          credential: { VerificationKey: { hash: stakeHash } }
        }
      }
    })
    const encoded = Data.toCBORHex(address, CBOR.AIKEN_DEFAULT_OPTIONS)
    // UndefinedOr wraps the value with Some (d8799f), then Inline variant (d8799f), then credential
    expect(encoded).toBe(
      "d8799fd8799f581cff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6ffd8799fd8799fd8799f581c64ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507ffffffff"
    )
  })

  // encode_bytearray_bounded_65: 65 bytes must be chunked (bounded_bytes = bytes .size (0..64))
  it("encode_bytearray_bounded_65: should chunk bytearray exceeding 64 bytes", () => {
    const value = new Uint8Array(65).fill(0xaa)
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe(
      "5f5840aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa41aaff"
    )
  })

  // encode_bytearray_exactly_64: 64 bytes stays definite-length (no chunking)
  it("encode_bytearray_exactly_64: should NOT chunk a 64-byte bytearray", () => {
    const value = new Uint8Array(64).fill(0xbb)
    const encoded = Data.toCBORHex(value, CBOR.AIKEN_DEFAULT_OPTIONS)
    expect(encoded).toBe(
      "5840bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    )
  })
})
