# Plutus Data Annotation Research Loop

## Goal

Design a TypeScript annotation system using Effect Schema that mirrors Haskell's Plutus data derivation (`makeIsData`, `makeIsDataIndexed`), enabling users to declaratively annotate TypeScript types and automatically derive Plutus Data encoding/decoding. Must handle all Plutus Data constructors, recursive types, nested unions, maps, options, and custom constructor indices.

**CRITICAL**: The implementation MUST use Effect Schema's annotation system (`Schema.annotations()`, custom `Symbol.for()` keys, `AST.Match<A>` + `AST.getCompiler` pattern). Do NOT copy the existing manual `switch(ast._tag)` approach from the current `PlutusSchema.ts` — that file is wrong and must be replaced.

## Context

- **Codebase**: `evolution-sdk` monorepo, `packages/evolution/src/`
- **Existing**: `TSchema.ts` (~860 lines) provides manual schema combinators (Struct, Union, Variant, Literal, etc.) that transform TS types <-> Plutus Data <-> CBOR
- **Existing**: `Data.ts` defines Plutus Data model: `Constr | Map<Data,Data> | Data[] | bigint | Uint8Array`
- **Effect version**: v3.19.3
- **Effect source clones**: available via `effect-local-source` skill — USE THIS for all Effect source research

## Key Research Findings (Phases 1-4)

### Phase 1 Discovery: How Effect Does Derivation

Effect's canonical derivation pattern (used by Pretty, Arbitrary, Equivalence):

```typescript
// SchemaAST.ts
type Match<A> = {
  [K in AST["_tag"]]: (
    ast: Extract<AST, { _tag: K }>,
    compile: Compiler<A>,
    path: ReadonlyArray<PropertyKey>
  ) => A
}
const getCompiler = <A>(match: Match<A>): Compiler<A>
```

Custom annotations use `Symbol.for()` and attach to any AST node:
```typescript
const ConstrIndexId = Symbol.for("plutus/annotation/ConstrIndex")
const mySchema = Schema.Struct({...}).annotations({ [ConstrIndexId]: 0 })
// Read back: AST.getAnnotation<number>(ast, ConstrIndexId)
```

### Phase 4 Winner: Candidate D (Hybrid)

Two paths coexist:
1. **TSchema path** — existing combinators, unchanged
2. **Plutus.data() path** — annotate any Effect Schema, derive Plutus encoding via AST compiler

```typescript
// User writes standard Effect Schema + Plutus.data() wrapper
const MyDatum = Plutus.data(Schema.Struct({
  owner: Schema.Uint8ArrayFromSelf,
  amount: Schema.BigIntFromSelf
}))
// Compiler infers: Uint8Array -> ByteArray, bigint -> Integer, Struct -> Constr(0)

const codec = Plutus.codec(MyDatum)
```

## Haskell Reference Patterns

```haskell
-- Simple product type
data MyDatum = MyDatum { owner :: PubKeyHash, amount :: Integer }
PlutusTx.unstableMakeIsData ''MyDatum
-- Encodes as: Constr 0 [ownerBytes, amountInt]

-- Sum type with explicit indices
data Credential = PubKeyCredential PubKeyHash | ScriptCredential ScriptHash
PlutusTx.makeIsDataIndexed ''Credential [('PubKeyCredential, 0), ('ScriptCredential, 1)]

-- Recursive type
data Value = Value (Map CurrencySymbol (Map TokenName Integer))

-- Nested sum in product
data TxOut = TxOut { address :: Address, value :: Value, datum :: OutputDatum }
data OutputDatum = NoOutputDatum | OutputDatumHash DatumHash | OutputDatum Datum
```

## Phases

### Phase 1: Effect Schema Annotation Deep-Dive
**Status**: done
**Output**: `phase1-effect-annotations.md`

### Phase 2: Catalog All Plutus Data Patterns
**Status**: done
**Output**: `phase2-pattern-catalog.md`

### Phase 3: Design Candidates
**Status**: done
**Output**: `phase3-candidates.md`

