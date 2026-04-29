# @evolution-sdk/evolution

## 0.5.6

### Patch Changes

- [#310](https://github.com/IntersectMBO/evolution-sdk/pull/310) [`72160b7`](https://github.com/IntersectMBO/evolution-sdk/commit/72160b770c58e05b5b1bbad6ada166ebf7943e82) Thanks [@Mavis2103](https://github.com/Mavis2103)! - Add `fullProtocolParameters` to `BuildOptions` for providerless transaction builds

- [#312](https://github.com/IntersectMBO/evolution-sdk/pull/312) [`a4404da`](https://github.com/IntersectMBO/evolution-sdk/commit/a4404daae38a354f019cdbc0805385c55e5c6aee) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add `registerStakeLegacy` and `deregisterStakeLegacy` builder methods for pre-Conway stake certificate support. These create `StakeRegistration` (CDDL tag 0) and `StakeDeregistration` (CDDL tag 1) certificates with no deposit, matching what most wallets use today. Both methods support script-controlled credentials with redeemers.

## 0.5.5

### Patch Changes

- [#308](https://github.com/IntersectMBO/evolution-sdk/pull/308) [`0da877a`](https://github.com/IntersectMBO/evolution-sdk/commit/0da877a0c9a2147832affc83e15d85ec758dc23a) Thanks [@Mavis2103](https://github.com/Mavis2103)! - Replace instanceof checks with duck-typing for Address vs Credential discrimination in provider implementations

## 0.5.4

### Patch Changes

- [#306](https://github.com/IntersectMBO/evolution-sdk/pull/306) [`73f9aaf`](https://github.com/IntersectMBO/evolution-sdk/commit/73f9aaf93798d80e24593e2d339f8b98efbd29be) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - The provider now reads `cost_models_raw` from the `/epochs/latest/parameters` response instead of the legacy `cost_models` field. The legacy field uses alphabetically-keyed names and is truncated post-Plomin (297 entries vs 350 canonical for PlutusV3), which produces an incorrect `script_data_hash` and causes `ScriptIntegrityHashMismatch` on any transaction carrying Plutus scripts. Falls back to `cost_models` for older API deployments that don't serve `cost_models_raw`.

- [#305](https://github.com/IntersectMBO/evolution-sdk/pull/305) [`032e545`](https://github.com/IntersectMBO/evolution-sdk/commit/032e54543d5798d4f154a59c733e59da02a99ffd) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Credential-based UTxO queries (`getUtxos` and `getUtxosWithUnit` with a `Credential` instead of an `Address`) now work across all providers that support them. Previously, passing a `Credential` to Blockfrost produced an invalid API path, and Koios silently rejected the query. Blockfrost now encodes credentials as CIP-5 bech32 (`addr_vkh`/`script` prefixes), and Koios routes credential queries to the `POST /credential_utxos` endpoint with hex-encoded payment credential hashes.
  - Added `toBech32`/`fromBech32` to `KeyHash` (`addr_vkh` prefix) and `ScriptHash` (`script` prefix)
  - Added `Credential.toHex` and `Credential.toBech32` convenience functions
  - Fixed `BlockfrostEffect.getUtxosWithUnit` reading the address from `addressPath` instead of the response `utxo.address`

## 0.5.3

### Patch Changes

- [#250](https://github.com/IntersectMBO/evolution-sdk/pull/250) [`10e5b44`](https://github.com/IntersectMBO/evolution-sdk/commit/10e5b44bb62055137278b9acc75660db3e3ef645) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fixed `getUtxos` and `getUtxosWithUnit` in the Kupmios provider producing invalid Kupo URLs when called with a `Credential` instead of an `Address`. The credential hash (a `Uint8Array`) was being interpolated directly into the URL pattern, resulting in a comma-separated list of byte values instead of the expected hex string. Both call sites now convert the hash to hex with `Bytes.toHex` before building the URL.

## 0.5.2

### Patch Changes

- [#246](https://github.com/IntersectMBO/evolution-sdk/pull/246) [`61ed73e`](https://github.com/IntersectMBO/evolution-sdk/commit/61ed73e60bc00951755d3d0a9ee09b12cdbeb149) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add `Address.fromSeed()` for synchronous address derivation from a BIP-39 seed phrase. This enables deriving addresses without constructing a `Client` or `Chain` instance — useful for devnet genesis funding where the address must be known before the cluster starts.

  The `Derivation` module now accepts a numeric `networkId` (0 = testnet, 1 = mainnet) instead of a `network` string (`"Mainnet" | "Testnet" | "Custom"`). The default changed from mainnet (1) to testnet (0). If you call `walletFromSeed`, `addressFromSeed`, `walletFromBip32`, or `walletFromPrivateKey` with the old `network` option, replace it with `networkId`:
  - `network: "Mainnet"` → `networkId: 1`
  - `network: "Testnet"` or `network: "Custom"` → `networkId: 0` (or omit, since 0 is the default)

- [#242](https://github.com/IntersectMBO/evolution-sdk/pull/242) [`2b464f8`](https://github.com/IntersectMBO/evolution-sdk/commit/2b464f8b4a1c441ca9b1484b08593e867b040710) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add `signTxs` method to `SigningClient`, `OfflineSignerClient`, and all wallet types for batch transaction signing per CIP-103. For CIP-30 browser wallets, the implementation detects `api.cip103.signTxs`, `api.experimental.signTxs`, or direct `api.signTxs` and falls back to sequential `api.signTx` calls when no batch method is available. Seed and private key wallets delegate to per-transaction signing internally.
  - `WalletApi` now accepts optional `cip103`, `experimental`, and direct `signTxs` properties
  - `TransactionSignatureRequest` type exported from `Wallet` module
  - `signTxsWithAutoFetch` aggregates reference inputs across all transactions in a single provider call

## 0.5.1

### Patch Changes

- [#243](https://github.com/IntersectMBO/evolution-sdk/pull/243) [`7fa8430`](https://github.com/IntersectMBO/evolution-sdk/commit/7fa843040e994b1c496260c101176cd0de679b97) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Restore Certificate.ts as a self-contained module and fix docgen compatibility. Remove convenience re-exports from Time.ts and update stale `@example` import paths for the flat module structure.

## 0.5.0

### Minor Changes

- [#240](https://github.com/IntersectMBO/evolution-sdk/pull/240) [`04c705e`](https://github.com/IntersectMBO/evolution-sdk/commit/04c705ea8c04e19161eaf02e8544279485f48389) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Flatten module structure to eliminate webpack casing conflicts on case-insensitive filesystems. The wildcard export now maps PascalCase filenames directly — namespace name equals filename equals import path, removing the directory/namespace casing mismatch that caused dual module identifiers in webpack builds.

  Modules previously nested in concept folders (address/, block/, transaction/, etc.) are now flat PascalCase files at the package root. Three subdirectories remain for separate domains with naming collisions: `plutus/` (on-chain script types), `cose/` (message signing protocol), and `blueprint/` (CIP-57 codegen). Deep imports into subdirectories are blocked.
  - Concept-folder subpath imports like `@evolution-sdk/evolution/address` are removed. Use the root barrel (`import { Address } from "@evolution-sdk/evolution"`) or the wildcard (`import * as Address from "@evolution-sdk/evolution/Address"`).
  - `MessageSigning` is renamed to `COSE` in the root barrel export.
  - `./plutus`, `./cose`, and `./blueprint` are available as subpath imports with namespaced barrels.
  - Blueprint barrel now uses `export * as` instead of `export *`.

## 0.4.0

### Minor Changes

- [#231](https://github.com/IntersectMBO/evolution-sdk/pull/231) [`7b36dc1`](https://github.com/IntersectMBO/evolution-sdk/commit/7b36dc10b3ae2607a395e721376f1729b7983bb1) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Reorganize flat module structure into semantic concept folders.
  - Move ~130 flat root-level files into 24 concept folders following Effect v4 conventions (camelCase folders, PascalCase files)
  - New folders: `address/`, `assets/`, `block/`, `blueprint/`, `bytes/`, `certificate/`, `credential/`, `data/`, `encoding/`, `governance/`, `messageSigning/`, `metadata/`, `network/`, `numeric/`, `plutus/`, `primitives/`, `relay/`, `script/`, `staking/`, `time/`, `transaction/`, `uplc/`, `value/`
  - Merge `datum/` into `data/` (DatumHash, DatumOption, InlineDatum alongside Data, TSchema, DataJson)
  - Extract `certificate/` from `governance/` (StakeCertificates and PoolCertificates have zero governance dependencies)
  - Move byte primitives (Bytes, Bytes4–448, BoundedBytes) from `primitives/` to `bytes/`
  - Move numeric types (Numeric, Natural, NonZeroInt64, UnitInterval) from `primitives/` to `numeric/`
  - Move CBOR and Codec from root to `encoding/`
  - Dissolve `utils/` anti-pattern: move hash functions to input-type modules via `to` pattern (TransactionBody.toHash, Data.toDatumHash, etc.)
  - Delete dead code: `Combinator.ts` (zero consumers, contained a bug), `FormatError.ts` (zero consumers), `NativeScriptsOLD.ts`, `Function.ts`
  - Rename non-conforming folders: `Assets/` → `assets/`, `Time/` → `time/`, `message-signing/` → `messageSigning/`
  - All public API exports preserved via barrel files and package.json exports map

### Patch Changes

- [#237](https://github.com/IntersectMBO/evolution-sdk/pull/237) [`c68507b`](https://github.com/IntersectMBO/evolution-sdk/commit/c68507b91ea7adfbfdae11ead52280f7cfd95305) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Conway-era transactions encode certificates as `#6.258([+ certificate])` (CBOR tag 258, a nonempty ordered set). TransactionBody deserialization now unwraps tag 258 when present on the certificates field (key 4), and serialization wraps the array in tag 258 so round-tripped bytes match the on-chain encoding.

- [#236](https://github.com/IntersectMBO/evolution-sdk/pull/236) [`f0c7ea4`](https://github.com/IntersectMBO/evolution-sdk/commit/f0c7ea4254a2c9d96551df294ecf4535872e79e4) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - `Transaction.fromCBORHex` and `Transaction.fromCBORBytes` now preserve the original CBOR encoding format (e.g. indefinite-length arrays) through round-trips. Previously, decoding via the default path normalised indefinite-length markers (`0x9f`) to definite-length (`0x81`), which silently broke `scriptDataHash` validation when the transaction contained non-canonical PlutusData in redeemers.

  The fix caches the CBOR format tree in a WeakMap on decode and re-applies it on encode, making the default `fromCBOR → toCBOR` path lossless with no API surface change. `addVKeyWitnesses` transfers the cached format to the resulting transaction.

- [#228](https://github.com/IntersectMBO/evolution-sdk/pull/228) [`a2310b0`](https://github.com/IntersectMBO/evolution-sdk/commit/a2310b0399377c69b3342182b9745c72d9bcd5bf) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Restructure transaction builder internals for maintainability.
  - Extract monolithic `TxBuilderImpl.ts` into focused internal modules (`build.ts`, `ctx.ts`, `factory.ts`, `layers.ts`, `resolve.ts`, `state.ts`, `txBuilder.ts`)
  - Rename internal modules from PascalCase to camelCase per Effect conventions
  - Add `Address.isScript` predicate and `UTxO.totalAssets`/`UTxO.toInputs` utilities to core modules
  - Remove unnecessary Effect wrappers from pure functions (`makeTxOutput`, `calculateTransactionSize`)
  - Fix `Unfrack.ts` ScriptRef encoding to use `fromHexStrings` instead of `fromUnit`
  - Fix `Stake.ts` withdraw to use dependency injection for `TxBuilderConfig`

## 0.3.32

### Patch Changes

- [#227](https://github.com/IntersectMBO/evolution-sdk/pull/227) [`b5eca41`](https://github.com/IntersectMBO/evolution-sdk/commit/b5eca41b1ccd2ac4fe23be618b303a504f241bbd) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Restructured client internals and fixed several consistency issues in the promise-based API layer.

  Signing logic has been extracted from `Wallets.ts` into a dedicated `internal/Signing.ts` module, and client assembly now lives in `internal/Client.ts`. The `WalletNew` module was renamed to `Wallet`; the legacy `ClientImpl` and `dual` modules were removed.

  `runEffectPromise` no longer mutates error stack traces — the `cleanErrorChain` infrastructure was removed entirely. `Cause.squash` now throws the original error object unchanged, which means `instanceof` checks and `_tag` discrimination work correctly when consumers catch errors from promise-based methods.

  All 19 `Effect.runPromise` call sites in the client layer were replaced with `runEffectPromise` so errors are consistently unwrapped across `readOnlyWallet`, `cip30Wallet`, `createOfflineSignerClient`, `createReadOnlyClient`, and `createSigningClient`.
  - Provider method wiring in `SigningClient` now uses spread instead of manual `.bind()` calls
  - `ProviderError.cause` is now optional, matching `WalletError` and `TransactionBuilderError`
  - Removed `cause: null` sentinels from all error constructors

- [#224](https://github.com/IntersectMBO/evolution-sdk/pull/224) [`7e87db9`](https://github.com/IntersectMBO/evolution-sdk/commit/7e87db9c5c0cd934fe070579528c4d139c8d6c7e) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Introduce composable client API with Chain, Providers, and Wallets modules. Fix signMessage returning vkey instead of signature, seedWallet ignoring paymentIndex/stakeIndex, redundant RewardAddress decode in getWalletDelegation, and dualify missing prototype-chain methods. Add chain property to ProviderOnlyClient and ApiWalletClient, remove MinimalClient.attach shortcut, and align ReadOnlyClient.newTx() signature with SigningClient.

## 0.3.31

### Patch Changes

- [`16cb6fd`](https://github.com/IntersectMBO/evolution-sdk/commit/16cb6fd55670bb51f823469e52ac71cfb23b0d1f) Thanks [@hadelive](https://github.com/hadelive)! - fix: make min_utxo optional in Blockfrost protocol parameters schema

## 0.3.30

### Patch Changes

- [#215](https://github.com/IntersectMBO/evolution-sdk/pull/215) [`19829c7`](https://github.com/IntersectMBO/evolution-sdk/commit/19829c7c6e1cd1ac3a33fb180e4482016791dcd5) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Blueprint codegen now supports recursive type schemas — Plutus types that reference themselves
  directly or through an intermediate type (e.g. `MultiSig` containing a `List<MultiSig>` field).
  Cyclic references are emitted as typed `Schema.suspend` thunks where the encoded type `I` is
  inferred by recursively walking the blueprint definition graph rather than hardcoded to `Data.Constr`:
  `list` → `readonly ItemEncoded[]`, `map` → `globalThis.Map<Data.Data, Data.Data>`,
  `bytes` → `Uint8Array`, `integer` → `bigint`, `constructor` and union → `Data.Constr`,
  `$ref` followed transitively up to depth 10. The previous hardcoded `Data.Constr` caused a
  TypeScript invariance error for any recursive field referencing a list type.

  Several other codegen correctness and API improvements ship in the same release:
  - **Namespace emission ordering** — the group-by-namespace emitter is replaced by a streaming emitter
    that walks a global topological sort and opens/closes namespace blocks on demand. TypeScript namespace
    merging handles split declarations transparently. This fixes cases where a type was emitted before
    its cross-namespace dependency (e.g. `Option.OfStakeCredential` appearing before `Cardano.Address.StakeCredential`).
  - **Cyclic type emit pattern** — cyclic types now emit a `export type X = ...` / `export const X = ...`
    pair with no outer `Schema.suspend` wrapper and no `as` cast. Only the inner field references that
    close the cycle use typed thunks: `Schema.suspend((): Schema.Schema<T, I> => T)`.
  - **`unionStyle` config** — `CodegenConfig` gains `unionStyle: "Variant" | "Struct" | "TaggedStruct"`
    in place of the removed `forceVariant` and `useSuspend` fields. `Struct` emits
    `TSchema.Struct({ Tag: TSchema.Struct({...}, { flatFields: true }) }, { flatInUnion: true })`,
    `TaggedStruct` emits `TSchema.TaggedStruct("Tag", {...}, { flatInUnion: true })`,
    and `Variant` emits `TSchema.Variant({ Tag: {...} })`.
  - **Import hygiene** — generated files emit `import { Schema } from "@evolution-sdk/evolution"`
    only when cyclic types are present, rather than always importing from `effect` directly.
    `CodegenConfig.imports.effect` is replaced by `imports.schema`.

## 0.3.29

### Patch Changes

- [#210](https://github.com/IntersectMBO/evolution-sdk/pull/210) [`03e4dea`](https://github.com/IntersectMBO/evolution-sdk/commit/03e4deaace5a98a2def15ebb088262160c77cd2c) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix Blockfrost evaluateTx failing on multi-asset UTxOs by correcting the value format sent to the Ogmios endpoint. Standardize error handling across all providers with consistent catchAll + wrapError pattern. Add JSONWSP fault detection to Blockfrost evaluation responses. Accept both CBOR tag-258 and plain array encodings in TransactionBody decoding.

## 0.3.28

### Patch Changes

- [#208](https://github.com/IntersectMBO/evolution-sdk/pull/208) [`76bbaa2`](https://github.com/IntersectMBO/evolution-sdk/commit/76bbaa2d1cebb40a52a037b23cd80f1fef20388d) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix Koios `getProtocolParameters` returning stale epoch data on preview by explicitly ordering `epoch_params` descending

## 0.3.27

### Patch Changes

- [#203](https://github.com/IntersectMBO/evolution-sdk/pull/203) [`9701411`](https://github.com/IntersectMBO/evolution-sdk/commit/9701411a17a4a2ef4d9b6c3547d3314801ec616c) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix `awaitTx` failing with a `ParseError` when Koios returns `asset_list` as a Haskell show-formatted string on collateral outputs. Add configurable `timeout` parameter to `awaitTx` across all providers (Koios, Blockfrost, Maestro, Kupmios).

- [#204](https://github.com/IntersectMBO/evolution-sdk/pull/204) [`78e8fd7`](https://github.com/IntersectMBO/evolution-sdk/commit/78e8fd756021c69cecd810d3a95ed34af721ce56) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Pass network to TxBuilder so testnet slot configs resolve correctly instead of always defaulting to Mainnet.

## 0.3.26

### Patch Changes

- [#201](https://github.com/IntersectMBO/evolution-sdk/pull/201) [`619c52b`](https://github.com/IntersectMBO/evolution-sdk/commit/619c52bd843d45e3062cfe3a7a49438c181e45d7) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Script transactions with certificate or withdrawal redeemers evaluated via Blockfrost no longer spam warning logs or loop indefinitely. Blockfrost's Ogmios v5 JSONWSP format returns `"certificate:N"` and `"withdrawal:N"` as redeemer pointer keys; these are now normalized to the canonical `"cert"` and `"reward"` tags before evaluation matching. Unmatched redeemer tags from any evaluator now fail immediately instead of silently leaving ExUnits at zero.

- [#200](https://github.com/IntersectMBO/evolution-sdk/pull/200) [`3685736`](https://github.com/IntersectMBO/evolution-sdk/commit/3685736ec8fb7b536d88d7ef4044846a8cebb52f) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix several provider mapping bugs that caused incorrect or missing data in `getDelegation`, `getDatum`, and `getUtxos` responses.

  **Koios**
  - `getDelegation`: was decoding the pool ID with `PoolKeyHash.FromHex` but Koios returns a bech32 `pool1…` string — switched to `PoolKeyHash.FromBech32`
  - `getUtxos`: `datumOption` and `scriptRef` fields were never populated — all UTxOs returned `datumOption: null, scriptRef: null` regardless of on-chain state. Now correctly maps inline datums, datum hashes, and native/Plutus script references.

  **Kupmios (Ogmios)**
  - `getDelegation`: the Ogmios v6 response is an array, but the code was using `Object.values(result)[0]` which silently produced wrong data on some responses. Switched to `result[0]`. Also corrected the field path from `delegate.id` to `stakePool.id` to match the v6 schema, and decoded the bech32 pool ID through `Schema.decode(PoolKeyHash.FromBech32)` so the return type satisfies `Provider.Delegation`.

  **Blockfrost**
  - `getDatum`: was calling `/scripts/datum/{hash}` which returns only the data hash — should be `/scripts/datum/{hash}/cbor` to get the actual CBOR-encoded datum value. Switched endpoint and response schema to `BlockfrostDatumCbor`.

## 0.3.25

### Patch Changes

- [#198](https://github.com/IntersectMBO/evolution-sdk/pull/198) [`24f1d59`](https://github.com/IntersectMBO/evolution-sdk/commit/24f1d59ee64dfb9ca0d2f73f8c5afe9b41a09816) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Filter out UTxOs with an empty `tx_hash` in Blockfrost `getUtxos` and `getUtxosWithUnit` to prevent a `ParseError` crash when providers like Dolos return malformed entries

- [#183](https://github.com/IntersectMBO/evolution-sdk/pull/183) [`277df7b`](https://github.com/IntersectMBO/evolution-sdk/commit/277df7be130609c16a4e44c023de0bce637a4fd4) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Handle plain-text responses in `postUint8Array` for compatibility with backends that return unquoted strings from `POST /tx/submit`

- [#192](https://github.com/IntersectMBO/evolution-sdk/pull/192) [`536eeb3`](https://github.com/IntersectMBO/evolution-sdk/commit/536eeb37ec734db2547da4fc597f5466dd94c12a) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - `addVKeyWitnessesBytes` now uses the WithFormat round-trip to merge witnesses, preserving original CBOR encoding rather than performing manual byte surgery.

## 0.3.24

### Patch Changes

- [#193](https://github.com/IntersectMBO/evolution-sdk/pull/193) [`37bd6fe`](https://github.com/IntersectMBO/evolution-sdk/commit/37bd6fe86eba7de12e7d77f072fe71f386ef7194) Thanks [@hadelive](https://github.com/hadelive)! - fix preserve original CBOR bytes when signing hex transactions

## 0.3.23

### Patch Changes

- [#191](https://github.com/IntersectMBO/evolution-sdk/pull/191) [`2a0c360`](https://github.com/IntersectMBO/evolution-sdk/commit/2a0c3603fbb3405c3b1e0d6e51935f28ed035611) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Add CBOR encoding preservation for bit-perfect round-trip fidelity and redesign Redeemers as a discriminated union (RedeemerMap + RedeemerArray)

## 0.3.22

### Patch Changes

- [#174](https://github.com/IntersectMBO/evolution-sdk/pull/174) [`a4fbd49`](https://github.com/IntersectMBO/evolution-sdk/commit/a4fbd49410b65a831d3d84091cfe11ba6b730ee8) Thanks [@hadelive](https://github.com/hadelive)! - byte-level vkey witness merging

## 0.3.21

### Patch Changes

- [#175](https://github.com/IntersectMBO/evolution-sdk/pull/175) [`38a460f`](https://github.com/IntersectMBO/evolution-sdk/commit/38a460f7a58212a42c720e3d165456bdee9ce505) Thanks [@solidsnakedev](https://github.com/solidsnakedev)! - Fix scriptDataHash integrity mismatch when spending UTxOs carrying inline scriptRef (e.g. PlutusV3) via `collectFrom()` without `attachScript()` or `readFrom()`. Also correct tiered reference-script fee calculation to match the Conway ledger formula (stride 25,600 bytes, 1.2× multiplier per tier, `minFeeRefScriptCostPerByte` protocol parameter).

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
