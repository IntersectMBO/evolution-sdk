# Phase 2: Complete Plutus Data Pattern Catalog

## Encoding Matrix

Every pattern the annotation system must support, organized by category.

### Primitives

| # | Pattern | TS Type | Plutus Data | Options |
|---|---------|---------|-------------|---------|
| P1 | ByteArray | `Uint8Array` | Raw CBOR bytes | — |
| P2 | Integer | `bigint` | CBOR integer | — |
| P3 | Boolean | `boolean` | `Constr(0,[])` / `Constr(1,[])` | — |
| P4 | PlutusData (opaque) | `Data.Data` | Passthrough unchanged | — |

### Collections

| # | Pattern | TS Type | Plutus Data | Options |
|---|---------|---------|-------------|---------|
| C1 | Array | `T[]` | CBOR array | — |
| C2 | Map | `Map<K,V>` | CBOR map | canonical mode |
| C3 | Tuple | `[T1, T2]` | CBOR array (fixed length) | — |

### Struct Patterns

| # | Pattern | TS Type | Plutus Data | Options |
|---|---------|---------|-------------|---------|
| S1 | Basic Struct | `{ a: T1, b: T2 }` | `Constr(0, [a, b])` | index (default 0) |
| S2 | Custom Index | `{ a: T1 }` | `Constr(N, [a])` | `{ index: N }` |
| S3 | Nested Struct | `{ inner: { x: T } }` | `Constr(0, [Constr(0, [x])])` | — |
| S4 | Flat Fields | `{ inner: { x, y }, z }` | `Constr(0, [x, y, z])` | `{ flatFields: true }` on inner |
| S5 | Tag Field (auto) | `{ _tag: "Mint", amount }` | `Constr(0, [amount])` | auto-detects `_tag`/`type`/`kind`/`variant` |
| S6 | Tag Field (explicit) | `{ op: "Read", key }` | `Constr(0, [key])` | `{ tagField: "op" }` |
| S7 | Tag Field (disabled) | `{ _tag: "X", val }` | `Constr(0, [tag_constr, val])` | `{ tagField: false }` |
| S8 | TaggedStruct helper | `{ _tag: "Deposit", amount }` | `Constr(0, [amount])` | shortcut for S5 |

### Union Patterns

| # | Pattern | TS Type | Plutus Data | Options |
|---|---------|---------|-------------|---------|
| U1 | Nested Union | `A \| B` | `Constr(pos, [Constr(idx, [fields])])` | — |
| U2 | Flat Union | `A \| B` | `Constr(idx, [fields])` | `{ flatInUnion: true }` |
| U3 | Mixed (nested+flat) | `A \| B \| C` | Mix of nested/flat | Per-member options |
| U4 | Tagged Union | `{ _tag: "A" } \| { _tag: "B" }` | Auto tag strip/inject | auto-detected |
| U5 | Variant (Aiken sugar) | `{ Tag1: {fields} } \| { Tag2: {fields} }` | `Constr(pos, [fields])` | — |
| U6 | Literal in Union | `"mint" \| "burn"` | `Constr(0,[]) \| Constr(1,[])` | flatInUnion auto |

### Nullable/Optional Patterns

| # | Pattern | TS Type | Plutus Data | Options |
|---|---------|---------|-------------|---------|
| N1 | NullOr | `T \| null` | Just: `Constr(0,[v])`, Nothing: `Constr(1,[])` | — |
| N2 | UndefinedOr | `T \| undefined` | Same as NullOr | — |

### Literal Patterns

| # | Pattern | TS Type | Plutus Data | Options |
|---|---------|---------|-------------|---------|
| L1 | Basic Literal | `"a" \| "b" \| "c"` | `Constr(position, [])` | — |
| L2 | Literal custom index | `"Action"` | `Constr(N, [])` | `{ index: N }` |
| L3 | Literal flatInUnion | `"X"` | Direct `Constr(idx,[])` in union | `{ flatInUnion: true }` |

### Recursive Patterns

| # | Pattern | TS Type | Plutus Data | Options |
|---|---------|---------|-------------|---------|
| R1 | Self-referencing | `type T = { next?: T }` | `Schema.suspend(() => T)` | — |
| R2 | Array of self | `type T = { children: T[] }` | Array of suspended schema | — |
| R3 | MultisigScript | Union of variants, some contain `T[]` | Nested Constr with recursive arrays | flatFields + flatInUnion + suspend |

### Composition Patterns

| # | Pattern | Description |
|---|---------|-------------|
| X1 | Schema.compose | Chain two schemas (e.g., hex string -> bytes -> Plutus) |
| X2 | Schema.filter | Add refinement predicates |
| X3 | Data.withSchema | Create codec object from any TSchema |
| X4 | Canonical CBOR | `{ mode: "canonical" }` for deterministic map ordering |

## Validation Rules

The annotation system must enforce:

1. **Tag uniqueness**: Union members using same tag field must have unique tag values
2. **Tag consistency**: All union members must use same tag field name
3. **Index collision**: Flat member indices can't collide with nested member positions
4. **Field order**: Schema definition order, not runtime object order
5. **Recursion termination**: Suspend must eventually produce a non-suspended schema

## Real-World Compositions (from plutus/ modules)

### Address = Struct + Variant + UndefinedOr
```
Struct({
  payment_credential: Variant({VerificationKey, Script}),
  stake_credential: UndefinedOr(Variant({Inline: {credential}, Pointer: {slot, tx_idx, cert_idx}}))
})
```

### Value = Map + Map + Integer
```
Map(ByteArray, Map(ByteArray, Integer))
```

### CIP68Metadata = Struct + PlutusData + Array
```
Struct({ metadata: PlutusData, version: Integer, extra: Array(PlutusData) })
```

### MultisigScript = Union + Variant + Array + Recursive
```
Union(
  Variant({Signature: {keyHash}}),
  Variant({AllOf: {scripts: Array(suspend(() => MultisigScript))}}),
  Variant({AnyOf: {scripts: Array(suspend(() => MultisigScript))}}),
  Variant({AtLeast: {required: Integer, scripts: Array(suspend(() => MultisigScript))}}),
  Variant({After: {time: Integer}}),
  Variant({Before: {time: Integer}})
)
```

## Total Pattern Count

- 4 primitives
- 3 collections
- 8 struct variants
- 6 union variants
- 2 nullable variants
- 3 literal variants
- 3 recursive variants
- 4 composition patterns
- **Total: 33 distinct patterns**
