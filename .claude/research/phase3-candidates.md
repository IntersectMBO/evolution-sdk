# Phase 3: API Design Candidates

## Candidate A: Annotation-Driven Derivation (AST Compiler)

**Approach**: Users write standard Effect `Schema.Struct` / `Schema.Class` / `Schema.Union` types with Plutus annotations. A compiler walks the AST and derives `TSchema`-compatible encoding/decoding.

### Annotation Symbols

```typescript
// PlutusAnnotation.ts
export const ConstrIndexId = Symbol.for("plutus/annotation/ConstrIndex")
export const FlatInUnionId = Symbol.for("plutus/annotation/FlatInUnion")
export const FlatFieldsId = Symbol.for("plutus/annotation/FlatFields")
export const TagFieldId = Symbol.for("plutus/annotation/TagField")
export const EncodingId = Symbol.for("plutus/annotation/Encoding")

// Encoding strategy enum
type PlutusEncoding = "constr" | "integer" | "bytes" | "list" | "map" | "bool" | "passthrough"
```

### API Surface

```typescript
import { Schema } from "effect"
import * as Plutus from "./PlutusSchema.js"

// P1-P4: Primitives — use Schema directly + annotation
const MyBytes = Schema.Uint8ArrayFromSelf.annotations({ [EncodingId]: "bytes" })
const MyInt = Schema.BigIntFromSelf.annotations({ [EncodingId]: "integer" })
// Or use pre-annotated helpers:
const MyBytes2 = Plutus.ByteArray  // pre-annotated Uint8Array
const MyInt2 = Plutus.Integer      // pre-annotated bigint

// S1: Basic Struct
const MyDatum = Schema.Struct({
  owner: Plutus.ByteArray,
  amount: Plutus.Integer
}).annotations({ [ConstrIndexId]: 0 })
// -> Constr(0, [ownerBytes, amountInt])

// S2: Custom Index
const MyAction = Schema.Struct({
  value: Plutus.Integer
}).annotations({ [ConstrIndexId]: 5 })
// -> Constr(5, [value])

// U2: Flat Union (like makeIsDataIndexed)
const Credential = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("PubKey"),
    hash: Plutus.ByteArray
  }).annotations({ [ConstrIndexId]: 0, [FlatInUnionId]: true }),
  Schema.Struct({
    _tag: Schema.Literal("Script"),
    hash: Plutus.ByteArray
  }).annotations({ [ConstrIndexId]: 1, [FlatInUnionId]: true })
)
// PubKey -> Constr(0, [hash]), Script -> Constr(1, [hash])

// N1: Option
const OptionalAmount = Plutus.NullOr(Plutus.Integer)
// null -> Constr(1, []), 42n -> Constr(0, [42n])

// C2: Map
const TokenMap = Plutus.Map(Plutus.ByteArray, Plutus.Integer)

// R1: Recursive
interface LinkedList {
  value: bigint
  next: LinkedList | null
}
const LinkedList: Schema.Schema<LinkedList> = Schema.Struct({
  value: Plutus.Integer,
  next: Plutus.NullOr(Schema.suspend(() => LinkedList))
}).annotations({ [ConstrIndexId]: 0 })

// Derive codec
const MyDatumCodec = Plutus.derive(MyDatum)
// { toData, fromData, toCBORHex, fromCBORHex, ... }

const datum = MyDatumCodec.toData({ owner: new Uint8Array([1,2,3]), amount: 42n })
// -> Constr(0n, [Uint8Array([1,2,3]), 42n])
```

### Derivation Implementation

```typescript
// Uses AST.Match<A> + getCompiler pattern from Phase 1
const match: AST.Match<PlutusCodec> = {
  "TypeLiteral": (ast, go, path) => {
    const index = getConstrIndex(ast) ?? 0
    const fields = ast.propertySignatures
      .filter(ps => !isTagField(ps, ast))
      .map(ps => ({ name: ps.name, codec: go(ps.type, [...path, ps.name]) }))
    return makeStructCodec(index, fields)
  },
  "Union": (ast, go, path) => {
    const members = ast.types.map((t, i) => ({
      codec: go(t, [...path, i]),
      flat: getFlatInUnion(t),
      index: getConstrIndex(t) ?? i
    }))
    return makeUnionCodec(members)
  },
  "Suspend": (ast, go, path) => {
    const get = memoizeThunk(() => go(ast.f(), path))
    return { toData: (a) => get().toData(a), fromData: (d) => get().fromData(d) }
  },
  // ... all other AST node types
}
const compiler = AST.getCompiler(match)
export const derive = <A, I, R>(schema: Schema.Schema<A, I, R>) => compiler(schema.ast, [])
```

