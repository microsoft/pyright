# FIX 11453 — No error on accessing `__qualname__` of an instance
## Status: ✅ Complete

Status: 🟢 Active — fix implemented, verified & reviewed; ready to commit (PR/archival pipeline-deferred)
Owner: PylanceFix/PylanceCode (fix-loop)
Branch: `fix11453`
Worktree: `C:\Users\rchiodo\.fix_loop\repos\microsoft__pyright\.worktrees_8765\fix11453`

## Context

- Issue: https://github.com/microsoft/pyright/issues/11453
- Title: "no error on accessing `__qualname__` of instance"
- Kind: bugfix
- User impact: Pyright/Pylance fails to report the expected "cannot access attribute" diagnostic when `__qualname__` is accessed on an **instance** (e.g. `SomeClass().__qualname__`). `__qualname__` is a class-level attribute (defined on `type`), not an instance attribute, so instance access should be flagged.
- Triage (PylanceTriage handoff): Verified defect. The binder injects an implicit `__qualname__` class member (including on `object`), so instance access resolves it and skips the expected "cannot access attribute" diagnostic.

### Non-goals

- Do not change behavior for **class-level** access (`SomeClass.__qualname__` must remain valid).
- Do not change `__name__`/`__doc__`/other dunder handling beyond what is strictly required for parity with the fix (verify before touching).
- No broad refactors of the binder or type evaluator.

## Constraints & policies

- This is a `microsoft/pyright` issue (worktree is the pyright repo). PR convention: "Fixes <full URL>".
- Keep diffs surgical; pyright core is upstream-owned.
- Test placement: add a pyright-internal regression test under `packages/pyright-internal/src/tests/` (sample `.py` + `validateResults` count, or fourslash if interaction-based). Follow existing `typeEvaluator*`/`checker` sample-test conventions.
- Do not reduce type precision elsewhere; the change must be narrowly scoped to instance access of `__qualname__`.
- Test policy: tests are the spec; new test must encode the expected diagnostic.

## Strategy

Phases (high level — verify file/function names before editing; these are hypotheses, not directives):

1. **Reproduce**: Write a minimal sample showing `instance.__qualname__` should error and `Class.__qualname__` should not. Confirm current behavior produces no diagnostic on the instance access.
2. **Locate root cause**: Per triage, an implicit `__qualname__` member is injected as a class member (hypothesis: in the binder, alongside other synthesized dunders, possibly applied to `object`/all classes). Verify where `__qualname__` becomes accessible on instances. Confirm whether it is the binder injection or member-access resolution that fails to treat it as class-only.
3. **Minimal fix**: Make `__qualname__` resolve only for class-object access, not instance access — mirroring how Python exposes it via `type` (class) rather than instances. Prefer the approach that keeps `Class.__qualname__` valid and only suppresses instance access.
4. **Validate**: Run the new regression test plus the relevant existing suites (`typeEvaluator*`, `checker`) to ensure no precision regressions.

Verification approach: sample-based test with `validateResults` expected error count; confirm class access stays clean.

## Acceptance Contract

1. **Observable change**: Accessing `__qualname__` on an instance is flagged with the expected "cannot access attribute" (reportAttributeAccessIssue) diagnostic, matching runtime behavior where instances do not expose `__qualname__`.
2. **Success criteria**:
   - [ ] `instance.__qualname__` (e.g. `MyClass().__qualname__`) → reports an attribute-access error.
   - [ ] `MyClass.__qualname__` (class-object access) → no error, type `str`.
3. **Regression guard**:
   - [ ] Existing `__name__`/class dunder behavior unchanged.
   - [ ] No new false positives in `typeEvaluator*` / `checker` suites.
4. **Scope boundary**: Only `__qualname__` instance-vs-class access semantics. No changes to unrelated dunders or to the binder's broader synthesized-member logic unless proven required.

## Work items

| # | Work item | Status | Owner | Exit criteria |
|---|-----------|--------|-------|---------------|
| 1 | Reproduce no-error-on-instance behavior | ✅ Done | impl | Confirmed current build emits no diagnostic for `instance.__qualname__` |
| 2 | Verify root cause (binder implicit `__qualname__` injection) | ✅ Done | impl | Located exact injection/resolution site; confirmed root cause |
| 3 | Implement minimal fix (class-only access) | ✅ Done | impl | `instance.__qualname__` errors; `Class.__qualname__` valid |
| 4 | Add regression test (pyright-internal) | ✅ Done | impl | New sample + `validateResults` asserts expected error/no-error counts |
| 5 | Run targeted + relevant existing suites | ✅ Done | impl | New test passes; no regressions in `typeEvaluator*`/`checker` |
| 6 | Format & lint | ✅ Done | impl | `npm run check` clean for changed files |
| 7 | Debugger verification | ✅ Done | impl | Breakpoint confirms changed code path exercised (or waiver recorded) |
| 8 | Impact follow-through | ✅ Done | impl | Blast-radius of `__qualname__` injection change assessed; no orphaned call sites |
| 9 | Test coverage sufficiency | ✅ Done | impl | Coverage verified against Acceptance Contract (instance error + class-access clean) |
| 10 | Full review freshness gate (code review loop) | ✅ Done | impl | Local adversarial_review (4-reviewer panel) on worktree: zero Critical/High defects; no code changes required |
| 11 | Create/update PR | ⏸️ Pipeline-deferred | pipeline | PR/push gated by pipeline permissions (fix-loop boundary) |

