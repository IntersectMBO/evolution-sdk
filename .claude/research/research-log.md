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

## Phase Status Tracker

| Phase | Name | Status | Started | Completed |
|-------|------|--------|---------|-----------|
| 1 | Effect Schema Annotation Deep-Dive | done | 2026-04-14 | 2026-04-14 |
| 2 | Catalog All Plutus Data Patterns | done | 2026-04-14 | 2026-04-14 |
| 3 | Design Candidates | done | 2026-04-14 | 2026-04-14 |
| 4 | Evaluate & Select Winners | pending | - | - |
| 5 | Prototype Winner | pending | - | - |
| 6 | Edge Cases & Completeness | pending | - | - |

### 2026-04-14 — Phase 2 Complete: Pattern Catalog
- Cataloged 33 distinct patterns across 8 categories
- Key categories: 4 primitives, 3 collections, 8 struct variants, 6 union variants, 2 nullable, 3 literal, 3 recursive, 4 composition
- Documented real-world compositions: Address, Value, CIP68Metadata, MultisigScript
- Validation rules: tag uniqueness, index collision detection, field order preservation
- Output: `phase2-pattern-catalog.md`

### 2026-04-14 — Phase 3 Complete: Design Candidates
- 4 candidates designed with full API examples for all pattern categories
- **A: Annotation-Driven** — pure Effect annotations + AST compiler
- **B: Fluent Builder** — thin Plutus-domain wrapper over TSchema
- **C: Schema.Class Protocol** — Haskell-like class instances
- **D: Hybrid** — annotated Effect Schema + derive layer, coexists with TSchema
- Preliminary scoring favors D (Hybrid) on most criteria
- Output: `phase3-candidates.md`

## Candidates Tracker

| ID | Name | Status | Phase Introduced | Notes |
|----|------|--------|-----------------|-------|
| A | Annotation-Driven (AST Compiler) | candidate | Phase 3 | Pure Effect annotations + Match<A> compiler |
| B | Fluent Builder | candidate | Phase 3 | Thin wrapper, Plutus vocabulary |
| C | Schema.Class Protocol | candidate | Phase 3 | Haskell-like, class-per-constructor |
| D | Hybrid (Annotated TSchema + Derive) | candidate | Phase 3 | Best of both, type inference, non-breaking |
