# @evolution-sdk/evolution

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
