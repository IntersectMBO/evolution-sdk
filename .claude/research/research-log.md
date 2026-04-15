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
| 10 | Real-World Validation | pending | - | - |

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
