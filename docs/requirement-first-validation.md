# Requirement-First Protocol Rejection: Clean Port

## Scope

This worktree starts directly from upstream/main
`c77393240247e017db6538d35876e723c518e06c`. It contains the requirement-first
protocol optimization from `0ad37c137`, plus the ordinary-instance generalization
and its instance, recursive-type, and state-continuation regressions.

Production changes are confined to protocol matching and the evaluator's
function/method-class accessor. The independent `solveAndApplyConstraints`
early return, constraint solver/storage experiments, research probes, and local
investigation plans are not included. Source worktrees are preserved.

The published clean version's stronger indexing-overlap and populated-caller
tests are retained. The three newer regression files were transferred unchanged
from the generalization experiment. No inference expectations were weakened to
accommodate removal of the independent solver optimization.

See [the overload walkthrough](overload-resolution-numpy.md) for the algorithm,
NumPy example, guards, and separate correctness obligations of the two paths.

## Reproduce the State Comparison

After installing dependencies with `pnpm install --frozen-lockfile`, run from
the repository root with Node 24:

```sh
node build/protocolRequirementStateAudit.cjs
```

The runner invokes Jest twice with separate evaluators and no transform cache.
One run disables production protocol shortcut dispatch; the other enables it.
Direct shortcut eligibility assertions still execute in both runs. The test
compares diagnostic and non-diagnostic matching, repeated rejection, exact
caller bounds and metadata, nested inferred types, continuation assignments,
parent-tracker state, and later positive acceptance.

The runner verifies full equality of 64 traces containing 4,992 recorded
observations across 32 cases. It records source hashes, logs, and traces in a
new temporary directory and prints that directory. It does not modify source
files or production artifacts. A changed instrumentation anchor fails explicitly.

The test preserves the existing ownership contract: `cloneWithSignature` shares
matching sets, while `clone` and `copyFromClone` isolate continuation writes.
Matching values alone does not establish a universal deep-ownership proof.

## Clean-Base Verification

- Baseline protocol port: 284 focused tests passed.
- Generalized capability checks: 30 tests passed.
- Newly transferred instance, recursive, and state tests: 76 tests passed.
- Repository-local differential runner: all 64 traces and 4,992 observations
  matched exactly on the clean upstream base.
- Latest full suite: 89 suites and 3,067 tests passed, with no additional exclusions,
  including the cycle, complexity, and speculative regression files.
  Jest reported listener and worker-teardown warnings despite the passing run.
- Core and development CLI builds, targeted ESLint and Prettier, editor
  diagnostics, and whitespace checks passed.
- Exact default-settings NumPy workload: three alternating fresh-process pairs
  produced a candidate median of 1.159716 seconds versus 16.671622 seconds for
  the earlier protocol control, with identical diagnostics. The comparator is
  not unmodified upstream. Artifacts: `/tmp/pyright-isolated-numpy-jhqVEb`.
- Final state-audit artifacts: `/tmp/pyright-state-continuation-17Odqa`.
- The existing real NumPy recursive-input fixture passed with default settings:
  zero errors or warnings, seven explicit float64 type assertions, and six
  reveals retaining the previously observed `dtype[Any]`. Strict-list inference
  was not rerun for this port.

These are results for this port, not timings inherited from the older experiment.
The three newer regression files remain byte-identical to their source, and
constraint solver and tracker files remain identical to upstream/main.

## Recursive-Type Review

The shortcut is a necessary-condition rejection, not a replacement recursive-type
solver. Given the verified indexing contracts, a source element must satisfy
`Leaf | NestedSequence[Leaf]`. The missing-member path rules out both alternatives;
it does not reject an element merely because it lacks the leaf capability.
The separate reduced-assignment path delegates element compatibility to the
existing evaluator and has its own specialization and caller-constraint guards.

Nine additional checks cover a recursive list alias and self/mutually recursive
classes with no terminating leaf. All require the shortcut to decline and the
ordinary matcher to accept, including repeated checks with unchanged caller
state. These and the existing recursive cases pass with dispatch enabled and
disabled: 28 checks in each mode. The latest full-suite result above includes
these nine new checks. No production code changed during this review.

Two further cases warm an outer recursive-list rejection before querying its
element alias. The alias has a non-indexable `float` terminal, so rejection against
`NestedSequence[int]` is meaningful. Warm and cold element queries reject, preserve
diagnostics, and subsequently accept `NestedSequence[float]`, both with and without
speculation. All 11 cycle-file cases pass with dispatch enabled and disabled.
This checks one failed-ancestor cache scenario, not arbitrary coinductive rollback.

## Direct Upstream Benchmark

Both roots were rebuilt (core, then development CLI) before three alternating
fresh-process pairs against unmodified upstream at the base commit. Node was
24.15.0, Python 3.12.3, and NumPy 2.4.6; the fixture uses default settings.

