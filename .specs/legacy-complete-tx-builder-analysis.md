# Legacy CompleteTxBuilder Analysis & Migration Guide

**Version**: 1.0.0  
**Created**: September 24, 2025  
**Purpose**: Analyze the legacy Lucid Evolution CompleteTxBuilder for migration to Evolution SDK

---

## Executive Summary

The legacy `CompleteTxBuilder` implements a sophisticated multi-phase transaction building workflow with hybrid CML (Cardano Multiplatform Library) integration and native TypeScript coin selection. This analysis breaks down the complex build process to guide migration to the new Evolution SDK architecture.

**Key Characteristics**:
- **Hybrid Architecture**: Uses CML for low-level transaction building with custom TypeScript coin selection
- **Multi-Phase Build Process**: Iterative coin selection with script evaluation integration
- **Complex State Management**: Manages UTxO sets, script evaluation, and collateral across multiple phases
- **Effect-ts Integration**: Uses Effect monad for error handling and composable operations

---

## High-Level Architecture Overview

The CompleteTxBuilder follows a **6-phase iterative workflow** with sophisticated error handling and resource management:

```
Phase 1: Setup & Validation
         ↓
Phase 2: Initial Coin Selection (No Script Costs)
         ↓
Phase 3: Script Evaluation & ExUnits Calculation
         ↓
Phase 4: Refined Coin Selection (With Script Costs)
         ↓
Phase 5: Collateral Selection & Management
         ↓
Phase 6: Final Transaction Assembly & Redeemer Building
```

### Core Components Integration

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│    Wallet       │    │   TxBuilder      │    │   CML Layer     │
│   (UTxO Fetch)  │◄──►│  (Orchestrator)  │◄──►│ (Transaction    │
│                 │    │                  │    │  Assembly)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │               ┌───────▼────────┐              │
         │               │  Coin Selection │              │
         │               │   (TypeScript   │              │
         │               │   Native)       │              │
         │               └────────────────┘              │
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                      ┌──────────────────┐
                      │ UPLC Evaluation  │
                      │ (WASM/Provider)  │
                      └──────────────────┘
```

---

## Detailed Phase-by-Phase Workflow Analysis

### Phase 1: Setup & Validation

**Responsibilities**:
- Validate build configuration and options
- Fetch wallet UTxOs if not preset
- Initialize transaction builder state

**Key Operations**:
```typescript
// Wallet UTxO fetching with fallback
const wallet: Wallet = yield* Effect.fromNullable(config.lucidConfig.wallet)
const walletInputs = options.presetWalletInputs ?? 
  (yield* wallet.utxos()).filter(hasNoRefScript)

// Change address derivation  
const changeAddress = options.changeAddress ?? 
  (yield* wallet.address()).toBech32()
