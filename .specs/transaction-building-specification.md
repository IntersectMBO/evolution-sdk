# Transaction Building Specification

**Version**: 1.0.0  
**Status**: DRAFT  
**Created**: September 24, 2025  
**Authors**: Evolution SDK Team  
**Reviewers**: [To be assigned]

---

## Abstract

This specification defines the transaction building architecture for the Evolution SDK, providing a comprehensive framework for constructing, validating, and submitting Cardano transactions. The system implements a progressive builder pattern that separates transaction construction, script evaluation, signing, and submission into distinct, composable phases. Core features include intelligent coin selection algorithms, dual UPLC/provider script evaluation, automatic collateral management, and explicit UTxO state management for transaction chaining. The architecture ensures type safety through progressive builder interfaces while maintaining compatibility with both Effect-based and Promise-based programming paradigms.

---

## Purpose and Scope

This specification establishes the architectural requirements and behavioral contracts for transaction building within the Evolution SDK ecosystem. It serves as the authoritative reference for developers implementing transaction construction logic and for teams integrating with the transaction building system.

**Target Audience**: SDK maintainers, DApp developers, wallet integrators, and contributors implementing transaction-related functionality.

**Scope**: This specification covers transaction construction patterns, coin selection algorithms, script evaluation workflows, progressive builder interfaces, UTxO management strategies, and integration contracts. It does not cover wallet implementation details, provider-specific protocols, or low-level CBOR serialization formats.

---

## Introduction

Transaction building in Cardano requires sophisticated coordination between UTxO selection, script evaluation, fee calculation, and network submission. The Evolution SDK addresses these challenges through a multi-phase architecture that provides both simplicity for common operations and flexibility for complex workflows.

### Key Design Principles

1. **Progressive Enhancement**: Start simple, add complexity as needed through builder progression
2. **UTxO Transparency**: Make UTxO state management explicit and predictable
3. **Script Integration**: Native support for Plutus script evaluation and execution
4. **Type Safety**: Compile-time guarantees for transaction builder capabilities
5. **Dual API Support**: Compatible with both Effect-ts and Promise-based programming

### Architectural Overview

The transaction building system consists of three primary builder types that form a progressive enhancement chain:

- **TransactionBuilder**: Accumulates transaction intents and builds unsigned transactions
- **SignBuilder**: Handles transaction signing with support for partial signatures and witness accumulation
- **SubmitBuilder**: Manages transaction submission and network interaction

This progression ensures that operations are only available when appropriate (e.g., signing requires a built transaction, submission requires signatures).

### Integration Context

Transaction building integrates with the broader Evolution SDK architecture through:
- **Provider System**: Protocol parameter queries and UTxO data access
- **Wallet System**: Address derivation, UTxO management, and transaction signing
- **Effect-Promise Bridge**: Dual API surface supporting multiple programming paradigms

---

## Functional Specification

### Progressive Builder Architecture (Normative)

The transaction building system MUST implement a progressive builder pattern with three distinct phases, each providing specific capabilities and enforcing appropriate constraints.

#### TransactionBuilder Interface

The `TransactionBuilder` interface SHALL provide methods for accumulating transaction intents through a fluent API. All methods MUST return the same `TransactionBuilder` instance to enable method chaining.

**Required Operations**:
- Payment operations: `payToAddress()`, `payToScript()`
- UTxO collection: `collectFrom()`, `addInput()`
- Token operations: `mintTokens()`, `burnTokens()`
- Staking operations: `delegateStake()`, `withdrawRewards()`
- Script operations: `attachScript()`, `attachDatum()`
- Metadata operations: `addMetadata()`, `setValidityInterval()`

**Build Methods**:
- `build(options?: BuildOptions): Promise<SignBuilder>` - Complete transaction construction
- `buildForEvaluation(collateralAmount: Coin, changeAddress: Address): Promise<TransactionBuilder>` - Script evaluation preparation
- `chain(options?: BuildOptions): Promise<ChainResult>` - UTxO state management for transaction sequences

**Intent Accumulation Pattern**:
```typescript
// Operations accumulate intents without immediate execution
const builder = client.newTx()
  .payToAddress({ address: alice, assets: { coin: 1000000n } })  // Intent 1
  .mintTokens({ assets: { [tokenUnit]: 100n } })                // Intent 2
  .addMetadata(1, { message: "Batch operation" })               // Intent 3

// All intents execute atomically during build()
const signBuilder = await builder.build()
```

