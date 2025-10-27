---
title: sdk/builders/TransactionResult.ts
nav_order: 134
parent: Modules
---

## TransactionResult overview

TransactionResult - Base interface for transaction building results

Provides core functionality available to all transaction builders regardless
of signing capability. This enables type-safe differentiation between
read-only clients (can build but not sign) and signing clients (can build and sign).

Added in v2.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [constructors](#constructors)
  - [makeTransactionResult](#maketransactionresult)
- [interfaces](#interfaces)
  - [TransactionResultBase (interface)](#transactionresultbase-interface)

---

# constructors

## makeTransactionResult

Create a TransactionResultBase instance for a built transaction without signing capability.

Used by ReadOnlyClient which can build transactions but cannot sign them.
Provides access to the unsigned transaction, fake-witness transaction for fee validation,
and fee estimation.

**Signature**

```ts
export declare const makeTransactionResult: (params: {
  transaction: Transaction.Transaction
  transactionWithFakeWitnesses: Transaction.Transaction
  fee: bigint
}) => TransactionResultBase
```

Added in v2.0.0

# interfaces

## TransactionResultBase (interface)

Base result interface for built transactions.

Available on all transaction builders regardless of signing capability.
Provides access to the unsigned transaction, fee estimates, and transaction
with fake witnesses for size validation.

**Signature**

````ts
export interface TransactionResultBase {
  /**
   * Get the unsigned transaction.
   *
   * This transaction has a complete body but no witness set (signatures).
   * Can be serialized to CBOR for external signing (hardware wallets, browser extensions, etc.)
   *
   * @returns Promise resolving to the unsigned transaction
   *
   * @example
   * ```typescript
   * const result = await readOnlyClient.newTx()
   *   .payToAddress({ address: "addr...", lovelace: 5_000_000n })
   *   .build()
   *
   * const unsignedTx = await result.toTransaction()
   * const txCbor = Transaction.toCBORHex(unsignedTx)
   * // Export for external signing
   * ```
   *
   * @since 2.0.0
   * @category accessors
   */
  readonly toTransaction: () => Promise<Transaction.Transaction>

  /**
   * Get the transaction with fake witnesses for fee validation.
   *
   * This transaction includes fake witness sets (294 bytes each) to accurately
   * calculate the final transaction size and fees. Useful for validating that
   * the calculated fee is sufficient for the final signed transaction.
   *
   * @returns Promise resolving to the transaction with fake witnesses
   *
   * @since 2.0.0
   * @category accessors
   */
  readonly toTransactionWithFakeWitnesses: () => Promise<Transaction.Transaction>

  /**
   * Get the calculated transaction fee in lovelace.
   *
   * This is the fee that was calculated during the build process based on
   * the transaction size (including fake witnesses) and protocol parameters.
   *
   * @returns Promise resolving to the transaction fee in lovelace
   *
   * @example
   * ```typescript
   * const result = await client.newTx()
   *   .payToAddress({ address: "addr...", lovelace: 5_000_000n })
   *   .build()
   *
   * const fee = await result.estimateFee()
   * console.log(`Transaction fee: ${fee} lovelace`)
   * ```
   *
   * @since 2.0.0
   * @category accessors
   */
  readonly estimateFee: () => Promise<bigint>

  /**
   * Effect-based API for compositional workflows.
   *
   * Provides the same functionality as the Promise-based methods but returns
   * Effect values for use in Effect-TS workflows with proper error handling
   * and composition.
   *
   * @since 2.0.0
   * @category effects
   */
  readonly Effect: {
    /**
     * Get the unsigned transaction as an Effect.
     *
     * @since 2.0.0
     */
    readonly toTransaction: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>

    /**
     * Get the transaction with fake witnesses as an Effect.
     *
     * @since 2.0.0
     */
    readonly toTransactionWithFakeWitnesses: () => Effect.Effect<Transaction.Transaction, TransactionBuilderError>

    /**
     * Get the calculated fee as an Effect.
     *
     * @since 2.0.0
     */
    readonly estimateFee: () => Effect.Effect<bigint, TransactionBuilderError>
  }
}
````

Added in v2.0.0