### Phase 4: Evaluate & Select Winners
**Status**: done
**Output**: `phase4-evaluation.md`

### Phase 5: Study Effect's Real AST Compiler Implementations
**Status**: done
**Goal**: Read the ACTUAL Effect source code for Pretty, Arbitrary, and Equivalence to understand exactly how `Match<A>` + `getCompiler` work in practice. The current prototype skipped this and wrote a manual `switch` — that's wrong.
**Actions**:
1. Use `effect-local-source` skill to find the Effect v3 source
2. Read `packages/effect/src/Pretty.ts` — study the full `Match<Pretty>` implementation
3. Read `packages/effect/src/Arbitrary.ts` — study how it handles Suspend (recursion), Union, TypeLiteral
4. Read `packages/effect/src/Equivalence.ts` — another derivation example
5. Read `packages/effect/src/SchemaAST.ts` — find `getCompiler`, `Match`, `Compiler` types and understand the exact contract
6. Document: exact function signatures, how each AST tag is handled, how annotations override default behavior, how memoization works for Suspend
7. Pay special attention to: how annotations are checked FIRST before structural derivation, how errors are reported for unsupported types
**Output**: Write findings to `phase5-ast-compiler-study.md`

### Phase 6: Define Plutus Annotation Symbols
**Status**: done
**Goal**: Define the custom annotation symbols that carry Plutus encoding metadata on Schema AST nodes.
**Actions**:
1. Based on Phase 5 findings, define annotation symbols following Effect conventions:
   - `PlutusConstrIndexId` — constructor index (number)
   - `PlutusEncodingId` — encoding strategy override ("constr" | "integer" | "bytes" | "list" | "map" | "bool" | "passthrough")
   - `PlutusFlatInUnionId` — flat union encoding (boolean)
   - `PlutusFlatFieldsId` — flatten nested struct fields (boolean)
   - `PlutusTagFieldId` — tag field name to strip (string | false)
2. Define TypeScript types for annotation values
3. Define `getAnnotation` helpers (curried form like Effect does)
4. Write a small `PlutusAnnotation.ts` module (or section within PlutusSchema.ts)
5. Write tests: attach annotations to schemas, read them back
**Output**: Working annotation symbols + tests, committed locally