#### SignBuilder Interface

The `SignBuilder` interface SHALL handle transaction signing with support for single signatures, partial signatures, and multi-signature assembly.

**Required Properties**:
- `transaction: Transaction` - The built, unsigned transaction
- `cost: TransactionEstimate` - Fee and execution unit estimates

**Signing Operations**:
- `sign(): Promise<SubmitBuilder>` - Complete transaction signing
- `partialSign(): Promise<TransactionWitnessSet>` - Partial signature for multi-sig workflows
- `assemble(witnesses: TransactionWitnessSet[]): Promise<SubmitBuilder>` - Multi-signature assembly
- `signWithWitness(witnessSet: TransactionWitnessSet): Promise<SubmitBuilder>` - External witness integration

#### SubmitBuilder Interface

The `SubmitBuilder` interface SHALL manage transaction submission and network interaction.

**Required Properties**:
- `transaction: Transaction` - The fully signed transaction
- `witnessSet: TransactionWitnessSet` - Complete witness set
- `cbor: string` - Serialized transaction for network submission

**Submission Operations**:
- `submit(): Promise<string>` - Submit transaction and return hash
- `simulate(): Promise<TransactionSimulation>` - Simulate execution without submission

### UTxO Management and Transaction Chaining (Normative)

The transaction building system MUST support both automatic and explicit UTxO management to accommodate different use case requirements.

#### Automatic UTxO Management

When no UTxOs are provided to `newTx()`, the builder SHALL automatically fetch available UTxOs from the associated wallet:

```typescript
// Automatic UTxO fetching
const builder = client.newTx()  // Internally calls wallet.getUtxos()
```

#### Explicit UTxO Management

When UTxOs are explicitly provided, the builder SHALL operate exclusively on the provided set without additional wallet queries:

```typescript
// Explicit UTxO management
const builder = client.newTx(specificUtxos)  // Uses only provided UTxOs
```

#### Transaction Chaining Protocol

The `chain()` method SHALL return a `ChainResult` that provides complete UTxO state transformation information:

```typescript
interface ChainResult {
  readonly transaction: Transaction        // The constructed transaction
  readonly spentUtxos: UTxO[]             // UTxOs consumed as inputs
  readonly newOutputs: UTxO[]             // UTxOs created as outputs
  readonly updatedUtxos: UTxO[]           // Available UTxOs for next transaction
  readonly cost: TransactionEstimate      // Fee and execution costs
}
```

**Chaining Workflow**:
```typescript
// Sequential transaction chain
let currentUtxos = await client.getWalletUtxos()

const step1 = await client.newTx(currentUtxos)
  .payToAddress(alice, { coin: 2000000n })
  .chain()

const step2 = await client.newTx(step1.updatedUtxos)
  .mintTokens({ assets: tokenMap })
  .chain()

// Submit transactions in dependency order
await client.submitTx(step1.transaction)
await client.submitTx(step2.transaction)
```

### Coin Selection Algorithms (Normative)

Coin selection has a **single responsibility**: select which UTxOs from available inputs should be spent to satisfy the transaction's asset requirements.

Coin selection does NOT handle:
- Fee calculation
- Change output creation  
- Minimum ADA requirements
- Transaction assembly
- Script evaluation

#### Algorithm Implementation

Each coin selection function embeds its own algorithm. The system provides:

1. **Largest-First Function**: `largestFirstSelection` - Select largest UTxOs first until requirements are met
2. **Random-Improve Function**: `randomImproveSelection` - Random selection with improvement heuristics following CIP-2
3. **Optimal Function**: `optimalSelection` - Minimize input count through optimization
4. **Custom Functions**: User-provided functions implementing any selection algorithm

#### Coin Selection Interface

```typescript
interface CoinSelectionResult {
  readonly selectedUtxos: ReadonlyArray<UTxO>    // ONLY the selected UTxOs
}

type CoinSelectionFunction = (
  availableUtxos: ReadonlyArray<UTxO>,
  requiredAssets: Assets
) => CoinSelectionResult
```

#### Two-Phase Selection Process

The transaction builder MAY call coin selection multiple times to handle script execution costs:

1. **Initial Selection**: Select UTxOs based on estimated asset requirements
2. **Refined Selection**: Re-run selection with updated requirements after script evaluation

