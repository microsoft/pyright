---
name: pyright-pr-typespec-review
description: Investigate whether a Pyright PR changes typing behavior safely by tracing its diff, designing adversarial cases, comparing exact revisions, and checking relevant CPython behavior. Use for requests to find regressions, assess merge safety, or test effects beyond a PR's own examples.
---

# Pyright PR TypeSpec Review

Produce a reproducible correctness assessment, with actual test execution when the environment permits. A green QA comment, passing CI, or a small diff is supporting evidence, not a substitute for testing the changed semantics. Do not merge, post comments, or change production source unless the user's request includes those actions.

## Work within the caller's workflow

Use this testing method without starting another review coordinator or delegating further work.

- When a QA runner supplies built revisions, execution tools, test passes, and an output schema, add skill-derived hypotheses and cases to those existing passes. Preserve independent expectations, negative neighbors, unchanged controls, and the final coverage check through execution. Use the runner's prepared builds and replay mechanism rather than creating another review session or invoking a comparison script with incompatible execution limits. Return the runner's declared result format, not a second review report. The runner owns verification, verdicts, and its QA comment.
- When the PR review coordinator assigns a specialist investigation, work in the assigned scope and scratch directory. Return the specialist report, executable evidence, coverage limits, and a concise feedback draft using [Draft PR feedback](#draft-pr-feedback). The coordinator reconciles duplicate findings and owns the final decision and authorized publication; the specialist never posts independently.
- For a standalone assessment, follow the complete workflow below. Drafting feedback is not authorization to publish it.

## Establish the comparison

- Read the current PR description, complete diff, added tests, review feedback, QA comments, CI and relevant primer/benchmark results. Associate each result with its tested commit. Distinguish a green QA feedback comment from an unrelated check mark.
- For a follow-up review, locate previous reports, reproductions, and controls; record their revisions and rerun relevant cases against the new head and pre-PR baseline before expanding coverage from the new diff. Previous conclusions are hypotheses to recheck, not current results. If those artifacts are unavailable, state the continuity gap. In an explicitly blind discovery evaluation, honor the withheld-evidence boundary instead; do not retrieve historical answers through comments or other artifacts.
- Record the exact head and the pre-change baseline that excludes **all** PR commits. Use the appropriate merge base and verify its diff matches the PR; `HEAD^` is insufficient for a multi-commit PR. If also testing a merge result against current main, label that as a separate comparison.
- Use isolated checkouts without disturbing user changes. Read applicable repository instructions. Use the revision's package manager, lockfile and build configuration. Sharing dependency installations is reasonable only if declared dependencies resolve compatibly; a missing tool or module is an environment failure, not a PR regression.
- Build each revision separately. Prefer the configured excluded output directory (`out` when applicable); arbitrary output folders can be picked up by `checkJs` on a subsequent build. Keep custom test cases and reports outside the source tree.

## Derive the affected behavior

Trace changed functions through callers, downstream consumers and early exits. Before selecting examples, make a compact inventory of the semantic decisions and type properties changed by the diff. Link each to its source location, preserved contract, and affected caller or consumer; then derive hypotheses from that inventory. A record of completed tests cannot reveal a hypothesis that was never selected. Explain the old and new contract, not just the changed lines. Look particularly for:

- A sentinel that is also a legitimate type/result: `Never`, `undefined`, empty unions, or failed inference.
- Shared helpers with multiple callers, and boolean changes that alter semantics rather than merely performance.
- New flags or cached metadata: initialization, every mutation path, cloning, specialization and synthesized types.
- The point where an inferred type is combined with later arguments, expected return types, union members or narrowing state.

For each changed decision that accepts, rejects, widens, or skips analysis, distinguish what its predicate actually establishes from the conclusion the caller draws. Look for a counterexample where the predicate holds but that conclusion does not. Inspect the helper's contract and returned information rather than inferring semantics from its name or a truthy result.

Use [references/discovery-coverage.md](references/discovery-coverage.md) to turn that inventory into concrete witnesses, relevant input combinations, and consumer tests, and later to audit missing hypotheses and classify individual findings. Choose feature-specific dimensions from [references/probe-design.md](references/probe-design.md); do not generate an arbitrary quota of cases or test every feature for every PR.

## Design an independent oracle

Construct three groups: intended fixes, invalid near-neighbors that must remain errors, and related behavior that should remain unchanged. State why each expected result follows from the contract or typing rules before treating a mismatch as a finding.

- Apply each hypothesis across the relevant combinations of input order, receivers, annotations and equivalent syntax. Testing an unsafe case in one form and an unrelated safe case in another does not cover the unsafe case in both. Preserve the triggering condition and independent oracle while varying the surrounding form; justify exclusions from the changed code's reach.
- For type inference, assert the exact inferred type as well as acceptance. For invalid cases, check the diagnostic's rule and location so an unrelated error cannot make the test pass.
- When information is widened, narrowed, replaced, or discarded, test the consumers that rely on each affected property. Pair type assertions with meaningful assignments, calls, element operations, or control-flow uses; the motivating operation alone may not expose the loss.
- Isolate probes in files or independent functions. A call inferred as `Never`, an unconditional raise, or a fatal earlier error can prevent later assertions from being checked. Use a returning wrapper such as `list[T]` when that preserves the inference question without making the rest of the sample unreachable.
- Give each claimed regression a specific observable obligation: a diagnostic at the bad operation, an exact result type, or acceptance of a valid consumer. Keep type-reveal/assertion probes separate from consumer probes if an assertion can fail independently. A baseline error elsewhere in the file is not evidence that the baseline caught the claimed bad operation.
- When testing generic compatibility, give containers observable reads and writes. Empty phantom classes and functions that only raise may conceal unsound mixing of invariant arguments. Use an existing typed alias rather than only a fresh literal, since contextual typing can legitimately widen the literal.
- Do not change an oracle merely to match the PR. If an initial inference expectation was unjustified, explain the correction or classify it as exploratory/unchanged; preserve the observation. Distinguish a new regression, an existing defect, an intended diagnostic change and an unresolved typing-spec question.

Use authoritative typing specifications for uncertain static rules. If the issue concerns syntax, operators or descriptors, consult the corresponding Python semantics as well.

## Execute and compare

Run the exact same isolated source/configuration on both built revisions, using matching Python target, checking mode, platform and typeshed. Capture full `--outputjson` diagnostics, stderr, exit status, revision IDs and commands. A Pyright exit code of 1 normally means diagnostics, not a broken runner.

The optional [scripts/compare_pyright.py](scripts/compare_pyright.py) runner executes both builds and compares per-case diagnostic signatures. It requires diagnostic evidence for every manifest file on both revisions; add a reachable top-level `reveal_type(0)` to otherwise clean probes. Missing evidence is an incomplete run, not a passing case. Read [references/runner.md](references/runner.md) for its input and limits, including `--validate-only` to catch malformed configurations before invoking either checker. A custom harness is equally acceptable if it retains the same evidence.

Validate the receiving harness's declaration format and save one replayable case early. Save sources, declarations, and actual results as each focused project completes, before starting long repository suites or composing the final report. Keep reproduction inputs separate from generated verification output and prose. Follow the provided export contract; a saved partial result is not a completed or independently replayed finding.

Check both directions: newly rejected valid programs **and newly accepted invalid programs**. Reduced diagnostic counts are not automatically improvements. Controls should compare inferred types and diagnostics, not only accept/reject counts.

Maintain a compact coverage record linking each selected hypothesis/combination to its oracle, source, and actual baseline/head evidence. Mark entries executed, excluded with a code-based reason, or untested (including failed execution); keep execution status separate from correctness classification. After finding a failure, test the remaining relevant forms of that same pattern and nearby valid controls. Before concluding, compare the original change/property inventory against the coverage record: identify changed decisions or consumers with no hypothesis, not just unexecuted planned tests. Challenge expectations and investigate those gaps rather than repeating completed tests or relying on case counts.

Run the relevant repository tests under the caller's shared validation ownership. For a core inference/evaluator change, the broader evaluator suite is appropriate after focused probes when it has not already been covered by a compatible shared run. A typical checkout supports `jest typeEvaluator --runInBand --forceExit --json --outputFile=<absolute-path>`; inspect that checkout rather than assuming the command or configuration. Record actual completion; do not call an interrupted suite passing. Once required checks complete, repeat only for a changed implementation, failure investigation or unresolved concern.

## Compare with CPython meaningfully

Use a Python version that supports the syntax and features under test, and record it. Execute the operations, not merely imports or unused function definitions.

- Parser/operator/decorator changes: observe actual exception category, timing and behavior.
- Static typing changes: Python generally does not enforce annotations. Successful execution alone cannot establish that an assignment is type-safe or that an inferred type is right.
- For a suspected soundness hole, demonstrate its consequence: an incompatible value written through an alias, a supposedly unreachable path reached, or a narrowed operation failing on an allowed runtime value. `assert_never` can make a false claim of unreachability observable.
- Separate assertions that confirm a runtime failure from tests that pass because the checker is correct. If the relevant runtime is unavailable, state the limit instead of substituting another version silently.

## Minimize, classify and report

Keep findings within the PR's intended behavior:

- Report introduced regressions and missed cases of the intended fix. A missed case can be actionable even when it also fails on the baseline; label it as incomplete coverage, not a regression.
- For example, in a PR that binds local names in unreachable code, "It misses the local binding from a mapping pattern like `case {**x}`" is in scope and should be reported.
- Unrelated, pre-existing missing `SyntaxError` diagnostics may be recorded separately in internal notes or the local report, including when noticed in added tests. Keep them out of PR comments and do not treat them as merge blockers. For example, missing use-before-`global`/`nonlocal` validation is outside an unreachable-local-binding fix. Do not request broader syntax validation or test corrections on that PR solely for the separate gap. Use a valid equivalent probe to assess the changed behavior.
- This does not exclude syntax findings when syntax validation is the PR's intended scope, the PR introduces the failure, or the user explicitly requests that investigation.

For each actionable finding, retain a small standalone reproduction with exact parent/PR diagnostics and, where useful, the runtime result. Trace the cause back to changed lines. A PR may expose a pre-existing weakness: report that distinction while showing that the failing input's behavior is newly changed. Check whether the PR's own tests accidentally encode the unsafe expectation.

Separate the observed change from its interpretation. Removing a setup error is not a consumer-diagnostic regression; a runtime failure involving `Any` is not by itself a static-typing violation. If an existing assertion or setup error obscures the claim, preserve the original evidence and independently test a valid isolated reproduction. Record a material in-scope precision loss or policy tradeoff as such rather than dropping it or promoting it to an unconditional bug. Prior reports and historical matching targets do not override the typing contract. The classification examples in [discovery-coverage.md](references/discovery-coverage.md) explain this distinction.

Lead with the merge recommendation and strongest evidence. Explain what the PR fixes, what it affects, the discovered failures and their conditions, and any important coverage limit. Distinguish locally executed tests from reported CI/QA results. Avoid a blanket “safe” claim; “no regression found in this scope” is the supported conclusion when no finding remains.

Save a readable report, minimal reproductions, the coverage record, and raw test evidence in the user's requested deliverable location. Include enough commands and revision IDs to rerun the comparison. Use the drafting guidance below when asked for PR feedback; do not post it without authorization. Stop when the selected coverage is accounted for and the requested assessment is supported. Finding a blocker is not evidence that other selected combinations were tested; if a budget or user instruction ends the review early, retain those gaps explicitly. Do not expand indefinitely or implement an unsolicited fix.

## Draft PR feedback

- Before drafting, read the completed review report and inventory all actionable findings. A general request such as "give me a draft comment" covers all introduced regressions and missed cases of the intended fix. Follow-up questions explaining one finding or its syntax do not narrow that request to the most recently discussed example.
- Include every distinct actionable finding unless the user explicitly requests a subset or the finding has been resolved or withdrawn. Group variants of the same issue to stay concise, but retain separate issues and their regression-versus-incomplete-coverage classifications. Keep unrelated pre-existing defects and internal observations out according to the scope rules above.
- Use one minimal executed reproduction for each distinct claim, plus a compact list or table of additional verified variants. Add another example when it establishes a different consequence or correction. Completeness means preserving the claims, not pasting every case, log, or the whole project. Keep full reproduction inputs and raw verification evidence in separate artifacts; include material in-scope policy tradeoffs with their qualification, not as unconditional blockers.
- Before returning the draft, reconcile it against the finding inventory: each actionable finding must have a corresponding explanation and supporting example/evidence, or an explicit reason for exclusion. Do not silently omit findings for brevity or recency. If the user requested a narrower draft, state its scope briefly. For example, a report with two introduced regressions and one missed in-scope case normally needs all three represented, even if the conversation just explained the first one.
- Return a concise, standalone comment in copyable Markdown. In chat, wrap the entire draft in a four-backtick `markdown` fence so inner triple-backtick `python` examples remain intact. A saved `.md` comment contains the comment itself without that outer presentation fence.
- Lead with the observed issue and relevant evidence, such as test names and baseline/head results. Explain its consequence, then ask for a specific correction or clarification. Keep unrelated observations in internal notes according to the scope rules above. Omit commentary about the assistant's process unless it materially affects confidence in a finding. Present proposed fixes as suggestions without implying they were tested.
- Put an example immediately beside the claim it explains. If the concern is that two similar syntax forms take different analysis paths, show those two forms together and label the distinction. Repeating the original test alone does not explain the separate-path claim.
- Keep explanatory examples minimal. A schematic snippet can use `...` when only the syntax distinction matters; a failure reproduction needs enough definitions and assertions to reproduce the result. Do not present an illustration as an executed regression test.
- For a test that passes before and after the PR, distinguish regression coverage from unchanged-behavior controls. Ask for a failing-before/passing-after test if a fix is claimed; if the test is a control, suggest clarifying that purpose rather than demanding unrelated implementation work.

For example, place this illustration directly after explaining the distinction between a direct pattern and an equality comparison in a guard:

```python
# Direct literal pattern: uses the separate pattern-matching narrowing path.
match value:
    case 40:
        ...

# Equality in a guard: exercises the equality-comparison narrowing path.
match value:
    case _ if value == 40:
        ...
```

Verify which paths the current diff changes before applying this example. Follow it with the concrete request, such as clarifying which behavior is fixed and providing a regression test that demonstrates the change.