```

**Critical Insights**:
- UTxOs with reference scripts are excluded from coin selection
- Change address defaults to wallet's primary address
- Wallet instance is required (no read-only building support)

### Phase 2: Initial Coin Selection (Without Script Costs)

**Purpose**: Select UTxOs to cover basic transaction requirements excluding script execution costs.

**Workflow**:
1. **Asset Delta Calculation**:
   ```typescript
   // Calculate required assets: outputs + estimatedFee - collected - minted
   const assetsDelta = pipe(
     config.totalOutputAssets,
     Record.union(estimatedFee, BigInt.sum),
     Record.union(negatedCollectedAssets, BigInt.sum), 
     Record.union(negatedMintedAssets, BigInt.sum)
   )
   ```

2. **Recursive UTxO Selection**:
   ```typescript
   // Select UTxOs using custom algorithm
   const { selected } = yield* recursive(
     sortUTxOs(availableInputs),
     requiredAssets,
     coinsPerUtxoByte,
     notRequiredAssets,
     includeLeftoverLovelaceAsFee
   )
   ```

**Algorithm Details**:
- **Sorting Strategy**: Largest UTxOs first for optimal selection
- **Recursive Selection**: Iterative UTxO selection until all requirements met
- **Minimum ADA Handling**: Ensures change outputs meet minimum ADA requirements
- **Reference Script Exclusion**: Filters out UTxOs containing reference scripts

### Phase 3: Script Evaluation & ExUnits Calculation

**Purpose**: Determine actual script execution costs for accurate fee calculation.

**Two-Track Evaluation Process**:

#### Track A: WASM UPLC Evaluation (Local)
```typescript
if (localUPLCEval !== false) {
  // Local UPLC evaluation using WASM
  const uplcResults = yield* evalTransaction(config, txRedeemerBuilder, walletInputs)
  applyUPLCEval(uplcResults, config.txBuilder)
}
```

#### Track B: Provider Evaluation (Remote)  
```typescript
else {
  // External provider evaluation
  const providerResults = yield* evalTransactionProvider(
    config, txRedeemerBuilder, walletInputs
  )
  applyUPLCEvalProvider(providerResults, config.txBuilder)
}
```

**Critical Implementation Details**:
- Uses CML's `build_for_evaluation()` to create evaluation transaction
- Evaluation transaction has dummy ExUnits and invalid script_data_hash
- Results applied via `applyUPLCEval()` for CBOR bytes or `applyUPLCEvalProvider()` for structured data
- **Safety Mechanism**: Evaluation transaction would fail if accidentally submitted

### Phase 4: Refined Coin Selection (With Script Costs)

**Purpose**: Adjust UTxO selection to account for actual script execution costs.

**Workflow**:
```typescript
// Second round of coin selection including script execution costs
yield* selectionAndEvaluation(
  walletInputs,
  changeAddress, 
  coinSelection,
  localUPLCEval,
  includeLeftoverLovelaceAsFee,
  true  // script_calculation = true
)
```

**Key Considerations**:
- **Fee Recalculation**: Includes script execution costs in total fee
- **UTxO Re-evaluation**: May select additional UTxOs if script costs exceed initial estimates
- **Script Budget Changes**: New inputs may change script execution budgets, requiring re-evaluation
- **Iterative Process**: Continues until stable UTxO selection achieved

### Phase 5: Collateral Selection & Management

**Purpose**: Set up collateral for Plutus script transaction safety.

**Collateral Calculation Logic**:
```typescript
const totalCollateral = BigInt(
  Math.ceil(
    Math.max(
      (protocolParameters.collateralPercentage * Number(estimatedFee)) / 100,
      Number(setCollateral)
    )
  )
)
```

**Selection Criteria**:
- **ADA-Only UTxOs**: No native tokens allowed in collateral
- **No Reference Scripts**: UTxOs with reference scripts excluded
- **Maximum 3 UTxOs**: Protocol limit for collateral inputs
- **Sufficient Value**: Must cover calculated collateral amount

**Error Handling**:
- Comprehensive error messages for insufficient collateral
- Specific handling for UTxOs with reference scripts
- Clear indication when collateral limits exceeded

### Phase 6: Final Assembly & Redeemer Building

**Purpose**: Complete transaction assembly with proper redeemer indices and witness preparation.

**Redeemer Building Process**:
```typescript
// Build redeemers with correct indices
yield* completePartialPrograms()