```typescript
// Phase 1: Select with estimated requirements
const { selectedUtxos: initial } = coinSelection(utxos, estimatedRequirements)

// Phase 2: Calculate actual costs and re-select if needed
const actualRequirements = baseRequirements + scriptCosts + fees
const { selectedUtxos: final } = coinSelection(utxos, actualRequirements)
```

Note: Coin selection itself remains stateless - it just selects UTxOs for given requirements. The transaction builder orchestrates multiple selections as needed.

### Script Evaluation Workflows (Normative)

The system MUST support dual evaluation strategies for Plutus scripts with appropriate cost calculation and error handling.

#### Evaluation Strategy Options

1. **WASM UPLC Evaluation**: Local evaluation using WebAssembly UPLC interpreter
2. **Provider Evaluation**: External evaluation through blockchain data providers

#### Two-Phase Building Process

For transactions containing Plutus scripts, the system SHALL implement a two-phase building process:

**Phase 1: Evaluation Preparation**
```typescript
// Build transaction with dummy ExUnits for evaluation
const evalBuilder = await txBuilder.buildForEvaluation(0n, changeAddress)

// Extract draft transaction for script evaluation
const draftTx = await evalBuilder.draftTx()
```

**Phase 2: Execution Unit Application**
```typescript
// Apply evaluation results
if (uplcEvaluation) {
  await evalBuilder.applyUplcEval(uplcResults)
} else {
  await evalBuilder.applyProviderEval(providerResults)
}

// Build final transaction with correct ExUnits
const signBuilder = await evalBuilder.build()
```

#### Script Evaluation Safety

Evaluation transactions MUST include safety mechanisms to prevent accidental submission:
- Dummy `script_data_hash` (all zeros) to invalidate premature submission
- Placeholder ExUnits that would cause script failures if submitted
- Clear separation between evaluation and submission transactions

### Build Configuration Options (Normative)

The `BuildOptions` interface SHALL provide comprehensive configuration for transaction construction:

```typescript
interface BuildOptions {
  // Coin selection configuration
  readonly coinSelection?: CoinSelectionAlgorithm | CoinSelectionFunction
  readonly coinSelectionOptions?: CoinSelectionOptions
  
  // Script evaluation configuration
  readonly uplcEval?: UplcEvaluationOptions
  
  // Collateral configuration
  readonly collateral?: ReadonlyArray<UTxO>  // Manual collateral (max 3)
  readonly autoCollateral?: boolean          // Default: true for script transactions
  
  // UTXO defragmentation strategies
  readonly defragmentation?: UtxoDefragmentationOptions
  
  // Fee configuration
  readonly minFee?: Coin
  readonly feeMultiplier?: number           // Default: 1.0
}
```

#### UplcEvaluationOptions

```typescript
interface UplcEvaluationOptions {
  readonly type: "wasm" | "provider"
  readonly wasmModule?: WasmUplcModule     // WASM UPLC interpreter instance
  readonly timeout?: number               // Evaluation timeout in milliseconds
  readonly maxMemory?: number            // Memory limit for evaluation
  readonly maxCpu?: number               // CPU step limit for evaluation
}
```

#### UtxoDefragmentationOptions

The `UtxoDefragmentationOptions` interface enables intelligent UTXO set optimization strategies to maintain transaction efficiency and reduce fees:

```typescript
interface UtxoDefragmentationOptions {
  // Split oversized UTXOs into multiple outputs to change address
  readonly unfrack?: {
    readonly enabled: boolean
    // Maximum number of assets per UTXO before splitting
    readonly maxAssetsPerUtxo?: number
    // Maximum ADA value per UTXO before splitting  
    readonly maxAdaPerUtxo?: Coin
  }
  // Consolidate many small UTXOs into fewer, larger ones
  readonly consolidate?: {
    readonly enabled: boolean
    // Minimum ADA value to consider for consolidation
    readonly minAdaThreshold?: Coin
    // Maximum number of UTXOs to consolidate in one transaction
    readonly maxUtxosToConsolidate?: number
  }
}
```

**Unfracking Strategy**: When a UTXO contains too many assets or excessive ADA value, the system automatically splits the UTXO by creating additional change outputs. This prevents individual UTXOs from becoming too large, which can cause transaction size issues and higher fees.

