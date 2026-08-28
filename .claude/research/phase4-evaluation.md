# Phase 4: Candidate Evaluation & Selection

## Scoring (1-5, higher is better)

### Criterion 1: Type Safety — Does TS catch errors at compile time?

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| A: Annotation | 4 | Standard Schema types = full inference. But annotations are untyped `unknown` values — wrong annotation type not caught at compile time. |
| B: Builder | 4 | Builder functions are typed, but the thin wrapper means some type relationships are implicit. `P.constr()` returns correct types. |
| C: Class | 5 | Class hierarchy gives strongest compile-time guarantees. `extends Plutus.Constr(...)` enforces fields AND encoding. Sum type membership is explicit. |
| D: Hybrid | 4 | Same as A for annotated path. TSchema path retains existing type safety. `Plutus.data()` inference can produce surprising results if input schema is ambiguous. |

### Criterion 2: Ergonomics — How much boilerplate vs Haskell?

**Haskell reference**: `data MyDatum = MyDatum { owner :: ByteString, amount :: Integer }` + `makeIsData ''MyDatum` = 2 lines

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| A: Annotation | 3 | `.annotations({ [ConstrIndexId]: 0, [FlatInUnionId]: true })` is verbose. Symbol imports clutter files. Simple cases need explicit annotation. |
| B: Builder | 4 | `P.constr({ owner: P.bytes(), amount: P.integer() })` — clean, but every field needs `P.*` wrapper. |
| C: Class | 4 | `class MyDatum extends Plutus.Constr("MyDatum")({...}) {}` is 1 line. But sum types need N classes + a `Sum()` call — verbose for enums. |
| D: Hybrid | 5 | `Plutus.data(Schema.Struct({...}))` — one wrapper call, inference handles the rest. Existing TSchema users change nothing. `Plutus.variant({...})` for Aiken-style. |

### Criterion 3: Completeness — Handles ALL 33 patterns from Phase 2?

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| A: Annotation | 5 | AST compiler covers every node type. Custom annotations can express any pattern. |
| B: Builder | 4 | Covers common patterns well. flatFields/tagField require extra options. Some edge cases (mixed flat+nested unions) need manual TSchema fallback. |
| C: Class | 3 | Weak on: Variant (needs class per constructor), Literal unions (overkill), PlutusData passthrough (doesn't fit class model), flatFields (class can't flatten). |
| D: Hybrid | 5 | Both paths available — TSchema for edge cases, Plutus.data for common cases. Inference handles 80%, explicit annotations for the rest 20%. |

### Criterion 4: Recursion Support — Clean recursive type definitions?

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| A: Annotation | 5 | `Schema.suspend(() => MySchema)` — standard Effect pattern, compiler memoizes via Suspend handler. |
| B: Builder | 4 | `P.lazy(() => LinkedList)` — works but is a thin rename of `Schema.suspend`. No special handling. |
| C: Class | 4 | `Schema.suspend(() => LinkedList)` works in fields. But class-based types can't self-reference as easily as schemas (class must be declared before use). |
| D: Hybrid | 5 | Same as A for annotated schemas. TSchema path already handles recursion via `Schema.suspend`. Both paths tested. |

### Criterion 5: Compatibility — Works with existing Data.withSchema pipeline?

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| A: Annotation | 4 | Compiler output is a TSchema-compatible Schema. But it's a NEW derivation — existing TSchema pipelines need to be replaced, not augmented. |
| B: Builder | 5 | Functions return TSchema values directly. `P.codec(x)` = `Data.withSchema(x)`. Zero friction. |
| C: Class | 3 | Classes have their own codec methods (`.toData()`). Doesn't easily compose with `Data.withSchema()`. Need adapter layer for existing code that expects schemas. |
| D: Hybrid | 5 | `Plutus.codec()` wraps `Data.withSchema()`. TSchema values work directly. Both paths produce compatible output. |

### Criterion 6: Extensibility — Easy to add new patterns later?

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| A: Annotation | 5 | Add new annotation symbol + handler in Match — open/closed principle. Third-party annotations possible. |
| B: Builder | 3 | Adding patterns means adding functions. Each new pattern = new export. Can't be extended by users without modifying the module. |
| C: Class | 4 | New encoding patterns = new base class. Extensible but heavy — every extension needs a class hierarchy. |
| D: Hybrid | 5 | Annotation path extensible like A. Builder path (variant, option) extensible like B. Users can add custom annotations for new patterns. |

