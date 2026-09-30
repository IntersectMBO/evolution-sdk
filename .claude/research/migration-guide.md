# Migration Guide: TSchema → Plutus.data()

Side-by-side examples showing how to migrate from manual TSchema combinators to annotation-driven `Plutus.data()`.

Both paths produce **identical CBOR** — this is a developer experience improvement, not a breaking change. Existing TSchema code continues to work unchanged.

## When to Use Which

| Use `Plutus.data()` when... | Use TSchema directly when... |
|---|---|
| Starting new code | Existing code already works |
| Want standard Effect Schema types | Need TSchema-specific features |
| Want auto-inference (bigint → Integer) | Want explicit control over encoding |
| Using Schema.Class/TaggedClass | Using Variant (Aiken-style wrapper API) |

## Primitives

```typescript
// ─── TSchema ───
const Hash = TSchema.ByteArray          // Uint8Array
const Amount = TSchema.Integer           // bigint
const Active = TSchema.Boolean           // boolean → Constr(0/1)

// ─── Plutus.data() ───
// Inside Plutus.data(), use standard Effect Schema types:
const MyStruct = Plutus.data(Schema.Struct({
  hash: Schema.Uint8ArrayFromSelf,       // auto-inferred as ByteArray
  amount: Schema.BigIntFromSelf,         // auto-inferred as Integer
  active: Schema.Boolean                 // auto-inferred as Boolean Constr(0/1)
}))

// Standalone primitives: use Plutus re-exports (same as TSchema)
const Hash = Plutus.ByteArray
const Amount = Plutus.Integer
```

## Struct (S1-S2)

```typescript
// ─── TSchema ───
const MyDatum = TSchema.Struct({
  owner: TSchema.ByteArray,
  amount: TSchema.Integer
})
// Constr(0, [ownerBytes, amountInt])

const MyAction = TSchema.Struct(
  { value: TSchema.Integer },
  { index: 5 }
)
// Constr(5, [value])

// ─── Plutus.data() ───
const MyDatum = Plutus.data(Schema.Struct({
  owner: Schema.Uint8ArrayFromSelf,
  amount: Schema.BigIntFromSelf
}))

const MyAction = Plutus.data(
  Schema.Struct({ value: Schema.BigIntFromSelf }),
  { index: 5 }
)

// Or with annotations directly:
const MyAction = Plutus.data(
  Schema.Struct({ value: Schema.BigIntFromSelf })
    .annotations({ [Plutus.ConstrIndexId]: 5 })
)

// Or using makeIsData shorthand:
const MyDatum = Plutus.makeIsData({
  owner: Schema.Uint8ArrayFromSelf,
  amount: Schema.BigIntFromSelf
})
```

## Nested Struct (S3)

```typescript
// ─── TSchema ───
const Inner = TSchema.Struct({ x: TSchema.Integer, y: TSchema.Integer })
const Outer = TSchema.Struct({ inner: Inner, z: TSchema.Integer })
// Constr(0, [Constr(0, [x, y]), z])

// ─── Plutus.data() ───
const Outer = Plutus.data(Schema.Struct({
  inner: Schema.Struct({
    x: Schema.BigIntFromSelf,
    y: Schema.BigIntFromSelf
  }),
  z: Schema.BigIntFromSelf
}))
```

## Flat Fields (S4)

```typescript
// ─── TSchema ───
const Inner = TSchema.Struct(
  { x: TSchema.Integer, y: TSchema.Integer },
  { flatFields: true }
)
const Outer = TSchema.Struct({ inner: Inner, z: TSchema.Integer })
// Constr(0, [x, y, z])  — inner fields inlined

// ─── Plutus.data() ───
const Inner = Schema.Struct({
  x: Schema.BigIntFromSelf,
  y: Schema.BigIntFromSelf
}).annotations({ [Plutus.FlatFieldsId]: true })

const Outer = Plutus.data(Schema.Struct({
  inner: Inner,
  z: Schema.BigIntFromSelf
}))
```

## Tag Field (S5-S7)

