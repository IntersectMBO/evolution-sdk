# Plutus Annotation Research Log

## Session Log

### 2026-04-14 — Project Initialized
- Created research loop instruction file: `plutus-annotation-loop.md`
- Created this log file
- Phases defined: 6 total (annotation deep-dive -> catalog -> candidates -> evaluate -> prototype -> edge cases)
- Current TSchema.ts analyzed: 860 lines, covers Struct/Union/Variant/Literal/Map/NullOr/Boolean/etc.
- Existing Plutus modules: Address, Credential, Value, OutputReference, CIP68Metadata
- All use manual TSchema combinators — goal is to add declarative annotation layer on top

### 2026-04-14 — Phase 1 Complete: Effect Schema Annotation Deep-Dive
- **Key discovery**: `Match<A>` + `getCompiler()` is the canonical Effect pattern for AST-driven derivation
- Annotations attach to every AST node via `Annotated` interface, custom symbols via `Symbol.for()`
- TSchema already uses string-key annotations (`TSchema.customIndex`, `TSchema.flatInUnion`, `TSchema.flatFields`)
- Three derivation patterns found: AST Compiler, Two-Phase (Description→Output), Annotation Hook
- `Schema.suspend` handles recursion with memoized thunks
- Module augmentation enables type-safe custom annotations
- **Implication**: Can build Plutus derivation as `Match<PlutusEncoder>` that walks annotated Effect schemas
- Output: `phase1-effect-annotations.md`

### 2026-04-14 — Loop Instruction Rewritten (Phases 5-10)
- Old phases 5-6 scrapped — prototype was wrong (manual `switch(ast._tag)` instead of annotations)
- Current `PlutusSchema.ts` copies TSchema pattern, does NOT use Effect's annotation system
- New phases 5-10 designed to properly use `Match<A>` + `getCompiler` + custom annotation symbols
- Phase 5: study real Effect compiler impls (Pretty, Arbitrary, Equivalence)
- Phase 6: define Plutus annotation symbols
- Phase 7: build AST compiler (`Match<PlutusCodec>`)
- Phase 8: public API (`Plutus.data()`, `Plutus.makeIsData()`, etc.)
- Phase 9: edge cases & completeness
- Phase 10: real-world validation (Address, Credential, Value, CIP68)

## Phase Status Tracker

| Phase | Name | Status | Started | Completed |
|-------|------|--------|---------|-----------|
| 1 | Effect Schema Annotation Deep-Dive | done | 2026-04-14 | 2026-04-14 |
| 2 | Catalog All Plutus Data Patterns | done | 2026-04-14 | 2026-04-14 |
| 3 | Design Candidates | done | 2026-04-14 | 2026-04-14 |
| 4 | Evaluate & Select Winners | done | 2026-04-14 | 2026-04-14 |
| 5 | Study Effect AST Compiler Impls | done | 2026-04-15 | 2026-04-15 |
| 6 | Define Plutus Annotation Symbols | done | 2026-04-15 | 2026-04-15 |
| 7 | Build AST Compiler (Match<PlutusCodec>) | done | 2026-04-15 | 2026-04-15 |
| 8 | Plutus.data() Public API | done | 2026-04-15 | 2026-04-15 |
| 9 | Edge Cases & Completeness | done | 2026-04-15 | 2026-04-15 |
| 10 | Real-World Validation | done | 2026-04-15 | 2026-04-15 |
| 11 | Challenge the Implementation | done | 2026-04-15 | 2026-04-15 |
| 12+ | Continuous Improvement | pending | - | repeating |

### 2026-04-14 — Phase 2 Complete: Pattern Catalog
- Cataloged 33 distinct patterns across 8 categories
- Key categories: 4 primitives, 3 collections, 8 struct variants, 6 union variants, 2 nullable, 3 literal, 3 recursive, 4 composition
- Documented real-world compositions: Address, Value, CIP68Metadata, MultisigScript
- Validation rules: tag uniqueness, index collision detection, field order preservation
- Output: `phase2-pattern-catalog.md`

