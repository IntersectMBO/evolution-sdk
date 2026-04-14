# Plutus Data Annotation Research Loop

## Goal

Design a TypeScript annotation system using Effect Schema that mirrors Haskell's Plutus data derivation (`makeIsData`, `makeIsDataIndexed`), enabling users to declaratively annotate TypeScript types and automatically derive Plutus Data encoding/decoding. Must handle all Plutus Data constructors, recursive types, nested unions, maps, options, and custom constructor indices.

## Context

- **Codebase**: `evolution-sdk` monorepo, `packages/evolution/src/`
- **Existing**: `TSchema.ts` (~860 lines) provides manual schema combinators (Struct, Union, Variant, Literal, etc.) that transform TS types <-> Plutus Data <-> CBOR
- **Existing**: `Data.ts` defines Plutus Data model: `Constr | Map<Data,Data> | Data[] | bigint | Uint8Array`
- **Effect version**: v3.19.3
- **Effect source clones**: available via `effect-local-source` skill

## Haskell Reference Patterns

```haskell
-- Simple product type
data MyDatum = MyDatum { owner :: PubKeyHash, amount :: Integer }
PlutusTx.unstableMakeIsData ''MyDatum
-- Encodes as: Constr 0 [ownerBytes, amountInt]

-- Sum type with explicit indices
data Credential = PubKeyCredential PubKeyHash | ScriptCredential ScriptHash
PlutusTx.makeIsDataIndexed ''Credential [('PubKeyCredential, 0), ('ScriptCredential, 1)]
-- PubKeyCredential h => Constr 0 [h]
-- ScriptCredential h => Constr 1 [h]

-- Recursive type
data Value = Value (Map CurrencySymbol (Map TokenName Integer))

-- Nested sum in product
data TxOut = TxOut { address :: Address, value :: Value, datum :: OutputDatum }
data OutputDatum = NoOutputDatum | OutputDatumHash DatumHash | OutputDatum Datum
```

## Phases

### Phase 1: Effect Schema Annotation Deep-Dive
**Status**: done
**Goal**: Understand Effect Schema v3 annotation system internals - how annotations attach to AST nodes, how to read/write custom annotations, how `Schema.annotations()` works at the AST level, and what annotation patterns exist in the Effect source.
**Actions**:
1. Use `effect-local-source` skill to access Effect v3 source
2. Read `packages/effect/src/Schema.ts` and `packages/effect/src/SchemaAST.ts` for annotation APIs
3. Find all uses of `.annotations()` and `Annotated` AST node
4. Document: how to attach custom metadata, how to traverse AST and read annotations, limitations
5. Check if Effect has any existing "derive from annotations" patterns (e.g., Equivalence, Arbitrary generation)
**Output**: Write findings to `phase1-effect-annotations.md`

### Phase 2: Catalog All Plutus Data Patterns
**Status**: done
**Goal**: Enumerate every Plutus Data encoding pattern that the annotation system must support.
**Actions**:
1. Read existing `TSchema.ts` combinators and test files to catalog current patterns
2. Read `packages/evolution/src/plutus/` modules for real-world usage
3. Cross-reference with Haskell Plutus Data encoding rules
4. Create exhaustive matrix: TS type shape -> Plutus Data encoding -> CBOR
**Patterns to cover**:
- Simple product (Struct -> Constr N [fields...])
- Sum types / enums (Union -> Constr 0..N)
- Nested products in sums (Variant pattern)
- Recursive types (linked lists, trees)
- Maps (Map<K,V> -> PlutusMap)
- Arrays/Lists (T[] -> PlutusList)
- Options (Maybe/NullOr -> Constr 0 [v] / Constr 1 [])
- Booleans (Constr 0/1 [])
- ByteArrays (raw bytes)
- Integers (bigint)
- Tuples
- Nested structs with flatFields
- Custom constructor indices
- Tag field stripping/injection
**Output**: Write matrix to `phase2-pattern-catalog.md`

### Phase 3: Design Candidates
**Status**: done
**Goal**: Propose 3+ distinct API designs for the annotation system.
**Actions**:
1. Review Phase 1 and Phase 2 outputs
2. Design candidates exploring different approaches:
   - **Candidate A**: Schema.Class + annotation decorators (closest to Haskell deriving)
   - **Candidate B**: Schema.Struct with annotation combinators (functional composition)
   - **Candidate C**: Tagged template / builder pattern
   - **Candidate D**: Hybrid - extend existing TSchema with annotation layer
3. For each candidate, write:
   - Full API surface with examples for EVERY pattern from Phase 2
   - How recursion is handled
   - Type inference quality (does TS infer the right types?)
   - Compatibility with existing `Data.withSchema()`
   - Migration path from current TSchema usage
   - Limitations and tradeoffs
**Output**: Write candidates to `phase3-candidates.md`

### Phase 4: Evaluate & Select Winners
**Status**: pending
**Goal**: Score candidates against criteria and select winner(s).
**Criteria**:
1. Type safety - does TS catch errors at compile time?
2. Ergonomics - how much boilerplate vs Haskell?
3. Completeness - handles ALL patterns from Phase 2?
4. Recursion support - clean recursive type definitions?
5. Compatibility - works with existing Data.withSchema pipeline?
6. Extensibility - easy to add new patterns later?
7. Effect idiom alignment - feels natural in Effect ecosystem?
**Actions**:
1. Score each candidate 1-5 on each criterion
2. Write detailed rationale for scores
3. Select top 1-2 winners
4. If no clear winner, identify what to combine from multiple candidates
**Output**: Write evaluation to `phase4-evaluation.md`

### Phase 5: Prototype Winner
**Status**: pending
**Goal**: Build working proof-of-concept for the winning design.
**Actions**:
1. Create `packages/evolution/src/PlutusSchema.ts` (or similar) with core annotation API
2. Implement support for at least: Struct, Union, recursive types, Option, Map, ByteArray, Integer
3. Write test file proving all Phase 2 patterns work
4. Verify roundtrip: TS value -> Plutus Data -> CBOR -> Plutus Data -> TS value
5. Verify compatibility with `Data.withSchema()`
**Output**: Working code + test file

### Phase 6: Edge Cases & Completeness
**Status**: pending
**Goal**: Handle remaining edge cases and ensure full coverage.
**Actions**:
1. Test deeply nested recursive types (mutual recursion)
2. Test all Option/Nullable combinations
3. Test custom constructor indices in nested unions
4. Test flatFields interop
5. Test tag field auto-detection with annotations
6. Performance: ensure annotation traversal doesn't add runtime overhead
7. Document any patterns that can't be supported and why
**Output**: Updated code + comprehensive tests + limitations doc

## Rules for Loop Execution

1. **One phase per iteration** - complete the current pending phase, update its status to `done`, then stop
2. **Always commit** - after completing a phase, `git add` and `git commit` locally with a descriptive message
3. **Update the log** - append to `research-log.md` after each phase
4. **Candidates stay** - never delete candidate designs, only annotate with winner/loser
5. **If stuck** - document what's blocking in the log, mark phase as `blocked`, move to next actionable phase
6. **Read before writing** - always read current state of tracking files before updating
7. **Use effect-local-source skill** - for any Effect source research
