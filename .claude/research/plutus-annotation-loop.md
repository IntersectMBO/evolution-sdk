# Plutus Annotation Cleanup Loop

## Phase System

Read `.loop-phase` to determine the current phase.
If the file doesn't exist, start at Phase 1.
After completing a phase, update `.loop-phase` to the next phase.
After Phase 5, the loop is done — do not cycle.

---

## Every Phase: Non-Negotiable

1. Run `npx turbo run test --filter=@evolution-sdk/evolution -- --run "Plutus"` — must pass before committing
2. Run `npx tsc --noEmit --project packages/evolution/tsconfig.json` — zero errors
3. Log actions to `.loop-log.md` (cycle, phase, action, result, next)
4. Commit locally with descriptive message
5. Update `.loop-phase` to the next phase

---

## Phase 1: Consolidate Tests
Goal: Merge 8 test files into 1 polished test file with clear sections.

1. Read all 8 test files: `PlutusAnnotation.test.ts`, `PlutusCompiler.test.ts`, `PlutusSchema.test.ts`, `PlutusEdgeCases.test.ts`, `PlutusEdgeSweep.test.ts`, `PlutusRealWorld.test.ts`, `PlutusChallenge.test.ts`, `PlutusBenchmark.test.ts`
2. Create `packages/evolution/test/PlutusData.test.ts` (single file) with sections:
   - **Annotations** — attach, read back, convenience helpers, module augmentation
   - **Compiler** — one test per AST handler (BigInt, Boolean, Literal, Declaration, TypeLiteral, Union, TupleType, Suspend, Transformation, Refinement, unsupported types)
   - **Public API** — `Plutus.data()` with structs, unions, options, arrays, maps, recursive types, Schema.Class
   - **Real-world types** — Address, Credential, StakeCredential, Value, CIP68 byte-for-byte CBOR match
   - **Edge cases** — flatFields, nested recursion, mutual recursion, empty structs, tag field handling, Set/Chunk support, unknown Declarations throw
   - **Benchmarks** — hot path profile, realistic workloads (keep `console.log` output for visibility)
3. Remove duplicate/overlapping tests — keep the most thorough version of each
4. Remove tests that only tested removed functions (makeIsData, makeIsDataIndexed, makeEnum) and weren't rewritten to test the annotation approach
5. Delete all 8 old test files
6. Run health check — all tests must pass, zero TS errors
7. If tests pass → update `.loop-phase` to Phase 2
8. If tests fail → fix before proceeding

---

## Phase 2: Polish Production Code
Goal: Ensure production files follow module-export-pattern and are PR-ready.

1. Read `PlutusAnnotation.ts`, `PlutusCompiler.ts`, `PlutusSchema.ts`
2. Verify zero `as any` in all three files (grep to confirm)
3. Verify JSDoc on every export — description, `@since`, `@example` where useful
4. Verify `PlutusCompiler.ts` is marked `@internal` (not exported to users)
5. Check `PlutusAnnotation.ts` module augmentation is correct
6. Remove any dead code, unused imports, stale comments
7. Ensure consistent code style across all three files
8. Run health check
9. If clean → update `.loop-phase` to Phase 3

---

## Phase 3: Wire Exports
Goal: Export PlutusSchema and PlutusAnnotation from the package so users can import them.

1. Read `packages/evolution/src/index.ts` — understand current export structure
2. Read `packages/evolution/package.json` — understand current `exports` map
3. Add exports following the existing pattern:
   - `PlutusSchema` — public API (`Plutus.data()`, `Plutus.codec()`, re-exports)
   - `PlutusAnnotation` — annotation symbols and helpers
   - `PlutusCompiler` — do NOT export (internal implementation detail)
4. Verify imports work: add a quick smoke test that imports from the package path
5. Run `npx turbo run build --filter=@evolution-sdk/evolution` — must succeed
6. Run health check
7. If clean → update `.loop-phase` to Phase 4

---

## Phase 4: Final Review
Goal: Read every changed file as a reviewer would and fix anything that isn't PR-ready.

1. Run `git diff main --stat` to see all changed files
2. For each production file (`PlutusAnnotation.ts`, `PlutusCompiler.ts`, `PlutusSchema.ts`):
   - Read top to bottom — is the code clear to someone seeing it for the first time?
   - Are there any TODO/FIXME/HACK comments that should be resolved?
   - Is the file header comment accurate?
3. For the test file (`PlutusData.test.ts`):
   - Are describe/it names clear and consistent?
   - Are there any tests that test implementation details instead of behavior?
   - Remove benchmark tests if they add noise without value (or move to a separate bench file)
4. For exports (`index.ts`, `package.json`):
   - Do the exports match the module-export-pattern?
   - Is anything exported that shouldn't be?
5. Run full build + test suite (not just Plutus tests — the whole package)
6. Fix any issues found
7. If clean → update `.loop-phase` to Phase 5

---

## Phase 5: PR Prep
Goal: Prepare the branch for a pull request.

1. Run `git log --oneline main..HEAD` — review all commits on this branch
2. Squash or fixup any "research:" commits that aren't relevant to the final PR
3. Write a PR description covering:
   - What: annotation-driven Plutus Data encoding using Effect's `Match<A>` + `getCompiler`
   - Why: standard Effect Schema types instead of TSchema-specific combinators
   - API surface: `Plutus.data()`, `Plutus.codec()`, annotation symbols
   - Test coverage: number of tests, what's covered
   - Breaking changes: none (TSchema still works, this is additive)
4. Verify the branch is up to date with main (rebase if needed)
5. Do NOT push or create the PR — just prepare everything and stop
6. Update `.loop-phase` to `phase: done`
