# Capability-Aware Client Design

Experimental redesign of the SDK client using accumulating generics with fine-grained capability tracking. The goal: every method that exists on the client is guaranteed to work at runtime — if a capability is missing, the method doesn't exist at compile time.

## How It Works

`Client<S>` where S is an intersection of capability interfaces accumulated via `.with*()` methods. Modules (`query`, `wallet`, `tx`) appear conditionally based on what capabilities S includes. Flat v1-compatible aliases (`getUtxos`, `signTx`, `newTx`) coexist alongside the module API.

## Key Type Patterns

**Conditional intersection** — modules/methods appear or disappear via `& (S extends X ? { method } : {})`. No `never` in autocomplete.

**Structural capabilities** — `UtxoProvider`, `ProtocolProvider`, `Signable`, etc. are Effect-returning interfaces. They serve as both the type tag AND the implementation contract.

**PromiseSurface\<T\>** — auto-derives Promise methods from Effect methods. Each capability is defined once (as Effect), the Promise surface is generated. Cuts module type definitions by ~87%.

**TxBuilder\<S, R\>** — two type params. S = client capabilities, R = accumulated requirements from builder methods (union of `NeedsProtocolProvider | NeedsUtxoProvider | NeedsEvalProvider`). `build()` uses `SmartBuildOptions` to compute which fields are required vs optional based on what S doesn't cover from R.

**Dynamic requirements** — `collectFrom({redeemer})`, `mintAssets({redeemer})`, `delegateTo({redeemer})`, etc. add `NeedsEvalProvider` to R. Operations without a redeemer leave R unchanged.

**Covariance** — `Client<FullProvider & Signable>` is assignable to `Client<UtxoProvider>`. S only appears in output positions.

**Plugin factories** — protocols create `PluginFactory<MinCaps, Plugin>` that type-checks the client has minimum capabilities: `createDex(fullClient)` compiles, `createDex(readOnlyClient)` fails.

## Reading the Examples

`usage-examples.ts` has 26 scenarios covering:
- Every wallet × provider combination (bare, provider-only, watch-only, seed, private key, CIP-30)
- Builder edge cases (redeemer, offline, standalone, partial options)
- Pipeline flows (build → sign → submit with capability gating)
- Protocol plugins (DEX, Oracle)
- Multi-party external signing
- Single-call constructor
- Covariance proofs
- `@ts-expect-error` for every invalid operation

Each scenario is self-contained. The `@ts-expect-error` lines prove that invalid operations fail at compile time.
