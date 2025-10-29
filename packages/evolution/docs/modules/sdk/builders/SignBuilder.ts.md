---
title: sdk/builders/SignBuilder.ts
nav_order: 135
parent: Modules
---

## SignBuilder overview

---

<h2 class="text-delta">Table of contents</h2>

- [interfaces](#interfaces)
  - [SignBuilder (interface)](#signbuilder-interface)
  - [SignBuilderEffect (interface)](#signbuildereffect-interface)

---

# interfaces

## SignBuilder (interface)

SignBuilder extends TransactionResultBase with signing capabilities.

Only available when the client has a signing wallet (seed, private key, or API wallet).
Provides access to unsigned transaction (via base interface) and signing operations.

**Signature**

```ts
export interface SignBuilder extends TransactionResultBase, EffectToPromiseAPI<SignBuilderEffect> {
  readonly Effect: SignBuilderEffect
}
```

Added in v2.0.0

## SignBuilderEffect (interface)

Effect-based API for SignBuilder operations.

Includes all TransactionResultBase.Effect methods plus signing-specific operations.

**Signature**

```ts
export interface SignBuilderEffect {
  // Base transaction methods (from TransactionResultBase)
  readonly toTransaction: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>
  readonly toTransactionWithFakeWitnesses: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>
  readonly estimateFee: () => Effect.Effect<bigint, TransactionBuilderError>

  // Signing methods
  readonly sign: () => Effect.Effect<SubmitBuilder, TransactionBuilderError>
  readonly signWithWitness: (
    witnessSet: TransactionWitnessSet.TransactionWitnessSet
  ) => Effect.Effect<SubmitBuilder, TransactionBuilderError>
  readonly assemble: (
    witnesses: ReadonlyArray<TransactionWitnessSet.TransactionWitnessSet>
  ) => Effect.Effect<SubmitBuilder, TransactionBuilderError>
  readonly partialSign: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
  readonly getWitnessSet: () => Effect.Effect<TransactionWitnessSet.TransactionWitnessSet, TransactionBuilderError>
}
```

Added in v2.0.0
