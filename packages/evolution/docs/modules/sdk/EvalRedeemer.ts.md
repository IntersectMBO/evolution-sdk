---
title: sdk/EvalRedeemer.ts
nav_order: 140
parent: Modules
---

## EvalRedeemer overview

// EvalRedeemer types and utilities for transaction evaluation

---

<h2 class="text-delta">Table of contents</h2>

- [utils](#utils)
  - [EvalRedeemer (type alias)](#evalredeemer-type-alias)

---

# utils

## EvalRedeemer (type alias)

**Signature**

```ts
export type EvalRedeemer = {
  readonly ex_units: { readonly mem: number; readonly steps: number }
  readonly redeemer_index: number
  readonly redeemer_tag: "spend" | "mint" | "publish" | "withdraw" | "vote" | "propose"
}
```
