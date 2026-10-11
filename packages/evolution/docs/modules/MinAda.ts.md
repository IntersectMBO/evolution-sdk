---

title: MinAda.ts
nav_order: 77
parent: Modules
---

## MinAda overview

Minimum lovelace for a transaction output.

A UTxO must hold at least `(160 + its serialized size) * coinsPerUtxoByte`, and the value is a
fixed point: raising the coin can widen its own CBOR encoding, which raises the size, which
raises the coin. The loop below solves it the way the ledger's own sizing does.

This lived inside `sdk/builders/internal/txBuilder` where a wallet could not reach it, so
anyone balancing a transaction outside the builder had to reimplement it — and an
under-estimate produces outputs a node rejects. `calculateMinimumUtxoLovelace` in the builder
now delegates here, so there is one implementation.

Added in v2.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [constants](#constants)
  - [MAX_ITERATIONS](#max_iterations)
  - [UTXO_ENTRY_OVERHEAD_BYTES](#utxo_entry_overhead_bytes)
- [transformation](#transformation)
  - [forOutput](#foroutput)

---

# constants

## MAX_ITERATIONS

Iteration cap for the fixed point. It converges in two or three passes in practice; the cap
only exists so a pathological input fails instead of spinning.

**Signature**

```ts
export declare const MAX_ITERATIONS: 8
```

Added in v2.0.0

## UTXO_ENTRY_OVERHEAD_BYTES

Per-UTxO overhead in bytes, from the Babbage spec (figure 5, UTxO entry size).

**Signature**

```ts
export declare const UTXO_ENTRY_OVERHEAD_BYTES: 160n
```

Added in v2.0.0

# transformation

## forOutput

The minimum lovelace `output` must hold at `coinsPerUtxoByte`.

The output's own coin is ignored — it is what we are solving for — but its address, assets,
datum, script reference and encoding format all affect the size and so the answer.

**Signature**

```ts
export declare const forOutput: (output: TxOut.TransactionOutput, coinsPerUtxoByte: bigint) => bigint
```

Added in v2.0.0
