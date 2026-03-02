# @evolution-sdk/devnet

## 1.1.20

### Patch Changes

- Updated dependencies [[`d139b44`](https://github.com/IntersectMBO/evolution-sdk/commit/d139b4456d46e783e9172b7fcd7c3bf7ae624fc6), [`e0245ae`](https://github.com/IntersectMBO/evolution-sdk/commit/e0245ae2d33c1712591bc26504928c6797a6a668), [`eebd2b0`](https://github.com/IntersectMBO/evolution-sdk/commit/eebd2b0c826f25d96244943da1b28f9b2cefd3e4), [`26dfe7e`](https://github.com/IntersectMBO/evolution-sdk/commit/26dfe7edaebaf38087ccd6d367a226369dda2a01)]:
  - @evolution-sdk/aiken-uplc@0.0.12
  - @evolution-sdk/evolution@0.3.20
  - @evolution-sdk/scalus-uplc@0.0.10

## 1.1.19

### Patch Changes

- Updated dependencies [[`e032384`](https://github.com/IntersectMBO/evolution-sdk/commit/e032384da83205f23a3d7358d60776b3b220f810)]:
  - @evolution-sdk/evolution@0.3.19
  - @evolution-sdk/aiken-uplc@0.0.11
  - @evolution-sdk/scalus-uplc@0.0.9

## 1.1.18

### Patch Changes

- Updated dependencies [[`16fdf5d`](https://github.com/IntersectMBO/evolution-sdk/commit/16fdf5df0587d373c8006437bfc26a9c60b657ee), [`d31f1d4`](https://github.com/IntersectMBO/evolution-sdk/commit/d31f1d43a9555b9dfda244867c4c1173b3298bde)]:
  - @evolution-sdk/evolution@0.3.18
  - @evolution-sdk/aiken-uplc@0.0.10
  - @evolution-sdk/scalus-uplc@0.0.8

## 1.1.17

### Patch Changes

- Updated dependencies [[`25ebda0`](https://github.com/IntersectMBO/evolution-sdk/commit/25ebda0a7812571d412abf8ba46830c688a80e15)]:
  - @evolution-sdk/evolution@0.3.17
  - @evolution-sdk/aiken-uplc@0.0.9
  - @evolution-sdk/scalus-uplc@0.0.7

## 1.1.16

### Patch Changes

- Updated dependencies [[`63c8491`](https://github.com/IntersectMBO/evolution-sdk/commit/63c84919b79690dc3b108616bb84fbd3841f09b7)]:
  - @evolution-sdk/evolution@0.3.16
  - @evolution-sdk/aiken-uplc@0.0.8
  - @evolution-sdk/scalus-uplc@0.0.6

## 1.1.15

### Patch Changes

- Updated dependencies [[`d801fa1`](https://github.com/IntersectMBO/evolution-sdk/commit/d801fa1ce89c4cdea70cb19c4efa919446dadcaa)]:
  - @evolution-sdk/evolution@0.3.15
  - @evolution-sdk/aiken-uplc@0.0.7
  - @evolution-sdk/scalus-uplc@0.0.5

## 1.1.14

### Patch Changes

- Updated dependencies [[`d21109b`](https://github.com/IntersectMBO/evolution-sdk/commit/d21109b3f42bdee33f1c8e3ecf274ca04735f8f5)]:
  - @evolution-sdk/evolution@0.3.14
  - @evolution-sdk/aiken-uplc@0.0.6
  - @evolution-sdk/scalus-uplc@0.0.4

## 1.1.13

### Patch Changes

- Updated dependencies [[`8494053`](https://github.com/IntersectMBO/evolution-sdk/commit/84940535cee0bd742417c20969f06181ed9cf260), [`2742e40`](https://github.com/IntersectMBO/evolution-sdk/commit/2742e40ea0e62cd75d2a958bed0b6ff6138ded59)]:
  - @evolution-sdk/scalus-uplc@0.0.3
  - @evolution-sdk/evolution@0.3.13
  - @evolution-sdk/aiken-uplc@0.0.5

## 1.1.12

### Patch Changes

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

- Updated dependencies [[`15be602`](https://github.com/IntersectMBO/evolution-sdk/commit/15be602a53dfcf59b8f0ccec55081904eaf7ff89), [`150fde4`](https://github.com/IntersectMBO/evolution-sdk/commit/150fde4cc73a52b999f89578b07e1e5f4cab0418), [`8b8ade7`](https://github.com/IntersectMBO/evolution-sdk/commit/8b8ade75f51dd1103dcf4b3714f0012d8e430725)]:
  - @evolution-sdk/evolution@0.3.12
  - @evolution-sdk/scalus-uplc@0.0.2
  - @evolution-sdk/aiken-uplc@0.0.4

## 1.1.11

### Patch Changes

- [#122](https://github.com/IntersectMBO/evolution-sdk/pull/122) [`079fd98`](https://github.com/IntersectMBO/evolution-sdk/commit/079fd98c2a1457b2d0fa2417d6e29ef996b59411) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add propose and vote APIs: introduce new operations for creating governance proposals and casting votes, including supporting types, procedures, and validators.

- Updated dependencies [[`079fd98`](https://github.com/IntersectMBO/evolution-sdk/commit/079fd98c2a1457b2d0fa2417d6e29ef996b59411)]:
  - @evolution-sdk/evolution@0.3.11
  - @evolution-sdk/aiken-uplc@0.0.3

## 1.1.10

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

- Updated dependencies [[`ed9bdc0`](https://github.com/IntersectMBO/evolution-sdk/commit/ed9bdc07011bcc4875b61fdd6b4f8e4219bb67e4)]:
  - @evolution-sdk/aiken-uplc@0.0.2
  - @evolution-sdk/evolution@0.3.10

## 1.1.9

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

- Updated dependencies [[`59b6187`](https://github.com/IntersectMBO/evolution-sdk/commit/59b6187cc9d7080ed580341d92c7845d47125c7c), [`0503b96`](https://github.com/IntersectMBO/evolution-sdk/commit/0503b968735bc221b3f4d005d5c97ac8a0a1c592)]:
  - @evolution-sdk/aiken-uplc@0.0.1
  - @evolution-sdk/evolution@0.3.9

## 1.1.8

### Patch Changes

- Updated dependencies [[`7905507`](https://github.com/IntersectMBO/evolution-sdk/commit/79055076ab31214dc4c7462553484e9c2bcaf22c)]:
  - @evolution-sdk/evolution@0.3.8

## 1.1.7

### Patch Changes

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

- Updated dependencies [[`c59507e`](https://github.com/IntersectMBO/evolution-sdk/commit/c59507eafd942cd5bce1d3608c9c3e9c99a4cac8), [`9ddc79d`](https://github.com/IntersectMBO/evolution-sdk/commit/9ddc79dbc9b6667b3f2981dd06875878d9ad14f5), [`0730f23`](https://github.com/IntersectMBO/evolution-sdk/commit/0730f2353490ff1fa75743cccc0d05b33cff1b23)]:
  - @evolution-sdk/evolution@0.3.7

## 1.1.6

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

- Updated dependencies [[`1e1aec8`](https://github.com/IntersectMBO/evolution-sdk/commit/1e1aec88dfc726ff66809f51671d80b3f469eb5c)]:
  - @evolution-sdk/evolution@0.3.6

## 1.1.5

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

- Updated dependencies [[`98b59fa`](https://github.com/IntersectMBO/evolution-sdk/commit/98b59fa49d5a4e454e242a9c400572677e2f986f)]:
  - @evolution-sdk/evolution@0.3.5

## 1.1.4

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

- Updated dependencies [[`aaf0882`](https://github.com/IntersectMBO/evolution-sdk/commit/aaf0882e280fad9769410a81419ebf1c6af48785), [`65b7259`](https://github.com/IntersectMBO/evolution-sdk/commit/65b7259b8b250b87d5420bca6458a5e862ba9406), [`c26391a`](https://github.com/IntersectMBO/evolution-sdk/commit/c26391a3783a5dca95b2ab1b2af95c98c62e4966)]:
  - @evolution-sdk/evolution@0.3.4

## 1.1.3

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

- Updated dependencies [[`ef563f3`](https://github.com/IntersectMBO/evolution-sdk/commit/ef563f305879e6e7411d930a87733cc4e9f34314)]:
  - @evolution-sdk/evolution@0.3.3

## 1.1.2

### Patch Changes

- [#93](https://github.com/IntersectMBO/evolution-sdk/pull/93) [`7edb423`](https://github.com/IntersectMBO/evolution-sdk/commit/7edb4237059b39815241823cf46ce3bf128e7600) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix module resolution error by moving @noble/hashes from peerDependencies to dependencies. This resolves the "Package subpath './blake2' is not defined by exports" error when users install the package.

- Updated dependencies [[`61ffded`](https://github.com/IntersectMBO/evolution-sdk/commit/61ffded47892f12bda6f538e8028b3fd64492187)]:
  - @evolution-sdk/evolution@0.3.2

## 1.1.1

### Patch Changes

- Updated dependencies [[`5ee95bc`](https://github.com/IntersectMBO/evolution-sdk/commit/5ee95bc78220c9aa72bda42954b88e47c81a23eb)]:
  - @evolution-sdk/evolution@0.3.1

## 1.1.0

### Minor Changes

- [#80](https://github.com/IntersectMBO/evolution-sdk/pull/80) [`b52e9c7`](https://github.com/IntersectMBO/evolution-sdk/commit/b52e9c7a0b21c166fe9c3463539a1ff277035ee8) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - **Restructured module exports** for better modularity and clarity:
  - Replaced monolithic `Devnet` and `DevnetDefault` exports with granular named exports: `Cluster`, `Config`, `Container`, `Genesis`, and `Images`
  - Renamed types: `DevNetCluster` → `Cluster.Cluster`, `DevNetContainer` → `Container.Container`
  - Moved `DEFAULT_SHELLEY_GENESIS` from `DevnetDefault` to `Config` module

  **New Features:**
  - **Genesis module** - Calculate and query genesis UTxOs with Cardano's `initialFundsPseudoTxIn` algorithm:
    - `calculateUtxosFromConfig()` - Deterministically compute genesis UTxOs from Shelley genesis configuration using blake2b-256 hashing
    - `queryUtxos()` - Query actual genesis UTxOs from running node via cardano-cli
    - Provides predictable UTxO structure for testing without node interaction
  - **Images module** - Docker image management utilities:
    - `isAvailable()` - Check if Docker image exists locally
    - `pull()` - Pull Docker images with progress logging
    - `ensureAvailable()` - Conditionally pull images only when needed

  **Improvements:**
  - Enhanced error handling with specific error reasons (`address_conversion_failed`, `utxo_query_failed`, `utxo_parse_failed`, `image_inspection_failed`, `image_pull_failed`)
  - All operations provide both Effect-based and Promise-based APIs for flexibility
  - Improved test coverage with descriptive cluster names for easier debugging
  - Full Effect error channel integration throughout the package

  **Breaking Changes:**

  Migration required for existing devnet users:

  ```typescript
  // Before
  import { Devnet, DevnetDefault } from "@evolution-sdk/devnet"

  const cluster = await Devnet.Cluster.make()
  const config = DevnetDefault.DEFAULT_SHELLEY_GENESIS

  // After
  import { Cluster, Config } from "@evolution-sdk/devnet"

  const cluster = await Cluster.make()
  const config = Config.DEFAULT_SHELLEY_GENESIS
  ```

  All module functionality remains the same, only import syntax has changed to use destructured named exports from the main package.

## 1.0.0

### Minor Changes

- [#76](https://github.com/IntersectMBO/evolution-sdk/pull/76) [`1f0671c`](https://github.com/IntersectMBO/evolution-sdk/commit/1f0671c068d44c1f88e677eb2d8bb55312ff2c38) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Initial release of @evolution-sdk/devnet as a standalone package. Extracted from @evolution-sdk/evolution for better modularity and maintainability.

### Patch Changes

- Updated dependencies [[`1f0671c`](https://github.com/IntersectMBO/evolution-sdk/commit/1f0671c068d44c1f88e677eb2d8bb55312ff2c38)]:
  - @evolution-sdk/evolution@0.3.0

## 0.2.5

### Minor Changes

- Initial release of @evolution-sdk/devnet as a standalone package
- Extracted from @evolution-sdk/evolution for better modularity
- Full Docker-based local Cardano devnet support
- Configurable genesis parameters and network settings
- Optional Kupo and Ogmios service integration
- Effect-based API for type-safe async operations
- Deterministic genesis UTxO calculation
- Comprehensive test suite included