### Pros
- Fully leverages Effect's annotation system
- Users write standard `Schema.Struct`/`Schema.Union` — no new API to learn
- AST compiler pattern is canonical Effect (Pretty, Arbitrary, Equivalence use it)
- Clean recursive type support via `Schema.suspend`
- Type inference is perfect — it's just Effect Schema

### Cons
- Annotations are verbose: `.annotations({ [ConstrIndexId]: 0, [FlatInUnionId]: true })`
- Easy to forget annotations — no compile-time enforcement
- Users must know which annotations to add
- Migration from TSchema: conceptual shift from "schema combinators" to "annotate + derive"

---

## Candidate B: Fluent Builder with Type-Level Encoding

**Approach**: A fluent/chainable API that builds Plutus-aware schemas. Each method adds both type information and encoding metadata.

### API Surface

```typescript
import * as P from "./PlutusBuilder.js"

// P1-P2: Primitives
const MyBytes = P.bytes()
const MyInt = P.integer()

// S1: Basic Struct (implicit Constr 0)
const MyDatum = P.constr({
  owner: P.bytes(),
  amount: P.integer()
})

// S2: Custom Index
const MyAction = P.constr({
  value: P.integer()
}, { index: 5 })

// U2: Flat Union (makeIsDataIndexed equivalent)
const Credential = P.indexed([
  P.constr({ hash: P.bytes() }, { tag: "PubKey" }),   // index 0
  P.constr({ hash: P.bytes() }, { tag: "Script" }),    // index 1
])

// U5: Variant (Aiken-style)
const Credential2 = P.variant({
  PubKey: { hash: P.bytes() },
  Script: { hash: P.bytes() }
})

// N1: Option
const OptionalAmount = P.option(P.integer())

// C2: Map
const TokenMap = P.map(P.bytes(), P.integer())

// C1: Array/List
const Hashes = P.list(P.bytes())

// R1: Recursive
const LinkedList = P.constr({
  value: P.integer(),
  next: P.option(P.lazy(() => LinkedList))
})

// Derive codec (same output as Candidate A)
const codec = P.codec(MyDatum)
```

### Implementation Sketch

```typescript
// Each builder function returns a Schema with annotations pre-applied
export const bytes = () => TSchema.ByteArray
export const integer = () => TSchema.Integer

export const constr = <F extends Record<string, Schema.Schema.Any>>(
  fields: F,
  options?: { index?: number; tag?: string }
) => {
  const struct = TSchema.Struct(fields, { index: options?.index ?? 0 })
  return options?.tag
    ? TSchema.TaggedStruct(options.tag, fields, { index: options?.index ?? 0 })
    : struct
}

export const indexed = <M extends ReadonlyArray<Schema.Schema.Any>>(members: M) =>
  TSchema.Union(...members.map((m, i) => /* apply flatInUnion + index */))

export const variant = <V extends Record<string, Record<string, Schema.Schema.Any>>>(variants: V) =>
  TSchema.Variant(variants)

export const option = <S extends Schema.Schema.Any>(s: S) => TSchema.NullOr(s)
export const map = <K extends Schema.Schema.Any, V extends Schema.Schema.Any>(k: K, v: V) => TSchema.Map(k, v)
export const list = <S extends Schema.Schema.Any>(s: S) => TSchema.Array(s)
export const lazy = Schema.suspend

export const codec = Data.withSchema
```

### Pros
- Very concise — `P.constr({ ... })` vs `TSchema.Struct({ ... })`
- Plutus-domain vocabulary: `constr`, `indexed`, `option`, `variant`
- Hard to forget encoding info — it's baked into the API
- `P.indexed([...])` directly mirrors `makeIsDataIndexed`
- Thin wrapper over existing TSchema — low implementation risk

### Cons
- New API to learn (though it maps cleanly to Plutus concepts)
- Less composable with raw Effect Schema (custom Schema types need adapters)
- Essentially a renamed TSchema — not much new capability
- Doesn't leverage Effect's annotation/derivation infrastructure

---

## Candidate C: Schema.Class with Plutus Protocol

**Approach**: Extend Effect's `Schema.Class` pattern with a Plutus derivation protocol. Classes declare their encoding via a static method or annotation, and a protocol-based compiler derives codecs.

### API Surface