| Repetition | Candidate Wall Seconds | Upstream Wall Seconds |
| ---------- | ---------------------- | --------------------- |
| 1          | 1.196166               | 86.557670             |
| 2          | 1.149528               | 85.309787             |
| 3          | 1.143793               | 83.754357             |
| Median     | 1.149528               | 85.309787             |

The measured median ratio is approximately 74.2x for this exact input, not a
general workload claim. All six exact-input runs have identical diagnostics and
reveal `ndarray[tuple[Any, ...], dtype[Any]]`. All six control runs preserve the
float64 assertions and exactly one intentional int64 argument error. This replaces
the earlier single-run upstream evidence; the historical 16-second comparator
above is the older protocol control, not upstream.

Reproduce from the candidate root after rebuilding both roots:

```sh
node build/benchmark/numpyCanary.cjs --python /path/to/python3.12 \
  --baseline-root /path/to/upstream-worktree --timeout-seconds 180 \
  --output /tmp/numpy-upstream-comparison
```

Local raw outputs, full bundle hashes, fixture hashes, source patches, and version
records are in `/tmp/pyright-numpy-canary-upstream-final`. That directory is local
evidence, not a hosted artifact. The measured candidate commit was `efaeffb07`
with only the initial speculative-test extension uncommitted; analyzer code did
not change during this review. Core bundle SHA-256 values:

- Candidate: `ae3fd2551808cbfc2dc8f14ed65f470e5997e86e43e24f791a17330edbff9af9`
- Upstream: `8b43f81be2d3e360178256dd1fd8215899051e33f23901abd076f3af5193d37a`

## Speculative Matching Review

The 48 matrix cases in `protocolRequirementSpeculative.test.ts` compare nested speculative
matching with a fresh non-speculative structural reference. They cover ordinary
instances, callable elements, and the reduced `int`-to-`str` rejection path;
Default and RetainLiteralsForTypeVar flags; one or two empty or populated caller
constraint sets with distinct ordered scopes, literal bounds, and retention flags;
and positive-first versus negative-first order.

Each case verifies repeated rejection, unchanged caller state and source types,
speculative-mode exit, identical later structural diagnostics, and subsequent
acceptance of both a compatible destination specialization and a compatible
source specialization. Two exception-injection cases throw during declared-member
lookup inside active protocol matching, optionally under two nested speculative
contexts. After the exception, speculative mode is off, the same incompatible pair
rejects, and a compatible specialization accepts. All 50 cases pass normally and
with shortcut dispatch disabled.

The 24 cases in `protocolRequirementPopulated.test.ts` additionally place a free
type variable in the destination itself. A second alternative has different bounds
and retention metadata. The generic populated case must decline the shortcut.
Exact solved and nested types, ordered bounds, scores, repeated calls, and later
Default/Invariant/Contravariant continuations agree across non-diagnostic,
diagnostic, and speculative matching. All 24 pass with dispatch enabled and disabled.

## Reviewer Map

- Start with `tryFastRejectSequenceProtocol` in `protocols.ts`: prove each negative
  path separately using the checked source and destination indexing contracts.
  Do not infer a negative merely from a missing leaf member; the recursive
  alternative must also be ruled out.
- Follow `assignClassToProtocol` and `setProtocolCompatibility`: fast entries stay
  specialization- and caller-context-specific, never become universal negatives,
  and can be replaced by structural results. Diagnostic retries retain observable
  failed-call inference. Pending recursive-pair handling is pre-existing machinery,
  not a new transactional relation cache.
- Constraint cloning copies entries and scope containers but retains bound type
  references. The reduced proof delegates to the evaluator with cloned caller
  constraints; cloning alone does not prove deep type immutability. No new solver
  result reuse or mutable type allocation policy is introduced here.
- Review the exception tests as stack-cleanup checks, not cancellation coverage
  at every evaluator callback. Review the failed-ancestor cases as bounded
  counterexample searches, not a proof of general coinductive cache soundness.
- Existing exact overload and failed-call inference assertions remain unchanged.
  The new test expectations preserve `Literal[7]`; they do not widen it to make
  multiple-alternative cases pass.

The latest full suite includes all these additions (3,067 tests in 439.42 seconds).
Targeted ESLint, Prettier, editor diagnostics, and whitespace checks passed. No
production changes were needed during this review. Hosted CI status is tracked
separately on the draft PR; local results are not a hosted pass. Independent model
review has not yet occurred.

## Limits

This remains an exact-builtin-list optimization, not general container handling.
The additional ordinary-instance support has demonstrated activation and
semantic parity in the covered cases, not a separately measured non-function
speedup. Other assignment flags, broader speculative re-entry, arbitrary pending
recursive cache assumptions, and deep mutable-type ownership
remain review obligations. Historical ecosystem checks in the walkthrough are
not fresh validation of this generalized port.