```typescript
// ─── TSchema ───
// Auto-detected (_tag, type, kind, variant)
const Tagged = TSchema.Struct({
  _tag: TSchema.Literal("Mint"),
  amount: TSchema.Integer
})
// Constr(0, [amount])  — _tag stripped

// ─── Plutus.data() ───
const Tagged = Plutus.data(Schema.Struct({
  _tag: Schema.Literal("Mint"),
  amount: Schema.BigIntFromSelf
}))
// Same: _tag auto-detected and stripped

// Disable tag stripping:
const NoStrip = Plutus.data(
  Schema.Struct({
    _tag: Schema.Literal("Mint"),
    amount: Schema.BigIntFromSelf
  }),
  { tagField: false }
)
```

## Sum Types / Variant (U2, U5)

```typescript
// ─── TSchema ───
const Credential = TSchema.Variant({
  VerificationKey: { hash: TSchema.ByteArray },
  Script: { hash: TSchema.ByteArray }
})
// Usage: { VerificationKey: { hash: bytes } }
// PubKey → Constr(0, [hash]), Script → Constr(1, [hash])

// ─── Plutus.data() — makeIsDataIndexed ───
const Credential = Plutus.makeIsDataIndexed(
  {
    VerificationKey: { hash: Schema.Uint8ArrayFromSelf },
    Script: { hash: Schema.Uint8ArrayFromSelf }
  },
  { VerificationKey: 0, Script: 1 }
)
// Usage: { _tag: "VerificationKey", hash: bytes }
// Same CBOR: Constr(0, [hash]) / Constr(1, [hash])

// ─── Plutus.data() — manual annotations ───
const Credential = Plutus.data(Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("VerificationKey"),
    hash: Schema.Uint8ArrayFromSelf
  }).annotations({ [Plutus.ConstrIndexId]: 0, [Plutus.FlatInUnionId]: true }),
  Schema.Struct({
    _tag: Schema.Literal("Script"),
    hash: Schema.Uint8ArrayFromSelf
  }).annotations({ [Plutus.ConstrIndexId]: 1, [Plutus.FlatInUnionId]: true })
))

// ─── TSchema Variant still available via Plutus.Variant ───
const Credential = Plutus.Variant({
  VerificationKey: { hash: Plutus.ByteArray },
  Script: { hash: Plutus.ByteArray }
})
```

**API difference**: TSchema.Variant uses `{ Name: { fields } }` wrapper objects. `makeIsDataIndexed` uses `{ _tag: "Name", ...fields }` discriminated unions. CBOR output is identical.

## Option / Nullable (N1-N2)

```typescript
// ─── TSchema ───
const OptInt = TSchema.NullOr(TSchema.Integer)
const MaybeBytes = TSchema.UndefinedOr(TSchema.ByteArray)

// ─── Plutus.data() ───
const OptInt = Plutus.data(Schema.NullOr(Schema.BigIntFromSelf))
const MaybeBytes = Plutus.data(Schema.UndefinedOr(Schema.Uint8ArrayFromSelf))

// In struct fields — auto-detected:
const WithOptional = Plutus.data(Schema.Struct({
  value: Schema.BigIntFromSelf,
  optional: Schema.NullOr(Schema.BigIntFromSelf)
}))
```

## Map (C2)

```typescript
// ─── TSchema ───
const Value = TSchema.Map(TSchema.ByteArray, TSchema.Map(TSchema.ByteArray, TSchema.Integer))

// ─── Plutus.data() ───
const Value = Plutus.data(Schema.MapFromSelf({
  key: Schema.Uint8ArrayFromSelf,
  value: Schema.MapFromSelf({
    key: Schema.Uint8ArrayFromSelf,
    value: Schema.BigIntFromSelf
  })
}))

// Or use Plutus.Map (re-export of TSchema.Map):
const Value = Plutus.Map(Plutus.ByteArray, Plutus.Map(Plutus.ByteArray, Plutus.Integer))
```

## Array / List (C1)