```typescript
import { Schema } from "effect"
import * as Plutus from "./PlutusProtocol.js"

// S1: Product type via Class
class MyDatum extends Plutus.Constr("MyDatum")({
  owner: Plutus.ByteArray,
  amount: Plutus.Integer
}) {}
// Automatically: Constr(0, [owner, amount])
// MyDatum has .toData(), .fromData(), .toCBORHex(), etc.

// S2: Custom index
class MyAction extends Plutus.Constr("MyAction", { index: 5 })({
  value: Plutus.Integer
}) {}
// Constr(5, [value])

// U2: Sum type (makeIsDataIndexed)
class PubKeyCredential extends Plutus.Constr("PubKeyCredential", { index: 0 })({
  hash: Plutus.ByteArray
}) {}

class ScriptCredential extends Plutus.Constr("ScriptCredential", { index: 1 })({
  hash: Plutus.ByteArray
}) {}

const Credential = Plutus.Sum("Credential")(
  PubKeyCredential,
  ScriptCredential
)
// PubKeyCredential -> Constr(0, [hash])
// ScriptCredential -> Constr(1, [hash])

// N1: Option
const OptionalAmount = Plutus.Option(Plutus.Integer)

// R1: Recursive
class LinkedList extends Plutus.Constr("LinkedList")({
  value: Plutus.Integer,
  next: Plutus.Option(Schema.suspend(() => LinkedList))
}) {}

// Usage
const datum = new MyDatum({ owner: new Uint8Array([1,2,3]), amount: 42n })
const data = datum.toData()     // Constr(0n, [bytes, 42n])
const cbor = datum.toCBORHex()  // "d8799f43010203182aff"
const back = MyDatum.fromData(data)  // MyDatum instance
```

### Implementation Sketch

```typescript
// Plutus.Constr creates a Schema.Class with Plutus codec methods
export const Constr = (tag: string, options?: { index?: number }) =>
  <Fields extends Schema.Struct.Fields>(fields: Fields) => {
    // Create the underlying TSchema
    const tschema = TSchema.Struct(fields, { index: options?.index ?? 0 })
    const codec = Data.withSchema(tschema)

    // Return a Class with codec methods
    return class extends Schema.Class<any>(tag)(fields) {
      static toData = codec.toData
      static fromData = codec.fromData
      static toCBORHex = codec.toCBORHex
      static fromCBORHex = codec.fromCBORHex

      toData() { return codec.toData(this) }
      toCBORHex() { return codec.toCBORHex(this) }
    }
  }

export const Sum = (tag: string) =>
  <Members extends ReadonlyArray<any>>(...members: Members) => {
    const union = TSchema.Union(...members.map(m => /* extract TSchema */))
    return Data.withSchema(union)
  }
```

### Pros
- Most Haskell-like: `class MyDatum extends Constr(...)({...}) {}`  ≈  `data MyDatum = MyDatum {...}; makeIsData`
- Instance methods: `datum.toData()` feels natural
- `Schema.Class` gives equality, hashing, JSON for free
- Sum types mirror Haskell's `makeIsDataIndexed` exactly
- Strong type safety — TS class system enforces structure

### Cons
- Classes are heavyweight — every type is a class instance
- Sum types require separate class per constructor (verbose for many-variant types)
- Variant/Aiken pattern (`TSchema.Variant`) harder to express
- Interop with existing TSchema-based code requires adapters
- `Schema.Class` has overhead (surrogate annotations, constructor functions)

---

## Candidate D: Hybrid — Annotated TSchema + Derive Layer

**Approach**: Keep TSchema as the core combinator API (it works well), but add an annotation layer that can attach Plutus metadata to *any* Effect Schema and derive TSchema-compatible codecs. Best of both worlds.

### API Surface