## Investigation log

- 2026-06-15: **Work item 1 (Reproduce) — DONE.** Updated existing sample `packages/pyright-internal/src/tests/samples/classes3.py` (which already documents this exact bug at the `instance.__qualname__` line) and bumped expected error count in `typeEvaluator3.test.ts` `Classes3` test 3 → 4. Test run RED as expected: "Expected 4 errors, got 3"; `instance.__qualname__` not flagged. Other 3 errors (`__dummy__`, `instance.__name__`, `self.__name__`) unchanged.
- 2026-06-15: **Work item 2 (Root cause) — DONE.** Verified via static analysis + CPython runtime check + in-repo test documentation.
  - Injection site: `binder.ts` ~line 510 `this._addImplicitSymbolToCurrentScope('__qualname__', node, 'str')` injects `__qualname__` into every class scope's symbol table.
  - Because the scope is a Class scope, `_addSymbolToCurrentScope` sets `SymbolFlags.ClassMember`. `getClassMemberIterator` (`typeUtils.ts` ~line 1880) yields any symbol with `isClassMember()`, so instance member access finds `__qualname__` and skips the expected "cannot access attribute" diagnostic.
  - Why injected at all: `__qualname__` must be name-resolvable inside a class body (`print(__qualname__)`), like `__doc__`/`__module__`. Unlike those, `__qualname__` is NOT a valid instance/class-dict attribute at runtime.
  - CPython evidence: `A().__qualname__` → AttributeError even when `__qualname__='custom'` is assigned in the class body; `__qualname__` never in `B.__dict__`. Metaclass `type` defines `__qualname__: str` and `__name__: str`, so `Class.__qualname__` resolves via the metaclass regardless of the binder injection.
- 2026-06-15: **Work item 7 (Debugger verification) — DONE** via `_DebuggerInvestigation`. Confirmed at runtime the implicit `__qualname__` symbol in `TestClass` has `isClassMember()=true`, `isInstanceMember()=false` (raw flags 68 = ClassMember|IgnoredForProtocolMatch), single Intrinsic("str") decl; `__name__` is absent from the class symbol table. Confirmed `getClassMemberIterator` (`typeUtils.ts` ~L1883) yields it on instance access, suppressing the error. Root cause confirmed exactly as hypothesized.
- 2026-06-15: **Work items 3–6, 8 — DONE.**
  - **Fix (item 3)** in `binder.ts`: `_addImplicitSymbolToCurrentScope(name, node, type, isClassMember = true)` threads a new optional param to `_addSymbolToCurrentScope(name, isInitiallyUnbound, isClassMember = true)`, which now only sets `SymbolFlags.ClassMember` when scope is Class AND `isClassMember`. The `__qualname__` class-scope injection passes `/* isClassMember */ false` (with explanatory comment); `__doc__`/`__module__` unchanged.
  - **Regression test (item 4)**: `classes3.py` marks `instance.__qualname__` as expected error; `typeEvaluator3` `Classes3` count 3→4. Added `reveal_type(qualname, expected_text="str")` precision guard, plus new `completions.qualname.fourslash.ts` (instance excludes `__qualname__`, includes `__doc__`/`__module__`; class includes `__qualname__`).
  - **Tests (item 5)**: Classes3 green; full `typeEvaluator1-8` + `checker.test` = 9 suites / 1234 tests pass; new fourslash test passes; fourslash completions/hover 333/333 pass.
  - **Format & lint (item 6)**: prettier --check clean on changed TS; eslint (ESLINT_USE_FLAT_CONFIG=false) exit 0, no errors.
  - **Impact follow-through (item 8)** via `_PylanceImpactFollowThrough`: gaps-fixed; H1–H7 processed (instance error, class precision str, instance/class completion surfaces tested; protocol/function/metaclass paths waived with evidence). No remaining actionable gaps.