```typescript
// ─── TSchema ───
const Hashes = TSchema.Array(TSchema.ByteArray)

// ─── Plutus.data() ───
const Hashes = Plutus.data(Schema.Array(Schema.Uint8ArrayFromSelf))
```

## Recursive Types (R1-R3)

```typescript
// ─── TSchema ───
interface LinkedList { value: bigint; next: LinkedList | null }
const LinkedList: Schema.Schema<LinkedList> = TSchema.Struct({
  value: TSchema.Integer,
  next: TSchema.NullOr(Schema.suspend(() => LinkedList))
})

// ─── Plutus.data() ───
const LinkedList: Schema.Schema<LinkedList, Data.Data> = Plutus.data(
  Schema.Struct({
    value: Schema.BigIntFromSelf,
    next: Schema.NullOr(Schema.suspend(() => LinkedList as any))
  })
) as any

// MultisigScript (recursive sum type):
const NativeScript = Plutus.makeIsDataIndexed(
  {
    ScriptPubkey: { key_hash: Schema.Uint8ArrayFromSelf },
    ScriptAll: { scripts: Schema.Array(Schema.suspend(() => NativeScript as any)) },
    ScriptAny: { scripts: Schema.Array(Schema.suspend(() => NativeScript as any)) },
    ScriptNOfK: {
      n: Schema.BigIntFromSelf,
      scripts: Schema.Array(Schema.suspend(() => NativeScript as any))
    },
    TimelockStart: { time: Schema.BigIntFromSelf },
    TimelockExpiry: { time: Schema.BigIntFromSelf }
  },
  { ScriptPubkey: 0, ScriptAll: 1, ScriptAny: 2, ScriptNOfK: 3, TimelockStart: 4, TimelockExpiry: 5 }
)
```

## Schema.Class / Schema.TaggedClass

```typescript
// ─── Schema.Class works directly with Plutus.data() ───
class MyDatum extends Schema.Class<MyDatum>("MyDatum")({
  owner: Schema.Uint8ArrayFromSelf,
  amount: Schema.BigIntFromSelf
}) {}

const PlutusMyDatum = Plutus.data(MyDatum)
const codec = Plutus.codec(PlutusMyDatum)
codec.toData(new MyDatum({ owner: bytes, amount: 42n }))
// Constr(0, [ownerBytes, 42n])

// TaggedClass — _tag auto-stripped
class Action extends Schema.TaggedClass<Action>()("Mint", {
  amount: Schema.BigIntFromSelf
}) {}

const PlutusAction = Plutus.data(Action)
// Constr(0, [amount])  — _tag:"Mint" stripped during encoding, injected during decoding
```

## Codec Usage

```typescript
// Both TSchema and Plutus.data() work with Plutus.codec() / Data.withSchema()
const codec = Plutus.codec(mySchema)

codec.toData(value)           // TS value → Data.Data
codec.fromData(data)          // Data.Data → TS value
codec.toCBORHex(value)        // TS value → CBOR hex string
codec.fromCBORHex(hex)        // CBOR hex string → TS value
codec.toCBORBytes(value)      // TS value → Uint8Array
codec.fromCBORBytes(bytes)    // Uint8Array → TS value
```

## Real-World Example: Cardano Address

```typescript
// ─── TSchema (current) ───
const Credential = TSchema.Variant({
  VerificationKey: { hash: TSchema.ByteArray },
  Script: { hash: TSchema.ByteArray }
})
const Address = TSchema.Struct({
  payment_credential: Credential,
  stake_credential: TSchema.UndefinedOr(StakeCredential)
})

// ─── Plutus.data() (new) ───
const Credential = Plutus.makeIsDataIndexed(
  {
    VerificationKey: { hash: Schema.Uint8ArrayFromSelf },
    Script: { hash: Schema.Uint8ArrayFromSelf }
  },
  { VerificationKey: 0, Script: 1 }
)
const Address = Plutus.data(Schema.Struct({
  payment_credential: Credential,
  stake_credential: Schema.UndefinedOr(StakeCredential)
}))

// CBOR output is byte-for-byte identical.
```
