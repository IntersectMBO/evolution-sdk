# Evolution SDK Provider Failover Specification

Technical specification for multi-provider failover strategies and error handling in the Evolution SDK.

## Overview

This specification defines the multi-provider failover system architecture, strategies, and error handling mechanisms for Cardano blockchain provider interactions.

### Features

- Multiple failover strategies: priority-based and round-robin selection
- Request-level retry mechanisms via Effect.retry
- Immediate failover on provider errors
- Comprehensive error handling and accumulation

## Architecture

```mermaid
graph TB
    Client[Client Application] --> MultiProvider[MultiProvider Controller]
    MultiProvider --> FailoverStrategy[Failover Strategy Engine]
    
    FailoverStrategy --> Priority[Priority Strategy]
    FailoverStrategy --> RoundRobin[Round Robin Strategy]
    
    MultiProvider --> P1[Provider 1<br/>Blockfrost]
    MultiProvider --> P2[Provider 2<br/>Kupmios]
    MultiProvider --> P3[Provider 3<br/>Maestro]
    MultiProvider --> P4[Provider 4<br/>Koios]
    
    P1 --> CardanoNetwork[Cardano Network]
    P2 --> CardanoNetwork
    P3 --> CardanoNetwork
    P4 --> CardanoNetwork
    
    classDef client fill:#3b82f6,stroke:#1e3a8a,stroke-width:3px,color:#ffffff,font-weight:bold
    classDef controller fill:#8b5cf6,stroke:#4c1d95,stroke-width:3px,color:#ffffff,font-weight:bold
    classDef strategy fill:#f59e0b,stroke:#92400e,stroke-width:3px,color:#ffffff,font-weight:bold
    classDef provider fill:#10b981,stroke:#065f46,stroke-width:3px,color:#ffffff,font-weight:bold
    classDef network fill:#ef4444,stroke:#991b1b,stroke-width:3px,color:#ffffff,font-weight:bold
    
    class Client client
    class MultiProvider controller
    class FailoverStrategy,Priority,RoundRobin strategy
    class P1,P2,P3,P4 provider
    class CardanoNetwork network
```

## Provider Types

| Provider | Network Support | API Key Required | Pagination |
|----------|-----------------|------------------|------------|
| **Blockfrost** | Mainnet, Preprod, Preview | ✅ | Cursor-based |
| **Kupmios** | Mainnet, Preprod, Preview | ❌ (self-hosted) | Offset-based |
| **Maestro** | Mainnet, Preprod | ✅ | Cursor-based |
| **Koios** | Mainnet, Preprod, Preview | Optional | Offset-based |

## Failover Strategies

### 1. Priority Strategy

Routes requests to providers based on configured priority levels, failing over to lower priority providers when higher priority ones fail.

```typescript
interface PriorityStrategy {
  type: "priority"
  providers: Array<{
    provider: ProviderConfig
    priority: number // Lower number = higher priority (1 = highest)
  }>
}
```

#### Priority Strategy Workflow

```mermaid
graph TD
    Start([Request]) --> P1{Try Priority 1 Provider}
    P1 -->|Success| Success1[Return Result]
    P1 -->|ProviderError| P2{Try Priority 2 Provider}
    P2 -->|Success| Success2[Return Result]
    P2 -->|ProviderError| P3{Try Priority 3 Provider}
    P3 -->|Success| Success3[Return Result]
    P3 -->|ProviderError| Error[All Providers Failed - MultiProviderError]
    
    classDef success fill:#10b981,stroke:#065f46,stroke-width:2px,color:#ffffff
    classDef failure fill:#ef4444,stroke:#991b1b,stroke-width:2px,color:#ffffff
    classDef process fill:#3b82f6,stroke:#1e3a8a,stroke-width:2px,color:#ffffff
    
    class Success1,Success2,Success3 success
    class Error failure
    class Start,P1,P2,P3 process
```

### 2. Round Robin Strategy