**Consolidation Strategy**: When the wallet contains many small UTXOs with minimal ADA values, the system combines them into fewer, larger UTXOs. This reduces the complexity of future transactions and minimizes fees by reducing the number of inputs required.

Both strategies operate transparently during the transaction building process, creating optimal UTXO distributions without requiring manual intervention from developers.

### Multi-Phase Build Process (Normative)

The `build()` method SHALL execute a comprehensive multi-phase process ensuring transaction validity and optimal resource utilization.

#### Phase 1: Setup and Validation
- Validate build options and configuration parameters
- Fetch wallet UTxOs if not explicitly provided
- Execute accumulated transaction intents

#### Phase 2: Asset Requirements Calculation
- Calculate total output requirements including estimated fees
- Account for minted assets and collected inputs
- Determine net asset requirements for coin selection

#### Phase 3: Initial Coin Selection
- Apply specified coin selection algorithm
- Select UTxOs to cover basic transaction requirements
- Calculate initial fee estimates without script costs

#### Phase 4: Script Evaluation (if applicable)
- Detect Plutus script usage in transaction intents
- Build evaluation transaction with dummy ExUnits
- Execute script evaluation using WASM or provider
- Apply real ExUnits to transaction redeemers

#### Phase 5: Refined Resource Management
- Recalculate fees with script execution costs
- Perform refined coin selection if additional funds needed
- Select and validate collateral UTxOs for script transactions

#### Phase 6: Transaction Finalization
- Build complete transaction with all components
- Calculate final fees and change outputs
- Create SignBuilder instance with built transaction

### Error Handling and Recovery (Normative)

The transaction building system MUST provide comprehensive error handling with specific error types for different failure scenarios.

#### Required Error Types

```typescript
interface TransactionBuilderError {
  readonly _tag: "TransactionBuilderError"
  readonly message: string
  readonly cause?: unknown
}

interface CoinSelectionError {
  readonly _tag: "CoinSelectionError"  
  readonly insufficientFunds?: { required: Assets, available: Assets }
  readonly maxInputsExceeded?: { requested: number, maximum: number }
}

interface ScriptEvaluationError {
  readonly _tag: "ScriptEvaluationError"
  readonly scriptHash?: string
  readonly evaluationFailure?: string
}
```

#### Recovery Strategies

- **Insufficient Funds**: Provide clear breakdown of required vs available assets
- **Script Evaluation Failures**: Include detailed script execution logs
- **Network Errors**: Implement automatic retry with exponential backoff
- **Validation Errors**: Return specific validation failure messages

### Effect-Promise API Bridge (Normative)

All transaction builder interfaces MUST provide both Effect-based and Promise-based APIs to support different programming paradigms.

#### Dual API Pattern

```typescript
interface TransactionBuilder extends EffectToPromiseAPI<TransactionBuilderEffect> {
  readonly Effect: TransactionBuilderEffect
}

interface TransactionBuilderEffect {
  readonly build: (options?: BuildOptions) => Effect<SignBuilder, TransactionBuilderError>
  readonly chain: (options?: BuildOptions) => Effect<ChainResult, TransactionBuilderError>
  // ... other operations
}
```

#### Usage Examples

```typescript
// Promise-based usage
const signBuilder = await client.newTx()
  .payToAddress(address, value)
  .build()

// Effect-based usage  
const signBuilder = await Effect.runPromise(
  client.Effect.newTx()
    .payToAddress(address, value)
    .build()
)
```

---

## Appendix

### Operation Parameter Matrices

#### PayToAddress Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | `Address` | Yes | Recipient address |
| `assets` | `Assets` | Yes | ADA and native tokens to send |
| `datum` | `Data` | No | Inline datum for script addresses |
| `scriptRef` | `Script` | No | Reference script to attach |

#### MintTokens Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assets` | `Assets` | Yes | Tokens to mint (excluding ADA) |
| `redeemer` | `Redeemer` | No | Redeemer for minting script |

