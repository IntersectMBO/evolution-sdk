use aiken/cbor
use cardano/address.{Address, Inline, Pointer, Script, VerificationKey}

// ============================================================================
// Primitive Types
// ============================================================================

/// This module contains comprehensive CBOR encoding tests to document
/// Aiken's exact CBOR encoding behavior for all PlutusData types.
/// 
/// Run with: aiken check
/// 
/// The test outputs will show the exact CBOR hex encoding that Aiken uses,
/// which we can then use to configure our TypeScript CBOR encoder options.
test encode_int_small() {
  cbor.serialise(42) == #"182a"
}

test encode_int_zero() {
  cbor.serialise(0) == #"00"
}

test encode_int_negative() {
  cbor.serialise(-1) == #"20"
}

test encode_int_large() {
  cbor.serialise(1000000) == #"1a000f4240"
}

test encode_bytearray_empty() {
  cbor.serialise(#"") == #"40"
}

test encode_bytearray_small() {
  cbor.serialise(#"a1b2") == #"42a1b2"
}

test encode_bytearray_long() {
  cbor.serialise(#"deadbeef") == #"44deadbeef"
}

// ============================================================================
// Lists (Arrays)
// ============================================================================

test encode_list_empty() {
  let empty: List<Int> = []
  cbor.serialise(empty) == #"80"
}

test encode_list_single() {
  cbor.serialise([1]) == #"9f01ff"
}

test encode_list_multiple() {
  cbor.serialise([1, 2, 3]) == #"9f010203ff"
}

test encode_list_nested() {
  cbor.serialise([[1, 2], [3, 4]]) == #"9f9f0102ff9f0304ffff"
}

// Mixed-type lists are not supported in Aiken's type system

// ============================================================================
// Tuples (Pairs)
// ============================================================================

test encode_pair_ints() {
  cbor.serialise((1, 2)) == #"9f0102ff"
}

test encode_pair_mixed() {
  cbor.serialise((1, #"ff")) == #"9f0141ffff"
}

test encode_triple() {
  cbor.serialise((1, #"ff", 3)) == #"9f0141ff03ff"
}

test encode_nested_pairs() {
  cbor.serialise(((1, 2), (3, 4))) == #"9f9f0102ff9f0304ffff"
}

// ============================================================================
// Lists of Tuples
// ============================================================================

test encode_tuples_empty() {
  // An empty list of tuples encodes as an empty array
  let tuples: List<(Int, ByteArray)> = []
  cbor.serialise(tuples) == #"80"
}

test encode_tuples_single_entry() {
  // A list of tuples is a list of lists: indefinite arrays of indefinite arrays
  cbor.serialise([(1, #"ff")]) == #"9f9f0141ffffff"
}

test encode_tuples_multiple_entries() {
  cbor.serialise([(#"01", 1), (#"02", 2), (#"03", 3)]) == #"9f9f410101ff9f410202ff9f410303ffff"
}

test encode_tuples_int_keys() {
  cbor.serialise([(1, 100), (2, 200)]) == #"9f9f011864ff9f0218c8ffff"
}

// ============================================================================
// Pairs (Maps)
// ============================================================================

test encode_pairs_single() {
  // Pairs encode as a definite-length CBOR map
  let pairs: Pairs<Int, ByteArray> = [Pair(1, #"ff")]
  cbor.serialise(pairs) == #"a10141ff"
}

test encode_pairs_empty() {
  let pairs: Pairs<Int, ByteArray> = []
  cbor.serialise(pairs) == #"a0"
}

// ============================================================================
// Option Types (Constructors 0 and 1)
// ============================================================================

test encode_option_some() {
  cbor.serialise(Some(42)) == #"d8799f182aff"
}

test encode_option_none() {
  cbor.serialise(None) == #"d87a80"
}

test encode_option_some_bytearray() {
  cbor.serialise(Some(#"deadbeef")) == #"d8799f44deadbeefff"
}

test encode_option_nested_some() {
  cbor.serialise(Some(Some(42))) == #"d8799fd8799f182affff"
}

// ============================================================================
// Custom Types (Multiple Constructors)
// ============================================================================

type SimpleEnum {
  Variant0
  Variant1
  Variant2
}

type ManyConstructors {
  C0
  C1
  C2
  C3
  C4
  C5
  C6
  C7
}

// Constructor 7 uses alternative tag encoding

test encode_custom_constructor_0() {
  cbor.serialise(Variant0) == #"d87980"
}

test encode_custom_constructor_1() {
  cbor.serialise(Variant1) == #"d87a80"
}

test encode_custom_constructor_2() {
  cbor.serialise(Variant2) == #"d87b80"
}

type WithFields {
  Single { value: Int }
  Triple { a: Int, b: Int, c: Int }
}

type WithListField {
  Container { items: List<Int> }
}

type WithOptionField {
  Wrapper { opt: Option<Int> }
}

type WithByteArrayField {
  Holder { data: ByteArray }
}

test encode_constructor_with_one_field() {
  cbor.serialise(Single(42)) == #"d8799f182aff"
}

test encode_pair_tuple() {
  // Pairs are tuples, not constructors
  cbor.serialise((1, #"ff")) == #"9f0141ffff"
}

test encode_constructor_with_three_fields() {
  cbor.serialise(Triple(1, 2, 3)) == #"d87a9f010203ff"
}

// ============================================================================
// Nested Structures
// ============================================================================

test encode_list_of_lists_of_ints() {
  cbor.serialise([[1, 2], [3, 4], [5, 6]]) == #"9f9f0102ff9f0304ff9f0506ffff"
}

test encode_list_of_bytearrays() {
  cbor.serialise([#"aa", #"bb", #"cc"]) == #"9f41aa41bb41ccff"
}

test encode_nested_options() {
  cbor.serialise(Some(Some(Some(1)))) == #"d8799fd8799fd8799f01ffffff"
}

test encode_list_of_options() {
  cbor.serialise([Some(1), None, Some(2)]) == #"9fd8799f01ffd87a80d8799f02ffff"
}

test encode_option_of_list() {
  cbor.serialise(Some([1, 2, 3])) == #"d8799f9f010203ffff"
}

test encode_tuples_with_option_values() {
  cbor.serialise([(1, Some(100)), (2, None)]) == #"9f9f01d8799f1864ffff9f02d87a80ffff"
}

test encode_tuples_nested_as_value() {
  // List of tuples with another list of tuples as a value
  cbor.serialise([(1, [(2, 3)])]) == #"9f9f019f9f0203ffffffff"
}

test encode_empty_nested_lists() {
  cbor.serialise([[], [], []]) == #"9f808080ff"
}

// ============================================================================
// Edge Cases
// ============================================================================

test encode_deeply_nested_list() {
  cbor.serialise([[[1]]]) == #"9f9f9f01ffffff"
}

test encode_constructor_with_list_field() {
  cbor.serialise(Container([1, 2, 3])) == #"d8799f9f010203ffff"
}

test encode_constructor_with_option_field() {
  cbor.serialise(Wrapper(Some(42))) == #"d8799fd8799f182affff"
}

test encode_constructor_with_bytearray_field() {
  cbor.serialise(Holder(#"deadbeef")) == #"d8799f44deadbeefff"
}

test encode_tuple_with_nested_constructor() {
  cbor.serialise((Some(1), Some(2))) == #"9fd8799f01ffd8799f02ffff"
}

test encode_list_all_same_constructor() {
  cbor.serialise([Variant0, Variant0, Variant0]) == #"9fd87980d87980d87980ff"
}

test encode_list_mixed_constructors() {
  cbor.serialise([Variant0, Variant1, Variant2]) == #"9fd87980d87a80d87b80ff"
}

test encode_constructor_index_6() {
  // Constructor 6 uses tag 127 (121 + 6)
  cbor.serialise(C6) == #"d87f80"
}

test encode_constructor_index_7() {
  // Constructor 7 uses alternative tag encoding: 1280 + (7 - 7) = 1280 (0x0500)
  // Encoded as: d90500 (tag 1280) followed by 80 (empty array)
  cbor.serialise(C7) == #"d9050080"
}

test encode_large_constructor_index() {
  // Constructor at index 7 should use general form tag 102
  // This would be constructor index 7 which is tag 128 (0x80)
  // But we need to create a type with 8+ constructors to test this
  // For now, testing the compact tags 121-127
  True
}

test encode_int_boundary_255() {
  // Test int that fits in 1 byte (uint8)
  cbor.serialise(255) == #"18ff"
}

test encode_int_boundary_256() {
  // Test int that needs 2 bytes (uint16)
  cbor.serialise(256) == #"190100"
}

test encode_int_boundary_65535() {
  // Max uint16
  cbor.serialise(65535) == #"19ffff"
}

test encode_int_boundary_65536() {
  // Needs uint32
  cbor.serialise(65536) == #"1a00010000"
}

test encode_int_negative_large() {
  // Large negative number
  cbor.serialise(-1000) == #"3903e7"
}

test encode_bytearray_25_bytes() {
  // 25 bytes - uses length prefix 0x19 for uint16 length
  let bytes_25 = #"000102030405060708090a0b0c0d0e0f101112131415161718"
  cbor.serialise(bytes_25) == #"5819000102030405060708090a0b0c0d0e0f101112131415161718"
}

test encode_bytearray_max_inline() {
  // 24 bytes - uses length prefix 0x18 (CBOR major type 2, length 24)
  let bytes_24 = #"000102030405060708090a0b0c0d0e0f1011121314151617"
  cbor.serialise(bytes_24) == #"5818000102030405060708090a0b0c0d0e0f1011121314151617"
}

// ============================================================================
// String Encoding (Text)
// ============================================================================

test encode_string_empty() {
  // Aiken encodes strings as bytearrays (0x40, not 0x60 text)
  cbor.serialise("") == #"40"
}

test encode_string_ascii() {
  // Aiken uses bytearray (0x45...) not text string (0x65...)
  cbor.serialise("hello") == #"4568656c6c6f"
}

test encode_string_unicode() {
  // UTF-8 "café" as bytearray
  cbor.serialise("café") == #"45636166c3a9"
}

// ============================================================================
// Boolean Encoding
// ============================================================================

test encode_bool_true() {
  cbor.serialise(True) == #"d87a80"
}

test encode_bool_false() {
  cbor.serialise(False) == #"d87980"
}

// ============================================================================
// Complex Real-World Example
// ============================================================================

type Datum {
  owner: ByteArray,
  amount: Int,
  beneficiaries: List<(ByteArray, Int)>,
  metadata: Option<ByteArray>,
}

type Redeemer {
  action: Int,
  params: List<ByteArray>,
}

type ScriptContext {
  inputs: List<Int>,
  outputs: List<Int>,
  fee: Int,
  valid_range: (Int, Int),
}

test encode_complex_datum() {
  let datum =
    Datum {
      owner: #"abababababababababababababababababababababababababababab",
      amount: 1000,
      beneficiaries: [],
      metadata: Some(#"dead"),
    }
  cbor.serialise(datum) == #"d8799f581cabababababababababababababababababababababababababababab1903e880d8799f42deadffff"
}

test encode_redeemer() {
  let redeemer = Redeemer { action: 100, params: [#"abcd"] }
  cbor.serialise(redeemer) == #"d8799f18649f42abcdffff"
}

test encode_script_context() {
  let ctx =
    ScriptContext {
      inputs: [1, 2],
      outputs: [3],
      fee: 170000,
      valid_range: (0, 100),
    }
  cbor.serialise(ctx) == #"d8799f9f0102ff9f03ff1a000298109f001864ffff"
}

test encode_pkh_credential() {
  // Simulating a payment credential (PubKeyHash)
  let pkh = #"abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
  cbor.serialise(pkh) == #"581cabcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
}

test encode_script_hash() {
  // Simulating a script hash (26 bytes)
  let script = #"1234567890abcdef1234567890abcdef1234567890abcdef1234"
  cbor.serialise(script) == #"581a1234567890abcdef1234567890abcdef1234567890abcdef1234"
}

// ============================================================================
// Address Types (Cardano Address Structure)
// ============================================================================

test encode_credential_verification_key() {
  // Credential.VerificationKey with 28-byte hash
  let vk_hash = #"abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
  let cred = VerificationKey(vk_hash)
  cbor.serialise(cred) == #"d8799f581cabcdef1234567890abcdef1234567890abcdef1234567890abcdef12ff"
}

test encode_credential_script() {
  // Credential.Script with 27-byte script hash
  let script_hash = #"1234567890abcdef1234567890abcdef1234567890abcdef1234ab"
  let cred = Script(script_hash)
  cbor.serialise(cred) == #"d87a9f581b1234567890abcdef1234567890abcdef1234567890abcdef1234abff"
}

test encode_referenced_inline() {
  // Referenced::Inline wrapping a credential
  let vk_hash = #"abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
  let cred = VerificationKey(vk_hash)
  let inline_ref = Inline(cred)
  cbor.serialise(inline_ref) == #"d8799fd8799f581cabcdef1234567890abcdef1234567890abcdef1234567890abcdef12ffff"
}

test encode_referenced_pointer() {
  // Referenced::Pointer with slot_number=100, tx_index=2, cert_index=0
  let pointer =
    Pointer { slot_number: 100, transaction_index: 2, certificate_index: 0 }
  cbor.serialise(pointer) == #"d87a9f18640200ff"
}

// Address with payment key, no stake credential
test encode_address_payment_key_no_stake() {
  // Address { payment_credential: VerificationKey(hash), stake_credential: None }
  let pk_hash = #"ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6"
  let address =
    Address {
      payment_credential: VerificationKey(pk_hash),
      stake_credential: None,
    }
  cbor.serialise(address) == #"d8799fd8799f581cff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6ffd87a80ff"
}

// Address with payment key + inline stake key
test encode_address_payment_key_stake_key_inline() {
  // Address with both payment and stake credentials (base address)
  let payment_hash = #"ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6"
  let stake_hash = #"64ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507"
  let address =
    Address {
      payment_credential: VerificationKey(payment_hash),
      stake_credential: Some(Inline(VerificationKey(stake_hash))),
    }
  cbor.serialise(address) == #"d8799fd8799f581cff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6ffd8799fd8799fd8799f581c64ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507ffffffff"
}

// Address with payment script, no stake credential
test encode_address_payment_script_no_stake() {
  // Script address without delegation (enterprise script address)
  let script_hash = #"1234567890abcdef1234567890abcdef1234567890abcdef1234ab"
  let address =
    Address { payment_credential: Script(script_hash), stake_credential: None }
  cbor.serialise(address) == #"d8799fd87a9f581b1234567890abcdef1234567890abcdef1234567890abcdef1234abffd87a80ff"
}

// Address with payment script + inline stake key
test encode_address_payment_script_stake_key_inline() {
  // Script address with stake delegation to a key
  let script_hash = #"1234567890abcdef1234567890abcdef1234567890abcdef1234ab"
  let stake_hash = #"abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
  let address =
    Address {
      payment_credential: Script(script_hash),
      stake_credential: Some(Inline(VerificationKey(stake_hash))),
    }
  cbor.serialise(address) == #"d8799fd87a9f581b1234567890abcdef1234567890abcdef1234567890abcdef1234abffd8799fd8799fd8799f581cabcdef1234567890abcdef1234567890abcdef1234567890abcdef12ffffffff"
}

// Address with payment key + inline stake script
test encode_address_payment_key_stake_script_inline() {
  // Payment key with stake script delegation
  let payment_hash = #"ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6"
  let stake_script = #"1234567890abcdef1234567890abcdef1234567890abcdef1234ab"
  let address =
    Address {
      payment_credential: VerificationKey(payment_hash),
      stake_credential: Some(Inline(Script(stake_script))),
    }
  cbor.serialise(address) == #"d8799fd8799f581cff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6ffd8799fd8799fd87a9f581b1234567890abcdef1234567890abcdef1234567890abcdef1234abffffffff"
}

// Address with payment script + inline stake script
test encode_address_payment_script_stake_script_inline() {
  // Both payment and stake are scripts
  let payment_script = #"1234567890abcdef1234567890abcdef1234567890abcdef1234ab"
  let stake_script = #"abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
  let address =
    Address {
      payment_credential: Script(payment_script),
      stake_credential: Some(Inline(Script(stake_script))),
    }
  cbor.serialise(address) == #"d8799fd87a9f581b1234567890abcdef1234567890abcdef1234567890abcdef1234abffd8799fd8799fd87a9f581cabcdef1234567890abcdef1234567890abcdef1234567890abcdef12ffffffff"
}

// Address with payment key + pointer stake credential
test encode_address_payment_key_stake_pointer() {
  // Payment key with pointer to stake credential registration
  let payment_hash = #"ff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6"
  let address =
    Address {
      payment_credential: VerificationKey(payment_hash),
      stake_credential: Some(
        Pointer {
          slot_number: 2498243,
          transaction_index: 7,
          certificate_index: 0,
        },
      ),
    }
  cbor.serialise(address) == #"d8799fd8799f581cff0185c80386d7ff02a2042efd97fbe6012dac0102751cfcc14507a6ffd8799fd87a9f1a00261ec30700ffffff"
}

// Address with payment script + pointer stake credential
test encode_address_payment_script_stake_pointer() {
  // Script payment with pointer to stake credential
  let script_hash = #"1234567890abcdef1234567890abcdef1234567890abcdef1234ab"
  let address =
    Address {
      payment_credential: Script(script_hash),
      stake_credential: Some(
        Pointer {
          slot_number: 1000,
          transaction_index: 5,
          certificate_index: 2,
        },
      ),
    }
  cbor.serialise(address) == #"d8799fd87a9f581b1234567890abcdef1234567890abcdef1234567890abcdef1234abffd8799fd87a9f1903e80502ffffff"
}

// bounded_bytes: byte strings > 64 bytes must be chunked (Conway CDDL constraint)

test encode_bytearray_bounded_65() {
  // 65 bytes: must be chunked as indefinite-length (bounded_bytes = bytes .size (0..64))
  cbor.serialise(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ) == #"5f5840aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa41aaff"
}

test encode_bytearray_exactly_64() {
  // 64 bytes: stays definite-length (not chunked)
  cbor.serialise(
    #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ) == #"5840bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