// Create final transaction with CML
const txRedeemerBuilder = yield* Effect.try({
  try: () => config.txBuilder.build_for_evaluation(
    0, 
    CML.Address.from_bech32(changeAddress)
  ),
  catch: (error) => completeTxError(error)
})
```

**Index Management**:
- **Input Mapping**: Maps UTxOs to their transaction input indices
- **Redeemer Types**: Handles both "shared" (one per script) and "self" (one per UTxO) redeemers
- **Index Validation**: Ensures redeemer indices match CML transaction structure

---

## Core Algorithms Deep Dive

### Recursive Coin Selection Algorithm

The `recursive()` function implements a sophisticated UTxO selection algorithm:

```typescript
export const recursive = (
  inputs: UTxO[],
  requiredAssets: Assets,
  coinsPerUtxoByte: bigint,
  externalAssets: Assets = {},
  includeLeftoverLovelaceAsFee?: boolean
): Effect<CoinSelectionResult, TxBuilderError>
```

**Algorithm Steps**:
1. **Initial Selection**: Select UTxOs to cover `requiredAssets`
2. **Change Calculation**: Calculate available assets after selection
3. **Minimum ADA Check**: Verify change outputs meet minimum ADA requirements
4. **Recursive Iteration**: Select additional UTxOs if minimum ADA not met
5. **Termination**: Continue until no additional ADA required

**Key Features**:
- **Largest-First Strategy**: Sorts UTxOs by value (descending)
- **Iterative Refinement**: Handles complex minimum ADA scenarios
- **External Asset Support**: Accounts for assets from minting/burning
- **Comprehensive Error Handling**: Clear messages for insufficient funds

### UTxO Selection Logic (`selectUTxOs`)

**Selection Strategy**:
```typescript
// Conceptual implementation (actual logic in separate module)
const selectUTxOs = (inputs: UTxO[], required: Assets, allowOverspend: boolean) => {
  // 1. Filter UTxOs that can contribute to required assets
  // 2. Sort by value (largest first) for optimal selection  
  // 3. Greedy selection until requirements met
  // 4. Handle multi-asset requirements with asset-specific logic
}
```

**Filtering Criteria**:
- **No Reference Scripts**: Excludes UTxOs containing reference scripts
- **Asset Availability**: Must contain required asset types
- **Value Threshold**: Prioritizes larger UTxOs for efficiency

### Fee Estimation Algorithm

**Multi-Component Fee Calculation**:
```typescript
const estimateFee = (config: TxBuilderConfig, script_calculation: boolean) => {
  const minFee = config.txBuilder.min_fee(script_calculation)  // CML calculation
  const refScriptFee = yield* calculateMinRefScriptFee(config)  // Custom calculation
  let estimatedFee = minFee + refScriptFee
  
  // Apply custom minimum fee if higher
  if (customMinFee > estimatedFee) {
    estimatedFee = customMinFee
    config.txBuilder.set_fee(estimatedFee)
  }
  
  return estimatedFee
}
```

**Fee Components**:
1. **Base Fee**: CML `min_fee()` based on transaction size
2. **Reference Script Fee**: Custom calculation for reference script costs
3. **Script Execution Fee**: Added during refined coin selection phase
4. **Custom Minimum**: User-specified minimum fee override

---

## State Management & Dependencies

### Configuration State (`TxBuilderConfig`)

**Key State Components**:
- `txBuilder: CML.TransactionBuilder` - Core CML transaction builder
- `totalOutputAssets: Assets` - Accumulated output requirements  
- `mintedAssets: Assets` - Assets created through minting
- `collectedInputs: UTxO[]` - Explicitly specified input UTxOs
- `partialPrograms: Map<string, PartialProgram>` - Redeemer builders for scripts

### Dependency Chain

```
Wallet → UTxOs → Coin Selection → CML TxBuilder → Script Evaluation → Final Transaction
   ↓         ↓            ↓             ↓              ↓               ↓
Address   UTxO Set   Selected UTxOs  Draft Tx    ExUnits Applied  Submittable Tx
```

**Critical Dependencies**:
1. **Wallet Required**: Cannot build without wallet instance
2. **Provider Access**: Required for script evaluation (if not using local UPLC)
3. **Protocol Parameters**: Essential for fee calculation and minimum ADA
4. **CML Integration**: Heavy dependency on CML for transaction assembly

---

## Error Handling Strategy

### Error Categories

1. **Insufficient Funds Errors**:
   ```typescript
   completeTxError(
     `Your wallet does not have enough funds to cover the required assets: ${requiredAssets}`
   )
   ```

2. **Collateral Errors**:
   ```typescript
   completeTxError(
     `Selected ${selected.length} inputs as collateral, but max collateral inputs is 3`
   )
   ```

3. **Script Evaluation Errors**:
   ```typescript
   completeTxError(
     `UPLC evaluation failed for script: ${scriptHash}`
   )
   ```

4. **Index Management Errors**:
   ```typescript
   completeTxError(
     `Index not found for input: ${input}`
   )
   ```

### Error Recovery Strategies

- **Graceful Degradation**: Fallback to provider evaluation if WASM fails
- **Retry Logic**: Multiple attempts for network-dependent operations
- **Clear Messaging**: Detailed error descriptions with context
- **State Cleanup**: Proper resource cleanup on errors

---

## Migration Path to Evolution SDK

### Architecture Transformation Required

#### 1. CML Dependency Removal
**Current**: Heavy reliance on CML for transaction building
**Target**: Pure TypeScript implementation with optional CML interop

**Migration Strategy**:
```typescript
// Current CML-dependent approach
const txBuilder = CML.TransactionBuilder.new(protocolParams)
const tx = txBuilder.build()

// Evolution SDK native approach  
const signBuilder = await client.newTx()
  .payToAddress(address, assets)
  .build()  // Pure TypeScript implementation
```

#### 2. Progressive Builder Pattern Adoption
**Current**: Monolithic `complete()` function with all phases
**Target**: Progressive TransactionBuilder → SignBuilder → SubmitBuilder

**Migration Strategy**:
```typescript
// Current approach
const completedTx = yield* complete({ changeAddress, coinSelection })

// Evolution SDK approach
const signBuilder = await client.newTx()
  .payToAddress(address, assets)
  .build({ coinSelection })