Distributes requests evenly across all providers in sequential order.

```typescript
interface RoundRobinStrategy {
  type: "round-robin" 
  providers: Array<ProviderConfig>
}
```

#### Round Robin Strategy Workflow

```mermaid
graph TD
    Start([Request]) --> Check{Current Index}
    Check -->|Index 0| P1{Try Provider 1}
    Check -->|Index 1| P2{Try Provider 2}
    Check -->|Index 2| P3{Try Provider 3}
    
    P1 -->|Success| Success1[Return Result<br/>Next: Index 1]
    P1 -->|ProviderError| Acc1[Accumulate Error<br/>Try Provider 2]
    Acc1 --> P2
    
    P2 -->|Success| Success2[Return Result<br/>Next: Index 2]
    P2 -->|ProviderError| Acc2[Accumulate Error<br/>Try Provider 3]
    Acc2 --> P3
    
    P3 -->|Success| Success3[Return Result<br/>Next: Index 0]
    P3 -->|ProviderError| Error[All Providers Failed<br/>MultiProviderError]
    
    classDef success fill:#10b981,stroke:#065f46,stroke-width:2px,color:#ffffff
    classDef failure fill:#ef4444,stroke:#991b1b,stroke-width:2px,color:#ffffff
    classDef process fill:#3b82f6,stroke:#1e3a8a,stroke-width:2px,color:#ffffff
    classDef decision fill:#f59e0b,stroke:#92400e,stroke-width:2px,color:#ffffff
    
    class Success1,Success2,Success3 success
    class Error,Acc1,Acc2 failure
    class Start process
    class Check,P1,P2,P3 decision
```

## Request Flow and Failover

### High-Level Workflow

```mermaid
graph TD
    Start([Client Request]) --> Select[Select Provider by Strategy]
    Select --> Invoke[Call Provider Method]
    Invoke --> Success{Success?}
    Success -->|Yes| Return[Return Result]
    Success -->|No ProviderError| Accumulate[Add Error to Accumulated Errors]
    Accumulate --> CheckNext{More Providers Available?}
    CheckNext -->|Yes| NextProvider[Select Next Provider]
    CheckNext -->|No| ThrowMulti[Throw MultiProviderError with All Errors]
    NextProvider --> Invoke
    
    classDef success fill:#10b981,stroke:#065f46,stroke-width:2px,color:#ffffff
    classDef failure fill:#ef4444,stroke:#991b1b,stroke-width:2px,color:#ffffff
    classDef process fill:#3b82f6,stroke:#1e3a8a,stroke-width:2px,color:#ffffff
    classDef decision fill:#f59e0b,stroke:#92400e,stroke-width:2px,color:#ffffff
    
    class Return success
    class Accumulate,ThrowMulti failure
    class Start,Select,Invoke,NextProvider process
    class Success,CheckNext decision
```

The system configures retry policies at provider construction time and switches providers immediately on ProviderError:

1. **Provider Construction**: Each provider is created with retry policy configured via `setRetryPolicy(config)`
2. **Provider Selection**: MultiProvider selects provider based on strategy
3. **Method Execution**: Call provider method (uses pre-configured retry policy with internal Effect.retry)
4. **Success**: Return result immediately
5. **ProviderError**: Provider has exhausted internal retries - immediately switch to next provider
6. **Error Accumulation**: Add provider's error to accumulated error list
7. **Failover**: Move to next provider and repeat the process
8. **Final Error**: Throw `MultiProviderError` with all accumulated errors if all providers fail

### Effect-Based Workflow Conditions

The MultiProvider maintains internal state and delegates retry logic to individual provider methods:

#### State Management
```typescript
interface MultiProviderState {
  readonly providers: ReadonlyArray<Provider>
  readonly strategy: FailoverStrategy
  // currentProviderIndex stored internally, accessed via method
}

// MultiProvider API for accessing internal state
interface MultiProvider {
  // Get current provider index (for debugging/monitoring)
  readonly getCurrentProviderIndex: () => number
  
  // ... provider methods
  readonly getProtocolParameters: () => Effect.Effect<ProtocolParameters, MultiProviderError>
  readonly getUtxos: (address: Address) => Effect.Effect<Array<UTxO>, MultiProviderError>
  // ... other provider methods
}
```

#### Provider Configuration Interface
```typescript
// Provider configuration with immutable retry policy
interface ProviderConfig {
  readonly type: "blockfrost" | "kupmios" | "maestro" | "koios"
  readonly baseUrl: string
  readonly apiKey?: string
  readonly projectId?: string
  readonly retryPolicy: RetryConfig
  // ... other provider-specific config
}

// Providers accept retry policy at construction time (immutable)
interface ProviderConstruction {
  readonly createProvider: (config: ProviderConfig) => Provider
}
```

#### Error Accumulation Pattern
```typescript
// MultiProviderError with accumulated child provider errors
interface MultiProviderError {
  readonly message: string
  readonly cause: unknown
  readonly failedProviders: ReadonlyArray<{
    readonly providerType: string
    readonly providerConfig: ProviderConfig
    readonly error: ProviderError
    readonly attemptTime: Date
    readonly retriesAttempted: number
  }>
  readonly allProvidersFailed: boolean
  readonly totalAttempts: number
}
```

#### Workflow Conditions
```typescript
// Minimal failover decision logic - immediate failover on ProviderError
interface FailoverConditions {
  // Should failover to next provider (always true on ProviderError)
  readonly shouldFailover: (
    providerIndex: number,
    error: ProviderError
  ) => boolean
}
```

#### Error-Driven State Transitions
```typescript
// Effect patterns for provider selection and error accumulation
interface StateTransitions {
  // Select next provider based on strategy
  readonly selectNextProvider: (
    currentIndex: number,
    strategy: FailoverStrategy,
    totalProviders: number
  ) => Effect.Effect<number, MultiProviderError>
  
  // Create MultiProviderError with all accumulated provider errors
  readonly createMultiProviderError: (
    accumulatedErrors: ReadonlyArray<ProviderFailureInfo>
  ) => MultiProviderError
}

interface ProviderFailureInfo {
  readonly providerType: string
  readonly providerConfig: ProviderConfig
  readonly error: ProviderError
  readonly attemptTime: Date
}
```

### Retry Configuration

```typescript
interface RetryConfig {
  maxRetries: number          // Configured at provider construction time
  retryDelayMs: number        // Base delay between retries
  backoffMultiplier: number   // Exponential backoff multiplier
  maxRetryDelayMs: number     // Maximum delay cap
}
```

### Example Flow

```typescript
// 1. Provider Construction - retry policy configured at construction time
const blockfrostConfig: ProviderConfig = {
  type: "blockfrost",
  baseUrl: "https://cardano-mainnet.blockfrost.io/api/v0",
  projectId: "your-project-id",
  retryPolicy: {
    maxRetries: 3,
    retryDelayMs: 1000,
    backoffMultiplier: 2,
    maxRetryDelayMs: 30000
  }
}

const blockfrostProvider = new BlockfrostProvider(blockfrostConfig)

// 2. Provider Implementation - internal Effect.retry using configured policy
class BlockfrostProvider implements Provider {
  constructor(private config: ProviderConfig) {
    this.Effect = {
      getProtocolParameters: Effect.retry(
        this.makeProtocolParametersRequest(),
        Schedule.exponential(`${this.config.retryPolicy.retryDelayMs} millis`)
          .pipe(
            Schedule.intersect(Schedule.recurs(this.config.retryPolicy.maxRetries)),
            Schedule.jittered() // Add jitter to prevent thundering herd
          )
      ),
      // ... other methods with same retry pattern
    }
  }
}

// 3. MultiProvider usage flow for getProtocolParameters()
// - MultiProvider.getProtocolParameters() called
// - Select provider by strategy (e.g., index 0 for priority strategy)
// - provider.Effect.getProtocolParameters() -> internal Effect.retry handles all retries
// - If provider method succeeds -> return result
// - If provider method fails with ProviderError -> accumulate error, select next provider
// - Repeat process with next provider
// - If all providers fail -> throw MultiProviderError with accumulated errors
```

