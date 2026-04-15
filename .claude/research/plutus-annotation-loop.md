# Plutus Data Annotation Research Loop

## Phase System

Read `.loop-phase` to determine the current phase.
If the file doesn't exist, start at Phase 1.
After completing a phase, update `.loop-phase` to the next phase.
After the last numbered phase, enter Phase 12 (Continuous Improvement) and increment cycle count.

---

## Goal

Design a TypeScript annotation system using Effect Schema that mirrors Haskell's Plutus data derivation (`makeIsData`, `makeIsDataIndexed`), enabling users to declaratively annotate TypeScript types and automatically derive Plutus Data encoding/decoding.

**Implementation constraint**: Uses Effect Schema's annotation system (`Schema.annotations()`, custom `Symbol.for()` keys, `AST.Match<A>` + `AST.getCompiler` pattern). See `PlutusCompiler.ts` for the working implementation.

## Context

- **Codebase**: `evolution-sdk` monorepo, `packages/evolution/src/`
- **Key files**: `PlutusCompiler.ts` (AST compiler), `PlutusSchema.ts` (public API), `PlutusAnnotation.ts` (annotation symbols)
- **Existing**: `TSchema.ts` provides manual schema combinators, `Data.ts` defines Plutus Data model
- **Effect version**: v3.19.3
- **Effect source clones**: available via `effect-local-source` skill — USE THIS for all Effect source research

---

## Every Phase: Non-Negotiable

1. Run `npx turbo run test --filter=@evolution-sdk/evolution -- --run "Plutus"` — must pass before committing
2. Run `npx tsc --noEmit --project packages/evolution/tsconfig.json` — must have zero errors
3. Log actions to `research-log.md` (structured entry: cycle, phase, action, result, next)
4. Commit locally with descriptive message
5. Update `.loop-phase` to the next phase

---

## Phase 1: Effect Schema Annotation Deep-Dive
**Status**: done | **Output**: `phase1-effect-annotations.md`

## Phase 2: Catalog All Plutus Data Patterns
**Status**: done | **Output**: `phase2-pattern-catalog.md`

## Phase 3: Design Candidates
**Status**: done | **Output**: `phase3-candidates.md`

## Phase 4: Evaluate & Select Winners
**Status**: done | **Output**: `phase4-evaluation.md`

## Phase 5: Study Effect's Real AST Compiler Implementations
**Status**: done | **Output**: `phase5-ast-compiler-study.md`

## Phase 6: Define Plutus Annotation Symbols
**Status**: done | **Output**: `PlutusAnnotation.ts` + tests

## Phase 7: Build the AST Compiler (Match<PlutusCodec>)
**Status**: done | **Output**: `PlutusCompiler.ts` + tests

## Phase 8: Plutus.data() and Public API
**Status**: done | **Output**: `PlutusSchema.ts` + tests

## Phase 9: Edge Cases & Completeness
**Status**: done | **Output**: Edge case tests + `phase9-limitations.md`

## Phase 10: Real-World Validation
**Status**: done | **Output**: Real-world tests + `migration-guide.md`

## Phase 11: Challenge the Implementation
**Status**: done | **Output**: Adversarial tests + fixes

---

## Phase 12: Continuous Improvement (repeating)

Goal: Pick the highest-value improvement from the backlog, implement it with tests, and update the backlog.

### Backlog (work top-down)

_(Empty — all items completed or dropped. See Completed Backlog below.)_

### When Backlog is Empty: Watchdog Mode

If the backlog has no unfinished items, run watchdog checks instead of reporting "nothing to do":

1. **Regression scan**: Run full test suite. If anything fails, fix it.
2. **Effect version check**: Has Effect released a new version? Check if `SchemaAST.Match`, `getCompiler`, or `getAnnotation` APIs changed. If so, add a backlog item to update.
3. **Coverage gap scan**: Read `PlutusCompiler.ts` and count how many AST handlers use `go(ast.to, path)` or `go(ast.from, path)` as pass-through. For each, ask: "could this silently produce wrong output?" If yes, add a backlog item.
4. **External research** (Rule 11): Search for how other Cardano libraries handle Plutus Data encoding. Check Aiken, Lucid, Mesh, Blaze for patterns we haven't considered. Log findings even if no immediate action.
5. If all checks pass and nothing found → log "watchdog: all clear" and stop.