#### CollectFrom Parameters  
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputs` | `UTxO[]` | Yes | UTxOs to consume as inputs |
| `redeemer` | `Redeemer` | No | Redeemer for script inputs |

### Coin Selection Algorithm Comparison

| Algorithm | Best For | Pros | Cons |
|-----------|----------|------|------|
| Largest-First | Simple payments | Fast execution, predictable | May not minimize change |
| Random-Improve | Privacy-focused | Better UTxO distribution | More complex computation |
| Optimal | Fee optimization | Minimizes inputs and change | Slower for large UTxO sets |
| Custom | Specialized needs | Full control over selection | Requires custom implementation |

### Script Evaluation Workflow Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Transaction   │    │   Evaluation     │    │   Final         │
│   Builder       │───▶│   Transaction    │───▶│   Transaction   │
│   (intents)     │    │   (dummy ExUnits)│    │   (real ExUnits)│
└─────────────────┘    └──────────────────┘    └─────────────────┘
        │                       │                       │
        │                       ▼                       │
        │              ┌──────────────────┐              │
        │              │  Script          │              │
        │              │  Evaluation      │              │
        │              │  (WASM/Provider) │              │
        │              └──────────────────┘              │
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                ▼
                       ┌──────────────────┐
                       │  Apply ExUnits   │
                       │  to Transaction  │
                       └──────────────────┘
```

### Integration Examples

#### Basic Payment Transaction
```typescript
// Automatic UTxO management
const txHash = await client
  .newTx()
  .payToAddress({
    address: "addr1...",
    assets: { coin: 1000000n }
  })
  .buildSignAndSubmit()
```

#### Multi-Asset Transfer with Script
```typescript
// Custom coin selection with script interaction
const signBuilder = await client
  .newTx(selectedUtxos)
  .payToScript({
    scriptHash: plutusScriptHash,
    assets: { coin: 5000000n, [tokenUnit]: 100n },
    datum: { action: "deposit", amount: 100n }
  })
  .mintTokens({
    assets: { [policyUnit]: 50n },
    redeemer: { action: "mint" }
  })
  .build({
    coinSelection: "largest-first",
    uplcEval: { type: "wasm", wasmModule: uplcWasm }
  })
```

#### Transaction Chaining Workflow
```typescript
// UTxO state management across transaction chain
const utxos = await client.getWalletUtxos()

const step1 = await client.newTx(utxos)
  .payToAddress(alice, { coin: 2000000n })
  .chain()

const step2 = await client.newTx(step1.updatedUtxos)
  .collectFrom({ inputs: [step1.newOutputs[0]] })
  .mintTokens({ assets: { [tokenUnit]: 1000n } })
  .chain()

// Submit in dependency order
await client.submitTx(step1.transaction)
await client.submitTx(step2.transaction)
```

### Configuration Examples

#### Advanced Build Options
```typescript
const buildOptions: BuildOptions = {
  coinSelection: "random-improve",
  coinSelectionOptions: {
    maxInputs: 5,
    excludeUtxos: [reservedUtxo],
    allowPartialSpend: true
  },
  uplcEval: {
    type: "wasm",
    wasmModule: aikenUplc,
    timeout: 30000,
    maxMemory: 14000000,
    maxCpu: 10000000000
  },
  autoCollateral: true,
  feeMultiplier: 1.1
}

const signBuilder = await client
  .newTx()
  .payToAddress(address, assets)
  .build(buildOptions)
```

#### Custom Coin Selection Function
```typescript
const customSelector: CoinSelectionFunction = (utxos, required, options) => {
  // Prefer UTxOs without native tokens for simple payments
  const adaOnlyUtxos = utxos.filter(utxo => 
    Object.keys(utxo.output.amount).length === 1
  )
  
  // Select largest UTxOs first up to maxInputs
  const selected = adaOnlyUtxos
    .sort((a, b) => Number(b.output.amount.coin - a.output.amount.coin))
    .slice(0, options.maxInputs || 10)
  
  return Effect.succeed({
    selectedUtxos: selected,
    totalFee: calculateFee(selected.length),
    changeOutput: calculateChange(selected, required)
  })
}
```

### Performance Considerations

#### Optimization Guidelines
1. **UTxO Set Size**: Large UTxO sets may require pagination or filtering
2. **Script Evaluation**: WASM evaluation is faster but requires module loading
3. **Coin Selection**: Optimal algorithms are slower for large UTxO sets
4. **Network Calls**: Minimize provider calls through intelligent caching

#### Resource Limits
- **Maximum Inputs**: Protocol limit of ~1000 inputs per transaction
- **Collateral UTxOs**: Maximum of 3 UTxOs for collateral
- **Transaction Size**: ~16KB maximum transaction size
- **Script Evaluation**: Memory and CPU limits defined by protocol parameters