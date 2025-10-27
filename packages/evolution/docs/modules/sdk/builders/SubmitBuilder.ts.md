---
title: sdk/builders/SubmitBuilder.ts
nav_order: 131
parent: Modules
---

## SubmitBuilder overview

SubmitBuilder - Final stage of transaction lifecycle

Represents a signed transaction ready for submission to the blockchain.
Provides the submit() method to broadcast the transaction and retrieve the transaction hash.

Added in v2.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [interfaces](#interfaces)
  - [SubmitBuilder (interface)](#submitbuilder-interface)
  - [SubmitBuilderEffect (interface)](#submitbuildereffect-interface)

---

# interfaces

## SubmitBuilder (interface)

SubmitBuilder - represents a signed transaction ready for submission.

The final stage in the transaction lifecycle after building and signing.
Provides the submit() method to broadcast the transaction to the blockchain
and retrieve the transaction hash.

**Signature**

```ts
export interface SubmitBuilder extends EffectToPromiseAPI<SubmitBuilderEffect> {
  /**
   * Effect-based API for compositional workflows.
   *
   * @since 2.0.0
   */
  readonly Effect: SubmitBuilderEffect

  /**
   * The witness set containing all signatures for this transaction.
   *
   * Can be used to inspect the signatures or combine with other witness sets
   * for multi-party signing scenarios.
   *
   * @since 2.0.0
   */
  readonly witnessSet: TransactionWitnessSet.TransactionWitnessSet
}
```

Added in v2.0.0

## SubmitBuilderEffect (interface)

Effect-based API for SubmitBuilder operations.

**Signature**

```ts
export interface SubmitBuilderEffect {
  /**
   * Submit the signed transaction to the blockchain via the provider.
   *
   * @returns Effect resolving to the transaction hash
   * @since 2.0.0
   */
  readonly submit: () => Effect.Effect<string, TransactionBuilderError>
}
```

Added in v2.0.0
