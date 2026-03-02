# @evolution-sdk/evolution

## 0.3.20

### Patch Changes

- [#168](https://github.com/IntersectMBO/evolution-sdk/pull/168) [`e0245ae`](https://github.com/IntersectMBO/evolution-sdk/commit/e0245ae2d33c1712591bc26504928c6797a6a668) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix BlockfrostEffect.evaluateTx dropping reference scripts from additionalUtxoSet, which caused missingRequiredScripts errors when evaluating transactions that reference unconfirmed UTxOs carrying minting policies.

- [#169](https://github.com/IntersectMBO/evolution-sdk/pull/169) [`eebd2b0`](https://github.com/IntersectMBO/evolution-sdk/commit/eebd2b0c826f25d96244943da1b28f9b2cefd3e4) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix `calculateMinimumUtxoLovelace` to use the Babbage/Conway formula with 160-byte UTxO entry overhead and an exact fixed-point solve to avoid CBOR under-estimation for outputs with script references.

## 0.3.19

### Patch Changes

- [#160](https://github.com/IntersectMBO/evolution-sdk/pull/160) [`e032384`](https://github.com/IntersectMBO/evolution-sdk/commit/e032384da83205f23a3d7358d60776b3b220f810) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Introduces `BoundedBytes` as a first-class CBOR node type that enforces the Conway CDDL `bounded_bytes = bytes .size (0..64)` constraint unconditionally and independently of `CodecOptions`. PlutusData byte strings are now emitted via `CBOR.BoundedBytes.make()`, which applies definite-length encoding for ≤ 64 bytes and indefinite-length 64-byte chunked encoding (`0x5f [chunk]* 0xff`) for larger values. Adds `BoundedBytes` branch to `CBOR.match`. Removes the unused `PreEncoded` node type.

## 0.3.18

### Patch Changes

- [#147](https://github.com/IntersectMBO/evolution-sdk/pull/147) [`16fdf5d`](https://github.com/IntersectMBO/evolution-sdk/commit/16fdf5df0587d373c8006437bfc26a9c60b657ee) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add `TSchema.PlutusData` schema for opaque PlutusData fields inside TSchema combinators.

  Previously, using `Data.DataSchema` inside `TSchema.Struct` caused a `ParseError` because its encoding layer transforms `Data` into `DataEncoded`, which is incompatible with how TSchema assembles `Constr.fields`. `TSchema.PlutusData` uses `Schema.typeSchema` to strip the encoding layer, matching the same pattern used by `TSchema.ByteArray` and `TSchema.Integer`.

  ```ts
  import * as TSchema from "@evolution-sdk/evolution/TSchema"
  import * as Data from "@evolution-sdk/evolution/Data"

  // Define a struct with an opaque PlutusData field
  const FooSchema = TSchema.Struct({
    foo: TSchema.PlutusData // accepts any PlutusData value
  })

  // Extract the TypeScript type from the schema
  type Foo = typeof FooSchema.Type

  // Create a serialiser using the schema
  const serialise = (d: Foo) => Data.withSchema(FooSchema).toCBORHex(d)

  // Encode a struct containing arbitrary PlutusData (e.g. Constr(0, []))
  serialise({ foo: Data.fromCBORHex("d87980") })
  // => "d8799fd87980ff"
  ```

  Fixes #146

- [#149](https://github.com/IntersectMBO/evolution-sdk/pull/149) [`d31f1d4`](https://github.com/IntersectMBO/evolution-sdk/commit/d31f1d43a9555b9dfda244867c4c1173b3298bde) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix blueprint codegen ignoring constructor index for empty constructors.

  `generateTypeScript` now emits `{ index: N }` for `TSchema.Literal` when the constructor index is non-zero (e.g. `Never` with `index: 1`).

  Fixes #148

## 0.3.17

### Patch Changes

- [#143](https://github.com/IntersectMBO/evolution-sdk/pull/143) [`25ebda0`](https://github.com/IntersectMBO/evolution-sdk/commit/25ebda0a7812571d412abf8ba46830c688a80e15) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add `Data.hashData()` function for computing blake2b-256 hash of PlutusData.

  This moves the hashing functionality from `utils/Hash.hashPlutusData()` to the Data module for better organization and discoverability. The function computes the datum hash used for inline datums and datum witnesses.

  **Example:**

  ```typescript
  import * as Data from "@evolution-sdk/evolution/Data"

  // Hash a simple integer
  const intHash = Data.hashData(42n)

  // Hash a constructor (e.g., for a custom datum type)
  const constr = new Data.Constr({ index: 0n, fields: [1n, 2n] })
  const constrHash = Data.hashData(constr)

  // Hash a bytearray
  const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
  const bytesHash = Data.hashData(bytes)

  // Hash a map
  const map = new Map<Data.Data, Data.Data>([[1n, 2n]])
  const mapHash = Data.hashData(map)
  ```

  **Breaking Change:** `hashPlutusData` has been removed from `utils/Hash`. Use `Data.hashData()` instead.

## 0.3.16

### Patch Changes

- [#139](https://github.com/IntersectMBO/evolution-sdk/pull/139) [`63c8491`](https://github.com/IntersectMBO/evolution-sdk/commit/63c84919b79690dc3b108616bb84fbd3841f09b7) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Update Address module @since labels from 1.0.0 to 2.0.0

## 0.3.15

### Patch Changes

- [#135](https://github.com/IntersectMBO/evolution-sdk/pull/135) [`d801fa1`](https://github.com/IntersectMBO/evolution-sdk/commit/d801fa1ce89c4cdea70cb19c4efa919446dadcaa) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Separate DatumOption into dedicated DatumHash and InlineDatum modules.
  - Add `DatumHash` module with `fromHex`, `toHex`, `fromBytes`, `toBytes` functions
  - Add `InlineDatum` module for inline plutus data
  - Refactor `DatumOption` to import from new modules (union type preserved)
  - Fix `BlockfrostUTxO` schema to include `address` field
  - Update all provider implementations to use new module imports

## 0.3.14

### Patch Changes

- [#131](https://github.com/IntersectMBO/evolution-sdk/pull/131) [`d21109b`](https://github.com/IntersectMBO/evolution-sdk/commit/d21109b3f42bdee33f1c8e3ecf274ca04735f8f5) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add `sendAll()` API to TxBuilder for draining wallet assets to a single address.

  This new method simplifies the common use case of transferring all wallet assets:
  - Automatically selects all wallet UTxOs as inputs
  - Creates a single output with all assets minus the transaction fee
  - Properly calculates minimum lovelace for the destination output
  - Validates incompatibility with other operations (payToAddress, collectFrom, mint, staking, governance)

  Usage:

  ```typescript
  const tx = await client.newTx().sendAll({ to: recipientAddress }).build()
  ```

## 0.3.13

### Patch Changes

- [#128](https://github.com/IntersectMBO/evolution-sdk/pull/128) [`2742e40`](https://github.com/IntersectMBO/evolution-sdk/commit/2742e40ea0e62cd75d2a958bed0b6ff6138ded59) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ### Provider Improvements: Full UTxO Resolution with Scripts and Datums

  **Blockfrost Provider:**
  - Added pagination support for `getUtxos` and `getUtxosWithUnit` (handles addresses with >100 UTxOs)
  - Full UTxO resolution now fetches reference scripts and resolves datum hashes
  - Updated `BlockfrostDelegation` schema to match actual `/accounts/{stake_address}` endpoint response
  - Added `BlockfrostAssetAddress` and `BlockfrostTxUtxos` schemas for proper endpoint handling
  - Improved `evaluateTx` to always use the more reliable `/utils/txs/evaluate/utxos` JSON endpoint
  - Added `EvaluationFailure` handling in evaluation response schema
  - Fixed delegation transformation to use `withdrawable_amount` for rewards
  - Added Conway era governance parameters (`drep_deposit`, `gov_action_deposit`) to protocol params

  **Kupmios Provider:**
  - Removed unnecessary double CBOR encoding for Plutus scripts (Kupo returns properly encoded scripts)

  **PoolKeyHash:**
  - Added `FromBech32` schema for parsing pool IDs in bech32 format (pool1...)
  - Added `fromBech32` and `toBech32` helper functions

  **Transaction Builder:**
  - Added `passAdditionalUtxos` option to control UTxO passing to provider evaluators (default: false to avoid OverlappingAdditionalUtxo errors)
  - Added `scriptDataFormat` option to choose between Conway-era array format and Babbage-era map format for redeemers
  - Fixed cost model detection to check reference scripts (not just witness set scripts) for Plutus version detection

## 0.3.12

### Patch Changes

- [#127](https://github.com/IntersectMBO/evolution-sdk/pull/127) [`15be602`](https://github.com/IntersectMBO/evolution-sdk/commit/15be602a53dfcf59b8f0ccec55081904eaf7ff89) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - **BREAKING CHANGE:** Remove `Core` namespace, flatten package structure

  ### What changed
  - Moved all modules from `src/core/` to `src/`
  - Removed the `Core` namespace export
  - Added `Cardano` namespace for API discovery/exploration
  - Individual module exports remain available for tree-shaking

  ### Migration

  **Before:**

  ```typescript
  import { Core } from "@evolution-sdk/evolution"
  const address = Core.Address.fromBech32("addr...")
  ```

  **After (namespace style):**

  ```typescript
  import { Cardano } from "@evolution-sdk/evolution"
  const address = Cardano.Address.fromBech32("addr...")
  ```

  **After (individual imports - recommended for production):**

  ```typescript
  import { Address } from "@evolution-sdk/evolution"
  const address = Address.fromBech32("addr...")
  ```

- [#125](https://github.com/IntersectMBO/evolution-sdk/pull/125) [`8b8ade7`](https://github.com/IntersectMBO/evolution-sdk/commit/8b8ade75f51dd1103dcf4b3714f0012d8e430725) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - # Remove SDK types and consolidate type system

  This release removes the duplicate SDK-level type wrappers and consolidates the type system to use core types throughout the codebase.

  ## Breaking Changes
  - **Removed SDK type modules**: Deleted redundant type wrappers including `sdk/Address.ts`, `sdk/AddressDetails.ts`, `sdk/Assets.ts`, `sdk/Credential.ts`, `sdk/Datum.ts`, `sdk/Delegation.ts`, `sdk/Network.ts`, `sdk/OutRef.ts`, `sdk/PolicyId.ts`, `sdk/PoolParams.ts`, `sdk/ProtocolParameters.ts`, `sdk/Relay.ts`, `sdk/RewardAddress.ts`, `sdk/Script.ts`, `sdk/UTxO.ts`, and `sdk/Unit.ts`
  - **Direct core type usage**: All components now use core types directly instead of going through SDK wrappers, simplifying the type system and reducing maintenance burden

  ## Bug Fixes
  - **Aiken UPLC evaluator**: Fixed incorrect RedeemerTag mappings in the Aiken WASM evaluator
    - Changed `cert: "publish"` → `cert: "cert"`
    - Changed `reward: "withdraw"` → `reward: "reward"`
    - Fixed `ex_units` to properly instantiate `Redeemer.ExUnits` class instead of plain objects
    - Changed `Number()` to `BigInt()` for ExUnits memory and steps values
  - **TransactionHash type handling**: Fixed numerous type errors related to `TransactionHash` object usage across test files
    - Removed incorrect `.fromHex()` calls on `TransactionHash` objects
    - Added proper `.toHex()` conversions for string operations
    - Fixed length checks and string comparisons to use hex representation

  ## Internal Changes
  - Simplified type imports across the codebase
  - Reduced code duplication between SDK and core type definitions
  - Improved type safety by using Effect Schema validation throughout

## 0.3.11

### Patch Changes

- [#122](https://github.com/IntersectMBO/evolution-sdk/pull/122) [`079fd98`](https://github.com/IntersectMBO/evolution-sdk/commit/079fd98c2a1457b2d0fa2417d6e29ef996b59411) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add propose and vote APIs: introduce new operations for creating governance proposals and casting votes, including supporting types, procedures, and validators.

## 0.3.10

### Patch Changes

- [#120](https://github.com/IntersectMBO/evolution-sdk/pull/120) [`ed9bdc0`](https://github.com/IntersectMBO/evolution-sdk/commit/ed9bdc07011bcc4875b61fdd6b4f8e4219bb67e4) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add governance and pool operation APIs to transaction builder

  This release adds comprehensive support for Conway-era governance operations and stake pool management:

  **New Delegation APIs**
  - `delegateToPool`: Delegate stake to a pool (with optional registration)
  - `delegateToDRep`: Delegate voting power to a DRep (with optional registration)
  - `delegateToPoolAndDRep`: Delegate to both pool and DRep simultaneously

  **DRep Operations**
  - `registerDRep`: Register as a Delegated Representative
  - `updateDRep`: Update DRep anchor/metadata
  - `deregisterDRep`: Deregister DRep and reclaim deposit

  **Constitutional Committee Operations**
  - `authCommitteeHot`: Authorize hot credential for committee member
  - `resignCommitteeCold`: Resign from constitutional committee

  **Stake Pool Operations**
  - `registerPool`: Register a new stake pool with parameters
  - `retirePool`: Retire a stake pool at specified epoch

  **Transaction Balance Improvements**
  - Proper accounting for certificate deposits and refunds
  - Withdrawal balance calculations
  - Minimum 1 input requirement enforcement (replay attack prevention)

## 0.3.9

### Patch Changes

- [#115](https://github.com/IntersectMBO/evolution-sdk/pull/115) [`0503b96`](https://github.com/IntersectMBO/evolution-sdk/commit/0503b968735bc221b3f4d005d5c97ac8a0a1c592) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ### TxBuilder Composition API

  Add `compose()` and `getPrograms()` methods for modular transaction building:

  ```ts
  // Create reusable builder fragments
  const mintBuilder = client
    .newTx()
    .mintAssets({ policyId, assets: { tokenName: 1n }, redeemer })
    .attachScript({ script: mintingPolicy })

  const metadataBuilder = client.newTx().attachMetadata({ label: 674n, metadata: "Composed transaction" })

  // Compose multiple builders into one transaction
  const tx = await client
    .newTx()
    .payToAddress({ address, assets: { lovelace: 5_000_000n } })
    .compose(mintBuilder)
    .compose(metadataBuilder)
    .build()
  ```

  **Features:**
  - Merge operations from multiple builders into a single transaction
  - Snapshot accumulated operations with `getPrograms()` for inspection
  - Compose builders from different client instances
  - Works with all builder methods (payments, validity, metadata, minting, staking, etc.)

  ### Fixed Validity Interval Fee Calculation Bug

  Fixed bug where validity interval fields (`ttl` and `validityIntervalStart`) were not included during fee calculation, causing "insufficient fee" errors when using `setValidity()`.

  **Root Cause**: Validity fields were being added during transaction assembly AFTER fee calculation completed, causing the actual transaction to be 3-8 bytes larger than estimated.

  **Fix**: Convert validity Unix times to slots BEFORE the fee calculation loop and include them in the TransactionBody during size estimation.

  ### Error Type Corrections

  Corrected error types for pure constructor functions to use `never` instead of `TransactionBuilderError`:
  - `makeTxOutput` - creates TransactionOutput
  - `txOutputToTransactionOutput` - creates TransactionOutput
  - `mergeAssetsIntoUTxO` - creates UTxO
  - `mergeAssetsIntoOutput` - creates TransactionOutput
  - `buildTransactionInputs` - creates and sorts TransactionInputs

  ### Error Message Improvements

  Enhanced error messages throughout the builder to include underlying error details for better debugging.

## 0.3.8

### Patch Changes

- [#113](https://github.com/IntersectMBO/evolution-sdk/pull/113) [`7905507`](https://github.com/IntersectMBO/evolution-sdk/commit/79055076ab31214dc4c7462553484e9c2bcaf22c) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add `attachMetadata()` operation to TransactionBuilder for attaching transaction metadata according to CIP-10 standard.

  **Changes:**
  - Added `attachMetadata()` method to attach metadata with custom labels
  - Metadata labels are now bigint (unbounded positive integers) supporting CIP-20 messages (label 674) and custom labels
  - Automatic computation of auxiliaryDataHash in transaction body when metadata is present
  - Proper fee calculation accounting for auxiliary data size
  - TransactionMetadatum refactored to simple union type: `string | bigint | Uint8Array | Map | Array`
  - Added `NonNegativeInteger` schema to Numeric module for unbounded non-negative integers

  **Example:**

  ```typescript
  await client
    .newTx()
    .attachMetadata({
      label: 674n, // CIP-20 message label
      metadata: "Hello Cardano!"
    })
    .payToAddress({ address, assets })
    .build()
    .then((tx) => tx.sign().submit())
  ```

## 0.3.7

### Patch Changes

- [#112](https://github.com/IntersectMBO/evolution-sdk/pull/112) [`c59507e`](https://github.com/IntersectMBO/evolution-sdk/commit/c59507eafd942cd5bce1d3608c9c3e9c99a4cac8) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add transaction chaining support via `SignBuilder.chainResult()`
  - Add `chainResult()` method to `SignBuilder` for building dependent transactions
  - Returns `ChainResult` with `consumed`, `available` UTxOs and pre-computed `txHash`
  - Lazy evaluation with memoization - computed on first call, cached for subsequent calls
  - Add `signAndSubmit()` convenience method combining sign and submit in one call
  - Remove redundant `chain()`, `chainEffect()`, `chainEither()` methods from TransactionBuilder

- [#110](https://github.com/IntersectMBO/evolution-sdk/pull/110) [`9ddc79d`](https://github.com/IntersectMBO/evolution-sdk/commit/9ddc79dbc9b6667b3f2981dd06875878d9ad14f5) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ### Native Scripts & Multi-Sig Support
  - **`addSigner` operation**: Add required signers to transactions for multi-sig and script validation
  - **Native script minting**: Full support for `ScriptAll`, `ScriptAny`, `ScriptNOfK`, `InvalidBefore`, `InvalidHereafter`
  - **Reference scripts**: Use native scripts via `readFrom` instead of attaching them to transactions
  - **Multi-sig spending**: Spend from native script addresses with multi-party signing
  - **Improved fee calculation**: Accurate fee estimation for transactions with native scripts and reference scripts

  ### API Changes
  - `UTxO.scriptRef` type changed from `ScriptRef` to `Script` for better type safety
  - `PayToAddressParams.scriptRef` renamed to `script` for consistency
  - Wallet `signTx` now accepts `referenceUtxos` context for native script signer detection
  - Client `signTx` auto-fetches reference UTxOs when signing transactions with reference inputs

- [#109](https://github.com/IntersectMBO/evolution-sdk/pull/109) [`0730f23`](https://github.com/IntersectMBO/evolution-sdk/commit/0730f2353490ff1fa75743cccc0d05b33cff1b23) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ### TxBuilder setValidity API

  Add `setValidity()` method to TxBuilder for setting transaction validity intervals:

  ```ts
  client.newTx()
    .setValidity({
      from: Date.now(),           // Valid after this Unix time (optional)
      to: Date.now() + 300_000    // Expires after this Unix time (optional)
    })
    .payToAddress({ ... })
    .build()
  ```

  - Times are provided as Unix milliseconds and converted to slots during transaction assembly
  - At least one of `from` or `to` must be specified
  - Validates that `from < to` when both are provided

  ### slotConfig support for devnets

  Add `slotConfig` parameter to `createClient()` for custom slot configurations:

  ```ts
  const slotConfig = Cluster.getSlotConfig(devnetCluster)
  const client = createClient({
    network: 0,
    slotConfig,  // Custom slot config for devnet
    provider: { ... },
    wallet: { ... }
  })
  ```

  Priority chain for slot config resolution:
  1. `BuildOptions.slotConfig` (per-transaction override)
  2. `TxBuilderConfig.slotConfig` (client default)
  3. `SLOT_CONFIG_NETWORK[network]` (hardcoded fallback)

  ### Cluster.getSlotConfig helper

  Add `getSlotConfig()` helper to derive slot configuration from devnet cluster genesis:

  ```ts
  const slotConfig = Cluster.getSlotConfig(cluster)
  // Returns: { zeroTime, zeroSlot, slotLength }
  ```

## 0.3.6

### Patch Changes

- [#107](https://github.com/IntersectMBO/evolution-sdk/pull/107) [`1e1aec8`](https://github.com/IntersectMBO/evolution-sdk/commit/1e1aec88dfc726ff66809f51671d80b3f469eb5c) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ### Added: Redeemer Labels for Script Debugging

  Added optional `label` property to redeemer operations (`collectFrom`, `withdraw`, `mint`, and stake operations) to help identify which script failed during evaluation.

  ```typescript
  client
    .newTx()
    .collectFrom({
      inputs: [utxo],
      redeemer: makeSpendRedeemer(999n),
      label: "coordinator-spend-utxo" // Shows in failure output
    })
    .withdraw({
      stakeCredential,
      amount: 0n,
      redeemer: makeWithdrawRedeemer([999n]),
      label: "coordinator-withdrawal"
    })
  ```

  When scripts fail, the `EvaluationError` now includes a structured `failures` array:

  ```typescript
  interface ScriptFailure {
    purpose: "spend" | "mint" | "withdraw" | "cert"
    index: number
    label?: string // User-provided label
    redeemerKey: string // e.g., "spend:0", "withdraw:0"
    utxoRef?: string // For spend failures
    credential?: string // For withdraw/cert failures
    policyId?: string // For mint failures
    validationError: string
    traces: string[]
  }
  ```

  ### Added: Stake Operations

  Full support for Conway-era stake operations:
  - `registerStake` - Register stake credential (RegCert)
  - `deregisterStake` - Deregister stake credential (UnregCert)
  - `delegateTo` - Delegate to pool and/or DRep (StakeDelegation, VoteDelegCert, StakeVoteDelegCert)
  - `registerAndDelegateTo` - Combined registration + delegation (StakeRegDelegCert, VoteRegDelegCert, StakeVoteRegDelegCert)
  - `withdraw` - Withdraw staking rewards (supports coordinator pattern with amount: 0n)

  All operations support script-controlled credentials with RedeemerBuilder for deferred redeemer resolution.

## 0.3.5

### Patch Changes

- [#105](https://github.com/IntersectMBO/evolution-sdk/pull/105) [`98b59fa`](https://github.com/IntersectMBO/evolution-sdk/commit/98b59fa49d5a4e454e242a9c400572677e2f986f) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add deferred redeemer construction for dynamic index resolution

  **RedeemerBuilder module** (`RedeemerBuilder.ts`):
  - `IndexedInput` type: `{ index: number, utxo: UTxO }` - provides the final sorted index and original UTxO after coin selection
  - Three modes for redeemer construction:
    - `Static`: Direct Data value when index not needed
    - `Self`: Per-input function `(input: IndexedInput) => Data` for single UTxO index
    - `Batch`: Multi-input function `(inputs: IndexedInput[]) => Data` for stake validator coordinator pattern
  - Type guards: `isSelfFn`, `isBatchBuilder`, `isStaticData`
  - Internal types: `DeferredRedeemer`, `toDeferredRedeemer`

  **Evaluation phase updates**:
  - Add `resolveDeferredRedeemers` to convert deferred redeemers after coin selection
  - Build `refToIndex` and `refToUtxo` mappings from sorted inputs
  - Invoke Self/Batch callbacks with resolved `IndexedInput` objects

  **Operations updates**:
  - `collectFrom` and `mintTokens` now accept `RedeemerArg` (Data | SelfRedeemerFn | BatchRedeemerBuilder)
  - Store deferred redeemers in `state.deferredRedeemers` for later resolution

  **Test coverage** (`TxBuilder.RedeemerBuilder.test.ts`):
  - Tests for all three modes with mint_multi_validator.ak spec

  **Architecture docs** (`redeemer-indexing.mdx`):
  - Document the circular dependency problem and deferred construction solution
  - Explain stake validator coordinator pattern with O(1) index lookup

## 0.3.4

### Patch Changes

- [#101](https://github.com/IntersectMBO/evolution-sdk/pull/101) [`aaf0882`](https://github.com/IntersectMBO/evolution-sdk/commit/aaf0882e280fad9769410a81419ebf1c6af48785) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ### Core Module Enhancements

  **Mint Module**
  - Added `Mint.getByHex()` and `Mint.getAssetsByPolicyHex()` utilities for hex-based lookups
  - Fixed `Mint.insert`, `removePolicy`, `removeAsset`, and `get` to use content-based equality (`Equal.equals`) instead of reference equality for PolicyId/AssetName lookups

  **Fee Calculation**
  - Fixed `calculateFeeIteratively` to include mint field in fee calculation via TxContext access
  - Removed unnecessary 5000n fee buffer that caused fee overpayment

  **Transaction Builder**
  - Added `.mint()` method to TransactionBuilder for native token minting/burning
  - `.attachScript()` now accepts `{ script: CoreScript }` parameter format
  - Improved type safety by using Core types directly instead of SDK wrappers

  ### Devnet Package

  **Test Infrastructure**
  - Added `TxBuilder.Mint.test.ts` with devnet submit tests for minting and burning
  - Updated `TxBuilder.Scripts.test.ts` to use Core types (`PlutusV2.PlutusV2`) instead of SDK format
  - Refactored `createCoreTestUtxo` helper to accept Core `Script` types directly
  - Removed unused `createTestUtxo` (SDK format) helper
  - Added `Genesis.calculateUtxosFromConfig()` for retrieving initial UTxOs from genesis config
  - Replaced all `Buffer.from().toString("hex")` with `Text.toHex()` in tests

  ### Breaking Changes
  - `attachScript()` now requires `{ script: ... }` object format instead of passing script directly
  - Test helpers now use Core types exclusively

- [#103](https://github.com/IntersectMBO/evolution-sdk/pull/103) [`65b7259`](https://github.com/IntersectMBO/evolution-sdk/commit/65b7259b8b250b87d5420bca6458a5e862ba9406) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ### Remove Buffer Usage from Source Code

  Replaced all `Buffer.from()` usage with `Bytes.fromHex()` and `Bytes.toHex()` from the core module for better cross-platform compatibility.

  **Files Updated:**
  - `TxBuilderImpl.ts` - Use `Bytes.toHex()` for key hash hex conversion in `buildFakeWitnessSet`
  - `Assets/index.ts` - Use `Bytes.fromHex()` for policy ID and asset name decoding
  - `MaestroEffect.ts` - Use `Bytes.fromHex()` for transaction CBOR conversion
  - `Ogmios.ts` - Use `Bytes.toHex()` for datum hash hex conversion
  - `KupmiosEffects.ts` - Use `Bytes.fromHex()` for datum hash and script bytes decoding

- [#104](https://github.com/IntersectMBO/evolution-sdk/pull/104) [`c26391a`](https://github.com/IntersectMBO/evolution-sdk/commit/c26391a3783a5dca95b2ab1b2af95c98c62e4966) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - ### PlutusV3 Minting Support
  - Add PlutusV3 script minting with automatic script evaluation via Ogmios
  - Add `mintAssets` builder method for Plutus script-based minting policies
  - Add `attachScript` builder method for attaching Plutus scripts to transactions
  - Support both minting (positive amounts) and burning (negative amounts)

  ### Redeemer API Improvements
  - **Breaking**: Change `redeemer` parameter type from `string` (CBOR hex) to `Data.Data`
    - Affects `collectFrom()` and `mintAssets()` builder methods
    - Provides type-safe redeemer construction without manual CBOR encoding
    - Example: `redeemer: Data.constr(0n, [Data.int(1n)])` instead of hex strings

  ### Core Module Additions
  - Add `Redeemers` module with Conway CDDL-compliant encoding (array format)
  - Refactor `hashScriptData` to use proper module encoders for redeemers and datums
  - Add `Redeemers.toCBORBytes()` for script data hash computation

  ### Internal Improvements
  - Store `PlutusData.Data` directly in builder state instead of CBOR hex strings
  - Remove redundant CBOR hex encoding/decoding in transaction assembly
  - Add PlutusV3 minting devnet tests with real script evaluation

## 0.3.3

### Patch Changes

- [#98](https://github.com/IntersectMBO/evolution-sdk/pull/98) [`ef563f3`](https://github.com/IntersectMBO/evolution-sdk/commit/ef563f305879e6e7411d930a87733cc4e9f34314) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Migrate transaction builder and provider layer to use Core UTxO types throughout the SDK.

  ### New Core Types
  - **`Core.UTxO`** — Schema-validated UTxO with branded types (`TransactionHash`, `Address`, `Assets`)
  - **`Core.Assets`** — Enhanced with `merge`, `subtract`, `negate`, `getAsset`, `setAsset`, `hasAsset` operations
  - **`Core.Time`** — New module for slot/time conversions with `SlotConfig`, `Slot`, `UnixTime`
  - **`Core.Address`** — Added `getAddressDetails`, `getPaymentCredential`, `getStakingCredential` utilities

  ### SDK Changes
  - Provider methods (`getUtxos`, `getUtxoByUnit`, `getUtxosWithUnit`) now return `Core.UTxO.UTxO[]`
  - Client methods (`getWalletUtxos`, `newTx`) use Core UTxO internally
  - Transaction builder accepts `Core.UTxO.UTxO[]` for `availableUtxos`
  - `Genesis.calculateUtxosFromConfig` and `Genesis.queryUtxos` return Core UTxOs

  ### Rationale

  The SDK previously used a lightweight `{ txHash, outputIndex, address, assets }` record for UTxOs, requiring constant conversions when interfacing with the Core layer (transaction building, CBOR serialization). This caused:
  1. **Conversion overhead** — Every transaction build required converting SDK UTxOs to Core types
  2. **Type ambiguity** — `txHash: string` vs `TransactionHash`, `address: string` vs `Address` led to runtime errors
  3. **Inconsistent APIs** — Some methods returned Core types, others SDK types

  By standardizing on Core UTxO:
  - **Zero conversion** — UTxOs flow directly from provider → wallet → builder → transaction
  - **Type safety** — Branded types prevent mixing up transaction hashes, addresses, policy IDs
  - **Unified model** — Single UTxO representation across the entire SDK

  ### Migration

  ```typescript
  // Before
  const lovelace = Assets.getAsset(utxo.assets, "lovelace")
  const txId = utxo.txHash
  const idx = utxo.outputIndex
  const addr = utxo.address // string

  // After
  const lovelace = utxo.assets.lovelace
  const txId = Core.TransactionHash.toHex(utxo.transactionId)
  const idx = utxo.index // bigint
  const addr = Core.Address.toBech32(utxo.address) // or use Address directly
  ```

## 0.3.2

### Patch Changes

- [#88](https://github.com/IntersectMBO/evolution-sdk/pull/88) [`61ffded`](https://github.com/IntersectMBO/evolution-sdk/commit/61ffded47892f12bda6f538e8028b3fd64492187) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add CIP-30 message signing support with modular architecture

  This release introduces comprehensive CIP-30 `signData` and `verifyData` support, implementing the complete COSE Sign1 specification with a clean, modular structure:

  **New Features:**
  - Full CIP-30 message signing (`signData`) and verification (`verifyData`) implementation
  - COSE (CBOR Object Signing and Encryption) primitives per RFC 8152

## 0.3.1

### Patch Changes

- [#86](https://github.com/IntersectMBO/evolution-sdk/pull/86) [`5ee95bc`](https://github.com/IntersectMBO/evolution-sdk/commit/5ee95bc78220c9aa72bda42954b88e47c81a23eb) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix UTxO references in transaction building.

## 0.3.0

### Minor Changes

- [#76](https://github.com/IntersectMBO/evolution-sdk/pull/76) [`1f0671c`](https://github.com/IntersectMBO/evolution-sdk/commit/1f0671c068d44c1f88e677eb2d8bb55312ff2c38) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Extract devnet functionality to separate `@evolution-sdk/devnet` package for better modularity.

## 0.2.5

### Patch Changes

- [#72](https://github.com/IntersectMBO/evolution-sdk/pull/72) [`ea9ffbe`](https://github.com/IntersectMBO/evolution-sdk/commit/ea9ffbe11a8b6a8e97c1531c108d5467a7eda6a8) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add Plutus script spending support with reference inputs and inline datums.

## 0.2.4

### Patch Changes

- [#70](https://github.com/IntersectMBO/evolution-sdk/pull/70) [`5b735c8`](https://github.com/IntersectMBO/evolution-sdk/commit/5b735c856fac3562f0e5892bf84c841b1dc85281) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add Kupmios provider combining Kupo and Ogmios for efficient querying.

## 0.2.3

### Patch Changes

- [#68](https://github.com/IntersectMBO/evolution-sdk/pull/68) [`29c3e4d`](https://github.com/IntersectMBO/evolution-sdk/commit/29c3e4d3bac9b35c1586c6a94d6aee037aeb6d62) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add Maestro provider support.

## 0.2.2

### Patch Changes

- [#66](https://github.com/IntersectMBO/evolution-sdk/pull/66) [`7bb1da3`](https://github.com/IntersectMBO/evolution-sdk/commit/7bb1da32488c5a1a92a9c8b90e5aa4514e004232) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add Blockfrost provider support.

- [#64](https://github.com/IntersectMBO/evolution-sdk/pull/64) [`844dfec`](https://github.com/IntersectMBO/evolution-sdk/commit/844dfeccb48c0af0ce0cebfc67e6cdcc67e28cc8) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Improve transaction builder API with better error handling.

## 0.2.1

### Patch Changes

- [#62](https://github.com/IntersectMBO/evolution-sdk/pull/62) [`0dcf415`](https://github.com/IntersectMBO/evolution-sdk/commit/0dcf4155e7950ff46061100300355fb0a69e902d) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Initial public release with core transaction building functionality.
