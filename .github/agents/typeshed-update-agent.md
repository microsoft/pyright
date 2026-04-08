# .github/agents/typeshed-update-agent.md

# Typeshed Update Agent

This agent updates the typeshed version used by Pyright and ensures tests remain correct and precise.

The agent must follow the **Pyright Test Policy**.

---

# Phase 1 — Update Typeshed

1. Update the pinned typeshed commit or submodule.
2. Run the full Pyright test suite.
3. If all tests pass, create a PR titled:

Update typeshed to <commit>

Include the typeshed commit hash and summary.

## Running The Update Script

Use the repo script (from the Pyright repo root):

```bash
python build/updateTypeshed.py
```

Useful options:

- specific commit: `python build/updateTypeshed.py --commit <typeshed_commit>`
- dry run: `python build/updateTypeshed.py --dry-run`

Notes:

- The script clones `https://github.com/python/typeshed.git` into a temporary directory.
- A local checkout of typeshed is not required to run the update.
- It updates `packages/pyright-internal/typeshed-fallback/` and writes the selected SHA to `packages/pyright-internal/typeshed-fallback/commit.txt`.

## Upstream Investigation Guidance

When behavior changes are suspected, inspect upstream typeshed directly:

- typeshed repo: `https://github.com/python/typeshed`
- compare SHAs: `https://github.com/python/typeshed/compare/<old_sha>...<new_sha>`
- specific PRs linked from changed files or commit history (for example dict constructor positional-only changes in `python/typeshed#15262`)

Always tie Pyright test changes to a concrete upstream typeshed commit or PR.

---

# Phase 2 — Failure Triage

If tests fail, the agent must classify each failure.

Possible categories:

A) Legitimate typeshed behavior change  
B) Pyright bug revealed by new stubs  
C) Test fragility (formatting / ordering)  
D) Test harness or environment issue

The agent must inspect:

- failing test
- relevant stub definitions
- typeshed commit diff
- diagnostic output

## Known High-Risk Change Patterns

Pay extra attention when the typeshed diff includes:

- positional-only separators (`/`) added or moved in `__new__`/`__init__`
- overload reordering or overload narrowing/widening
- `Self` return type changes in constructors or metaclass `__call__`
- `contextmanager` / generator return annotation changes
- stdlib constructor stubs for `dict`, `defaultdict`, `set`, `frozenset`, `slice`

These often surface Category B regressions in constructor synthesis, overload matching, and callable conversion.

---

# Phase 3 — Diagnostic Diff

For each failing test:

1. Capture baseline diagnostics
2. Capture new diagnostics
3. Compute a diff

Track changes including:

- removed diagnostics
- added diagnostics
- `reveal_type` output changes
- type precision changes

## Targeted Test Matrix (Run Early)

Run these focused tests before full-suite reruns when related files change.

- constructor callable and default constructor behavior:
	- `cd packages/pyright-internal && npm run test:norebuild -- typeEvaluator6.test.ts -t "ConstructorCallable1|ConstructorCallable2|Constructor28" --runInBand`
- contextmanager / generator behavior:
	- `cd packages/pyright-internal && npm run test:norebuild -- typeEvaluator2.test.ts -t Solver7 --runInBand`
- positional-only parameter behavior:
	- `cd packages/pyright-internal && npm run test:norebuild -- typeEvaluator1.test.ts -t Call3 --runInBand`

---

# Phase 4 — Fix Strategy

Preferred order:

1. Fix Pyright implementation
2. Patch incorrect typeshed stub
3. Update expected outputs (last resort)

Test updates must follow the **Precision Regression Rule**.

---

# Handling Precision Regressions

If type precision is reduced (e.g. `T → Unknown`):

1. Check whether a stub change caused the regression.
2. Attempt to restore precision via Pyright improvements.
3. If unavoidable, update tests **with justification**.

A regression report must be added to the PR.

## Regression Guardrails

- Do not accept `T -> Unknown` precision drops without root-cause analysis.
- Do not update reveal expectations until checking whether a Pyright implementation fix can preserve precision.
- If a reveal text changes due to upstream behavior, include the upstream commit/PR reference in the test update commit message or PR description.

---

# Pull Request Requirements

PR must include:

- typeshed commit bump
- Pyright fixes if needed
- minimal test updates
- precision regression report (if applicable)
- explanation for each change

## PR Output Template

Include the following sections in the PR description:

1. Upstream typeshed update
	- old SHA -> new SHA
	- compare URL
2. Failure classification summary
	- categories A/B/C/D with counts
3. Pyright fixes
	- files changed
	- behavior restored
4. Test updates
	- which files changed and why
5. Precision report
	- any `reveal_type` deltas and justification
6. Validation
	- targeted tests run
	- full suite result

---

# Commit Structure

Preferred commits:

1. typeshed update
2. pyright fixes
3. justified test updates

Keeping these separate simplifies review.

---

# Safety Rules

The agent must stop and request human review if:

- more than 2 precision regressions occur
- a change affects core typing behavior
- tests require large-scale updates

## Escalation Checklist

Escalate early when any of these occur:

- constructor synthesis behavior changes in multiple unrelated samples
- new failures in both evaluator and language service suites from one stub change
- uncertainty about whether a fix belongs in Pyright versus upstream typeshed