const submitBuilder = await signBuilder.sign()
const txHash = await submitBuilder.submit()
```

#### 3. UTxO State Management Modernization
**Current**: Implicit wallet UTxO fetching with filtering
**Target**: Explicit UTxO management with chaining support

**Migration Strategy**:
```typescript
// Current implicit approach
const walletInputs = (yield* wallet.utxos()).filter(hasNoRefScript)

// Evolution SDK explicit approach
const utxos = await client.getWalletUtxos()
const chainResult = await client.newTx(utxos)
  .payToAddress(address, assets)  
  .chain()
```

### Component Migration Priorities

#### Phase 1: Core Algorithm Extraction
1. **Coin Selection Logic**: Extract `recursive()` and `selectUTxOs()` algorithms
2. **Fee Calculation**: Migrate `estimateFee()` and `calculateMinRefScriptFee()`
3. **UTxO Management**: Extract filtering and sorting utilities

#### Phase 2: Script Evaluation Modernization
1. **Two-Phase Building**: Implement `buildForEvaluation()` pattern
2. **UPLC Integration**: Port WASM UPLC evaluation logic
3. **Provider Evaluation**: Modernize provider-based script evaluation

#### Phase 3: Progressive Builder Implementation
1. **TransactionBuilder**: Implement intent accumulation pattern
2. **SignBuilder**: Create signing abstraction with partial signature support
3. **SubmitBuilder**: Implement submission and simulation capabilities

#### Phase 4: Integration & Testing
1. **Wallet Integration**: Connect with Evolution SDK wallet system
2. **Provider Integration**: Integrate with Evolution SDK provider architecture
3. **Comprehensive Testing**: Migrate test suites and add new test coverage

### Key Challenges & Solutions

#### Challenge 1: CML Dependency Removal
**Complexity**: Deep integration with CML for transaction assembly
**Solution**: 
- Phase 1: Wrap CML operations in Evolution SDK interfaces
- Phase 2: Implement native TypeScript transaction building
- Phase 3: Remove CML dependencies entirely

#### Challenge 2: State Management Complexity
**Complexity**: Complex state management across multiple phases
**Solution**:
- Use Effect-ts for state management and error handling
- Implement immutable state transitions
- Clear separation of concerns between phases

#### Challenge 3: Backward Compatibility
**Complexity**: Existing applications depend on current API
**Solution**:
- Provide compatibility layer during transition
- Gradual migration path with deprecation warnings
- Comprehensive migration documentation

---

## Recommended Migration Strategy

### Step 1: Algorithm Extraction (Week 1-2)
```typescript
// Extract core algorithms to Evolution SDK
export const recursiveCoinSelection = (/* ... */) => { /* ... */ }
export const calculateTransactionFee = (/* ... */) => { /* ... */ }
export const selectOptimalUTxOs = (/* ... */) => { /* ... */ }
```

### Step 2: Interface Compatibility (Week 3-4)  
```typescript
// Create compatibility layer
export const complete = (options: CompleteOptions) => 
  client.newTx()
    ./* accumulate operations */
    .build(options)
    .then(signBuilder => signBuilder.sign())
    .then(submitBuilder => submitBuilder.submit())
```

### Step 3: Progressive Enhancement (Week 5-8)
```typescript
// Implement progressive builder pattern
const builder = client.newTx(utxos)
  .payToAddress(address, assets)
  .mintTokens(policy, tokens)

const signBuilder = await builder.build(options)
const submitBuilder = await signBuilder.sign()
const txHash = await submitBuilder.submit()
```

### Step 4: Full Migration (Week 9-12)
```typescript  
// Complete Evolution SDK native implementation
const client = createClient({ provider, wallet, network })

const chainResult = await client.newTx()
  .payToAddress(address, assets)
  .chain({ coinSelection: "largest-first" })
  
await client.submitTx(chainResult.transaction)
```

---

## Conclusion

The legacy CompleteTxBuilder implements a sophisticated transaction building system with complex multi-phase workflows and hybrid CML integration. Migration to the Evolution SDK requires careful extraction of core algorithms while modernizing the architecture to support progressive builders, explicit UTxO management, and pure TypeScript implementation.

**Key Success Factors**:
1. **Incremental Migration**: Gradual transition with compatibility layers
2. **Algorithm Preservation**: Maintain proven coin selection and fee calculation logic
3. **Architecture Modernization**: Adopt progressive builder patterns and explicit state management
4. **Comprehensive Testing**: Extensive testing during each migration phase

The migration will result in a more maintainable, type-safe, and flexible transaction building system while preserving the sophisticated logic that makes the current implementation robust and reliable.