### Criterion 7: Effect Idiom Alignment — Feels natural in Effect ecosystem?

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| A: Annotation | 5 | Annotations + AST compiler = exactly how Pretty/Arbitrary/Equivalence work. Core Effect pattern. |
| B: Builder | 2 | Custom DSL that doesn't use Effect's Schema infrastructure. Feels like a separate library that happens to produce schemas. |
| C: Class | 4 | `Schema.Class` is Effect-native. But the Plutus protocol layer is custom. `datum.toData()` is imperative, not Effect-idiomatic (would be Effect pipe). |
| D: Hybrid | 5 | Uses Effect annotations, Schema composition, and derives like other Effect modules. `Plutus.data()` is just a Schema transformation — fully composable. |

### Criterion 8: Migration from Current TSchema — How easy to adopt?

| Candidate | Score | Rationale |
|-----------|-------|-----------|
| A: Annotation | 3 | Requires rewriting all TSchema usage to annotated Schema types. Conceptual shift from "combinators" to "annotate + derive". |
| B: Builder | 4 | Similar vocabulary to TSchema — rename `TSchema.Struct` → `P.constr`, etc. Mostly mechanical. |
| C: Class | 2 | Complete rewrite — every type becomes a class. Variant/union types change fundamentally. |
| D: Hybrid | 5 | **Zero migration required.** Existing TSchema code works unchanged. New code can use either path. Gradual adoption. |

## Score Summary

| Criterion | Weight | A | B | C | D |
|-----------|--------|---|---|---|---|
| Type safety | 1.0 | 4 | 4 | 5 | 4 |
| Ergonomics | 1.5 | 3 | 4 | 4 | 5 |
| Completeness | 1.5 | 5 | 4 | 3 | 5 |
| Recursion | 1.0 | 5 | 4 | 4 | 5 |
| Compatibility | 1.5 | 4 | 5 | 3 | 5 |
| Extensibility | 1.0 | 5 | 3 | 4 | 5 |
| Effect alignment | 1.0 | 5 | 2 | 4 | 5 |
| Migration | 1.5 | 3 | 4 | 2 | 5 |
| **Weighted Total** | | **39.5** | **37.5** | **33.5** | **48.5** |

## Decision

### Winner: Candidate D (Hybrid)

**Score: 48.5** — highest on every dimension except type safety (where C wins by 1 point on a low-weight criterion).

**Key reasons**:
1. **Non-breaking migration** — existing codebase untouched, adopt incrementally
2. **Dual-path** — TSchema for power users, `Plutus.data()` for convenience
3. **Type inference** — `Plutus.data(Schema.Struct({...}))` infers encoding automatically
4. **Effect-native** — uses annotations, AST compiler, Schema composition
5. **Complete** — all 33 patterns covered between TSchema and Plutus.data paths

### Runner-up: Candidate A (Annotation-Driven)

**Score: 39.5** — strong on extensibility and Effect alignment, but verbose annotations and harder migration hurt it.

**Incorporate from A into D**: The AST compiler (`Match<A>` + `getCompiler`) is the implementation strategy for D's `Plutus.data()` inference engine. A's annotation symbols become D's internal implementation detail.

### Rejected

- **B (Builder)**: Score 37.5. Essentially a renamed TSchema with no new capability. Low Effect alignment.
- **C (Class Protocol)**: Score 33.5. Weak on completeness, compatibility, and migration. Too heavyweight for simple types.

## Implementation Plan for Winner (D)

### Core API to Implement

```typescript
// Main entry points
Plutus.data(schema, options?)     // Annotate + transform any Effect Schema → Plutus-encoded Schema
Plutus.variant(variants)          // Aiken-style shorthand (delegates to TSchema.Variant)
Plutus.option(schema)             // NullOr shorthand
Plutus.codec(schema)              // Derive full codec (delegates to Data.withSchema)

// Re-exported primitives (convenience)
Plutus.ByteArray                  // = TSchema.ByteArray
Plutus.Integer                    // = TSchema.Integer
Plutus.Boolean                    // = TSchema.Boolean
```

### Internal Implementation

1. **AST compiler** using `Match<PlutusTransform>` that walks Effect Schema AST
2. **Inference rules** map TS types → Plutus encoding (table from Candidate D design)
3. **Annotation override** — explicit `{ index, flatInUnion, flatFields, tagField }` takes precedence over inference
4. **Output**: A `Schema.transform` from TS type to `Data.Data` — compatible with `Data.withSchema`
5. **Recursion**: Suspend handler with memoization (same as Pretty/Arbitrary)