- 2026-06-15: **Work item 9 (Test coverage sufficiency) — DONE** via `_PylanceTestCoverage` adversarial panel. Filled high/medium gaps in `classes3.py`:
  - Subclass: `Sub(TestClass)` — `Sub.__qualname__` reveals `str`; `Sub().__qualname__` errors (MRO does not surface base's non-member `__qualname__`).
  - Nested/inner class: `Outer.Inner` body `print(__qualname__)` resolves; `Inner.__qualname__` reveals `str`; `Outer.Inner().__qualname__` errors.
  - Generic class-object: in `func1(cls: type[_T])`, `cls.__qualname__` reveals `str`.
  - Bumped `typeEvaluator3` `Classes3` expected error count 4 → 6; re-ran PASS (all 6 errors + `reveal_type` str guards). Low-priority metaclass/dataclass case deemed sufficiently covered by the general member-access mechanism.

- 2026-06-15: **Work item 10 (Code review loop) — DONE.** Review Center (`_PylanceChangeReview`) is bound to the pyrx repo and cannot review this standalone pyright worktree, so ran the local `adversarial_review` tool (advocate/skeptic/architect/rules panel) on the worktree.
  - **Outcome: zero Critical/High code defects.** All four reviewers endorsed the fix as a precise, root-cause fix (binder injection) with strong test coverage. No code changes required.
  - Findings (all non-actionable for code):
    - [issue] "Plan still active in `.github/plans/` — archive before merge." NOT actionable here: per fix-loop pipeline boundary, the pipeline owns plan archival/PR; impl must not archive or push. Pipeline-deferred.
    - [warning] "post-archive `npm run fix:files`" — tied to archival; pipeline-handled.
    - [info] Obscure edge: `self.__qualname__ = x` / `cls.__qualname__ = x` member-assignment in a method can re-stamp ClassMember via `_getMemberAccessInfo`. Out of scope — and `self.__qualname__ = x` SETS a real instance attribute at runtime, so resolving is correct there. Left as-is.
    - [info] Comment could mention `getClassMemberIterator` gates on `isClassMember()` — existing comment already explains the why; acceptable.
    - [info] Could add in-class-body completion marker — already covered by `print(__qualname__)` resolution in the nested-class sample.
    - [info] Audit direct symbol-table iterators — covered by green typeEvaluator1-8 + checker (1234 tests) and fourslash completions/hover (333 tests); repo-wide grep shows only `classes3.py` references instance `__qualname__`.
  - Verified binder.ts change is present (line 517 `__qualname__` injected with `isClassMember=false`); reviewer's "pre-fix" note was confusion with a separate pyrx mirror checkout. `git diff --stat` confirms `binder.ts` + `classes3.py` + `typeEvaluator3.test.ts` modified (+ new untracked fourslash test).
  - Decision: No code changes required from review. Proceeding to commit (AUTO_DRIVE_GIT=true). Push/PR (item 11) + plan archival remain pipeline-gated per fix-loop boundary.

## Root cause (verified)

The binder unconditionally injects an implicit `__qualname__` symbol into each class scope's symbol table (`binder.ts` ~L510). In a Class scope, `_addSymbolToCurrentScope` stamps it with `SymbolFlags.ClassMember`. Instance member-access resolution (`getClassMemberIterator`, `typeUtils.ts` ~L1880) treats any `isClassMember()` symbol as accessible, so `instance.__qualname__` resolves to `str` and the expected "cannot access attribute" diagnostic is suppressed. At runtime, `__qualname__` is exposed only via the metaclass `type` (so `Class.__qualname__` works) and never as an instance attribute.

## Decisions

- 2026-06-15: Adopt class-only access semantics for `__qualname__` (instance access should error), consistent with CPython where `__qualname__` is exposed via `type`, not instances.
- 2026-06-15: **Planned fix** — make the binder's implicit `__qualname__` symbol scope-only by omitting the `ClassMember` flag, so it remains name-resolvable inside the class body but is not exposed as a class/instance member. `Class.__qualname__` still resolves via metaclass `type.__qualname__: str`; `instance.__qualname__` now errors like `__name__`. Implement via an optional param on `_addImplicitSymbolToCurrentScope` / `_addSymbolToCurrentScope` to suppress the `ClassMember` flag. Change isolated to `__qualname__` only — NOT `__doc__`/`__module__` (which are legitimately instance-accessible).

## Risks / unknowns

- Risk: `__qualname__` may be needed on class objects in some synthesized contexts (e.g. functions/methods also have `__qualname__`). Ensure the fix does not break `function.__qualname__` or `Class.__qualname__`.
- Unknown: exact location and mechanism of the implicit injection (binder vs synthesized-type members vs `object` stub). Verify before editing.
- Risk: Over-broad fix could newly flag legitimate dunder access elsewhere → mitigate with focused test + full suite run.

## Learnings

- (to capture) Where pyright synthesizes/injects class-only dunders and how instance-vs-class member access is distinguished.
- 2026-06-15: Implicit class-scope dunders that are metaclass-only (e.g. `__qualname__`) must be injected WITHOUT `SymbolFlags.ClassMember` so they stay name-resolvable in the class body while being excluded from instance/class member access and completions. `__doc__`/`__module__` are legitimately instance-accessible and keep the flag.

## Next steps

1. impl: Commit the change on branch `fix11453` (AUTO_DRIVE_GIT=true).
2. pipeline: Create/update PR (work item 11) — gated on push/PR permissions.
3. pipeline: Archive plan + run `npm run fix:files` post-archival per fix-loop boundary.
