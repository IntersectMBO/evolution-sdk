<div align="center">
  
  # Evolution SDK
  
  **TypeScript-first Cardano development with static type inference**
  
  Build robust Cardano applications with modern TypeScript, functional programming, and comprehensive type safety.
  
  [![Build Status](https://img.shields.io/github/actions/workflow/status/IntersectMBO/evolution-sdk/ci.yml?branch=main)](https://github.com/IntersectMBO/evolution-sdk/actions)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
  [![Effect](https://img.shields.io/badge/Effect-3.0+-blueviolet.svg)](https://effect.website/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  
  [Documentation](https://intersectmbo.github.io/evolution-sdk) • [Quick Start](#quick-start) • [Contributing](#contributing)
</div>

---

## What is Evolution SDK?

Evolution SDK is a **TypeScript-first** Cardano development framework. Define your data schemas and build transactions with full type safety. You'll get back strongly typed, validated results with comprehensive error handling.

```typescript
import { createClient } from "@evolution-sdk/evolution"

// Create a client with wallet and provider
const client = createClient({
  network: "preprod",
  provider: {
    type: "blockfrost",
    baseUrl: "https://cardano-preprod.blockfrost.io/api/v0",
    projectId: process.env.BLOCKFROST_API_KEY!
  },
  wallet: {
    type: "seed",
    mnemonic: "your twelve word mnemonic phrase here...",
    accountIndex: 0
  }
})

// Build a transaction with full type safety
const tx = await client
  .newTx()
  .payToAddress({
    address: "addr_test1qz...",
    assets: { lovelace: 2000000n }
  })
  .build()

// Sign and submit
const signed = await tx.sign()
const hash = await signed.submit()
console.log("Transaction submitted:", hash)
```

## Features

- **Zero runtime errors** - Comprehensive TypeScript types for all Cardano primitives
- **Effect-powered** - Built on Effect for robust error handling and async operations  
- **Blazing fast** - Modern tooling with hot reload and optimized builds
- **DevNet ready** - Local blockchain development with Docker integration
- **Modular design** - Tree-shakeable exports for minimal bundle size
- **CBOR first-class** - Native support for Cardano's binary format
- **Battle-tested** - Production-ready with comprehensive test coverage

---

## Installation

```bash
npm install @evolution-sdk/evolution
```

## 🐳 Docker Quick Start

Run the complete development environment with Docker:

```bash
# Clone the repository
git clone https://github.com/IntersectMBO/evolution-sdk.git
cd evolution-sdk

# Start documentation site at http://localhost:3000
docker-compose up -d evolution-docs

# Access the documentation at http://localhost:3000/docs

# Or start SDK development environment
docker-compose up -d evolution-dev

# View logs
docker-compose logs -f evolution-docs

# Stop containers
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

**Using build helper script:**

```bash
# Build all images
./docker-build.sh all

# Build specific images
./docker-build.sh dev     # Development image
./docker-build.sh prod    # Production image
./docker-build.sh docs    # Documentation site

# Run tests in Docker
./docker-build.sh test

# View help
./docker-help.sh
```

**Available containers:**
- **evolution-docs** - Documentation site (Next.js) on port 3000
- **evolution-dev** - SDK development with hot reload
- **cardano-devnet** - Local Cardano blockchain node

For complete Docker documentation, see [DOCKER.md](./DOCKER.md)

---

## Quick Start

```typescript
import { Core, createClient } from "@evolution-sdk/evolution"

// Work with addresses - convert between formats
const bech32 = "addr1qx2kd28nq8ac5prwg32hhvudlwggpgfp8utlyqxu6wqgz62f79qsdmm5dsknt9ecr5w468r9ey0fxwkdrwh08ly3tu9sy0f4qd"

// Parse Bech32 to address structure
const address = Core.Address.fromBech32(bech32)
console.log("Network ID:", address.networkId)
console.log("Payment credential:", address.paymentCredential)

// Convert to different formats
const hex = Core.Address.toHex(address)
const bytes = Core.Address.toBytes(address)

// Build and submit transactions
const client = createClient({
  network: "preprod",
  provider: {
    type: "blockfrost",
    baseUrl: "https://cardano-preprod.blockfrost.io/api/v0",
    projectId: process.env.BLOCKFROST_API_KEY!
  },
  wallet: {
    type: "seed",
    mnemonic: "your mnemonic here...",
    accountIndex: 0
  }
})

const tx = await client
  .newTx()
  .payToAddress({
    address: bech32,
    assets: { lovelace: 2000000n }
  })
  .build()

const signed = await tx.sign()
const txHash = await signed.submit()
```

## Architecture

Evolution SDK is built as a **single package** with a clean, modular structure that's ready for future expansion:

```
evolution-sdk/
├── 📦 packages/
│   └── evolution/           # Main SDK package
│       ├── src/
│       │   ├── Address.ts   # Address utilities
│       │   ├── Transaction.ts # Transaction building
│       │   ├── Devnet/      # Development network tools
│       │   └── ...
│       └── dist/            # Compiled output
├── docs/                    # Documentation
├── turbo.json              # Turbo configuration
├── pnpm-workspace.yaml     # Workspace configuration
└── flake.nix               # Nix development environment
```

## Package

| Package                                            | Description                                                                  | Status                                                                                                                     | Documentation                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`@evolution-sdk/evolution`](./packages/evolution) | Complete Cardano SDK with address management, transactions, and DevNet tools | In Development | [README](./packages/evolution/README.md) |

### Core Features

- **Address Management**: Create, validate, and convert Cardano addresses
- **Transaction Building**: Construct and serialize transactions with type safety
- **CBOR Encoding/Decoding**: Handle Cardano's binary data format
- **Network Utilities**: Tools for different Cardano networks
- **DevNet Integration**: Local development blockchain with Docker
- **Data Schemas**: Comprehensive Cardano data type definitions

## Core Modules

Evolution SDK provides **125+ core modules** plus SDK utilities, organized into comprehensive categories:

### Address Management (10 modules)
- `Address` - Core address utilities with bech32/hex encoding
- `BaseAddress`, `ByronAddress`, `EnterpriseAddress` - Address type implementations
- `PaymentAddress`, `PointerAddress`, `RewardAddress` - Specialized addresses
- `AddressEras`, `AddressTag`, `StakeReference` - Address metadata

### Transaction Handling (9 modules)
- `Transaction`, `TransactionBody`, `TransactionHash` - Core transaction types
- `TransactionInput`, `TransactionOutput`, `TransactionIndex` - I/O handling
- `TransactionWitnessSet`, `TransactionMetadatum`, `TransactionMetadatumLabels` - Metadata & witnesses

### Cryptography & Security (9 modules)
- `Ed25519Signature`, `KesSignature`, `VrfCert` - Digital signatures
- `Hash28`, `KeyHash`, `VrfKeyHash` - Hash utilities
- `VKey`, `KESVkey`, `VrfVkey` - Verification keys

### Value & Assets (7 modules)
- `Coin`, `PositiveCoin`, `Value` - ADA and multi-asset handling
- `MultiAsset`, `AssetName`, `PolicyId` - Asset management
- `Mint` - Minting operations

### Scripts & Certificates (7 modules)
- `Certificate`, `NativeScripts`, `NativeScriptJSON` - Script support
- `ScriptDataHash`, `ScriptHash`, `ScriptRef` - Script utilities

### Governance & Staking (12 modules)
- `DRep`, `DRepCredential`, `VotingProcedures` - Governance
- `ProposalProcedures`, `CommitteeColdCredential`, `CommitteeHotCredential` - Committee
- `PoolKeyHash`, `PoolMetadata`, `PoolParams` - Pool management
- `Withdrawals`, `Credential` - Staking operations

### Network & Communication (11 modules)
- `Network`, `NetworkId`, `Relay` - Network utilities
- `IPv4`, `IPv6`, `Port`, `DnsName`, `Url` - Network addressing
- `SingleHostAddr`, `SingleHostName`, `MultiHostName` - Host management

### Data Types & Primitives (15 modules)
- `Bytes`, `BoundedBytes` + 8 fixed-size byte arrays
- `Text`, `Text128`, `BigInt`, `Natural` - Text and numeric types
- `NonZeroInt64`, `Numeric`, `UnitInterval` - Specialized numbers

### Blockchain Primitives (12 modules)
- `Block`, `BlockBodyHash`, `BlockHeaderHash` - Block structure
- `Header`, `HeaderBody`, `EpochNo` - Block components
- `AuxiliaryDataHash`, `OperationalCert`, `ProtocolVersion` - Protocol
- `Pointer`, `Anchor`, `RewardAccount` - Blockchain references

### Core Utilities (8 modules)
- `CBOR`, `Codec`, `Combinator` - Core encoding/decoding
- `Data`, `DataJson`, `DatumOption` - Data handling
- `Bech32`, `FormatError` - Utilities and error handling

### Development Tools (2 modules)
- `Devnet`, `DevnetDefault` - Local development network with custom configuration, automated testing, transaction simulation, and performance monitoring

## Development

### Setting Up the Development Environment

```bash
# Clone the repository
git clone https://github.com/IntersectMBO/evolution-sdk.git
cd evolution-sdk

# Enter Nix development shell (optional but recommended)
nix develop

# Install dependencies
pnpm install

# Build all packages
pnpm turbo build

# Start development mode with file watching
pnpm turbo dev

# Run type checking
pnpm turbo type-check
```

### Available Scripts

| Command                 | Description                            |
| ----------------------- | -------------------------------------- |
| `pnpm turbo build`      | Build the package with optimal caching |
| `pnpm turbo dev`        | Start development mode with hot reload |
| `pnpm turbo type-check` | Run TypeScript type checking           |
| `pnpm turbo test`       | Run all tests (when available)         |
| `pnpm turbo lint`       | Run code quality checks                |
| `pnpm turbo clean`      | Clean all build artifacts              |

## Documentation

### Website
For comprehensive guides, tutorials, and interactive examples, visit our [official documentation](https://intersectmbo.github.io/evolution-sdk).

### API Reference
Complete API documentation with type definitions and examples is available in our [API reference](https://intersectmbo.github.io/evolution-sdk/api).

### Learning Resources

- [Getting Started Guide](https://intersectmbo.github.io/evolution-sdk/getting-started) - Your first steps with Evolution SDK

## Community & Support

Join our thriving community of Cardano developers:

- [Discord](https://discord.gg/jnGW5YG3) - Get help, share projects, and discuss development
- [X](https://x.com/nowitnesslabs) - Latest announcements and ecosystem updates  
- [GitHub Issues](https://github.com/IntersectMBO/evolution-sdk/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/IntersectMBO/evolution-sdk/discussions) - Questions, ideas, and community showcases

### Getting Help

- Found a bug? Open an issue with a minimal reproduction
- Need help? Ask in our Discord community
- Have an idea? Start a discussion on GitHub
- Want to contribute? Check our [contribution guide](#contributing)

## Roadmap

### Phase 3: Transaction Building & Providers (In Progress)
- [ ] **Transaction Builder Components**
  - [ ] Transaction builder with fluent API
  - [ ] UTXO selection algorithms
  - [ ] Fee calculation utilities
  - [ ] Balance and change computation
  - [ ] Multi-asset transaction support
  - [ ] Script witness attachment
- [ ] **Provider Integrations**
  - [ ] `Maestro` - Maestro API provider
  - [ ] `Blockfrost` - Blockfrost API provider  
  - [ ] `Koios` - Koios API provider
  - [ ] `KupoOgmios` - Kupo/Ogmios provider
  - [ ] `UtxoRpc` - UTXO RPC provider
  - [ ] Provider abstraction layer
  - [ ] Failover and load balancing
- [ ] **Wallet Integration**
  - [ ] Hardware wallet support (Ledger, Trezor)
  - [ ] Browser wallet integration (Nami, Eternl, Flint)
  - [ ] Multi-signature wallet support
  - [ ] Wallet connector abstraction layer
  - [ ] CIP-30 standard implementation
- [ ] **Smart Contract Support**
  - [ ] UPLC evaluation from Aiken
  - [ ] UPLC evaluation from Helios
  - [ ] UPLC evaluation from Plu-ts
  - [ ] UPLC evaluation from Scalus
  - [ ] Script validation utilities
  - [ ] Datum and redeemer handling
  - [ ] Script cost estimation
- [ ] **Effect 4.0 Migration**
  - [ ] Upgrade to Effect 4.0 when released
  - [ ] Leverage new Effect features and performance improvements
  - [ ] Update all Codec and Error handling patterns
  - [ ] Maintain backward compatibility where possible

### Phase 4: Advanced Features (Planned)
- [ ] **Hydra Integration**
  - [ ] Hydra Head management
  - [ ] State channel operations
  - [ ] Off-chain transaction handling
  - [ ] Hydra Head lifecycle management
  - [ ] Layer 2 scaling utilities
- [ ] **DeFi Primitives**
  - [ ] DEX integration utilities
  - [ ] Liquidity pool management
  - [ ] Yield farming helpers
  - [ ] NFT marketplace tools
- [ ] **Developer Experience**
  - [ ] CLI tool for project scaffolding
  - [ ] VS Code extension
  - [ ] Interactive tutorials
  - [ ] Schema types from Plutus blueprint types

### Current Focus
We're currently prioritizing transaction building components and provider integrations (Maestro, Blockfrost, Koios, Kupo/Ogmios, UTXO RPC) to provide developers with the essential infrastructure needed for building production Cardano applications.

## Contributing

We love your input! We want to make contributing to Evolution SDK as easy and transparent as possible.

### Quick Start for Contributors

**Option 1: Docker (Recommended)**

```bash
# Clone and start development environment
git clone https://github.com/IntersectMBO/evolution-sdk.git
cd evolution-sdk

# Start development with Docker
docker-compose up -d evolution-dev

# Access the container
docker exec -it evolution-sdk-dev sh

# Inside container, run commands
pnpm turbo build
pnpm turbo test
```

**Option 2: Local Development**

1. Fork and clone the repository
   ```bash
   git clone https://github.com/IntersectMBO/evolution-sdk.git
   cd evolution-sdk
   ```

2. Install dependencies
   ```bash
   pnpm install
   ```

3. Start development
   ```bash
   pnpm turbo dev
   ```

4. Run the documentation site
   ```bash
   pnpm docs:dev  # Opens at http://localhost:3000
   # Then visit http://localhost:3000/docs in your browser
   ```

5. Make your changes and test them
   ```bash
   pnpm turbo test
   pnpm turbo type-check
   pnpm turbo lint
   ```

### Docker Development Workflow

```bash
# Build development image
./docker-build.sh dev

# Start all services
docker-compose up -d

# Access the documentation site
# Open http://localhost:3000/docs in your browser

# View logs
docker-compose logs -f evolution-dev

# Run tests in Docker
./docker-build.sh test

# Stop services
docker-compose down
```

See [DOCKER.md](./DOCKER.md) for comprehensive Docker documentation.

4. Make your changes and test them
   ```bash
   pnpm turbo build
   pnpm turbo type-check
   ```

5. Create a pull request

### Contribution Guidelines

- Follow TypeScript best practices - Use strict typing and modern patterns
- Add tests for new features and bug fixes
- Update documentation when adding new APIs
- Keep changes focused - One feature/fix per pull request
- Follow conventional commits - Use clear, descriptive commit messages

Read our full [Contribution Guide](CONTRIBUTING.md) for detailed guidelines.

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

Evolution SDK builds on the incredible work of:

- [Turborepo](https://turborepo.org/) - For the incredible build system
- [Effect](https://effect.website/) - For functional programming excellence  
- Our [contributors](https://github.com/IntersectMBO/evolution-sdk/graphs/contributors) - Building the future together

---

<div align="center">
  <p>
    <sub>Built with ❤️ by <a href="https://github.com/no-witness-labs">No Witness Labs</a></sub>
  </p>
  <p>
    <a href="https://github.com/IntersectMBO/evolution-sdk">⭐ Star us on GitHub</a> •
    <a href="https://x.com/nowitnesslabs">Follow on X</a> •
    <a href="https://discord.gg/jnGW5YG3">Join Discord</a>
  </p>
  
  [Read the docs](https://intersectmbo.github.io/evolution-sdk) to get started building with Evolution SDK
</div>
