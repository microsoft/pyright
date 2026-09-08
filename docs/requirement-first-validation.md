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
- Latest full suite: 89 suites and 3,027 tests passed, with no additional exclusions,
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

A fresh rebuild of unmodified upstream at the base commit took 88.822 seconds
wall time for the exact default-settings NumPy input, with diagnostics identical
to the candidate. This is one upstream run, not a median. The latest candidate
three-run median was 1.180985 seconds; its paired earlier-protocol-control median
was 16.547263 seconds (`/tmp/pyright-isolated-numpy-uL7biS`). The large improvement
does not establish universal recursive-type soundness or general workload gains.

## Speculative Matching Review

The 24 cases in `protocolRequirementSpeculative.test.ts` compare nested speculative
matching with a fresh non-speculative structural reference. They cover ordinary
instances, callable elements, and the reduced `int`-to-`str` rejection path;
Default and RetainLiteralsForTypeVar flags; one or two empty caller constraint
sets with distinct ordered scopes; and positive-first versus negative-first order.

Each case verifies repeated rejection, unchanged caller state and source types,
speculative-mode exit, identical later structural diagnostics, and subsequent
acceptance of both a compatible destination specialization and a compatible
source specialization. All 24 cases pass normally and with shortcut dispatch
disabled. This does not exercise populated multi-alternative bounds, exception
unwinding, or arbitrary deep mutable-type ownership.

## Limits

This remains an exact-builtin-list optimization, not general container handling.
The additional ordinary-instance support has demonstrated activation and
semantic parity in the covered cases, not a separately measured non-function
speedup. Other assignment flags, populated multiple constraint alternatives,
broader speculative re-entry, pending recursive cache assumptions, and deep mutable-type ownership
remain review obligations. Historical ecosystem checks in the walkthrough are
not fresh validation of this generalized port.