# Phase 5: Effect AST Compiler Implementations — Study Notes

## Core Infrastructure (SchemaAST.ts)

### Types (lines 2628-2643)

```typescript
export type Compiler<A> = (ast: AST, path: ReadonlyArray<PropertyKey>) => A

export type Match<A> = {
  [K in AST["_tag"]]: (
    ast: Extract<AST, { _tag: K }>,
    compile: Compiler<A>,
    path: ReadonlyArray<PropertyKey>
  ) => A
}

export const getCompiler = <A>(match: Match<A>): Compiler<A> => {
  const compile = (ast: AST, path: ReadonlyArray<PropertyKey>): A =>
    match[ast._tag](ast as any, compile, path)
  return compile
}
```

`Match<A>` enforces exhaustive handling — TS won't compile if any AST tag is missing.

### getAnnotation (line 335)

```typescript
export const getAnnotation: {
  <A>(key: symbol): (annotated: Annotated) => Option.Option<A>
  <A>(annotated: Annotated, key: symbol): Option.Option<A>
} = dual(2, (annotated, key) =>
  Object.prototype.hasOwnProperty.call(annotated.annotations, key)
    ? Option.some(annotated.annotations[key])
    : Option.none()
)
```

Curried form creates reusable getters:
```typescript
const getPrettyAnnotation = AST.getAnnotation<PrettyAnnotation<any, any>>(AST.PrettyAnnotationId)
```

### All 22 AST Tags Match Must Cover

**Leaf types (no recursion needed):**
Declaration, Literal, UniqueSymbol, UndefinedKeyword, VoidKeyword,
NeverKeyword, UnknownKeyword, AnyKeyword, StringKeyword, NumberKeyword,
BooleanKeyword, BigIntKeyword, SymbolKeyword, ObjectKeyword, Enums,
TemplateLiteral

**Composite types (recursive compilation):**
TupleType, TypeLiteral, Union, Suspend, Refinement, Transformation

## Pretty.ts — The Canonical Single-Phase Example (205 lines)

### getMatcher Helper

```typescript
const getMatcher = (defaultPretty: Pretty<any>) => (ast: AST.AST): Pretty<any> =>
  Option.match(getPrettyAnnotation(ast), {
    onNone: () => defaultPretty,
    onSome: (handler) => handler()
  })

// Used for all keyword types:
"StringKeyword": stringify,
"NumberKeyword": toString,
"BooleanKeyword": toString,
"BigIntKeyword": getMatcher((a) => `${String(a)}n`),
```

Pattern: check annotation first, fall back to default. One-liner for simple types.

### Declaration — Requires Annotation

```typescript
"Declaration": (ast, go, path) => {
  const annotation = getPrettyAnnotation(ast)
  if (Option.isSome(annotation)) {
    return annotation.value(...ast.typeParameters.map((tp) => go(tp, path)))
  }
  throw new Error(errors_.getPrettyMissingAnnotationErrorMessage(path, ast))
}
```

Declaration nodes (Schema.Class, custom types) have no structural info — annotation is mandatory.

### TypeLiteral (Struct) — Annotation-First + Structural Fallback

```typescript
"TypeLiteral": (ast, go, path) => {
  const hook = getPrettyAnnotation(ast)
  if (Option.isSome(hook)) { return hook.value() }

  const propertySignaturesTypes = ast.propertySignatures.map((ps) =>
    go(ps.type, path.concat(ps.name))
  )
  const indexSignatureTypes = ast.indexSignatures.map((is) => go(is.type, path))
  // ... build function from compiled children
}
```

### Union — Compile All Members + Runtime Discriminator

```typescript
"Union": (ast, go, path) => {
  const hook = getPrettyAnnotation(ast)
  if (Option.isSome(hook)) { return hook.value() }

  const types = ast.types.map((ast) =>
    [ParseResult.is({ ast } as any), go(ast, path)] as const
  )
  return (a) => {
    const index = types.findIndex(([is]) => is(a))
    return types[index][1](a)
  }
}
```

### Suspend — memoizeThunk Breaks Recursion

```typescript
"Suspend": (ast, go, path) => {
  return Option.match(getPrettyAnnotation(ast), {
    onNone: () => {
      const get = util_.memoizeThunk(() => go(ast.f(), path))
      return (a) => get()(a)
    },
    onSome: (handler) => handler()
  })
}
```

### Transformation/Refinement — Look-Through