### 2026-04-14 — Phase 4 Complete: Evaluation & Selection
- **Winner: Candidate D (Hybrid)** — weighted score 48.5/50
- Runner-up: A (Annotation-Driven) at 39.5
- Rejected: B (37.5), C (33.5)
- Key winning factors: non-breaking migration, dual-path (TSchema + Plutus.data), type inference, Effect-native
- A's AST compiler pattern incorporated as D's implementation strategy
- Implementation plan: Plutus.data() + variant() + option() + codec(), AST compiler internally
- Output: `phase4-evaluation.md`

### 2026-04-14 — Phase 3 Complete: Design Candidates
- 4 candidates designed with full API examples for all pattern categories
- **A: Annotation-Driven** — pure Effect annotations + AST compiler
- **B: Fluent Builder** — thin Plutus-domain wrapper over TSchema
- **C: Schema.Class Protocol** — Haskell-like class instances
- **D: Hybrid** — annotated Effect Schema + derive layer, coexists with TSchema
- Preliminary scoring favors D (Hybrid) on most criteria
- Output: `phase3-candidates.md`

### 2026-04-15 — Phase 5 Complete: AST Compiler Study
- Read Pretty.ts (205 lines) — canonical single-phase `Match<A>` + `getCompiler` example
- Read Arbitrary.ts (1101 lines) — two-phase approach (Description → LazyArbitrary) for constraint accumulation
- Read Schema.equivalence() — older manual `switch(ast._tag)` pattern, same principles
- Read SchemaAST.ts — `Match<A>`, `Compiler<A>`, `getCompiler`, `getAnnotation` types
- Read memoizeThunk implementation — simple closure memoization for Suspend recursion breaking
- **Key decision**: Use Pretty.ts single-phase pattern (not Arbitrary's two-phase). Plutus encoding doesn't accumulate constraints.
- **22 AST tags** must be covered — Match enforces exhaustiveness at compile time
- **Pattern**: annotation-first in every handler, structural fallback, memoizeThunk for Suspend, look-through for Transformation/Refinement
- Output: `phase5-ast-compiler-study.md`

### 2026-04-15 — Phase 12+ Iteration 7: Module augmentation
- **Backlog item**: Symbol annotation keys didn't autocomplete in `.annotations()` calls
- **Fix**: Added `declare module "effect/SchemaAST"` augmentation extending the `Annotations` interface with all 5 Plutus annotation symbols and their correct value types
- **TypeScript compilation**: Clean (no errors)
- 1 new test verifying all 5 annotations flow through augmented interface
- 262 total tests passing

### 2026-04-15 — Phase 12+ Iterations 5-6: Effect error channel + Mutual recursion
- **Effect error channel**: DEFERRED — raw throws already caught by `Schema.encodeSync` in `Data.withSchema` → users get `ParseError`. Converting 22 handlers to Effect would be massive churn for marginal benefit.
- **Mutual recursion**: Already works via `memoizeThunk` + `Schema.suspend`. Tested Expr/BinOp pattern and A→B→A separate schemas with CBOR roundtrip. 2 new tests, 261 total.
- **Phase 9 limitation removed**: mutual recursion is no longer a limitation

### 2026-04-15 — Phase 12+ Iteration 4: Map auto-derivation
- **Backlog item**: Map required `Plutus.Map()` combinator — couldn't use `Schema.MapFromSelf` with `Plutus.data()`
- **Fix**: Declaration handler detects Map via Description annotation ("Map<...") + 2 typeParameters. Recursively compiles key/value codecs.
- **Schema.Map** (Transformation wrapper) handled automatically via existing `go(ast.to, path)` fallback → hits Declaration → Map detected
- **Tests**: MapFromSelf, Schema.Map, CBOR match with TSchema.Map, nested maps (Value pattern), Map in struct field
- 259 total tests passing
- **Phase 9 limitation removed**: Map is no longer a limitation

### 2026-04-15 — Phase 12+ Iteration 3: Schema.Class support
- **Backlog item**: Schema.Class/TaggedClass passed through as opaque (Declaration → passthrough)
- **Root cause**: Transformation handler's fallback `go(ast.to, path)` hit the Declaration handler which returned passthrough
- **Fix**: Detect `Transformation(from: TypeLiteral, to: Declaration)` pattern and compile `ast.from` instead — the TypeLiteral has the struct fields
- **TaggedClass**: `_tag` field auto-stripped by existing tag detection in TypeLiteral handler
- **Tests updated**: Challenge tests now verify Schema.Class encodes as Constr with correct fields
- 254 total tests passing
- **Phase 9 limitation removed**: Schema.Class is no longer a limitation

### 2026-04-15 — Phase 12+ Iteration 2: Implement flatFields in compiler
- **Backlog item**: flatFields — FlatFieldsId annotation was defined but compiler ignored it
- **Implementation**: TypeLiteral handler now checks `FlatFieldsId` (and TSchema `"TSchema.flatFields"`) on each field's AST. `countStructFields()` helper counts non-tag fields in a struct AST for decoding.
- **Encoding**: when flat field produces a Constr, spreads its fields into parent
- **Decoding**: slices the right number of parent fields, reconstructs inner Constr, delegates to inner codec
- **Tests**: 4 new tests — basic flat, multiple flat structs, mixed flat+non-flat, TSchema backward compat
- 254 total tests passing
- **Phase 9 limitation removed**: flatFields is no longer a limitation

### 2026-04-15 — Phase 12+ Iteration 1: Reduce encode/decode overhead
- **Backlog item**: Reduce encode/decode overhead (was up to 5x slower than TSchema)
- **Root cause**: Transformation handler used `Schema.encodeSync`/`Schema.decodeSync` for ALL TSchema fields — runs full Effect pipeline on every encode/decode
- **Fix**: Added `tschemaFastCodec()` function that recognizes known TSchema identifiers (Boolean, NullOr, UndefinedOr) and returns direct codec functions, bypassing Schema.encodeSync entirely
- **Result**: TSchema.Boolean field encode now within 3x of pure TSchema (was 5x). Unknown TSchema transforms still fall back to slow path.
- 250 tests passing (36 challenge tests including new benchmark)

### 2026-04-15 — Phase 11 Complete: Challenge the Implementation
- 35 adversarial tests — all passing
- **Bug found and fixed**: Schema.Record silently produced empty Constr → now throws descriptive error
- **Compiler pattern validated**: Match<PlutusCodec> + getCompiler is sound, exhaustive, deterministic
- **Error channel acceptable**: Raw throws in codec, but Data.withSchema wraps into ParseError for users
- **Type safety confirmed**: Plutus.data() returns Schema<A, Data.Data>, composes with Schema.encodeSync
- **Schema.Class/TaggedClass**: Pass through as opaque — documented as limitation (use Schema.Struct)
- **Branded types**: Work transparently via Refinement look-through
- **Complex Haskell types proven**: TxInfo (nested struct+union+option), ScriptContext (4-variant sum with nested struct), NativeScript (6-variant recursive sum) — all roundtrip correctly
- **Benchmarks**: Plutus.data() compilation within 10x of TSchema construction; encode/decode within 5x — acceptable for the flexibility gained
- **Error quality**: All error paths tested — messages include path, type name, and actionable suggestions
- **All 249 tests passing** across 11 test files

### 2026-04-15 — Phase 10 Complete: Real-World Validation
- Re-implemented OutputReference, Credential, StakeCredential, Address using Plutus.data()
- **Byte-for-byte CBOR match** with existing TSchema versions for all types tested
- Value confirmed as Map limitation — use Plutus.Map() directly (CBOR also matches)
- CIP68Metadata re-implemented using Plutus.makeIsData with Schema.Unknown for opaque Data fields
- Migration patterns documented: TSchema.ByteArray→Uint8Array, TSchema.Variant→makeIsDataIndexed, etc.
- API style difference: Variant uses `{Name: {fields}}`, makeIsDataIndexed uses `{_tag: "Name", ...fields}`
- 26 tests — all passing
- **ALL 10 PHASES COMPLETE**
- Total new test count: 15 + 25 + 24 + 27 + 26 = 117 new tests across 5 test files

### 2026-04-15 — Phase 9 Complete: Edge Cases & Completeness
- 27 edge case tests — all passing
- Binary tree recursion (6 nodes), 10-level linked list
- Nested options, Option(Boolean), Option(Array), UndefinedOr
- Non-sequential constructor indices (0, 5, 10)
- Tag field auto-detection for _tag, type; disable with tagField:false
- TSchema field mixing: Boolean, Integer, ByteArray, NullOr all work inside Plutus.data()
- Complex compositions: array of structs, struct with array, heterogeneous tuples, empty structs
- Performance: 100 compilations < 100ms, 1000 roundtrips < 100ms
- Limitations documented: Map (use TSchema.Map), flatFields (not yet compiled), mutual recursion (untested), TS enums (unsupported)
- Output: `packages/evolution/test/PlutusEdgeCases.test.ts` + `phase9-limitations.md`

### 2026-04-15 — Phase 8 Complete: Plutus.data() Public API
- Created `PlutusSchema.ts` — public API wiring the AST compiler into Schema transforms
- `Plutus.data(schema, options?)` — annotate + compile any Effect Schema → `Schema<A, Data.Data>`
- `Plutus.makeIsData(fields, options?)` — Haskell `unstableMakeIsData` equivalent
- `Plutus.makeIsDataIndexed(variants, indices)` — Haskell `makeIsDataIndexed` equivalent
- `Plutus.codec(schema)` — wraps `Data.withSchema()` for CBOR roundtrip
- Re-exports: `ByteArray`, `Integer`, `Boolean`, `Map`, `List`, `Tuple`, `Literal`, `Variant`
- Annotation re-exports: `ConstrIndexId`, `FlatInUnionId`, convenience helpers
- Fixed TSchema interop: Transformation handler now uses `Schema.encodeSync/decodeSync` for TSchema nodes
- 24 PlutusSchema tests + 25 PlutusCompiler + 15 PlutusAnnotation = 64 new tests, all passing
- All 161 tests in evolution package pass (including existing plutus module tests)

### 2026-04-15 — Phase 7 Complete: AST Compiler (Match<PlutusCodec>)
- Created `PlutusCompiler.ts` using `SchemaAST.Match<PlutusCodec>` + `SchemaAST.getCompiler(match)`
- Follows Pretty.ts single-phase pattern exactly
- All 22 AST tags handled: primitives, struct, union, array/tuple, suspend, transformation, refinement, unsupported
- Annotation-first in TypeLiteral (ConstrIndex) and Union (ConstrIndex, FlatInUnion)
- Suspend uses memoizeThunk for recursion breaking
- Transformation: passes through TSchema-annotated nodes, looks through others to `ast.to`
- NullOr/UndefinedOr auto-detection in Union handler
- Tag field auto-detection and stripping in TypeLiteral handler
- 25 tests — all passing
- Output: `packages/evolution/src/PlutusCompiler.ts` + `packages/evolution/test/PlutusCompiler.test.ts`

### 2026-04-15 — Phase 6 Complete: Plutus Annotation Symbols
- Created `PlutusAnnotation.ts` with 5 annotation symbols following Effect conventions
- Symbols: `ConstrIndexId`, `EncodingId`, `FlatInUnionId`, `FlatFieldsId`, `TagFieldId`
- All use `Symbol.for("plutus/annotation/...")` — globally unique, namespaced
- Curried getters via `SchemaAST.getAnnotation<T>(symbolId)` — matches Effect pattern
- Convenience helpers: `constrIndex(n)`, `encoding(s)`, `flatInUnion()`, `flatFields()`, `tagField(name)`
- 15 tests — all passing: symbol identity, attach+read, missing=None, multiple annotations, convenience helpers
- Output: `packages/evolution/src/PlutusAnnotation.ts` + `packages/evolution/test/PlutusAnnotation.test.ts`

## Candidates Tracker

| ID | Name | Status | Phase Introduced | Notes |
|----|------|--------|-----------------|-------|
| A | Annotation-Driven (AST Compiler) | runner-up | Phase 3 | Score 39.5 — strong extensibility, verbose annotations |
| B | Fluent Builder | rejected | Phase 3 | Score 37.5 — renamed TSchema, low Effect alignment |
| C | Schema.Class Protocol | rejected | Phase 3 | Score 33.5 — heavyweight, weak completeness/migration |
| D | Hybrid (Annotated TSchema + Derive) | **WINNER** | Phase 3 | Score 48.5 — non-breaking, dual-path, type inference |