```typescript
import { Schema } from "effect"
import * as TSchema from "./TSchema.js"
import * as Plutus from "./PlutusDerive.js"

// === Path 1: Use TSchema directly (existing API, unchanged) ===

const Credential = TSchema.Variant({
  PubKey: { hash: TSchema.ByteArray },
  Script: { hash: TSchema.ByteArray }
})
const codec1 = Data.withSchema(Credential)

// === Path 2: Annotate Effect Schema + derive (new API) ===

// Plutus.data() wraps any Schema with Plutus encoding annotations
// It returns a Schema that is ALSO a valid TSchema (same encoded type)

// S1: Struct
const MyDatum = Plutus.data(Schema.Struct({
  owner: Schema.Uint8ArrayFromSelf,
  amount: Schema.BigIntFromSelf
}))
// Automatically infers: Uint8Array -> ByteArray, bigint -> Integer, Struct -> Constr(0)

// S2: Custom index
const MyAction = Plutus.data(Schema.Struct({
  value: Schema.BigIntFromSelf
}), { index: 5 })

// U2: makeIsDataIndexed equivalent
const Credential2 = Plutus.data(Schema.Union(
  Plutus.data(Schema.Struct({
    _tag: Schema.Literal("PubKey"),
    hash: Schema.Uint8ArrayFromSelf
  }), { index: 0 }),
  Plutus.data(Schema.Struct({
    _tag: Schema.Literal("Script"),
    hash: Schema.Uint8ArrayFromSelf
  }), { index: 1 })
))

// U5: Variant shorthand
const Credential3 = Plutus.variant({
  PubKey: { hash: Schema.Uint8ArrayFromSelf },
  Script: { hash: Schema.Uint8ArrayFromSelf }
})

// N1: Option
const OptionalAmount = Plutus.option(Schema.BigIntFromSelf)

// R1: Recursive
interface Tree { value: bigint; children: Tree[] }
const Tree: Schema.Schema<Tree> = Plutus.data(Schema.Struct({
  value: Schema.BigIntFromSelf,
  children: Schema.Array(Schema.suspend(() => Tree))
}))

// Derive codec from any Plutus.data-annotated schema
const codec = Plutus.codec(MyDatum)
// { toData, fromData, toCBORHex, fromCBORHex }

// === Path 3: Convert between paths ===
// Any TSchema IS already a valid annotated schema (TSchema.* annotations present)
// Plutus.codec works on both TSchema and Plutus.data schemas
const codec3 = Plutus.codec(Credential) // works with TSchema.Variant too
```

### Inference Rules (for Plutus.data)

When `Plutus.data(schema)` is called without explicit encoding annotations, infer from TS types:

| Schema Type | Inferred Plutus Encoding |
|------------|--------------------------|
| `Schema.Uint8ArrayFromSelf` | ByteArray |
| `Schema.BigIntFromSelf` | Integer |
| `Schema.Boolean` | Boolean (Constr 0/1) |
| `Schema.Struct({...})` | Constr(0, [fields]) |
| `Schema.Union(...)` | Union (auto-index) |
| `Schema.Array(...)` | List |
| `Schema.MapFromSelf(...)` | Map |
| `Schema.NullOr(...)` | Option (Constr 0/1) |
| `Schema.suspend(...)` | Recursive (memoized) |
| `Schema.Literal(...)` | Literal (Constr per value) |

### Implementation Sketch

```typescript
// Plutus.data adds annotations and returns a schema with encoded type = Data
export const data = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  options?: { index?: number; flatInUnion?: boolean; flatFields?: boolean }
): Schema.Schema<A, Data.Data, R> => {
  // Use the AST compiler from Phase 1 to walk schema and build transformation
  const plutusSchema = compileToPlutusTranform(schema, options)
  return plutusSchema
}

// compileToPlutusTranform uses Match<A> internally
// It walks the user's Schema AST, infers Plutus encoding for each node,
// and produces a Schema.transform that goes TS type <-> Data.Data

// Plutus.codec is just Data.withSchema applied to the derived schema
export const codec = <A>(schema: Schema.Schema<A, Data.Data>) => Data.withSchema(schema)
```

### Pros
- **Non-breaking**: Existing TSchema code works unchanged
- **Gradual adoption**: Use Path 1 (TSchema) or Path 2 (annotated Schema) or mix
- **Type inference**: `Plutus.data()` infers encoding from TS types — minimal annotations needed
- **Full coverage**: Supports all 33 patterns from Phase 2
- **Leverages both systems**: Effect's annotation/derivation + existing TSchema internals
- **Clean migration**: New code uses `Plutus.data()`, old code stays on TSchema

### Cons
- Two ways to do everything (TSchema vs Plutus.data) — could confuse users
- Inference rules need to be well-documented
- `Plutus.data()` wrapping adds a layer — need to ensure no runtime overhead
- More implementation work than Candidate B (compiler + inference + TSchema bridge)

---

## Candidate Comparison Matrix

| Criterion | A: Annotation | B: Builder | C: Class | D: Hybrid |
|-----------|:---:|:---:|:---:|:---:|
| Type safety | 4 | 4 | 5 | 4 |
| Ergonomics (boilerplate) | 3 | 4 | 4 | 5 |
| Completeness (33 patterns) | 5 | 4 | 3 | 5 |
| Recursion support | 5 | 4 | 4 | 5 |
| Compatibility (Data.withSchema) | 4 | 5 | 3 | 5 |
| Extensibility | 5 | 3 | 4 | 5 |
| Effect idiom alignment | 5 | 2 | 4 | 5 |
| Migration from TSchema | 3 | 4 | 2 | 5 |
| Implementation complexity | Medium | Low | High | Medium-High |
