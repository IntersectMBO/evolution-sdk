# @evolution-sdk/devnet

## 2.0.0

### Patch Changes

- Updated dependencies [[`61ffded`](https://github.com/IntersectMBO/evolution-sdk/commit/61ffded47892f12bda6f538e8028b3fd64492187)]:
  - @evolution-sdk/evolution@0.4.0

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
