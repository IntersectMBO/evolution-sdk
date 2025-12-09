# @evolution-sdk/evolution

## 0.4.0

### Minor Changes

- [#88](https://github.com/IntersectMBO/evolution-sdk/pull/88) [`61ffded`](https://github.com/IntersectMBO/evolution-sdk/commit/61ffded47892f12bda6f538e8028b3fd64492187) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add CIP-30 message signing support with modular architecture

  This release introduces comprehensive CIP-30 `signData` and `verifyData` support, implementing the complete COSE Sign1 specification with a clean, modular structure:

  **New Features:**
  - Full CIP-30 message signing (`signData`) and verification (`verifyData`) implementation
  - COSE (CBOR Object Signing and Encryption) primitives per RFC 8152
  - Support for Ed25519 signatures with proper COSE key structures
  - Message hashing with BLAKE2b-256 for payload integrity
  - CIP-8 compliant address field handling
  - Complete test coverage with CSL compatibility tests

  **Module Structure:**
  - `message-signing/SignData.ts` - Main CIP-30 signData/verifyData API
  - `message-signing/Header.ts` - COSE header structures and operations
  - `message-signing/Label.ts` - COSE label types and algorithm identifiers
  - `message-signing/CoseSign1.ts` - COSE_Sign1 structure implementation
  - `message-signing/CoseKey.ts` - COSE key format support
  - `message-signing/Ed25519Key.ts` - Ed25519 key operations
  - `message-signing/Utils.ts` - Encoding and conversion utilities

  **Breaking Changes:**
  - Refactored `Bytes` module API:
    - Renamed `bytesEquals` to `equals` with stricter type signature (no longer accepts undefined)
    - Removed `Bytes.FromHex` schema in favor of Effect's built-in `Schema.Uint8ArrayFromHex`
    - Updated `fromHex`/`toHex` to use Effect's native schemas

  **Internal Improvements:**
  - Removed unused `Bytes` imports across 32 files
  - Updated all modules to use new Bytes API
  - Improved CBOR encoding/decoding with proper codec options
  - Enhanced type safety with Effect Schema compositions

## 0.3.1

### Patch Changes

- [#85](https://github.com/IntersectMBO/evolution-sdk/pull/85) [`5ee95bc`](https://github.com/IntersectMBO/evolution-sdk/commit/5ee95bc78220c9aa72bda42954b88e47c81a23eb) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ## hashPlutusData encoding options

  Add optional CBOR encoding options parameter to `hashPlutusData` function. This allows controlling how Plutus data is encoded before hashing, which affects the resulting datum hash.

  **Before:**

  ```typescript
  import { hashPlutusData } from "@evolution-sdk/evolution/utils/Hash"

  // Always uses indefinite-length encoding (CML_DATA_DEFAULT_OPTIONS)
  const hash = hashPlutusData(data)
  ```

  **After:**

  ```typescript
  import { Core } from "@evolution-sdk/evolution"
  import { hashPlutusData } from "@evolution-sdk/evolution/utils/Hash"

  const cborHex =
    "d87983486c6f76656c6163655820c3e43c6b8fb46068d4ef9746a934eba534873db0aacebdaf369c78ab23cb57751a004c4b40"
  const decoded = Core.Data.fromCBORHex(cborHex)

  // Indefinite-length (SDK default for Data)
  const indefiniteHash = hashPlutusData(decoded, Core.CBOR.CML_DATA_DEFAULT_OPTIONS)
  console.log("Hash:", Core.Bytes.toHex(indefiniteHash.hash))
  // b67b6e7d2497d4e87a240a080a109a905f73527a244775cc1e2a43f48202700f

  // Definite-length encoding
  const definiteHash = hashPlutusData(decoded, Core.CBOR.CML_DEFAULT_OPTIONS)
  console.log("Hash:", Core.Bytes.toHex(definiteHash.hash))
  // bc7eea92ba15710926e99904e746e5da739d77085b6192ddd87a0e7b4298e0c0

  // Aiken-compatible encoding
  const aikenHash = hashPlutusData(decoded, Core.CBOR.AIKEN_DEFAULT_OPTIONS)
  console.log("Hash:", Core.Bytes.toHex(aikenHash.hash))
  // b67b6e7d2497d4e87a240a080a109a905f73527a244775cc1e2a43f48202700f
  ```

## 0.3.0

### Minor Changes

- [#76](https://github.com/IntersectMBO/evolution-sdk/pull/76) [`1f0671c`](https://github.com/IntersectMBO/evolution-sdk/commit/1f0671c068d44c1f88e677eb2d8bb55312ff2c38) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Initial release of @evolution-sdk/devnet as a standalone package. Extracted from @evolution-sdk/evolution for better modularity and maintainability.

## 0.2.5

### Patch Changes

- [#70](https://github.com/IntersectMBO/evolution-sdk/pull/70) [`ea9ffbe`](https://github.com/IntersectMBO/evolution-sdk/commit/ea9ffbe11a8b6a8e97c1531c108d5467a7eda6a8) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - add blueprint module

## 0.2.4

### Patch Changes

- [#68](https://github.com/IntersectMBO/evolution-sdk/pull/68) [`5b735c8`](https://github.com/IntersectMBO/evolution-sdk/commit/5b735c856fac3562f0e5892bf84c841b1dc85281) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ## TSchema Code Simplifications and Test Coverage

  ### Summary

  Added Literal options (index, flatInUnion) for better Union control. Simplified TSchema implementation by removing redundant code, extracting helpers, and optimizing algorithms. Added 7 missing round-trip tests for comprehensive coverage.

  ### New Features

  **Literal options for custom indices and flat unions:**

  ```typescript
  // Custom index for positioning in unions
  const Action = TSchema.Literal("withdraw", { index: 100 })

  // Flat in union - unwraps the Literal at the Union level
  const FlatUnion = TSchema.Union(
    TSchema.Literal("OptionA", { flatInUnion: true }),
    TSchema.Literal("OptionB", { flatInUnion: true })
  )

  // Before: Union wraps each literal
  // Constr(0, [Constr(0, [])]) for OptionA
  // Constr(1, [Constr(1, [])]) for OptionB

  // After: Literals are unwrapped at Union level
  // Constr(0, []) for OptionA
  // Constr(1, []) for OptionB

  // Note: TSchema.Literal("OptionA", "OptionB") creates a single schema
  // with multiple literal values, which is different from a Union of
  // separate Literal schemas. Use Union + flatInUnion for explicit control.
  ```

  **LiteralOptions interface:**

  ```typescript
  interface LiteralOptions {
    index?: number // Custom Constr index (default: auto-increment)
    flatInUnion?: boolean // Unwrap when used in Union (default: false)
  }

  // Overloaded signatures
  function Literal(...values: Literals): Literal<Literals>
  function Literal(...args: [...Literals, LiteralOptions]): Literal<Literals>
  ```

  ### Code Simplifications

  **Removed redundant OneLiteral function:**

  ```typescript
  // Before: Separate function for single literals
  const Action = TSchema.OneLiteral("withdraw")

  // After: Use Literal directly
  const Action = TSchema.Literal("withdraw")
  ```

  **Simplified Boolean validation:**

  ```typescript
  // Before: Two separate checks
  decode: ({ fields, index }) => {
    if (index !== 0n && index !== 1n) {
      throw new Error(`Expected constructor index to be 0 or 1, got ${index}`)
    }
    if (fields.length !== 0) {
      throw new Error("Expected a constructor with no fields")
    }
    return index === 1n
  }

  // After: Combined check with better error message
  decode: ({ fields, index }) => {
    if ((index !== 0n && index !== 1n) || fields.length !== 0) {
      throw new Error(
        `Expected constructor with index 0 or 1 and no fields, got index ${index} with ${fields.length} fields`
      )
    }
    return index === 1n
  }
  ```

  **Optimized collision detection (O(n²) → O(n)):**

  ```typescript
  // Before: Nested loops
  for (let i = 0; i < flatMembers.length; i++) {
    for (let j = i + 1; j < flatMembers.length; j++) {
      if (flatMembers[i].index === flatMembers[j].index) {
        // collision detected
      }
    }
  }

  // After: Map-based tracking
  const indexMap = new globalThis.Map<number, number>()
  for (const member of flatMembers) {
    if (indexMap.has(member.index)) {
      // collision detected
    }
    indexMap.set(member.index, member.position)
  }
  ```

  **Extracted helper functions:**
  - `getTypeName(value)` - Centralized type name logic for error messages
  - Simplified `getLiteralFieldValue` with ternary operators
  - Simplified tag field detection logic

  ### New Round-Trip Tests

  Added comprehensive test coverage for previously untested features:
  1. **UndefinedOr** - Both defined and undefined value encoding/decoding
  2. **Struct with custom index** - Validates custom Constr index is preserved
  3. **Struct with flatFields** - Verifies field merging into parent struct
  4. **Variant** - Multi-option tagged unions (Mint, Burn, Transfer)
  5. **TaggedStruct** - Default "\_tag" field and custom tagField names
  6. **flatInUnion Literals in Union** - Validates flat Literals with Structs
  7. **flatInUnion mixed types** - Literals and Structs with flatFields

## 0.2.3

### Patch Changes

- [#66](https://github.com/IntersectMBO/evolution-sdk/pull/66) [`29c3e4d`](https://github.com/IntersectMBO/evolution-sdk/commit/29c3e4d3bac9b35c1586c6a94d6aee037aeb6d62) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fixed field ordering bug in TSchema.Struct encode function that caused fields to be swapped during CBOR encoding when using NullOr/UndefinedOr.

  **Before:**

  ```typescript
  const CredentialSchema = TSchema.Union(
    TSchema.Struct({ pubKeyHash: TSchema.ByteArray }, { flatFields: true }),
    TSchema.Struct({ scriptHash: TSchema.ByteArray }, { flatFields: true })
  )

  const AddressSchema = TSchema.Struct({
    paymentCredential: CredentialSchema,
    stakeCredential: TSchema.NullOr(TSchema.Integer)
  })

  const Foo = TSchema.Union(TSchema.Struct({ foo: AddressSchema }, { flatFields: true }))

  const input = {
    foo: {
      paymentCredential: { pubKeyHash: fromHex("deadbeef") },
      stakeCredential: null
    }
  }

  const encoded = Data.withSchema(Foo).toData(input)
  // BUG: Fields were swapped in innerStruct!
  // innerStruct.fields[0] = Constr(1, [])      // stakeCredential (null) - WRONG!
  // innerStruct.fields[1] = Constr(0, [...])   // paymentCredential - WRONG!
  ```

  **After:**

  ```typescript
  const CredentialSchema = TSchema.Union(
    TSchema.Struct({ pubKeyHash: TSchema.ByteArray }, { flatFields: true }),
    TSchema.Struct({ scriptHash: TSchema.ByteArray }, { flatFields: true })
  )

  const AddressSchema = TSchema.Struct({
    paymentCredential: CredentialSchema,
    stakeCredential: TSchema.NullOr(TSchema.Integer)
  })

  const Foo = TSchema.Union(TSchema.Struct({ foo: AddressSchema }, { flatFields: true }))

  const input = {
    foo: {
      paymentCredential: { pubKeyHash: fromHex("deadbeef") },
      stakeCredential: null
    }
  }

  const encoded = Data.withSchema(Foo).toData(input)
  // FIXED: Fields now in correct order matching schema!
  // innerStruct.fields[0] = Constr(0, [...])   // paymentCredential - CORRECT!
  // innerStruct.fields[1] = Constr(1, [])      // stakeCredential (null) - CORRECT!
  ```

## 0.2.2

### Patch Changes

- [#63](https://github.com/IntersectMBO/evolution-sdk/pull/63) [`7bb1da3`](https://github.com/IntersectMBO/evolution-sdk/commit/7bb1da32488c5a1a92a9c8b90e5aa4514e004232) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Improve `Variant` type inference with `PropertyKey` constraint

  The `Variant` helper now accepts `PropertyKey` (string | number | symbol) as variant keys instead of just strings, enabling more flexible discriminated union patterns.

  **Before:**

  ```typescript
  // Only string keys were properly typed
  const MyVariant = TSchema.Variant({
    Success: { value: TSchema.Integer },
    Error: { message: TSchema.ByteArray }
  })
  ```

  **After:**

  ```typescript
  // Now supports symbols and numbers as variant keys
  const MyVariant = TSchema.Variant({
    Success: { value: TSchema.Integer },
    Error: { message: TSchema.ByteArray }
  })
  // Type inference is improved, especially with const assertions
  ```

  Replace `@ts-expect-error` with `as any` following Effect patterns

  Improved code quality by replacing forbidden `@ts-expect-error` directives with explicit `as any` type assertions, consistent with Effect Schema's approach for dynamic object construction.

  Add comprehensive Cardano Address type support

  Added full CBOR encoding support for Cardano address structures with Aiken compatibility:

  ```typescript
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

  // Creates proper CBOR encoding matching Aiken's output
  const address = Data.withSchema(Address).toData({
    payment_credential: { VerificationKey: { hash } },
    stake_credential: { Inline: { credential: { VerificationKey: { stakeHash } } } }
  })
  ```

- [#63](https://github.com/IntersectMBO/evolution-sdk/pull/63) [`844dfec`](https://github.com/IntersectMBO/evolution-sdk/commit/844dfeccb48c0af0ce0cebfc67e6cdcc67e28cc8) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add Aiken-compatible CBOR encoding with encodeMapAsPairs option and comprehensive test suite. PlutusData maps can now encode as arrays of pairs (Aiken style) or CBOR maps (CML style). Includes 72 Aiken reference tests and 40 TypeScript compatibility tests verifying identical encoding. Also fixes branded schema pattern in Data.ts for cleaner type inference and updates TSchema error handling test.

## 0.2.1

### Patch Changes

- [#61](https://github.com/IntersectMBO/evolution-sdk/pull/61) [`0dcf415`](https://github.com/IntersectMBO/evolution-sdk/commit/0dcf4155e7950ff46061100300355fb0a69e902d) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - upgrade modules

## 0.2.0

### Minor Changes

- [#24](https://github.com/no-witness-labs/evolution-sdk/pull/24) [`1503549`](https://github.com/no-witness-labs/evolution-sdk/commit/15035498c85286a661f1073fdd34423f01128b54) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Experimental release 1:
  - Introduce experimental modules and docs flow
  - Add runnable Data examples with MDX generation
  - ESM Next/Nextra configuration for docs
