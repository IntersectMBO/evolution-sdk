# Phase 9: Known Limitations

## Patterns That Work

All 33 patterns from the Phase 2 catalog are supported through one of:
- `Plutus.data()` — annotation-driven auto-derivation
- `Plutus.makeIsData()` / `Plutus.makeIsDataIndexed()` — Haskell-equivalent shorthands
- TSchema combinators — direct use for power users / edge cases

## Patterns Not Supported by Plutus.data() (Use TSchema Directly)

### 1. Plutus Map
`Plutus.data()` does not auto-derive Map encoding from `Schema.Map`. Maps require TSchema.Map:
```typescript
// Won't work: Plutus.data(Schema.Map({ key: ..., value: ... }))
// Use instead:
const MyMap = Plutus.Map(Plutus.ByteArray, Plutus.Integer)
```
**Why**: Schema.Map uses a Declaration AST node, and the compiler treats unknown Declarations as passthrough. Map encoding requires a specific CBOR map representation that differs from the standard Schema.Map behavior.

### 2. FlatFields (Nested Struct Inlining)
The `flatFields` annotation is defined but not yet implemented in the compiler. Structs are always encoded as nested Constrs:
```typescript
// Currently: inner struct is always a nested Constr
// flatFields would inline inner fields into parent
```
**Why**: This is a complex encoding that requires coordinating field counts between parent and child structs during both encoding and decoding. TSchema implements this via string annotations, but the compiler doesn't yet handle it. Use TSchema.Struct with `flatFields: true` for now.

### 3. Mutual Recursion
Only self-recursion via `Schema.suspend` is supported. Mutual recursion (type A references type B which references type A) is not tested and may not work:
```typescript
// Not supported:
// type Expr = Literal | BinOp
// type BinOp = { left: Expr, right: Expr }
```
**Why**: The memoizeThunk approach handles single-schema cycles but may not handle cross-schema cycles. This would require a shared memo map across compilations.

### 4. TypeScript Enums
TS `enum` types (`Schema.Enums`) throw an error. Use `Schema.Literal` instead:
```typescript
// Won't work: enum Color { Red, Green, Blue }
// Use instead: Schema.Literal("Red", "Green", "Blue")
```

### 5. String / Number Types
These have no Plutus Data representation and throw descriptive errors. Use `Schema.BigIntFromSelf` for numbers and `Schema.Uint8ArrayFromSelf` for byte data.

## Performance Notes

- Schema compilation (AST walk) takes < 0.1ms for typical schemas
- 100 compilations of a simple struct: < 100ms total
- 1000 encode/decode roundtrips: < 100ms total
- No measurable overhead vs direct TSchema construction
