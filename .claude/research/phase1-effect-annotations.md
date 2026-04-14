# Phase 1: Effect Schema Annotation Deep-Dive

## Core Architecture

### Annotations Type
Every AST node implements `Annotated` with an `annotations: Annotations` record that accepts both string and symbol keys:

```typescript
// SchemaAST.ts
interface Annotated {
  readonly annotations: Annotations
}
interface Annotations {
  readonly [_: string]: unknown
  readonly [_: symbol]: unknown
}
```

All AST node constructors accept `annotations: Annotations = {}` as last param.

### How `.annotations()` Works

`AST.annotations(ast, overrides)` creates a **shallow clone** of the AST node via `Object.create` + property descriptors. It:
1. Merges new annotations with existing (spread)
2. Deletes `IdentifierAnnotationId` to prevent stale identifiers
3. Recursively applies to surrogate ASTs (for transformations)
4. Is **non-mutating** — returns new object

At the Schema level, `schema.annotations(a)` calls `mergeSchemaAnnotations(this.ast, a)` which maps user-friendly annotation keys to AST annotation symbols via `toASTAnnotations`.

### Custom Annotation Keys

All built-in annotations use `Symbol.for()`:
```typescript
export const BrandAnnotationId: unique symbol = Symbol.for("effect/annotation/Brand")
export const ArbitraryAnnotationId: unique symbol = Symbol.for("effect/annotation/Arbitrary")
export const PrettyAnnotationId: unique symbol = Symbol.for("effect/annotation/Pretty")
// etc.
```

**Custom annotations**: define with `Symbol.for("myapp/annotation/MyKey")` — namespaced globally.

Module augmentation is supported for type-safe custom annotations:
```typescript
declare module "effect/Schema" {
  namespace Annotations {
    interface Schema<A> {
      myCustomField?: string
    }
  }
}
```

### Reading Annotations

```typescript
// Generic getter - works with any symbol key
export const getAnnotation: <A>(annotated: Annotated, key: symbol) => Option<A>

// Curried form for creating specialized getters
const getMyAnnotation = AST.getAnnotation<MyType>(MySymbol)
// Usage: getMyAnnotation(ast) -> Option<MyType>
```

## Derivation Patterns (The Key Discovery)

### Pattern 1: AST Compiler (`Match<A>` + `getCompiler`)

This is the **primary mechanism** for building derivation systems. Used by Pretty, Equivalence, etc.

```typescript
// SchemaAST.ts
type Compiler<A> = (ast: AST, path: ReadonlyArray<PropertyKey>) => A

type Match<A> = {
  [K in AST["_tag"]]: (
    ast: Extract<AST, { _tag: K }>,
    compile: Compiler<A>,
    path: ReadonlyArray<PropertyKey>
  ) => A
}

const getCompiler = <A>(match: Match<A>): Compiler<A> => {
  const compile = (ast: AST, path: ReadonlyArray<PropertyKey>): A =>
    match[ast._tag](ast as any, compile, path)
  return compile
}
```

**Usage**: Define a handler for each AST node type, get a recursive traversal for free.

### Pattern 2: Two-Phase (Arbitrary.ts)

1. **Phase 1**: Walk AST → collect into intermediate `Description` objects (constraints, annotations)
2. **Phase 2**: Compile `Description` → output (lazy arbitrary generators)

Useful when you need to accumulate constraints before generating output.

### Pattern 3: Annotation Hook

Check for custom annotation first, fall back to structural derivation:
```typescript
"TypeLiteral": (ast, go, path) => {
  const hook = getMyAnnotation(ast)
  if (Option.isSome(hook)) {
    return hook.value()  // User override
  }
  // Default: derive from structure
  const fields = ast.propertySignatures.map(ps => go(ps.type, [...path, ps.name]))
  return buildFromFields(fields)
}
```

## AST Node Types (All Tags)

These are all the `_tag` values that `Match<A>` must cover:

| Tag | Description | Relevant for Plutus? |
|-----|-------------|---------------------|
| `Declaration` | Custom opaque types (Schema.Class, etc.) | Yes - class instances |
| `Literal` | Literal values (string, number, boolean, null, bigint) | Yes - enum values |
| `UniqueSymbol` | Unique symbol types | No |
| `UndefinedKeyword` | `undefined` type | Maybe - Option/Nothing |
| `VoidKeyword` | `void` type | No |
| `NeverKeyword` | `never` type | No |
| `UnknownKeyword` | `unknown` type | No |
| `AnyKeyword` | `any` type | No |
| `StringKeyword` | `string` type | No (Plutus has no strings) |
| `NumberKeyword` | `number` type | No |
| `BooleanKeyword` | `boolean` type | Yes - Constr 0/1 |
| `BigIntKeyword` | `bigint` type | Yes - Plutus Integer |
| `SymbolKeyword` | `symbol` type | No |
| `ObjectKeyword` | `object` type | No |
| `Enums` | TypeScript enums | Maybe |
| `TemplateLiteral` | Template literal types | No |
| `Refinement` | Refined types with predicates | Yes - constraints |
| `TupleType` | Tuples and arrays | Yes - Plutus lists/tuples |
| `TypeLiteral` | Object types (struct fields) | Yes - Plutus Constr fields |
| `Union` | Union types | Yes - Plutus sum types |
| `Suspend` | Lazy/recursive schemas | Yes - recursive types |
| `Transformation` | Bidirectional transforms | Yes - encoding/decoding |

## Schema.suspend (Recursive Types)

```typescript
const suspend = <A, I, R>(f: () => Schema<A, I, R>): suspend<A, I, R> =>
  make(new AST.Suspend(() => f().ast))
```

- Takes a **thunk** returning a Schema
- `Suspend` AST node **memoizes** the thunk (`util_.memoizeThunk`)
- Breaks cycles by deferring evaluation
- Supports annotations like any other node
- Pretty/Arbitrary handle it by memoizing the compiled result:
  ```typescript
  "Suspend": (ast, go, path) => {
    const get = util_.memoizeThunk(() => go(ast.f(), path))
    return (a) => get()(a)
  }
  ```

## Schema.Class / Schema.TaggedClass

Internally use `makeClass` which:
1. Creates three annotation groups: type, transformation, encoded
2. Builds a transformation AST: encoded-side → declaration (class constructor)
3. Uses **surrogate annotations** to preserve structural schema alongside class metadata
4. The `ast` getter is lazy-evaluated and cached

Key: Classes store field metadata statically and the `ast` includes the full transformation chain.

## Implications for Plutus Annotation System

### What We Can Build

1. **Custom annotation symbols** for Plutus metadata:
   - `PlutusConstrIndex` — constructor index
   - `PlutusEncoding` — encoding strategy (Constr, Map, List, Integer, ByteArray)
   - `PlutusFieldOrder` — explicit field ordering
   - `PlutusFlatUnion` — flat vs nested union encoding
   - `PlutusTagField` — tag field name to strip

2. **AST Compiler** to derive Plutus Data encoder/decoder from annotated schemas:
   - Walk the AST using `Match<A>`
   - At each node, check for Plutus annotations → use them
   - Fall back to structural inference (Struct → Constr, Union → indexed Constr, etc.)

3. **Two-phase approach** for complex cases:
   - Phase 1: Walk AST, collect Plutus encoding plan (intermediate representation)
   - Phase 2: Compile plan into encoder/decoder functions

4. **Recursive type support** via Suspend handling with memoization

### What Already Exists in TSchema

TSchema already uses string-key annotations on AST nodes:
```typescript
.annotations({
  "TSchema.customIndex": options.index,
  "TSchema.flatInUnion": isFlatInUnion,
  "TSchema.flatFields": isFlatFields
})
```

This is the same mechanism — TSchema is already annotation-driven! The question is whether to:
- **Extend this approach** (add more annotations, build compiler on top)
- **Replace with declarative API** (user annotates, system derives)
- **Layer on top** (new API that generates TSchema internally)

### Key Insight

The `Match<A>` + `getCompiler` pattern is the canonical Effect way to build derivation systems. A Plutus annotation system should:
1. Let users annotate `Schema.Struct` / `Schema.Class` with Plutus metadata
2. Use `getCompiler` to walk the annotated AST
3. Produce encoder/decoder functions (or TSchema-compatible schemas)

This avoids reimplementing schema combinators — we'd reuse Effect's existing Schema infrastructure and just add the Plutus-specific derivation layer.
