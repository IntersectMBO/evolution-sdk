# Client Interface Specification

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Client Configuration](#client-configuration)
4. [Comprehensive Examples](#comprehensive-examples)
5. [Optional Provider & Wallet Design](#optional-provider--wallet-design-benefits)
6. [Best Practices](#best-practices)
7. [Core Interfaces](#core-interfaces)
8. [UTxO-Based Transaction Building](#utxo-based-transaction-building)
9. [Integration Patterns](#integration-patterns)
10. [Migration Guide](#migration-guide)
11. [Future Enhancements](#future-enhancements)
12. [Conclusion](#conclusion)

## Overview

The Evolution SDK Client interface is a unified API that combines blockchain data access (Provider), wallet operations (Wallet), and transaction building capabilities into a single, cohesive interface. Inspired by Viem's design patterns, the Client provides a fluent API for interacting with the Cardano blockchain.

## Architecture

The Client interface serves as the primary entry point for developers, abstracting away the complexity of managing separate Provider and Wallet instances while providing a streamlined API for common blockchain operations.

```mermaid
graph TB
    Client --> Provider
    Client --> Wallet
    Client --> TransactionBuilder
    Provider --> Blockchain[Blockchain Data]
    Wallet --> Keys[Key Management]
    TransactionBuilder --> Transaction[Transaction Construction]
```

## Client Configuration

The Evolution SDK Client provides built-in support for popular Cardano providers, making it easy to get started with just an API key:

### Built-in Provider Support

```typescript
// Create clients with built-in provider support and just an API key
const kupmiosClient = createKupmiosClient({
  apiKey: "your-kupmios-api-key",
  network: "mainnet",
  wallet: { type: "seed", mnemonic: "..." }
})

const blockfrostClient = createBlockfrostClient({
  apiKey: "your-blockfrost-project-id", 
  network: "mainnet",
  wallet: { type: "cip30", walletName: "nami" }
})

const koiosClient = createKoiosClient({
  network: "mainnet", // API key optional for public instances
  wallet: { type: "readOnly", address: "addr1..." }
})

const maestroClient = createMaestroClient({
  apiKey: "your-maestro-api-key",
  network: "mainnet",
  wallet: { type: "privateKey", privateKey: "..." }
})
```

## Comprehensive Examples

### 1. Basic Payment Transaction

```typescript
// Create client with seed wallet
const client = createKupmiosClient({
  apiKey: "your-kupmios-api-key",
  network: "mainnet",
  wallet: {
    type: "seed",
    mnemonic: "word1 word2 ... word24",
    accountIndex: 0
  }
})

// Simple payment
const txHash = await client
  .newTx()
  .payToAddress("addr1...", 1_000_000n) // 1 ADA
  .buildSignAndSubmit()

console.log("Transaction submitted:", txHash)
```

### 2. Multi-Asset Transfer with Metadata

```typescript
// Create client with Blockfrost provider and private key wallet
const client = createBlockfrostClient({
  apiKey: "your-blockfrost-project-id",
  network: "mainnet",
  wallet: {
    type: "privateKey",
    privateKey: "your-private-key"
  }
})

// Build complex transaction
const txBuilder = client.newTx()
  .payToAddress("addr1...", 2_000_000n)
  .payToAddressWithData(
    "addr2...",
    1_500_000n,
    new Map([
      ["asset1policy123", 1000n], // Native tokens
      ["asset2policy456", 500n]
    ]),
    { inline: "Hello from Evolution SDK!" } // Inline datum
  )
  .addMetadata(674, { msg: ["Payment with metadata"] })

const { transaction, fee } = await txBuilder.build()
console.log("Transaction fee:", fee)

const witnessSet = await txBuilder.sign()
const txHash = await txBuilder.submit()
```

### 3. Transaction Chaining with UTxO Management

```typescript
const client = createMaestroClient({
  apiKey: "your-maestro-api-key", 
  network: "mainnet",
  wallet: {
    type: "seed",
    mnemonic: "word1 word2 ... word24"
  }
})

// First transaction
const tx1Hash = await client
  .newTx()
  .payToAddress("addr1...", 1_000_000n)
  .buildSignAndSubmit()

// Chain second transaction using outputs from first
const tx1Utxos = await client.awaitTxAndGetUtxos(tx1Hash)
const tx2Hash = await client
  .newTx(tx1Utxos) // Use specific UTxOs
  .payToAddress("addr2...", 500_000n)
  .buildSignAndSubmit()
```

### 4. Smart Contract Interaction

```typescript
const client = createKoiosClient({
  network: "mainnet",
  wallet: {
    type: "seed",
    mnemonic: "word1 word2 ... word24"
  }
  // Note: Koios doesn't require API key for basic usage
})

// Interact with Plutus script
const scriptRef = { txHash: "abc123...", outputIndex: 0 }
const datum = { constructor: 0, fields: [42n] }
const redeemer = { constructor: 1, fields: ["unlock"] }

const txHash = await client
  .newTx()
  .payToScript(scriptRef, 5_000_000n, datum)
  .spendFromScript(
    scriptRef,
    { txHash: "def456...", outputIndex: 1 },
    redeemer
  )
  .buildSignAndSubmit()
```

### 5. Token Minting with Native Scripts

```typescript
const client = createBlockfrostClient({
  apiKey: "your-blockfrost-project-id",
  network: "testnet", // Using testnet for minting example
  wallet: {
    type: "seed",
    mnemonic: "word1 word2 ... word24"
  }
})

// Create minting policy (simple signature policy)
const paymentKey = await client.wallet.getPaymentKey()
const nativeScript = {
  type: "sig",
  keyHash: paymentKey.hash()
}

const policyId = calculatePolicyId(nativeScript)
const assetName = "MyToken"

const txHash = await client
  .newTx()
  .mintTokens(
    policyId,
    new Map([[assetName, 1000n]]),
    undefined // No redeemer needed for native scripts
  )
  .attachNativeScript(nativeScript)
  .buildSignAndSubmit()
```

### 6. CIP-30 Browser Wallet Integration

```typescript
// CIP-30 wallets require async initialization
const wallet = await createCIP30Wallet({
  walletName: "nami",
  network: "mainnet"
})

const client = createKupmiosClient({
  apiKey: "your-kupmios-api-key",
  network: "mainnet",
  wallet
})

// Request user permission for each transaction
const txHash = await client
  .newTx()
  .payToAddress("addr1...", 1_000_000n)
  .buildSignAndSubmit() // Will trigger wallet popup for signing
```

### 7. Read-Only Wallet (Compile-Time Safety)

```typescript
// Read-only wallet for blockchain analysis and monitoring
const readOnlyClient = createKupmiosClient({
  apiKey: "your-kupmios-api-key",
  network: "mainnet",
  wallet: {
    type: "readOnly",
    address: "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs2x5nej"
  }
})

// Supported read-only operations
const utxos = await readOnlyClient.getUtxos(someAddress)
const balance = await readOnlyClient.getWalletUtxos()
const protocolParams = await readOnlyClient.getProtocolParameters()

// Transaction construction for analysis (no signing capability)
const unsignedTx = await readOnlyClient
  .newTx()
  .payToAddress("addr1...", 1_000_000n)
  .build() // Returns { transaction, cost } - no signing capability

// Operations intentionally unavailable (compile-time errors):
// readOnlyClient.signTx(transaction)           // Property 'signTx' does not exist
// readOnlyClient.signMessage(address, payload) // Property 'signMessage' does not exist  
// readOnlyClient.submitTx(transaction)         // Property 'submitTx' does not exist

// Transaction builder has no signing methods:
// readOnlyClient.newTx().payToAddress(addr, value).sign()    // Property 'sign' does not exist
// readOnlyClient.newTx().payToAddress(addr, value).submit()  // Property 'submit' does not exist
// readOnlyClient.newTx().payToAddress(addr, value).buildSignAndSubmit() // Property 'buildSignAndSubmit' does not exist

// Type-safe comparison - these return different types:
const signingClient: SigningClient = createKupmiosClient({
  apiKey: "key",
  network: "mainnet", 
  wallet: { type: "seed", mnemonic: "..." }
})

const readClient: ReadOnlyClient = createKupmiosClient({
  apiKey: "key",
  network: "mainnet",
  wallet: { type: "readOnly", address: "addr1..." }
})

// TypeScript knows at compile-time which operations are available
if (typeof signingClient.signTx === 'function') {
  // This code only compiles for SigningClient
  const signature = await signingClient.signTx(transaction)
}

// Factory function also works with pre-created read-only wallet
const readOnlyWallet = createReadOnlyWallet({
  address: "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs2x5nej"
})

const analysisClient = createBlockfrostClient({
  apiKey: "your-blockfrost-project-id",
  network: "mainnet",
  wallet: readOnlyWallet // Type system knows this produces ReadOnlyClient
})
```

### Read-Only Wallet Design Benefits

The read-only wallet design provides several key advantages:

1. **Compile-Time Safety**: TypeScript prevents calling signing methods on read-only clients
2. **Zero Private Key Risk**: No possibility of accidental key exposure in monitoring/analysis code
3. **Clear Intent**: Code clearly communicates whether signing is intended or not
4. **Performance**: Read-only wallets are lightweight with no key management overhead
5. **Flexible Integration**: Suitable for portfolio trackers, block explorers, and analytics tools

```typescript
// Example: Portfolio tracking service
class PortfolioTracker {
  private readOnlyClients: Map<string, ReadOnlyClient> = new Map()
  
  async trackAddress(address: string, apiKey: string) {
    // Type system ensures we can't accidentally sign transactions
    const client = createKupmiosClient({
      apiKey,
      network: "mainnet",
      wallet: { type: "readOnly", address }
    })
    
    this.readOnlyClients.set(address, client)
    
  // Available operations only
    const utxos = await client.getWalletUtxos()
    const balance = this.calculateBalance(utxos)
    
  // Unsupported operations (compile-time errors):
    // await client.signTx(transaction)  // Compile error!
    // await client.submitTx(tx)         // Compile error!
    
    return { address, balance, utxos }
  }
  
  private calculateBalance(utxos: ReadonlyArray<UTxO.UTxO>): Value.Value {
    return utxos.reduce((total, utxo) => 
      Value.merge(total, utxo.output.amount), Value.zero())
  }
}
```

### 8. Optional Provider & Wallet (Advanced Compile-Time Safety)

```typescript
// 1. Provider-only client - blockchain data access without wallet operations
const providerOnlyClient = createKupmiosClient({
  apiKey: "your-kupmios-api-key",
  network: "mainnet"
  // wallet: undefined (explicitly or implicitly)
})

// Provider-only operations
const protocolParams = await providerOnlyClient.getProtocolParameters()
const utxos = await providerOnlyClient.getUtxos("addr1...")
const delegation = await providerOnlyClient.getDelegation(rewardAddress)

// Operations unavailable without wallet (compile-time errors):
// providerOnlyClient.address()           // Property 'address' does not exist
// providerOnlyClient.getWalletUtxos()    // Property 'getWalletUtxos' does not exist
// providerOnlyClient.signTx(tx)          // Property 'signTx' does not exist
// providerOnlyClient.newTx()             // Property 'newTx' does not exist

// 2. Wallet-only client with signing - uses default provider
const walletOnlyClient = createClient({
  network: "mainnet",
  wallet: {
    type: "seed",
    mnemonic: "word1 word2 ... word24"
  }
  // provider: undefined (uses default)
})

// Wallet-only operations (signing enabled)
const walletAddress = await walletOnlyClient.address()
const walletUtxos = await walletOnlyClient.getWalletUtxos()
const signature = await walletOnlyClient.signTx(transaction)
const txHash = await walletOnlyClient.submitTx(transaction)

// Transaction construction using wallet UTxOs
const signedTx = await walletOnlyClient
  .newTx() // Uses wallet's UTxOs automatically
  .payToAddress("addr1...", 1_000_000n)
  .buildSignAndSubmit()

// Operations requiring provider (compile-time errors):
// walletOnlyClient.getProtocolParameters() // Property 'getProtocolParameters' does not exist
// walletOnlyClient.getUtxos(address)       // Property 'getUtxos' does not exist
// walletOnlyClient.getDelegation(addr)     // Property 'getDelegation' does not exist

// 3. Wallet-only client with read-only - uses default provider
const readOnlyWalletOnlyClient = createClient({
  network: "mainnet",
  wallet: {
    type: "readOnly",
    address: "addr1..."
  }
  // provider: undefined (uses default)
})

// Read-only wallet operations
const readOnlyAddress = await readOnlyWalletOnlyClient.address()
const readOnlyUtxos = await readOnlyWalletOnlyClient.getWalletUtxos()

// Transaction construction for analysis (no signing)
const unsignedTx = await readOnlyWalletOnlyClient
  .newTx()
  .payToAddress("addr1...", 1_000_000n)
  .build() // Can only build, not sign or submit

// Operations requiring signing (compile-time errors):
// readOnlyWalletOnlyClient.signTx(tx)        // Property 'signTx' does not exist
// readOnlyWalletOnlyClient.submitTx(tx)      // Property 'submitTx' does not exist
// readOnlyWalletOnlyClient.getUtxos(address) // Property 'getUtxos' does not exist

// 4. Minimal client - neither provider nor wallet
const minimalClient = createClient({
  network: "mainnet"
  // provider: undefined, wallet: undefined
})

// Most operations unavailable at this stage (compile-time errors):
// minimalClient.getUtxos(address)     // Property 'getUtxos' does not exist
// minimalClient.address()             // Property 'address' does not exist
// minimalClient.newTx()               // Property 'newTx' does not exist

// Services can be attached later with type safety
const attachedProviderClient = minimalClient.attachProvider(kupmiosProvider)
// Now has provider operations but still no wallet operations

// Cannot attach wallet without provider (wallet requires provider)
// minimalClient.attachWallet(seedWallet)  // This method doesn't exist

const fullClient = minimalClient.attach(kupmiosProvider, seedWallet)
// Now has both provider and wallet operations

// 5. One Provider, Multiple Wallets Pattern
// Shared provider across multiple wallet clients
const sharedProvider = createKupmiosProvider({
  apiKey: "your-kupmios-api-key"
})

// Create provider-only client
const providerClient = createClient({
  network: "mainnet",
  provider: { type: "custom", provider: sharedProvider }
})

// Attach different wallets to the same provider
const userWallet1 = createSeedWallet({ mnemonic: "user1 mnemonic..." })
const userWallet2 = createSeedWallet({ mnemonic: "user2 mnemonic..." })
const readOnlyWallet = createReadOnlyWallet({ address: "addr1..." })

const client1 = providerClient.attachWallet(userWallet1) // SigningClient
const client2 = providerClient.attachWallet(userWallet2) // SigningClient  
const client3 = providerClient.attachWallet(readOnlyWallet) // ReadOnlyClient

// All clients share the same provider instance and connection
// Appropriate for services managing multiple user wallets

// Example: Multi-user transaction service
class MultiUserTransactionService {
  private providerClient: ProviderOnlyClient
  private userClients: Map<string, SigningClient> = new Map()

  constructor(apiKey: string) {
    this.providerClient = createKupmiosClient({
      apiKey,
      network: "mainnet"
      // No wallet - provider only
    })
  }

  addUser(userId: string, mnemonic: string) {
    const wallet = createSeedWallet({ mnemonic })
    const client = this.providerClient.attachWallet(wallet)
    this.userClients.set(userId, client)
  }

  async sendPayment(fromUserId: string, toAddress: string, amount: bigint) {
    const client = this.userClients.get(fromUserId)
    if (!client) throw new Error("User not found")
    
    return await client
      .newTx()
      .payToAddress(toAddress, amount)
      .buildSignAndSubmit()
  }

  // All users share the same provider connection
}

// 6. Type-safe progressive enhancement
function handleClientByCapability(client: unknown) {
  if ('getUtxos' in client && 'signTx' in client) {
    // TypeScript knows this is a SigningClient
    const signingClient = client as SigningClient
    return signingClient.newTx().payToAddress(addr, value).buildSignAndSubmit()
  }
  
  if ('getUtxos' in client && !('signTx' in client)) {
    // TypeScript knows this is a ProviderOnlyClient or ReadOnlyClient
    const readClient = client as ProviderOnlyClient | ReadOnlyClient
    return readClient.getUtxos(address)
  }
  
  // Minimal client (wallet-only is invalid - wallets need providers)
  const minimal = client as MinimalClient
  return minimal.network // Only basic properties available
}

// 4. Factory functions with different provider/wallet combinations
const combinations = {
  // Full combinations
  full: createKupmiosClient({ 
    apiKey: "key", 
    network: "mainnet", 
    wallet: { type: "seed", mnemonic: "..." } 
  }), // Returns SigningClient
  
  readOnly: createKupmiosClient({ 
    apiKey: "key", 
    network: "mainnet", 
    wallet: { type: "readOnly", address: "addr1..." } 
  }), // Returns ReadOnlyClient
  
  providerOnly: createKupmiosClient({ 
    apiKey: "key", 
    network: "mainnet" 
  }), // Returns ProviderOnlyClient
  
  minimal: createClient({ 
    network: "mainnet" 
  }) // Returns MinimalClient
}

// Note: Wallet-only combinations are invalid (wallets need providers)
// Each has different compile-time capabilities!
```

### Optional Provider & Wallet Design Benefits

The optional provider and wallet design provides unprecedented compile-time safety and flexibility:

#### 🔒 **Granular Security Model**
- **Provider-only**: Zero wallet risk - impossible to accidentally sign transactions
- **Wallet-only**: Limited scope - can't access arbitrary blockchain data
- **Read-only wallet**: Zero private key exposure even with wallet operations
- **Minimal client**: Zero external dependencies until explicitly attached

#### 🎯 **Compile-Time Guarantees**
- **Method Availability**: TypeScript prevents calling unavailable methods
- **Progressive Enhancement**: Start minimal, add capabilities as needed
- **Clear Intent**: Code structure shows exactly what operations are intended
- **Zero Runtime Errors**: All capability checks happen at compile time

#### 🛠️ **Flexible Architecture**
```typescript
// Service-specific clients for microservices
class AnalyticsService {
  // Only needs provider access
  private client: ProviderOnlyClient
  
  constructor(apiKey: string) {
    this.client = createKupmiosClient({ 
      apiKey, 
      network: "mainnet" 
    }) // TypeScript ensures no wallet operations
  }
  
  async analyzeAddress(address: string) {
  // Access to blockchain data
    const utxos = await this.client.getUtxos(address)
    
  // Restricted operations prevented at compile time
    // this.client.signTx(tx)  // Compile error!
    
    return this.processUtxos(utxos)
  }
}

class SigningService {
  // Needs both provider and wallet (wallet requires provider)
  private client: SigningClient
  
  constructor(mnemonic: string, apiKey: string) {
    this.client = createClient({
      network: "mainnet",
      provider: { type: "kupmios", apiKey },
      wallet: { type: "seed", mnemonic }
    }) // Wallet requires provider for blockchain access
  }
  
  async signTransaction(tx: Transaction.Transaction) {
  // Supports signing
    return await this.client.signTx(tx)
    
  // Also provides blockchain data access
    return await this.client.getUtxos(await this.client.address())
  }
}

class MinimalService {
  private client: MinimalClient
  
  constructor(network: NetworkId) {
    this.client = createClient({ network })
    // No external dependencies yet
  }
  
  // Services can be attached based on runtime configuration
  configureProvider(config: ProviderConfig) {
    return this.client.attachProvider(createProvider(config))
  }
  
  configureWallet(config: WalletConfig) {
    return this.client.attachWallet(createWallet(config))
  }
}
```

#### 📊 **Use Cases Enabled**

| Client Type | Provider | Wallet | Use Cases |
|-------------|----------|---------|-----------|
| `SigningClient` | Yes | Yes (Signing) | General DApp functionality and wallet-enabled applications |
| `ReadOnlyClient` | Yes | Yes (Read-only) | Portfolio tracking and transaction analysis |
| `ProviderOnlyClient` | Yes | No | Block explorers, analytics services, monitoring |
| `MinimalClient` | No | No | Configuration bootstrapping and dependency injection |

> **Note**: Wallet-only combinations are invalid because wallet operations require blockchain access through a provider.

## Best Practices

### Provider Selection
- **Kupmios**: Local nodes and high-performance applications
- **Blockfrost**: Production applications with reliable infrastructure  
- **Koios**: Community-driven applications and testing
- **Maestro**: Enterprise applications requiring advanced features

### Security Guidelines
- Use read-only wallets for portfolio tracking and analysis
- Implement provider-only clients for data-intensive services
- Keep wallet operations in isolated, minimal services
- Use minimal clients for configuration and dependency injection

### Progressive Enhancement Pattern
```typescript
// Start minimal and add capabilities as needed
const client = createClient({ network: "mainnet" })

// Add provider when blockchain access is needed
const withProvider = client.attachProvider(createBlockfrostProvider({
  projectId: "your-project-id"
}))

// Add wallet when signing is required
const withWallet = withProvider.attachWallet(createCIP30Wallet("nami"))

// Full client with all capabilities
const txHash = await withWallet
  .newTx()
  .payToAddress(address, Value.lovelace(2_000_000n))
  .buildSignAndSubmit()
```

### Factory Function Usage
```typescript
const client = createKupmiosClient({
  apiKey: "your-kupmios-api-key",
  network: "mainnet",
  wallet: {
    type: "seed",
    mnemonic: "word1 word2 ... word24"
  }
})

// Or with pre-created wallet
const wallet = createSeedWallet({
  mnemonic: "word1 word2 ... word24"
})
const client = createKupmiosClient({ apiKey: "...", network: "mainnet", wallet })

// Initialize and use
const utxos = await client.getUtxos(address) // First network call initializes provider
const txHash = await client.newTx().payToAddress(addr, value).buildSignAndSubmit()
```

### Manual Configuration

```typescript
// Manual configuration (for advanced use cases)
const provider = createKupmiosProvider({ apiKey: "your-api-key" })
const wallet = createSeedWallet({ 
  mnemonic: "word1 word2 ... word24"
})

const client = createClient({
  provider,
  wallet,
  network: "mainnet",
  options: {
    coinSelection: "largest-first",
    feeStrategy: "balanced"
  }
})

// Create client with Blockfrost provider and CIP-30 wallet  
const client = createClient({
  provider: {
    type: "blockfrost",
    apiKey: "your-blockfrost-project-id"
  },
  wallet: {
    type: "cip30",
    walletName: "nami" // "nami", "eternl", "flint", "typhon", etc.
  },
  network: "mainnet"
})

// Create client with Koios provider and private key wallet
const client = createClient({
  provider: {
    type: "koios", 
    apiKey: "your-koios-api-key", // Optional for public instances
    baseUrl: "https://api.koios.rest/api/v1" // Optional custom endpoint
  },
  wallet: {
    type: "privateKey",
    privateKey: "your-hex-encoded-private-key"
  },
  network: "mainnet"
})

// Create client with Maestro provider and seed wallet
const client = createClient({
  provider: {
    type: "maestro",
    apiKey: "your-maestro-api-key"
  },
  wallet: {
    type: "seed",
    mnemonic: "word1 word2 ... word24",
    accountIndex: 0
  },
  network: "mainnet"
})
```

### Wallet Configuration Examples

```typescript
// Create wallets separately and use with any provider
const seedWallet = createSeedWallet({
  mnemonic: "your twenty four word mnemonic phrase here...",
  accountIndex: 0 // Optional, defaults to 0
})

const privateKeyWallet = createPrivateKeyWallet({
  privateKey: "your-hex-encoded-private-key"
})

// CIP-30 wallets require async initialization
const cip30Wallet = await createCIP30Wallet({
  walletName: "nami"
})

// Read-only wallets for monitoring and analysis
const readOnlyWallet = createReadOnlyWallet({
  address: "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs2x5nej"
})

// Use any wallet with any provider
const client = createClient({
  provider: { type: "kupmios", apiKey: "..." },
  wallet: seedWallet, // or privateKeyWallet, cip30Wallet, readOnlyWallet
  network: "mainnet"
})

// Or use wallet config directly (recommended for most cases)
const client = createClient({
  provider: { type: "blockfrost", apiKey: "..." },
  wallet: {
    type: "seed", 
    mnemonic: "your mnemonic..."
  },
  network: "mainnet"
})
```

### Advanced Provider Configuration

```typescript
// Provider with custom configuration
const client = createClient({
  provider: {
    type: "kupmios",
    apiKey: "your-api-key",
    config: {
      timeout: 30000,          // Request timeout in ms
      retries: 3,              // Number of retries
      rateLimit: 100,          // Requests per second
      baseUrl: "https://custom-kupmios-endpoint.com" // Custom endpoint
    }
  },
  wallet: myWallet,
  network: "mainnet"
})

// Multiple providers with automatic failover
const client = createClient({
  provider: {
    type: "multi",
    providers: [
      {
        type: "kupmios",
        apiKey: "primary-key",
        priority: 1
      },
      {
        type: "blockfrost", 
        apiKey: "fallback-key",
        priority: 2
      }
    ],
    failoverStrategy: "round-robin" // or "priority", "random"
  },
  wallet: myWallet,
  network: "mainnet"
})
```

### Provider Configuration Types

```typescript
// Wallet requires provider - can't have wallet operations without blockchain access
export type ClientConfig = 
  | { 
      readonly network: NetworkId; 
      readonly provider: ProviderConfig; 
      readonly wallet: WalletConfig | Wallet;
      readonly options?: ClientOptions;
    }    // Provider + Wallet
  | { 
      readonly network: NetworkId; 
      readonly provider: ProviderConfig; 
      readonly wallet?: undefined;
      readonly options?: ClientOptions;
    }      // Provider only  
  | { 
      readonly network: NetworkId; 
      readonly provider?: undefined; 
      readonly wallet?: undefined;
      readonly options?: ClientOptions;
    }          // Minimal (neither)

export type ProviderConfig = 
  | KupmiosConfig
  | BlockfrostConfig  
  | KoiosConfig
  | MaestroConfig
  | MultiProviderConfig
  | CustomProviderConfig

export type WalletConfig = 
  | SeedWalletConfig
  | PrivateKeyWalletConfig
  | CIP30WalletConfig
  | ReadOnlyWalletConfig
  | CustomWalletConfig

export interface KupmiosConfig {
  readonly type: "kupmios"
  readonly apiKey: string
  readonly config?: ProviderOptions
}

export interface BlockfrostConfig {
  readonly type: "blockfrost"
  readonly apiKey: string // Project ID
  readonly config?: ProviderOptions
}

export interface KoiosConfig {
  readonly type: "koios"
  readonly apiKey?: string // Optional for public instances
  readonly baseUrl?: string // Custom endpoint
  readonly config?: ProviderOptions
}

export interface MaestroConfig {
  readonly type: "maestro"
  readonly apiKey: string
  readonly config?: ProviderOptions
}

export interface MultiProviderConfig {
  readonly type: "multi"
  readonly providers: ReadonlyArray<ProviderConfig & { priority?: number }>
  readonly failoverStrategy: "round-robin" | "priority" | "random"
  readonly healthCheck?: boolean
}

export interface CustomProviderConfig {
  readonly type: "custom"
  readonly provider: Provider // User-provided provider instance
}

export interface ProviderOptions {
  readonly timeout?: number        // Request timeout in milliseconds
  readonly retries?: number        // Number of retries for failed requests
  readonly rateLimit?: number      // Requests per second limit
  readonly baseUrl?: string        // Custom base URL
  readonly headers?: Record<string, string> // Additional headers
}

// Wallet Configuration Types
export interface SeedWalletConfig {
  readonly type: "seed"
  readonly mnemonic: string
  readonly accountIndex?: number    // Default: 0
  readonly addressIndex?: number    // Default: 0
  readonly passphrase?: string     // Optional passphrase
}

export interface PrivateKeyWalletConfig {
  readonly type: "privateKey"
  readonly privateKey: string      // Hex-encoded private key
}

export interface CIP30WalletConfig {
  readonly type: "cip30"
  readonly walletName: string      // e.g., "nami", "eternl", "flint", "typhon"
}

export interface ReadOnlyWalletConfig {
  readonly type: "readOnly"
  readonly address: string         // Base58 or Bech32 encoded address
}

export interface CustomWalletConfig {
  readonly type: "custom"
  readonly wallet: Wallet         // User-provided wallet instance
}

export type NetworkId = "mainnet" | "testnet" | "preview" | "preprod"

export interface ClientOptions {
  readonly caching?: CacheOptions
  readonly logging?: LoggingOptions
  readonly metrics?: MetricsOptions
}
```

## Core Interfaces

### Client Factory Function

```typescript
// Main client factory function with sophisticated type-safe overloads
// Based on provider and wallet presence/absence

// Full client - both provider and signing wallet
export function createClient(config: { network: NetworkId, provider: ProviderConfig, wallet: SeedWalletConfig | PrivateKeyWalletConfig | CIP30WalletConfig | SigningWallet, options?: ClientOptions }): SigningClient

// Read-only client - provider with read-only wallet
export function createClient(config: { network: NetworkId, provider: ProviderConfig, wallet: ReadOnlyWalletConfig | ReadOnlyWallet, options?: ClientOptions }): ReadOnlyClient

// Provider-only client - no wallet operations available
export function createClient(config: { network: NetworkId, provider: ProviderConfig, wallet?: undefined, options?: ClientOptions }): ProviderOnlyClient

// Minimal client - neither provider nor wallet specified (wallet-only combinations are invalid)
export function createClient(config: { network: NetworkId, provider?: undefined, wallet?: undefined, options?: ClientOptions }): MinimalClient
```

```typescript

// Fallback for any other combinations
export function createClient(config: ClientConfig): Client

// Alternative factory functions for specific providers (these require both provider and wallet)
export function createKupmiosClient(config: { apiKey: string, network: NetworkId, wallet?: ReadOnlyWalletConfig | ReadOnlyWallet, options?: ClientOptions }): ReadOnlyClient
export function createKupmiosClient(config: { apiKey: string, network: NetworkId, wallet?: SeedWalletConfig | PrivateKeyWalletConfig | CIP30WalletConfig | SigningWallet, options?: ClientOptions }): SigningClient
export function createKupmiosClient(config: { apiKey: string, network: NetworkId, wallet?: undefined, options?: ClientOptions }): ProviderOnlyClient
export function createKupmiosClient(config: { apiKey: string, network: NetworkId, wallet?: WalletConfig | Wallet, options?: ClientOptions }): Client // Fallback

export function createBlockfrostClient(config: { apiKey: string, network: NetworkId, wallet?: ReadOnlyWalletConfig | ReadOnlyWallet, options?: ClientOptions }): ReadOnlyClient
export function createBlockfrostClient(config: { apiKey: string, network: NetworkId, wallet?: SeedWalletConfig | PrivateKeyWalletConfig | CIP30WalletConfig | SigningWallet, options?: ClientOptions }): SigningClient
export function createBlockfrostClient(config: { apiKey: string, network: NetworkId, wallet?: undefined, options?: ClientOptions }): ProviderOnlyClient
export function createBlockfrostClient(config: { apiKey: string, network: NetworkId, wallet?: WalletConfig | Wallet, options?: ClientOptions }): Client // Fallback

export function createKoiosClient(config: { apiKey?: string, network: NetworkId, wallet?: ReadOnlyWalletConfig | ReadOnlyWallet, baseUrl?: string, options?: ClientOptions }): ReadOnlyClient
export function createKoiosClient(config: { apiKey?: string, network: NetworkId, wallet?: SeedWalletConfig | PrivateKeyWalletConfig | CIP30WalletConfig | SigningWallet, baseUrl?: string, options?: ClientOptions }): SigningClient
export function createKoiosClient(config: { apiKey?: string, network: NetworkId, wallet?: undefined, baseUrl?: string, options?: ClientOptions }): ProviderOnlyClient
export function createKoiosClient(config: { apiKey?: string, network: NetworkId, wallet?: WalletConfig | Wallet, baseUrl?: string, options?: ClientOptions }): Client // Fallback

export function createMaestroClient(config: { apiKey: string, network: NetworkId, wallet?: ReadOnlyWalletConfig | ReadOnlyWallet, options?: ClientOptions }): ReadOnlyClient
export function createMaestroClient(config: { apiKey: string, network: NetworkId, wallet?: SeedWalletConfig | PrivateKeyWalletConfig | CIP30WalletConfig | SigningWallet, options?: ClientOptions }): SigningClient
export function createMaestroClient(config: { apiKey: string, network: NetworkId, wallet?: undefined, options?: ClientOptions }): ProviderOnlyClient
export function createMaestroClient(config: { apiKey: string, network: NetworkId, wallet?: WalletConfig | Wallet, options?: ClientOptions }): Client // Fallback

// Wallet factory functions
export const createSeedWallet: (config: {
  mnemonic: string
  accountIndex?: number
  addressIndex?: number
  passphrase?: string
}) => Wallet

export const createPrivateKeyWallet: (config: {
  privateKey: string
}) => Wallet

export const createCIP30Wallet: (config: {
  walletName: string
}) => Promise<Wallet> // CIP-30 requires async initialization

export const createReadOnlyWallet: (config: {
  address: string
}) => ReadOnlyWallet
```

**Design Note: Synchronous Construction**

The client factory functions are synchronous - they return a `Client` instance immediately rather than a `Promise<Client>`. Provider initialization and network connections are handled lazily on first use, ensuring fast client construction while maintaining a clean, non-async API.

## Type-Safe Read-Only Wallets

The Evolution SDK provides compile-time safety for read-only wallets. When using a read-only wallet, the type system prevents signing operations at compile time:

```typescript
// Read-only wallet interface (subset of Wallet)
export interface ReadOnlyWallet {
  readonly address: Effect.Effect<Address.Address, WalletError>
  readonly rewardAddress: Effect.Effect<RewardAddress.RewardAddress | null, WalletError>
  readonly getWalletUtxos: Effect.Effect<ReadonlyArray<UTxO.UTxO>, WalletError>
  readonly getWalletDelegation: Effect.Effect<Delegation.Delegation, WalletError>
  // Note: NO signTx, signMessage, or submitTx methods
}

// Full wallet interface with signing capabilities
export interface SigningWallet extends ReadOnlyWallet {
  readonly signTx: (tx: Transaction.Transaction, virtualUtxos?: ReadonlyArray<UTxO.UTxO>) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  readonly signMessage: (address: Address.Address | RewardAddress.RewardAddress, payload: Payload) => Effect.Effect<SignedMessage, WalletError>
  readonly submitTx: (tx: Transaction.Transaction | string) => Effect.Effect<string, WalletError>
}

// Type alias for compatibility
export type Wallet = SigningWallet

// Type-safe client interfaces based on wallet capability
export interface ReadOnlyClient {
  // All provider operations (read-only blockchain access)
  readonly getProtocolParameters: () => Promise<ProtocolParameters.ProtocolParameters>
  readonly getUtxos: (addressOrCredential: Address.Address | { hash: string }) => Promise<Array<UTxO>>
  readonly getUtxosWithUnit: (addressOrCredential: Address.Address | { hash: string }, unit: string) => Promise<Array<UTxO>>
  readonly getUtxoByUnit: (unit: string) => Promise<UTxO>
  readonly getUtxosByOutRef: (outRefs: ReadonlyArray<OutRef.OutRef>) => Promise<Array<UTxO>>
  readonly getDelegation: (rewardAddress: RewardAddress.RewardAddress) => Promise<Delegation.Delegation>
  readonly getDatum: (datumHash: string) => Promise<string>
  readonly awaitTx: (txHash: string, checkInterval?: number) => Promise<boolean>
  readonly evaluateTx: (tx: string, additionalUTxOs?: Array<UTxO>) => Promise<Array<EvalRedeemer>>

  // Read-only wallet operations
  readonly address: () => Promise<Address.Address>
  readonly rewardAddress: () => Promise<RewardAddress.RewardAddress | null>
  readonly getWalletUtxos: () => Promise<ReadonlyArray<UTxO.UTxO>>
  readonly getWalletDelegation: () => Promise<Delegation.Delegation>

  // Build-only transaction operations (no signing)
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilder

  // Effect namespace
  readonly Effect: ReadOnlyClientEffect

  // Underlying services
  readonly provider: Provider
  readonly wallet: ReadOnlyWallet
}

export interface SigningClient extends ReadOnlyClient {
  // Additional signing operations
  readonly signTx: (tx: Transaction.Transaction, virtualUtxos?: ReadonlyArray<UTxO.UTxO>) => Promise<TransactionWitnessSet.TransactionWitnessSet>
  readonly signMessage: (address: Address.Address | RewardAddress.RewardAddress, payload: Payload) => Promise<SignedMessage>
  readonly submitTx: (tx: Transaction.Transaction | string) => Promise<string>

  // Full transaction operations (with signing)
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => TransactionBuilder

  // Override with signing capabilities
  readonly Effect: ClientEffect
  readonly wallet: SigningWallet
  readonly templates: TransactionTemplates
}

// Main Client type (backward compatibility)
export type Client = SigningClient

// Provider-only client (no wallet operations)
export interface ProviderOnlyClient {
  // All provider operations (blockchain data access)
  readonly getProtocolParameters: () => Promise<ProtocolParameters.ProtocolParameters>
  readonly getUtxos: (addressOrCredential: Address.Address | { hash: string }) => Promise<Array<UTxO>>
  readonly getUtxosWithUnit: (addressOrCredential: Address.Address | { hash: string }, unit: string) => Promise<Array<UTxO>>
  readonly getUtxoByUnit: (unit: string) => Promise<UTxO>
  readonly getUtxosByOutRef: (outRefs: ReadonlyArray<OutRef.OutRef>) => Promise<Array<UTxO>>
  readonly getDelegation: (rewardAddress: RewardAddress.RewardAddress) => Promise<Delegation.Delegation>
  readonly getDatum: (datumHash: string) => Promise<string>
  readonly awaitTx: (txHash: string, checkInterval?: number) => Promise<boolean>
  readonly evaluateTx: (tx: string, additionalUTxOs?: Array<UTxO>) => Promise<Array<EvalRedeemer>>

  // NO wallet operations available - these don't exist at compile time:
  // address, rewardAddress, getWalletUtxos, getWalletDelegation, signTx, signMessage, submitTx

  // Can't create transactions without a wallet
  // NO newTx method

  // Can attach wallets to create full clients (provider + wallet)
  readonly attachWallet: (wallet: SigningWallet) => SigningClient
  readonly attachWallet: (wallet: ReadOnlyWallet) => ReadOnlyClient

  // Effect namespace (provider only)
  readonly Effect: ProviderOnlyClientEffect

  // Only provider service available
  readonly provider: Provider
  // NO wallet property
}

// Minimal client (neither provider nor wallet specified)
export interface MinimalClient {
  // NO provider operations available
  // NO wallet operations available
  // NO transaction operations available

  // Only configuration and utility methods
  readonly network: NetworkId
  readonly options?: ClientOptions

  // Can attach provider only (wallet requires provider)
  readonly attachProvider: (provider: Provider) => ProviderOnlyClient
  
  // Can attach both provider and wallet together (wallet requires provider)
  readonly attach: (provider: Provider, wallet: SigningWallet) => SigningClient
  readonly attach: (provider: Provider, wallet: ReadOnlyWallet) => ReadOnlyClient

  // Effect namespace (minimal)
  readonly Effect: MinimalClientEffect
}

// Read-only transaction builder (no signing methods)
export interface ReadOnlyTransactionBuilder {
  // All the build methods but NO sign/submit methods
  readonly payToAddress: (address: Address.Address, value: Value.Value) => ReadOnlyTransactionBuilder
  readonly payToAddressWithData: (address: Address.Address, value: Value.Value, data: Datum) => ReadOnlyTransactionBuilder
  readonly payToScript: (scriptRef: ScriptRef, value: Value.Value, datum: Datum, redeemer?: Redeemer.Redeemer) => ReadOnlyTransactionBuilder
  readonly spendFromScript: (scriptRef: ScriptRef, utxo: UTxO.UTxO, redeemer: Redeemer.Redeemer) => ReadOnlyTransactionBuilder
  readonly mintTokens: (policyId: PolicyId.PolicyId, assets: Map<AssetName.AssetName, bigint>, redeemer?: Redeemer.Redeemer) => ReadOnlyTransactionBuilder
  readonly burnTokens: (policyId: PolicyId.PolicyId, assets: Map<AssetName.AssetName, bigint>, redeemer?: Redeemer.Redeemer) => ReadOnlyTransactionBuilder
  readonly attachScript: (script: PlutusScript.PlutusScript) => ReadOnlyTransactionBuilder
  readonly attachNativeScript: (script: NativeScript.NativeScript) => ReadOnlyTransactionBuilder
  readonly attachScriptRef: (scriptRef: ScriptRef) => ReadOnlyTransactionBuilder
  readonly collectFrom: (utxos: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilder
  readonly addSigner: (keyHash: string) => ReadOnlyTransactionBuilder
  readonly setValidityInterval: (start?: Slot, end?: Slot) => ReadOnlyTransactionBuilder
  readonly addMetadata: (label: MetadataLabel, metadata: TransactionMetadatum.TransactionMetadatum) => ReadOnlyTransactionBuilder
  readonly addCertificate: (cert: Certificate.Certificate) => ReadOnlyTransactionBuilder
  readonly withdraw: (rewardAddress: RewardAddress.RewardAddress, amount: Coin.Coin, redeemer?: Redeemer.Redeemer) => ReadOnlyTransactionBuilder

  // Build method returns transaction but no signing capabilities
  readonly build: (options?: BuildOptions) => Promise<{ transaction: Transaction.Transaction, cost: TransactionEstimate }>

  // Effect version
  readonly Effect: ReadOnlyTransactionBuilderEffect
}

export interface ReadOnlyTransactionBuilderEffect {
  // Same methods as ReadOnlyTransactionBuilder but returning Effect types
  readonly build: (options?: BuildOptions) => Effect.Effect<{ transaction: Transaction.Transaction, cost: TransactionEstimate }, TransactionBuilderError>
  // ... other methods with Effect return types
}

export interface ReadOnlyClientEffect {
  // Same as ClientEffect but without signing operations
  readonly getProtocolParameters: Effect.Effect<ProtocolParameters.ProtocolParameters, ProviderError>
  readonly getUtxos: (addressOrCredential: Address.Address | { hash: string }) => Effect.Effect<Array<UTxO>, ProviderError>
  // ... other read-only operations
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => ReadOnlyTransactionBuilderEffect
}

// Provider-only Effect interface
export interface ProviderOnlyClientEffect {
  // Only provider operations, no wallet operations
  readonly getProtocolParameters: Effect.Effect<ProtocolParameters.ProtocolParameters, ProviderError>
  readonly getUtxos: (addressOrCredential: Address.Address | { hash: string }) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getUtxosWithUnit: (addressOrCredential: Address.Address | { hash: string }, unit: string) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getUtxoByUnit: (unit: string) => Effect.Effect<UTxO, ProviderError>
  readonly getUtxosByOutRef: (outRefs: ReadonlyArray<OutRef.OutRef>) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getDelegation: (rewardAddress: RewardAddress.RewardAddress) => Effect.Effect<Delegation.Delegation, ProviderError>
  readonly getDatum: (datumHash: string) => Effect.Effect<string, ProviderError>
  readonly awaitTx: (txHash: string, checkInterval?: number) => Effect.Effect<boolean, ProviderError>
  readonly evaluateTx: (tx: string, additionalUTxOs?: Array<UTxO>) => Effect.Effect<Array<EvalRedeemer>, ProviderError>
  // NO wallet operations, NO newTx

  // Can attach wallets to create full clients (provider + wallet)
  readonly attachWallet: (wallet: SigningWallet) => ClientEffect
  readonly attachWallet: (wallet: ReadOnlyWallet) => ReadOnlyClientEffect
}

// Minimal Effect interface (wallet requires provider)
export interface MinimalClientEffect {
  // Only provider attachment (can work standalone)
  readonly attachProvider: (provider: Provider) => ProviderOnlyClientEffect
  
  // Attach both provider and wallet together (wallet requires provider)
  readonly attach: (provider: Provider, wallet: SigningWallet) => ClientEffect
  readonly attach: (provider: Provider, wallet: ReadOnlyWallet) => ReadOnlyClientEffect
}

```typescript
// Client construction is immediate and synchronous
const client = createKupmiosClient({ apiKey: "...", network: "mainnet", wallet })

// Network operations are async when needed
const utxos = await client.getUtxos(address) // First network call initializes provider
const txHash = await client.newTx().payToAddress(addr, value).buildSignAndSubmit()
```

### Client Interface

```typescript
export interface Client extends EffectToPromiseAPI<ClientEffect> {
  // Effect namespace for Effect-based alternatives
  readonly Effect: ClientEffect
  
  // Underlying services
  readonly provider: Provider
  readonly wallet: Wallet
  
  // Transaction templates for common operations
  readonly templates: TransactionTemplates
}

export interface ClientEffect {
  // Provider operations (blockchain data access)
  readonly getProtocolParameters: Effect.Effect<ProtocolParameters.ProtocolParameters, ProviderError>
  readonly getUtxos: (addressOrCredential: Address.Address | { hash: string }) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getUtxosWithUnit: (addressOrCredential: Address.Address | { hash: string }, unit: string) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getUtxoByUnit: (unit: string) => Effect.Effect<UTxO, ProviderError>
  readonly getUtxosByOutRef: (outRefs: ReadonlyArray<OutRef.OutRef>) => Effect.Effect<Array<UTxO>, ProviderError>
  readonly getDelegation: (rewardAddress: RewardAddress.RewardAddress) => Effect.Effect<Delegation.Delegation, ProviderError>
  readonly getDatum: (datumHash: string) => Effect.Effect<string, ProviderError>
  readonly awaitTx: (txHash: string, checkInterval?: number) => Effect.Effect<boolean, ProviderError>
  readonly evaluateTx: (tx: string, additionalUTxOs?: Array<UTxO>) => Effect.Effect<Array<EvalRedeemer>, ProviderError>
  
  // Wallet operations (account management and signing)
  readonly address: Effect.Effect<Address.Address, WalletError>
  readonly rewardAddress: Effect.Effect<RewardAddress.RewardAddress | null, WalletError>
  readonly getWalletUtxos: Effect.Effect<ReadonlyArray<UTxO.UTxO>, WalletError>
  readonly getWalletDelegation: Effect.Effect<Delegation.Delegation, WalletError>
  readonly signTx: (tx: Transaction.Transaction, virtualUtxos?: ReadonlyArray<UTxO.UTxO>) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, WalletError>
  readonly signMessage: (address: Address.Address | RewardAddress.RewardAddress, payload: Payload) => Effect.Effect<SignedMessage, WalletError>
  readonly submitTx: (tx: Transaction.Transaction | string) => Effect.Effect<string, WalletError>
  
  // Transaction building
  readonly newTx: (utxos?: ReadonlyArray<UTxO.UTxO>) => TransactionBuilderEffect
}
```

### TransactionBuilder Interface

The TransactionBuilder provides a fluent API for constructing transactions with method chaining:

```typescript
export interface TransactionBuilder extends EffectToPromiseAPI<TransactionBuilderEffect> {
  readonly Effect: TransactionBuilderEffect
}

export interface TransactionBuilderEffect {
  // Basic transaction operations
  readonly payToAddress: (address: Address.Address, value: Value.Value) => TransactionBuilderEffect
  readonly payToAddressWithDatum: (address: Address.Address, value: Value.Value, datum: Data.Data) => TransactionBuilderEffect
  readonly payToScript: (scriptHash: ScriptHash.ScriptHash, value: Value.Value, datum: Data.Data) => TransactionBuilderEffect
  
  // Native token operations
  readonly mintTokens: (policyId: PolicyId.PolicyId, assets: Map<AssetName.AssetName, bigint>, redeemer?: Redeemer.Redeemer) => TransactionBuilderEffect
  readonly burnTokens: (policyId: PolicyId.PolicyId, assets: Map<AssetName.AssetName, bigint>, redeemer?: Redeemer.Redeemer) => TransactionBuilderEffect
  
  // Staking operations
  readonly delegateStake: (poolId: PoolKeyHash.PoolKeyHash) => TransactionBuilderEffect
  readonly withdrawRewards: (amount?: Coin.Coin) => TransactionBuilderEffect
  readonly registerStakeKey: () => TransactionBuilderEffect
  readonly deregisterStakeKey: () => TransactionBuilderEffect
  
  // Governance operations
  readonly vote: (governanceActionId: string, vote: VotingChoice) => TransactionBuilderEffect
  readonly proposeGovernanceAction: (proposal: ProposalProcedure.ProposalProcedure) => TransactionBuilderEffect
  
  // Transaction metadata and configuration
  readonly addMetadata: (label: MetadataLabel, metadata: TransactionMetadatum.TransactionMetadatum) => TransactionBuilderEffect
  readonly setValidityInterval: (start?: Slot, end?: Slot) => TransactionBuilderEffect
  readonly addRequiredSigner: (keyHash: KeyHash.KeyHash) => TransactionBuilderEffect
  readonly addCollateral: (utxo: UTxO.UTxO) => TransactionBuilderEffect
  
  // Manual input/output management
  readonly addInput: (utxo: UTxO.UTxO, redeemer?: Redeemer.Redeemer) => TransactionBuilderEffect
  readonly addOutput: (output: TransactionOutput.TransactionOutput) => TransactionBuilderEffect
  readonly addChangeOutput: (address: Address.Address) => TransactionBuilderEffect
  
  // Script operations
  readonly attachScript: (script: Script.Script) => TransactionBuilderEffect
  readonly attachDatum: (datum: Data.Data) => TransactionBuilderEffect
  
  // Transaction finalization and execution
  readonly build: (options?: BuildOptions) => Effect.Effect<SignBuilder, TransactionBuilderError>
  readonly buildAndSign: (options?: BuildOptions) => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
  readonly buildSignAndSubmit: (options?: BuildOptions) => Effect.Effect<string, TransactionBuilderError>
  readonly estimateFee: (options?: BuildOptions) => Effect.Effect<TransactionEstimate, TransactionBuilderError>
  
  // Transaction chaining
  readonly chain: (options?: BuildOptions) => Effect.Effect<ChainResult, TransactionBuilderError>
}
```

### Supporting Types

```typescript
export interface BuiltTransaction {
  readonly transaction: Transaction.Transaction
  readonly cost: TransactionEstimate
}

export interface SignedTransaction {
  readonly transaction: Transaction.Transaction
  readonly witnessSet: TransactionWitnessSet.TransactionWitnessSet
  readonly cbor: string
}

export interface ChainResult {
  readonly transaction: Transaction.Transaction
  readonly newOutputs: ReadonlyArray<UTxO.UTxO>      // UTxOs created by this transaction
  readonly updatedUtxos: ReadonlyArray<UTxO.UTxO>    // Available UTxOs for next transaction (original - spent + new)
  readonly spentUtxos: ReadonlyArray<UTxO.UTxO>      // UTxOs consumed by this transaction
  readonly cost: TransactionEstimate
}

export interface TransactionEstimate {
  readonly fee: Coin.Coin
  readonly executionUnits?: ExecutionUnits
  readonly scriptDataHash?: ScriptDataHash.ScriptDataHash
}

// Progressive Builder Interfaces
export interface SignBuilder extends EffectToPromiseAPI<SignBuilderEffect> {
  readonly Effect: SignBuilderEffect
  readonly transaction: Transaction.Transaction
  readonly cost: TransactionEstimate
}

export interface SignBuilderEffect {
  // Main signing method - produces a fully signed transaction ready for submission
  readonly sign: () => Effect.Effect<SubmitBuilder, TransactionBuilderError>
  
  // Add external witness and proceed to submission
  readonly signWithWitness: (witnessSet: TransactionWitnessSet.TransactionWitnessSet) => Effect.Effect<SubmitBuilder, TransactionBuilderError>
  
  // Assemble multiple witnesses into a complete transaction ready for submission
  readonly assemble: (witnesses: ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>) => Effect.Effect<SubmitBuilder, TransactionBuilderError>
  
  // Partial signing - creates witness without advancing to submission (useful for multi-sig)
  readonly partialSign: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
  
  // Get witness set without signing (for inspection)
  readonly getWitnessSet: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
}

export interface SubmitBuilder extends EffectToPromiseAPI<SubmitBuilderEffect> {
  readonly Effect: SubmitBuilderEffect
  readonly transaction: Transaction.Transaction
  readonly witnessSet: TransactionWitnessSet.TransactionWitnessSet
  readonly cbor: string
}

export interface SubmitBuilderEffect {
  readonly submit: () => Effect.Effect<string, TransactionBuilderError>
  readonly simulate: () => Effect.Effect<TransactionSimulation, TransactionBuilderError>
}

export interface TransactionSimulation {
  readonly isValid: boolean
  readonly executionUnits?: ExecutionUnits
  readonly logs?: ReadonlyArray<string>
  readonly errors?: ReadonlyArray<string>
}

// Build Options
export interface BuildOptions {
  readonly coinSelection?: CoinSelectionStrategy | CustomCoinSelector
  readonly coinSelectionOptions?: CoinSelectionOptions
  readonly feeMultiplier?: number                   // Fee adjustment factor (default: 1.0)
}

// Coin Selection Types
export type CoinSelectionStrategy = 
  | "largest-first"       // Select largest UTxOs first (minimize change)
  | "random-improve"      // CIP-2 Random-Improve algorithm
  | "smallest-first"      // Select smallest UTxOs first (UTxO consolidation)
  | "optimal"             // SDK-optimized selection

export interface CustomCoinSelector {
  readonly selectCoins: (
    availableUtxos: ReadonlyArray<UTxO.UTxO>,
    targetValue: Value.Value,
    options?: CoinSelectionOptions
  ) => Effect.Effect<CoinSelectionResult, CoinSelectionError>
}

export interface CoinSelectionOptions {
  readonly maxInputs?: number
  readonly feeRate?: Coin.Coin
  readonly includeUtxos?: ReadonlyArray<UTxO.UTxO>    // UTxOs that must be included
  readonly excludeUtxos?: ReadonlyArray<UTxO.UTxO>    // UTxOs that must be excluded
}

export interface CoinSelectionResult {
  readonly selectedUtxos: ReadonlyArray<UTxO.UTxO>
  readonly change: ReadonlyArray<TransactionOutput.TransactionOutput>
  readonly fee: Coin.Coin
}

// Transaction Templates
export interface TransactionTemplates extends EffectToPromiseAPI<TransactionTemplatesEffect> {
  readonly Effect: TransactionTemplatesEffect
}

export interface TransactionTemplatesEffect {
  // Simple operations
  readonly simplePayment: (recipient: Address.Address, amount: Value.Value) => Effect.Effect<string, ClientError>
  readonly multiPayment: (recipients: ReadonlyArray<{ address: Address.Address, amount: Value.Value }>) => Effect.Effect<string, ClientError>
  
  // Token operations
  readonly mintNFT: (metadata: NFTMetadata, recipient: Address.Address) => Effect.Effect<string, ClientError>
  readonly mintTokens: (policyId: PolicyId.PolicyId, tokens: Map<AssetName.AssetName, bigint>, recipient?: Address.Address) => Effect.Effect<string, ClientError>
  readonly tokenTransfer: (recipient: Address.Address, policyId: PolicyId.PolicyId, tokenName: AssetName.AssetName, amount: bigint) => Effect.Effect<string, ClientError>
  
  // Staking operations
  readonly delegateToPool: (poolId: PoolKeyHash.PoolKeyHash) => Effect.Effect<string, ClientError>
  readonly withdrawAllRewards: () => Effect.Effect<string, ClientError>
  readonly registerAndDelegate: (poolId: PoolKeyHash.PoolKeyHash) => Effect.Effect<string, ClientError>
  
  // Governance operations
  readonly voteOnProposal: (governanceActionId: string, vote: VotingChoice) => Effect.Effect<string, ClientError>
  readonly submitProposal: (proposal: ProposalProcedure.ProposalProcedure, deposit: Coin.Coin) => Effect.Effect<string, ClientError>
}

export interface NFTMetadata {
  readonly name: string
  readonly description?: string
  readonly image?: string
  readonly attributes?: ReadonlyArray<{ trait_type: string, value: string }>
  readonly [key: string]: unknown
}

export type ClientError = ProviderError | WalletError | TransactionBuilderError | CoinSelectionError

export interface TransactionBuilderError {
  readonly _tag: "TransactionBuilderError"
  readonly message: string
  readonly cause?: unknown
}

export interface CoinSelectionError {
  readonly _tag: "CoinSelectionError"
  readonly message: string
  readonly cause?: unknown
}
```

## UTxO-Based Transaction Building

The Evolution SDK embraces Cardano's UTxO model by making UTxO management explicit and transparent. This design provides several key benefits:

### Pure Functional Approach

```typescript
// TransactionBuilder is a pure function of UTxOs
const builder = client.newTx(myUtxos)  // Deterministic given the same UTxO set
```

**Benefits:**
- **Deterministic**: Same UTxOs + same operations = same result
- **Testable**: Easy to test with mock UTxO sets
- **Composable**: Can combine and chain operations predictably
- **No Hidden State**: All UTxO state is explicit

### Transaction Chaining

When chaining transactions off-chain, each transaction in the chain consumes UTxOs and produces new ones:

```mermaid
graph LR
    A[Initial UTxOs] --> B[Tx1: Pay Alice]
    B --> C[Updated UTxOs]
    C --> D[Tx2: Mint Tokens]
    D --> E[Final UTxOs]
```

The `chain()` method computes the UTxO state transformation:

```typescript
interface ChainResult {
  transaction: Transaction           // The built transaction
  spentUtxos: UTxO[]                // UTxOs consumed as inputs
  newOutputs: UTxO[]                // UTxOs created as outputs  
  updatedUtxos: UTxO[]              // Available UTxOs = original - spent + new
}
```

### Automatic vs Explicit UTxO Management

The `newTx()` method provides flexibility through optional UTxO parameter:

```typescript
// Automatic UTxO Management (Default Behavior)
// When no UTxOs provided, automatically fetches from wallet
client.newTx()                              // Internally calls wallet.getUtxos()
  .payToAddress(alice, amount)
  .build()

// Explicit UTxO Management (For Chaining & Advanced Use Cases)
// When UTxOs provided, builder operates purely on that set
client.newTx(myUtxos)                       // Uses only the provided UTxOs
  .payToAddress(alice, amount)
  .chain()
```

**Implementation Logic:**
```typescript
// Conceptual client implementation
class Client {
  newTx(utxos?: ReadonlyArray<UTxO.UTxO>): TransactionBuilder {
    if (utxos === undefined) {
      // Automatic: Fetch UTxOs from wallet
      return new TransactionBuilder(this.wallet.getUtxos(), this.provider)
    } else {
      // Explicit: Use provided UTxOs (wallet-independent)
      return new TransactionBuilder(utxos, this.provider)
    }
  }
}
```

**Benefits of this approach:**
- **Convenience**: Simple transactions "just work" without UTxO management
- **Control**: Advanced scenarios can manage UTxO state explicitly
- **Backward Compatibility**: Existing code continues to work
- **Pure Functions**: When UTxOs are provided, builder is deterministic

This gives developers the flexibility to choose between convenience and control based on their use case.

### Basic Setup

```typescript
import { createClient } from "@evolution-sdk/core"

// Create client with built-in provider and wallet configurations
const client = createClient({
  provider: {
    type: "kupmios",
    apiKey: "your-kupmios-api-key",
    network: "mainnet"
  },
  wallet: {
    type: "seed",
    mnemonic: "your twenty four word mnemonic phrase here...",
    network: "mainnet"
  }
})

// Or with Blockfrost provider and CIP-30 wallet
const client = createClient({
  provider: {
    type: "blockfrost", 
    apiKey: "your-blockfrost-project-id",
    network: "mainnet"
  },
  wallet: {
    type: "cip30",
    walletName: "nami"
  },
  network: "mainnet"
})

// Or with custom provider and private key wallet
const client = createClient({
  provider: {
    type: "custom",
    provider: myCustomProvider
  },
  wallet: {
    type: "privateKey",
    privateKey: "your-hex-private-key"
  },
  network: "mainnet"
})

// Convenience factory functions with wallet configurations
const kupmiosClient = createKupmiosClient({
  apiKey: "your-api-key",
  network: "mainnet", 
  wallet: {
    type: "privateKey",
    privateKey: "your-hex-private-key"
  }
})

const blockfrostClient = createBlockfrostClient({
  apiKey: "your-project-id",
  network: "testnet",
  wallet: {
    type: "seed",
    mnemonic: "your mnemonic..."
  }
})
```

### Simple Payment Transaction

```typescript
// Promise-based API (UTxOs fetched automatically from wallet)
const txHash = await client
  .newTx()  // ← No UTxOs provided, automatically uses wallet.getUtxos()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .buildSignAndSubmit()

console.log(`Transaction submitted: ${txHash}`)

// Effect-based API (same automatic behavior)
const txHash = await Effect.runPromise(
  client.Effect.newTx()  // ← Automatically uses wallet UTxOs
    .payToAddress(recipientAddress, Value.lovelace(1000000n))
    .buildSignAndSubmit()
)
```

### Transaction Chaining

```typescript
// Get initial UTxOs from wallet
const initialUtxos = await client.getWalletUtxos()

// First transaction in chain
const firstChain = await client
  .newTx(initialUtxos)
  .payToAddress(aliceAddress, Value.lovelace(2000000n))
  .chain()

// Second transaction using outputs from first
const secondChain = await client
  .newTx(firstChain.updatedUtxos)
  .payToAddress(bobAddress, Value.lovelace(1500000n))
  .mintTokens(myPolicyId, new Map([
    [AssetName.fromString("ChainToken"), 100n]
  ]))
  .chain()

// Third transaction in the chain  
const thirdChain = await client
  .newTx(secondChain.updatedUtxos)
  .delegateStake(poolKeyHash)
  .chain()

// Submit all transactions in order
await client.submitTx(firstChain.transaction)
await client.submitTx(secondChain.transaction)  
await client.submitTx(thirdChain.transaction)

console.log(`Chain completed: ${firstChain.transaction.id} -> ${secondChain.transaction.id} -> ${thirdChain.transaction.id}`)
```

### Coin Selection and Fee Estimation

```typescript
// Fee estimation before building
const estimate = await client
  .newTx()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .estimateFee()

console.log(`Estimated fee: ${estimate.fee}`)

// Using different coin selection strategies during build
const txWithLargestFirst = await client
  .newTx()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .buildSignAndSubmit({
    coinSelection: "largest-first"
  })

// Custom coin selection logic
const customSelector: CustomCoinSelector = {
  selectCoins: (availableUtxos, targetValue, options) => {
    // Your custom UTxO selection algorithm here
    const selectedUtxos = availableUtxos
      .filter(utxo => /* your criteria */)
      .slice(0, 5) // Example: limit to 5 inputs
    
    return Effect.succeed({
      selectedUtxos,
      change: [], // Calculate change outputs
      fee: Coin.fromNumber(200000) // Calculate fee
    })
  }
}

// Use custom selector with additional options
const txWithCustomSelection = await client
  .newTx()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .build({
    coinSelection: customSelector,
    coinSelectionOptions: {
      maxInputs: 3,
      excludeUtxos: [specificUtxoToAvoid]
    }
  })

// Fee estimation with specific coin selection
const estimateWithCustomSelection = await client
  .newTx()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .estimateFee({
    coinSelection: "random-improve",
    feeMultiplier: 1.2 // 20% fee buffer
  })
```

### Progressive Builder Pattern

```typescript
// Step-by-step transaction building with proper type safety
const signBuilder = await client
  .newTx()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .build()

// Type safety ensures you can only sign after building
const submitBuilder = await signBuilder.sign()

// Additional witness can be added
const submitBuilderWithWitness = await signBuilder.signWithWitness(additionalWitness)

// For partial signing scenarios (e.g., multi-sig), get just the witness
const partialWitness = await signBuilder.partialSign()
console.log(`Partial signature created with ${partialWitness.vkeys?.length || 0} key witnesses`)

// For multi-signature scenarios, assemble multiple witnesses
const witness1 = await signBuilder.partialSign()
const witness2 = await otherSignBuilder.partialSign() // from another signer
const witness3 = await thirdSignBuilder.partialSign() // from third signer

const submitBuilder = await signBuilder.assemble([witness1, witness2, witness3])

// Type safety ensures you can only submit after signing
const txHash = await submitBuilder.submit()

// Or simulate before submitting
const simulation = await submitBuilder.simulate()
if (simulation.isValid) {
  const txHash = await submitBuilder.submit()
  console.log(`Transaction submitted: ${txHash}`)
} else {
  console.error(`Simulation failed: ${simulation.errors?.join(', ')}`)
}
```

### Effect-ts Integration

```typescript
import { Effect, pipe } from "effect"

// Functional transaction building with Effect-ts
const sendPaymentEffect = (recipient: Address.Address, amount: bigint) =>
  pipe(
    client.Effect.newTx(),
    tx => tx.payToAddress(recipient, Value.lovelace(amount)),
    tx => tx.build({ coinSelection: "largest-first" }),
    Effect.flatMap(signBuilder => signBuilder.sign()),
    Effect.flatMap(submitBuilder => submitBuilder.submit())
  )

// Error handling with Effect-ts
const sendWithRetry = pipe(
  sendPaymentEffect(recipientAddress, 1000000n),
  Effect.retry({
    times: 3,
    schedule: Schedule.exponential("1 second")
  }),
  Effect.catchAll(error => 
    Effect.logError(`Payment failed: ${error}`)
  )
)

// Execute the effect
const result = await Effect.runPromise(sendWithRetry)
```

### Multi-Signature Workflow

```typescript
// Multi-signature transaction requiring 3 signatures
const signBuilder = await client
  .newTx()
  .payToAddress(treasuryAddress, Value.lovelace(10000000n))
  .build()

// Each signer creates their partial signature
const witness1 = await client1.signBuilder.partialSign() // First signer
const witness2 = await client2.signBuilder.partialSign() // Second signer  
const witness3 = await client3.signBuilder.partialSign() // Third signer

// Coordinator assembles all witnesses into final transaction
const submitBuilder = await signBuilder.assemble([witness1, witness2, witness3])

// Verify the assembled transaction has required signatures
console.log(`Assembled ${submitBuilder.witnessSet.vkeys?.length || 0} key witnesses`)

// Submit the fully signed multi-sig transaction
const txHash = await submitBuilder.submit()
console.log(`Multi-sig transaction submitted: ${txHash}`)
```

### Manual Transaction Control

```typescript
console.log(`Transaction fee: ${signBuilder.cost.fee}`)
console.log(`Transaction size: ${signBuilder.transaction.body.inputs.length} inputs`)

// Sign the transaction
const submitBuilder = await signBuilder.sign()

// submitBuilder provides CBOR and witness set
console.log(`Transaction CBOR: ${submitBuilder.cbor}`)

// Submit to network
const txHash = await submitBuilder.submit()
console.log(`Transaction submitted: ${txHash}`)
```

### Advanced Signing Options

```typescript
// Get witness set without automatically signing
const builtTx = await client
  .newTx()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .build()

// Get witness set for multi-sig scenarios
const witnessSet = await builtTx.getWitnessSet()

// Or sign with external witness set
const externalWitness = getExternalWitnessSet()
const submitBuilder = await builtTx.signWithWitness(externalWitness)

// Simulate before submitting
const simulation = await submitBuilder.simulate()
if (simulation.isValid) {
  const txHash = await submitBuilder.submit()
} else {
  console.error('Transaction would fail:', simulation.errors)
}
```

### Transaction Templates

```typescript
// Simple payment template
const txHash = await client.templates.simplePayment(
  recipientAddress, 
  Value.lovelace(1000000n)
)

// Multi-payment template
const txHash = await client.templates.multiPayment([
  { address: aliceAddress, amount: Value.lovelace(1000000n) },
  { address: bobAddress, amount: Value.lovelace(2000000n) },
  { address: charlieAddress, amount: Value.lovelace(500000n) }
])

// NFT minting template
const nftTxHash = await client.templates.mintNFT(
  {
    name: "My Awesome NFT",
    description: "A unique digital collectible",
    image: "ipfs://QmXxXxXx...",
    attributes: [
      { trait_type: "Rarity", value: "Legendary" },
      { trait_type: "Color", value: "Gold" }
    ]
  },
  recipientAddress
)

// Token minting template
const tokenTxHash = await client.templates.mintTokens(
  myPolicyId,
  new Map([
    [AssetName.fromString("MyToken"), 1000000n],
    [AssetName.fromString("MyOtherToken"), 500000n]
  ]),
  recipientAddress // Optional, defaults to wallet address
)

// Staking template
const delegationTxHash = await client.templates.delegateToPool(poolKeyHash)

// Governance template
const voteTxHash = await client.templates.voteOnProposal(
  governanceActionId, 
  VotingChoice.Yes
)
```

### Advanced Coin Selection Examples

```typescript
// Build with specific coin selection options
const result = await client
  .newTx()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .build({
    coinSelection: "random-improve",
    coinSelectionOptions: {
      maxInputs: 5,
      includeUtxos: [requiredUtxo], // Must include this UTxO
      excludeUtxos: [lockedUtxo]     // Must exclude this UTxO
    }
  })

// Transaction chaining with custom coin selection
const firstResult = await client
  .newTx(walletUtxos)
  .payToAddress(aliceAddress, Value.lovelace(2000000n))
  .chain({
    coinSelection: "largest-first",
    feeMultiplier: 1.1 // 10% fee buffer
  })

// Use updated UTxOs from chain with different strategy
const secondResult = await client
  .newTx(firstResult.updatedUtxos)  // UTxOs passed to newTx(), not build options
  .mintTokens(policyId, tokenMap)
  .chain({
    coinSelection: customSelector
  })

// Custom coin selection with constraints
const constrainedSelector: CustomCoinSelector = {
  selectCoins: (availableUtxos, targetValue, options) => {
    // Only use UTxOs larger than 5 ADA
    const largeUtxos = availableUtxos.filter(utxo => 
      Value.lovelace(utxo.output.amount) >= 5000000n
    )
    
    // Prefer UTxOs without native tokens for simple payments
    const adaOnlyUtxos = largeUtxos.filter(utxo =>
      Value.isAdaOnly(utxo.output.amount)
    )
    
    const selectedUtxos = adaOnlyUtxos.slice(0, 3) // Max 3 inputs
    
    return Effect.succeed({
      selectedUtxos,
      change: calculateChange(selectedUtxos, targetValue),
      fee: estimateFee(selectedUtxos.length, 1) // 1 output
    })
  }
}

// Use with fee estimation
const estimate = await client
  .newTx()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .estimateFee({
    coinSelection: constrainedSelector,
    coinSelectionOptions: {
      maxInputs: 3
    }
  })
```
```

### Complex Transaction with Multiple Operations

```typescript
const txHash = await client
  .newTx()
  .payToAddress(aliceAddress, Value.lovelace(2000000n))
  .payToAddress(bobAddress, Value.lovelace(1500000n))
  .mintTokens(myPolicyId, new Map([
    [AssetName.fromString("MyToken"), 1000n]
  ]))
  .addMetadata(MetadataLabel.fromNumber(721), {
    name: "My NFT",
    description: "A sample NFT"
  })
  .setValidityInterval(undefined, currentSlot + 7200) // 2 hours validity
  .buildSignAndSubmit()
```

### Staking Operations

```typescript
// Delegate to a stake pool
const delegationTxHash = await client
  .newTx()
  .delegateStake(poolKeyHash)
  .buildSignAndSubmit()

// Withdraw rewards
const withdrawalTxHash = await client
  .newTx()
  .withdrawRewards() // Withdraws all available rewards
  .buildSignAndSubmit()
```

### Transaction Building with Manual Control

```typescript
// Build and inspect before signing
const builtTx = await client
  .newTx()
  .payToAddress(recipientAddress, Value.lovelace(1000000n))
  .build()

console.log(`Estimated fee: ${builtTx.cost.fee}`)

// Sign and submit separately
const signedTx = await client.signTx(builtTx.transaction)
const txHash = await client.submitTx(signedTx)
```

### Governance Operations

```typescript
// Vote on a governance action
const voteTxHash = await client
  .newTx()
  .vote(governanceActionId, VotingChoice.Yes)
  .buildSignAndSubmit()

// Propose a governance action
const proposalTxHash = await client
  .newTx()
  .proposeGovernanceAction(myProposal)
  .buildSignAndSubmit()
```

## Integration Patterns

### Error Handling

```typescript
import { Effect, pipe } from "effect"

const transferEffect = pipe(
  client.Effect.newTx()
    .payToAddress(address, value)
    .buildSignAndSubmit(),
  Effect.catchTag("ProviderError", error => {
    console.error("Provider error:", error.message)
    return Effect.fail(error)
  }),
  Effect.catchTag("WalletError", error => {
    console.error("Wallet error:", error.message)
    return Effect.fail(error)
  }),
  Effect.catchTag("TransactionBuilderError", error => {
    console.error("Transaction builder error:", error.message)
    return Effect.fail(error)
  })
)
```

### Concurrent Operations

```typescript
// Query multiple pieces of data concurrently
const [protocolParams, utxos, delegation] = await Promise.all([
  client.getProtocolParameters(),
  client.getUtxos(myAddress),
  client.getDelegation(myRewardAddress)
])

// Using Effect for concurrent operations
const dataEffect = Effect.all([
  client.Effect.getProtocolParameters(),
  client.Effect.getUtxos(myAddress),
  client.Effect.getDelegation(myRewardAddress)
], { concurrency: "unbounded" })
```

### Transaction Chaining

```typescript
// Chain transactions with proper dependency management
const firstTxHash = await client
  .newTx()
  .payToAddress(intermediateAddress, Value.lovelace(5000000n))
  .buildSignAndSubmit()

// Wait for first transaction to be confirmed
await client.awaitTx(firstTxHash)

// Build second transaction that depends on the first
const secondTxHash = await client
  .newTx()
  .addInput(outputFromFirstTx) // Reference output from first transaction
  .payToAddress(finalAddress, Value.lovelace(4000000n))
  .buildSignAndSubmit()
```

## Comparison to Viem

The Evolution SDK Client interface draws inspiration from Viem's design while adapting to Cardano's unique characteristics:

### Similarities
- **Unified Interface**: Single entry point combining transport, account, and chain operations
- **Fluent API**: Method chaining for transaction building
- **TypeScript-first**: Full type safety and inference
- **Extensible**: Easy to add new functionality

### Cardano-specific Adaptations
- **UTxO Model**: Built around Cardano's UTxO model rather than Ethereum's account model
- **Native Tokens**: First-class support for minting and burning native tokens
- **Staking**: Integrated staking and delegation operations
- **Governance**: Built-in support for Cardano governance actions
- **Effect-ts Integration**: Dual API supporting both Promise and Effect-based programming

## Best Practices

### 1. Choose the Right Provider for Your Needs
```typescript
// Example: built-in provider configuration for simplicity
const client = createKupmiosClient({
  apiKey: "your-api-key",
  network: "mainnet",
  wallet: myWallet
})

// Example: multi-provider setup for production resilience
const client = createClient({
  provider: {
    type: "multi",
    providers: [
      { type: "kupmios", apiKey: "primary-key", network: "mainnet", priority: 1 },
      { type: "blockfrost", apiKey: "backup-key", network: "mainnet", priority: 2 }
    ],
    failoverStrategy: "priority"
  },
  wallet: myWallet
})

// Manual provider instantiation when built-in support exists (generally unnecessary)
const provider = new KupmiosProvider(apiKey, network)
const client = createClient({ provider: { type: "custom", provider }, wallet })
```

### 2. Use the Client as the Primary Interface
```typescript
// Using client for consolidated operations
const result = await client.getUtxos(address)

// Direct provider/wallet usage when client is available is discouraged
const result = await client.provider.getUtxos(address)
```

### 2. Choose Appropriate UTxO Management Strategy
```typescript
// Automatic UTxO selection for simple, standalone transactions
const tx = await client
  .newTx()  // Automatically uses wallet.getUtxos()
  .payToAddress(addr1, value1)
  .buildSignAndSubmit()

// Explicit UTxO selection for chaining and complex scenarios
const walletUtxos = await client.getWalletUtxos()
const result = await client
  .newTx(walletUtxos)  // Explicit UTxO management
  .payToAddress(addr1, value1)
  .chain()

// Using chain result for subsequent transactions
const nextResult = await client
  .newTx(result.updatedUtxos)  // UTxOs from previous chain
  .payToAddress(addr2, value2)
  .chain()

// Manual UTxO fetching when automatic selection suffices
const utxos = await client.getWalletUtxos()
const tx = await client.newTx(utxos).payToAddress(addr, value).build() // Unnecessary complexity
```

### 3. Leverage Transaction Chaining for Complex Workflows
```typescript
// Chaining for multi-step operations
let currentUtxos = await client.getWalletUtxos()

const step1 = await client.newTx(currentUtxos).payToAddress(addr1, val1).chain()
const step2 = await client.newTx(step1.updatedUtxos).mintTokens(policy, assets).chain()
const step3 = await client.newTx(step2.updatedUtxos).delegateStake(poolId).chain()

// Submit all transactions
await Promise.all([
  client.submitTx(step1.transaction),
  client.submitTx(step2.transaction),
  client.submitTx(step3.transaction)
])

// Building dependent transactions without coordinated UTxO management
```

### 4. Handle Errors Appropriately
```typescript
// Specific error handling
try {
  const result = await client.newTx(myUtxos)
    .payToAddress(address, value)
    .chain()
} catch (error) {
  if (error._tag === "InsufficientFundsError") {
    // Handle insufficient funds
  } else if (error._tag === "NetworkError") {
    // Handle network issues
  }
}
```

### 5. Use Effect-ts for Complex Workflows
```typescript
// Effect usage for complex error handling and composition
const transferWorkflow = pipe(
  client.Effect.getUtxos(sourceAddress),
  Effect.flatMap(utxos => {
    if (utxos.length === 0) {
      return Effect.fail(new NoUtxosError())
    }
    return client.Effect.newTx(utxos)
      .payToAddress(targetAddress, amount)
      .buildSignAndSubmit()
  }),
  Effect.retry(Schedule.exponential("1 second", 2.0)),
  Effect.timeout("30 seconds")
)
```

## Comprehensive Usage Examples

### Basic Client Patterns

```typescript
// 1. Read-only client - No wallet needed
const readOnlyClient = createClient({
  network: "mainnet",
  provider: { type: "blockfrost", apiKey: "..." }
  // No wallet - read-only operations only
})

const utxos = await readOnlyClient.getUtxos(someAddress)
const protocolParams = await readOnlyClient.getProtocolParameters()
// readOnlyClient.newTx() // Not available: no wallet

// 2. Full signing client - Both provider and wallet
const signingClient = createClient({
  network: "mainnet",
  provider: { type: "blockfrost", apiKey: "..." },
  wallet: { type: "seed", mnemonic: "..." }
  // Has both provider and wallet
})

const txHash = await signingClient
  .newTx()
  .payToAddress(targetAddress, 1000000n)
  .buildSignAndSubmit()
```

### Multi-User Service Pattern

```typescript
// One provider, multiple wallets (service pattern)
const sharedProvider = createKupmiosProvider({
  apiKey: "your-kupmios-api-key"
})

// Create provider-only client
const providerClient = createClient({
  network: "mainnet",
  provider: { type: "custom", provider: sharedProvider }
  // No wallet - provider only
})

// Attach different wallets to same provider
const alice = providerClient.attachWallet(createSeedWallet({ mnemonic: aliceMnemonic }))
const bob = providerClient.attachWallet(createSeedWallet({ mnemonic: bobMnemonic }))
const monitor = providerClient.attachWallet(createReadOnlyWallet({ address: monitorAddress }))

// All clients share the same provider connection
await alice.newTx().payToAddress(bobAddress, 1000000n).buildSignAndSubmit()
await bob.newTx().payToAddress(aliceAddress, 500000n).buildSignAndSubmit()
const bobUtxos = await monitor.getUtxos(bobAddress) // Read-only monitoring

// Real-world multi-user service example
class PaymentService {
  private providerClient: ProviderOnlyClient
  private userClients: Map<string, SigningClient> = new Map()

  constructor(apiKey: string) {
    this.providerClient = createClient({
      network: "mainnet",
      provider: { type: "kupmios", apiKey }
      // No wallet - provider only
    })
  }

  addUser(userId: string, mnemonic: string) {
    const wallet = createSeedWallet({ mnemonic })
    const client = this.providerClient.attachWallet(wallet)
    this.userClients.set(userId, client)
    return client
  }

  async sendPayment(fromUserId: string, toAddress: string, amount: bigint) {
    const client = this.userClients.get(fromUserId)
    if (!client) throw new Error("User not found")
    
    return await client
      .newTx()
      .payToAddress(toAddress, amount)
      .buildSignAndSubmit()
  }

  async getUserBalance(userId: string): Promise<bigint> {
    const client = this.userClients.get(userId)
    if (!client) throw new Error("User not found")
    
    const utxos = await client.getWalletUtxos()
    return utxos.reduce((total, utxo) => total + utxo.output.amount.coin, 0n)
  }

  // All users share the same provider connection
}
```

### Progressive Enhancement Pattern

```typescript
// Start minimal, add capabilities as needed
let client = createMinimalClient({ network: "mainnet" })

// Add provider when needed
const provider = createBlockfrostProvider({ apiKey: "..." })
client = client.attachProvider(provider)
const utxos = await client.getUtxos(address) // Now has provider operations

// Add wallet when needed  
const wallet = createSeedWallet({ mnemonic: "..." })
client = client.attachWallet(wallet)
const txHash = await client.newTx().payToAddress(addr, value).buildSignAndSubmit() // Now has signing

// Or combine both in one step
const fullClient = createMinimalClient({ network: "mainnet" })
  .attach(provider, wallet) // Add both provider and wallet
```

### Effect-Based Advanced Example

```typescript
import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"

const effectClient = createEffectClient({
  network: "mainnet",
  provider: { type: "blockfrost", apiKey: "..." },
  wallet: { type: "seed", mnemonic: "..." }
})

// Complex workflow with error handling
const complexTransferWorkflow = pipe(
  // Get UTxOs and validate sufficient funds
  effectClient.getWalletUtxos(),
  Effect.flatMap(utxos => {
    const totalBalance = utxos.reduce((sum, utxo) => sum + utxo.output.amount.coin, 0n)
    if (totalBalance < 2000000n) {
      return Effect.fail(new InsufficientFundsError())
    }
    return Effect.succeed(utxos)
  }),
  
  // Build and submit transaction
  Effect.flatMap(utxos =>
    effectClient.newTx()
      .payToAddress("addr1...", 1000000n)
      .addMetadata(1, { message: "Payment from Effect workflow" })
      .buildSignAndSubmit()
  ),
  
  // Wait for confirmation
  Effect.flatMap(txHash =>
    effectClient.awaitTx(txHash, 5000) // Check every 5 seconds
  ),
  
  // Add retry logic and timeout
  Effect.retry(Schedule.exponential("2 seconds", 2.0)),
  Effect.timeout("60 seconds"),
  
  // Handle all possible errors
  Effect.catchAll(error => {
    console.error("Transaction workflow failed:", error)
    return Effect.succeed(null) // Graceful fallback
  })
)

// Run the workflow
const result = await Effect.runPromise(complexTransferWorkflow)
```

### Real-World DApp Integration

```typescript
// DeFi trading bot example
class DeFiTradingBot {
  private client: SigningClient
  private monitorClient: ReadOnlyClient

  constructor(config: {
    apiKey: string,
    tradingWallet: string,
    monitorAddresses: string[]
  }) {
    // Trading client with signing capabilities
    this.client = createClient({
      network: "mainnet",
      provider: { type: "kupmios", apiKey: config.apiKey },
      wallet: { type: "seed", mnemonic: config.tradingWallet }
    })

    // Monitoring client for read-only operations
    this.monitorClient = createClient({
      network: "mainnet", 
      provider: { type: "kupmios", apiKey: config.apiKey }
      // No wallet - read-only
    })
  }

  async executeArbitrageOpportunity(
    dexAddress: string,
    tokenA: string,
    tokenB: string,
    amount: bigint
  ) {
    try {
      // 1. Check current prices from DEX
      const dexUtxos = await this.monitorClient.getUtxos(dexAddress)
      const currentPrice = this.calculatePrice(dexUtxos, tokenA, tokenB)
      
      // 2. Check if arbitrage is profitable
      const expectedProfit = this.calculateExpectedProfit(currentPrice, amount)
      if (expectedProfit < 100000n) return // Not profitable
      
      // 3. Execute swap transaction
      const txHash = await this.client
        .newTx()
        .payToContract(dexAddress, {
          inline: this.buildSwapDatum(tokenA, tokenB, amount)
        })
        .addRedeemer(dexAddress, this.buildSwapRedeemer())
        .buildSignAndSubmit()
      
      // 4. Wait for confirmation
      await this.client.awaitTx(txHash)
      
      console.log(`Arbitrage executed: ${txHash}`)
      return txHash
      
    } catch (error) {
      console.error("Arbitrage failed:", error)
      return null
    }
  }

  private calculatePrice(utxos: UTxO[], tokenA: string, tokenB: string): bigint {
    // Price calculation logic
    return 0n
  }

  private calculateExpectedProfit(price: bigint, amount: bigint): bigint {
    // Profit calculation logic  
    return 0n
  }

  private buildSwapDatum(tokenA: string, tokenB: string, amount: bigint) {
    // Build Plutus datum for swap
    return {}
  }

  private buildSwapRedeemer() {
    // Build Plutus redeemer for swap
    return {}
  }
}
```

## Future Enhancements

- **Smart Contract Integration**: Direct support for Plutus script interaction
- **Batch Operations**: Efficient handling of multiple transactions
- **Advanced Governance**: Support for complex governance workflows
- **Cross-chain Operations**: Integration with bridges and side chains
- **Performance Optimization**: Caching and optimization strategies

## Conclusion

The Evolution SDK Client interface provides a comprehensive, type-safe, and developer-friendly API for interacting with the Cardano blockchain. By combining Provider, Wallet, and TransactionBuilder capabilities into a single interface, it simplifies development while maintaining the power and flexibility needed for complex applications.

The dual Effect/Promise API ensures compatibility with different programming paradigms, while the fluent transaction building API makes common operations intuitive and error-resistant.
