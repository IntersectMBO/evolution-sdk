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
| 2 | Catalog All Plutus Data Patterns | pending | - | - |
| 3 | Design Candidates | pending | - | - |
| 4 | Evaluate & Select Winners | pending | - | - |
| 5 | Prototype Winner | pending | - | - |
| 6 | Edge Cases & Completeness | pending | - | - |

## Candidates Tracker

| ID | Name | Status | Phase Introduced | Notes |
|----|------|--------|-----------------|-------|
| - | - | - | - | (none yet) |
