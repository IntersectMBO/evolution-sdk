# Phase 9: Known Limitations

## Patterns That Work

All 33 patterns from the Phase 2 catalog are supported through one of:
- `Plutus.data()` — annotation-driven auto-derivation
- `Plutus.makeIsData()` / `Plutus.makeIsDataIndexed()` — Haskell-equivalent shorthands
- TSchema combinators — direct use for power users / edge cases

## Patterns Not Supported by Plutus.data() (Use TSchema Directly)

### ~~1. Plutus Map~~ — RESOLVED in Phase 12+ Iteration 4
Map now auto-derived from `Schema.MapFromSelf` and `Schema.Map` via Declaration handler detection.

### ~~2. FlatFields~~ — RESOLVED in Phase 12+ Iteration 2
FlatFields now supported via `FlatFieldsId` annotation and TSchema backward compat.

### ~~3. Mutual Recursion~~ — RESOLVED in Phase 12+ Iteration 6
Mutual recursion works via `memoizeThunk` + `Schema.suspend`. Tested with Expr/BinOp and A→B→A patterns.

### 4. TypeScript Enums
TS `enum` types (`Schema.Enums`) throw an error. Use `Schema.Literal` instead:
```typescript
// Won't work: enum Color { Red, Green, Blue }
// Use instead: Schema.Literal("Red", "Green", "Blue")
```

### 5. String / Number Types
These have no Plutus Data representation and throw descriptive errors. Use `Schema.BigIntFromSelf` for numbers and `Schema.Uint8ArrayFromSelf` for byte data.

### 6. Schema.Record / Index Signatures
`Schema.Record({ key: Schema.String, value: ... })` now throws instead of silently producing an empty Constr. Use `Plutus.Map()` for key-value data.
**Fixed in Phase 11**: Previously silently ignored index signatures, losing all data.

### ~~7. Schema.Class / Schema.TaggedClass~~ — RESOLVED in Phase 12+ Iteration 3
Schema.Class now compiles via from-side TypeLiteral. TaggedClass `_tag` auto-stripped.

### 8. Optional Properties (Schema.optional)
`Schema.optional(T)` creates a field that may be absent. The compiler encodes whatever value is present (including `undefined`). For Plutus optional semantics, use `Schema.NullOr()` or `Schema.UndefinedOr()` explicitly.

## Phase 11 Findings

### Design Validations (Sound)
- **Compiler pattern**: `Match<PlutusCodec>` + `getCompiler` is correct. Exhaustive, type-safe, idiomatic.
- **Error channel**: Raw throws in codec, but `Data.withSchema` wraps via `Schema.encodeSync/decodeSync` → users get `ParseError`. Acceptable tradeoff.
- **Type safety**: `Plutus.data()` returns properly typed `Schema<A, Data.Data>`. Composes with `Schema.encodeSync/decodeSync`.
- **Branded types**: Work transparently via Refinement look-through.
- **Complex Haskell types**: TxInfo, ScriptContext, NativeScript (recursive 6-variant sum) all work correctly with CBOR roundtrip.
- **Determinism**: Same AST → same codec behavior.

### Bug Fixed
- **Schema.Record**: Now throws descriptive error instead of silently producing empty Constr.

## Performance Notes

- Schema compilation (AST walk) takes < 0.1ms for typical schemas
- 100 compilations of a simple struct: < 100ms total
- 1000 encode/decode roundtrips: < 100ms total
- No measurable overhead vs direct TSchema construction