```typescript
"Transformation": (ast, go, path) => {
  // No annotation → go to decoded ("to") side
  return Option.match(getPrettyAnnotation(ast), {
    onNone: () => go(ast.to, path),
    onSome: (handler) => handler()
  })
}

"Refinement": (ast, go, path) => {
  // No annotation → go to base ("from") type
  return Option.match(getPrettyAnnotation(ast), {
    onNone: () => go(ast.from, path),
    onSome: (handler) => handler()
  })
}
```

### Final Compilation

```typescript
export const match: AST.Match<Pretty<any>> = { ... }
const compile = AST.getCompiler(match)
// Usage: compile(schema.ast, []) → Pretty<A>
```

## Arbitrary.ts — Two-Phase Approach (1101 lines)

### Why Two Phases?

Arbitrary needs to **accumulate constraints** from Refinement chains before generating. E.g., `Schema.String.pipe(Schema.minLength(3), Schema.maxLength(10))` produces nested Refinement AST nodes. Phase 1 collects ALL constraints into a flat Description, phase 2 generates from the combined constraints.

### Phase 1: `getDescription(ast, path) → Description`

Uses `wrapGetDescription` to compose annotation checking on top of structural extraction:

```typescript
function wrapGetDescription(
  f: (ast: AST, description: Description) => Description,  // annotation layer
  g: (ast: AST, path: ReadonlyArray<PropertyKey>) => Description  // structural layer
): (ast: AST, path: ReadonlyArray<PropertyKey>) => Description {
  return (ast, path) => f(ast, g(ast, path))
}
```

Refinements accumulate constraints onto their base type's description:
```typescript
case "Refinement": {
  const from = getDescription(ast.from, path)
  switch (from._tag) {
    case "StringKeyword":
      return { ...from, constraints: [...from.constraints, makeStringConstraints(meta)] }
  }
}
```

Suspend uses `idMemoMap` (global Map) to detect and break cycles, assigns unique IDs.

### Phase 2: `go(description, ctx) → LazyArbitrary<A>`

Uses same `wrapGo` pattern. Context carries `maxDepth` for recursion limits. Suspend uses `arbitraryMemoMap` (second level of memoization).

### Key Insight for Plutus

**We don't need two phases.** Plutus encoding doesn't accumulate constraints — each AST node maps directly to one encoding strategy. The single-phase `Match<A>` pattern from Pretty.ts is the right model.

## Schema.equivalence() — Manual Switch (Older Pattern)

Located in Schema.ts (line 10688). Uses a recursive `go()` with manual `switch(ast._tag)` instead of `Match<A>`.

```typescript
const go = (ast: AST.AST, path: ReadonlyArray<PropertyKey>): Equivalence<any> => {
  const hook = getEquivalenceAnnotation(ast)
  if (option_.isSome(hook)) {
    switch (ast._tag) {
      case "Declaration": return hook.value(...ast.typeParameters.map((tp) => go(tp, path)))
      case "Refinement": return hook.value(go(ast.from, path))
      default: return hook.value()
    }
  }
  switch (ast._tag) {
    case "Suspend": {
      const get = util_.memoizeThunk(() => go(ast.f(), path))
      return (a, b) => get()(a, b)
    }
    // ... etc
  }
}
```

Same principles: annotation-first, memoizeThunk for Suspend, look-through for Transformation/Refinement. But no compile-time exhaustiveness enforcement. `Match<A>` is the better approach.

## memoizeThunk Implementation

From `effect/src/internal/schema/util.ts`:

```typescript
export const memoizeThunk = <A>(f: () => A): () => A => {
  let done = false
  let a: A
  return () => {
    if (done) { return a }
    a = f()
    done = true
    return a
  }
}
```

First call executes `f()` and caches. Subsequent calls return cached value. Used in every Suspend handler to break infinite recursion.

## Summary: What Our Plutus Compiler Must Do

1. **Use `Match<A>` + `getCompiler`** (Pretty.ts pattern, single-phase)
2. **Define `PlutusAnnotationId`** symbol + curried getter via `AST.getAnnotation`
3. **All 22 handlers required** — TS enforces exhaustiveness
4. **Every handler checks annotation first**, falls back to structural inference
5. **Suspend**: `memoizeThunk(() => go(ast.f(), path))` — exact same pattern as Pretty
6. **Transformation**: check for existing TSchema annotations (passthrough), else look through to `ast.to`
7. **Refinement**: look through to `ast.from`
8. **Declaration**: check `IdentifierAnnotationId` for known types (Uint8ArrayFromSelf → ByteArray)
9. **Unsupported tags** (StringKeyword, NumberKeyword, etc.): throw descriptive errors with path
10. **`getMatcher`-style helper** for simple Plutus primitives (BigIntKeyword → Integer, BooleanKeyword → Boolean)