### Phase 7: Build the AST Compiler (Match<PlutusCodec>)
**Status**: done
**Goal**: Implement the core `Match<PlutusCodec>` that walks annotated Effect Schema AST and produces Plutus Data encoder/decoder.
**Actions**:
1. Define `PlutusCodec` type: `{ toData: (a: any) => Data.Data, fromData: (d: Data.Data) => any }`
2. Implement `Match<PlutusCodec>` with handlers for every relevant AST tag:
   - `TypeLiteral` → check for ConstrIndex annotation, build Constr encoder from property signatures
   - `BigIntKeyword` → Integer passthrough
   - `BooleanKeyword` → Boolean Constr(0/1)
   - `Literal` → handle tag literals, enum values
   - `Declaration` → detect Uint8ArrayFromSelf, etc.
   - `Union` → detect NullOr/UndefinedOr patterns, else build indexed union
   - `TupleType` → Array or Tuple encoding
   - `Suspend` → memoized recursive thunk (MUST follow Effect's Suspend pattern exactly)
   - `Transformation` → check if already TSchema-annotated, otherwise look-through
   - `Refinement` → look through to base type
   - All other tags → throw descriptive error
3. Each handler MUST check for annotation override FIRST, then fall back to structural inference
4. Use `AST.getCompiler(match)` to get the compiler function
5. Write tests for each AST tag handler individually
**Output**: Working AST compiler + tests, committed locally

### Phase 8: Plutus.data() and Public API
**Status**: done
**Goal**: Wire the AST compiler into the public `Plutus.data()` / `Plutus.fromSchema()` API.
**Actions**:
1. `Plutus.data(schema, options?)` — applies annotations from options, then runs compiler
2. `Plutus.makeIsData(fields, options?)` — shorthand for `Plutus.data(Schema.Struct(fields))`
3. `Plutus.makeIsDataIndexed(variants, indices)` — shorthand that applies ConstrIndex annotations per variant
4. `Plutus.variant(variants)` — Aiken-style, delegates to TSchema.Variant
5. `Plutus.codec(schema)` — wraps `Data.withSchema()`
6. Re-export primitives: `Plutus.ByteArray`, `Plutus.Integer`, `Plutus.Boolean`, etc.
7. Write comprehensive tests covering ALL patterns from Phase 2 catalog
8. Verify roundtrip: TS value -> Plutus Data -> CBOR -> Plutus Data -> TS value
9. Verify compatibility: `Data.withSchema(Plutus.data(schema))` works
**Output**: Working `PlutusSchema.ts` + comprehensive tests, committed locally

### Phase 9: Edge Cases & Completeness
**Status**: done
**Goal**: Handle remaining edge cases and ensure full coverage of the Phase 2 pattern catalog.
**Actions**:
1. Test deeply nested recursive types (mutual recursion if possible)
2. Test all Option/Nullable combinations (nested options, optional in union, etc.)
3. Test custom constructor indices in nested unions
4. Test flatFields interop
5. Test tag field auto-detection with annotations
6. Test mixing TSchema fields inside Plutus.data() schemas (passthrough)
7. Test error messages for unsupported types (string, number, etc.)
8. Performance: ensure annotation traversal doesn't add measurable runtime overhead vs direct TSchema
9. Document any patterns that can't be supported and why
**Output**: Updated code + comprehensive tests + limitations doc, committed locally

### Phase 10: Real-World Validation
**Status**: done
**Goal**: Validate the annotation system works for real Cardano types.
**Actions**:
1. Re-implement `Address`, `Credential`, `Value` using `Plutus.data()` alongside existing TSchema versions
2. Verify CBOR output matches byte-for-byte with existing TSchema versions
3. Re-implement `CIP68Metadata` and `MultisigScript` patterns
4. Verify recursive types (MultisigScript) work correctly
5. Write migration examples showing TSchema -> Plutus.data() for each real type
6. If any real type can't be expressed, go back and fix the compiler
**Output**: Real-world validation tests + migration examples, committed locally

### Phase 11: Challenge the Implementation
**Status**: done
**Goal**: Adversarial review — stress-test assumptions, find holes, and prove the design is sound or fix what isn't.
**Actions**:
1. **Question the compiler pattern**: Is `Match<PlutusCodec>` the right abstraction? The codec returns raw `toData`/`fromData` functions, but `Data.withSchema` expects `Schema<A, Data.Data>`. Are we losing Effect's error channel by using synchronous encode/decode? What happens when encoding fails — do we get a useful ParseError or a raw throw?
2. **Question annotation coverage**: Are there real Plutus patterns that CANNOT be expressed via annotations alone? Can a user annotate a `Schema.Class` (Declaration AST)? What about branded types, newtypes, or opaque wrappers?
3. **Type safety audit**: Does `Plutus.data()` return a properly typed `Schema<A, Data.Data>`? Or does it lose type information via `as any` casts? Can users compose `Plutus.data()` schemas with Effect's `Schema.compose`, `Schema.transform`, `Schema.filter`?
4. **Try to break it**: Write adversarial test cases designed to fail:
   - Schema with index signatures (`Record<string, bigint>`)
   - Schema with optional properties (`Schema.optional(...)`)
   - Schema.Class / Schema.TaggedClass as input to `Plutus.data()`
   - Deeply nested transformations (3+ levels of Schema.transform)
   - Union with non-struct members (e.g., `Schema.Union(Schema.BigIntFromSelf, Schema.Boolean)`)
   - Empty union, single-member union
   - Tuple with rest elements (`Schema.Array` inside a tuple)
5. **Compare with Haskell**: Pick 3 complex Plutus types from real contracts and verify the annotation system can express them. If not, document what's missing.
6. **Benchmark against TSchema**: For the same types, measure compilation time and encode/decode throughput. Is the compiler overhead justified?
7. **Review error quality**: Trigger every error path in the compiler. Are the messages actionable? Do they include the AST path?
8. **Fix or document**: For each issue found, either fix the code (with tests) or document it as a known limitation with a clear rationale for why it's acceptable.
**Output**: Adversarial test file + fixes + updated limitations doc, committed locally

### Phase 12+: Continuous Improvement (repeating)
**Status**: pending
**Goal**: Each iteration picks the highest-value improvement from the backlog, implements it, and updates the backlog. This phase repeats indefinitely — it is never marked `done`.
**Backlog** (ordered by priority — work top-down):
1. ~~**Reduce encode/decode overhead**~~ — DONE (moved to Completed Backlog)
2. ~~**Implement flatFields in compiler**~~ — DONE (moved to Completed Backlog)
3. ~~**Schema.Class support**~~ — DONE (moved to Completed Backlog)
4. **Map auto-derivation** — Detect `Schema.Map`/`Schema.MapFromSelf` Declaration nodes and compile them to Plutus Map encoding, eliminating the need for `Plutus.Map()` combinator.
5. **Effect error channel** — Replace raw `toData`/`fromData` throws with `Effect`-based `ParseResult.encode`/`ParseResult.decode` for proper error composition. This would make the compiler produce `Schema.transformOrFail` instead of `Schema.transform`.
6. **Mutual recursion** — Test and support cross-schema cycles (type A → type B → type A) by sharing a memo map across compilations.
7. **Module augmentation for type-safe annotations** — Add `declare module "effect/Schema"` augmentation so that `[ConstrIndexId]` autocompletes in `.annotations()` calls and has the right type.
8. **Documentation** — Write a migration guide showing side-by-side TSchema vs Plutus.data() for each pattern.
**How each iteration works**:
1. Read this backlog
2. Pick the top unfinished item
3. Implement it with tests
4. Commit locally
5. Update the research log
6. Move the completed item to a `## Completed Backlog` section below
7. Stop — wait for next iteration

## Completed Backlog

1. **Reduce encode/decode overhead** — Added `tschemaFastCodec()` fast-path in Transformation handler. Known TSchema types (Boolean, NullOr, UndefinedOr) now use direct codec functions instead of `Schema.encodeSync`/`Schema.decodeSync`. Unknown TSchema transforms still fall back to the slow path. Encode with TSchema.Boolean field now within 3x of pure TSchema (was 5x). 250 tests passing.
2. **Implement flatFields in compiler** — Added `FlatFieldsId` support in TypeLiteral handler + `countStructFields` helper. When a field has `FlatFieldsId: true` (or TSchema's `"TSchema.flatFields": true`), its sub-fields are inlined into the parent Constr during encoding and reconstructed during decoding. Supports multiple flat fields, mixed flat+non-flat, backward compat with TSchema string annotations. 4 new tests, 254 total passing.
3. **Schema.Class support** — Transformation handler now detects `Transformation(from: TypeLiteral, to: Declaration)` pattern (Schema.Class/TaggedClass) and compiles the `from` side (TypeLiteral with struct fields) instead of falling through to passthrough. TaggedClass `_tag` field auto-stripped. 254 tests passing.

## Rules for Loop Execution

1. **One phase per iteration** — complete the current pending phase, update its status to `done`, then stop
2. **Always commit** — after completing a phase, `git add` and `git commit` locally with a descriptive message
3. **Update the log** — append to `research-log.md` after each phase
4. **Use effect-local-source skill** — for ANY Effect source research, invoke this skill FIRST
5. **Annotation-first** — every implementation decision must use Effect's annotation system. If you find yourself writing `switch(ast._tag)` manually, STOP and use `Match<A>` + `getCompiler` instead
6. **Read before writing** — always read current state of tracking files before updating
7. **If stuck** — document what's blocking in the log, mark phase as `blocked`, move to next actionable phase
8. **No manual AST dispatch** — never use `switch(ast._tag)`. Always use `Match<A>` + `getCompiler`
9. **Test each phase** — every phase that produces code must include tests that pass
10. **Candidates stay** — never delete candidate designs from research files, only annotate with winner/loser