### How Each Iteration Works

1. Read `.loop-phase` — if not Phase 12, execute that phase instead
2. Read this backlog
3. If unfinished items exist → pick the top one, implement with tests, commit, move to Completed Backlog
4. If backlog is empty → run Watchdog Mode checks above
5. Update `research-log.md` with structured entry
6. Update `.loop-phase` (increment cycle if watchdog, stay at Phase 12)
7. Stop — wait for next iteration

### Transition Rules

- If a backlog item requires research → use `effect-local-source` skill first
- If a backlog item is blocked → mark as `BLOCKED: [reason]`, skip to next item
- If watchdog finds a regression → fix it immediately, don't add to backlog
- If watchdog finds an API change → add backlog item, don't fix in watchdog cycle
- If user adds a new backlog item between iterations → it appears at the priority they placed it

---

## Completed Backlog

| # | Item | Result |
|---|------|--------|
| 1 | Reduce encode/decode overhead | TSchema fast-path codecs for Boolean, NullOr, UndefinedOr |
| 2 | Implement flatFields | FlatFieldsId annotation + countStructFields helper |
| 3 | Schema.Class support | Compile from-side TypeLiteral for Transformation→Declaration |
| 4 | Map auto-derivation | Detect Map/HashMap/ReadonlyMap via Description prefix |
| 5 | Effect error channel | DEFERRED — raw throws caught by Data.withSchema, acceptable |
| 6 | Mutual recursion | Already works via memoizeThunk + Schema.suspend |
| 7 | Module augmentation | declare module "effect/SchemaAST" for typed annotations |
| 8 | Documentation | Migration guide: TSchema vs Plutus.data() for all patterns |
| 9 | Eliminate `as any` (prod) | 14→0 using discriminated union narrowing |
| 10 | Eliminate `as any` (tests) | 31→2 using explicit encoded type in suspend thunks |
| 11 | Edge case sweep | 30 tests, zero bugs found |
| 12 | Fix silent passthrough | Unknown Declarations throw, added Set/List/Chunk/HashMap support |
| 13 | Benchmark improvements | Plutus.data() at parity with TSchema (1.0x), Address 0.7x faster |
| 14 | Enum shorthand | Plutus.makeEnum("A", "B", "C") with auto indices |
| 15 | Newtype flattening | DROPPED — use raw schema directly |
| 16 | Auto-index sum types | DROPPED — explicit indices safer than implicit key order |

**Total**: 312 tests across 13 files, zero `as any` in production code, zero TypeScript errors.

---

## Rules for Loop Execution

1. **One phase per iteration** — complete the current pending phase, then stop
2. **Health check first** — run tests + tsc before committing (see "Every Phase: Non-Negotiable")
3. **Always commit** — `git add` + `git commit` locally with descriptive message after each phase
4. **Update the log** — structured entry in `research-log.md` (cycle, phase, action, result, next)
5. **Use effect-local-source skill** — for ANY Effect source research, invoke this skill FIRST
6. **Annotation-first** — use Effect's annotation system, never manual `switch(ast._tag)`
7. **Read before writing** — always read current state of tracking files before updating
8. **If stuck** — document what's blocking in the log, mark phase as `blocked`, skip to next
9. **Test each phase** — every phase that produces code must include passing tests
10. **No `as any`** — production: zero. Tests: only for intentional wrong-type error tests
11. **No convenience wrappers** — users compose from primitives (`data()`, `makeIsDataIndexed`, annotations)
12. **Draft before commit** — exploratory work goes in `_candidate-*.ts` files, promoted or discarded in the next phase