## Usage Examples

### MultiProvider Construction

```typescript
// Example: Priority-based MultiProvider with custom retry policies
const multiProvider = MultiProvider.create({
  strategy: FailoverStrategy.Priority,
  providers: [
    {
      type: "blockfrost",
      baseUrl: "https://cardano-mainnet.blockfrost.io/api/v0",
      projectId: "mainnet_abc123",
      retryPolicy: {
        maxRetries: 3,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
        maxRetryDelayMs: 30000
      }
    },
    {
      type: "kupmios", 
      baseUrl: "wss://ogmios.example.com",
      apiKey: "backup-key",
      retryPolicy: {
        maxRetries: 2,
        retryDelayMs: 500,
        backoffMultiplier: 1.5,
        maxRetryDelayMs: 10000
      }
    },
    {
      type: "maestro",
      baseUrl: "https://api.maestro.org/v1",
      apiKey: "maestro-key",
      retryPolicy: {
        maxRetries: 1,  // Fast failover for tertiary provider
        retryDelayMs: 200,
        backoffMultiplier: 1,
        maxRetryDelayMs: 200
      }
    }
  ]
})

// Usage with Effect API
const protocolParamsEffect = multiProvider.Effect.getProtocolParameters()
const protocolParams = await Effect.runPromise(protocolParamsEffect)

// Usage with Promise API (auto-generated)
const protocolParams2 = await multiProvider.getProtocolParameters()

// Debugging: Check which provider is currently active
const currentIndex = multiProvider.getCurrentProviderIndex()
console.log(`Currently using provider at index: ${currentIndex}`)
```

### Round-Robin Example

```typescript
// Example: Round-robin MultiProvider for load balancing
const loadBalancedProvider = MultiProvider.create({
  strategy: FailoverStrategy.RoundRobin,
  providers: [
    {
      type: "blockfrost",
      baseUrl: "https://cardano-mainnet.blockfrost.io/api/v0", 
      projectId: "project_1",
      retryPolicy: { maxRetries: 2, retryDelayMs: 1000, backoffMultiplier: 2, maxRetryDelayMs: 10000 }
    },
    {
      type: "blockfrost",
      baseUrl: "https://cardano-mainnet.blockfrost.io/api/v0",
      projectId: "project_2", 
      retryPolicy: { maxRetries: 2, retryDelayMs: 1000, backoffMultiplier: 2, maxRetryDelayMs: 10000 }
    },
    {
      type: "maestro",
      baseUrl: "https://api.maestro.org/v1",
      apiKey: "load-balance-key",
      retryPolicy: { maxRetries: 2, retryDelayMs: 800, backoffMultiplier: 1.8, maxRetryDelayMs: 15000 }
    }
  ]
})
```

## Error Handling

### MultiProviderError Structure

```typescript
class MultiProviderError extends Data.TaggedError("MultiProviderError") {
  readonly message: string
  readonly cause: unknown
  readonly failedProviders: ReadonlyArray<{
    readonly providerType: string
    readonly providerConfig: ProviderConfig
    readonly error: ProviderError
    readonly attemptTime: Date
  }>
  readonly allProvidersFailed: boolean
  readonly totalAttempts: number
}
```

### Error Recovery Strategies

```typescript
// Immediate Failover (no retries at provider level)
interface ImmediateFailover {
  maxRetries: 0
  retryDelayMs: 0
}

// Retry with Backoff (retries handled internally by provider methods)
interface RetryWithBackoff {
  maxRetries: number
  retryDelayMs: number
  backoffMultiplier: number
  maxRetryDelayMs: number
}
```

