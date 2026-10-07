# Complexity Regression Canaries

These checks complement the full-project benchmark. They assert semantic
expectations as well as resource budgets; finishing quickly is not sufficient.

## Deterministic Work Gate

`protocolRequirementComplexity.test.ts` runs in the ordinary Jest suite, outside
the excluded benchmarks directory. It generates two generic overloaded functions
with 2/3, 4/5, 8/9, and 16/17 signatures and checks their union against a recursive
sequence protocol requiring a missing leaf capability.

After fixture setup, the test counts actual `ConstraintSet.clone` calls and throws
at clone 65. This is a deliberately generous fixed budget for a path that can
reject without reconciling overloads. The counter must fire at least once, and
the test restores instrumentation even on failure. It asserts rejection,
unchanged source types and caller bounds/scopes. A neighboring sample assertion
protects positive, nested, callable, mixed, and negative overload selection.

Disabling production shortcut dispatch was verified to exceed this budget even
at the smallest input.

The same suite also generates cyclic structural protocol pairs at depths 2, 4,
and 6, with 2 or 3 methods per level returning the same next-level type. The final
level points back to the root and includes a leaf method returning `int` in the
target and either `int` or `str` in the source. Every case checks both acceptance
and rejection, then repeats the assignment with unchanged source and caller state.
These are ordinary class/protocol comparisons, not the builtin-list shortcut.

For this family, a test-local wrapper counts `getDeclaredTypeOfSymbol` requests
after fixture setup, with a cumulative budget of `32 * depth * memberCount`
across cold and repeated assignment. The lower bound also requires the counter
to observe the recursive walk. Disabling completed protocol-cache lookup in a
disposable test transform was verified to exceed the 576-request budget at depth
6 with 3 members. Pending-cycle handling was left intact in that counterfactual.

These are regression tripwires, not mathematical proofs of asymptotic complexity.
The member counter measures calls through the evaluator API, not all internal
symbol lookups, and work that neither clones sets nor requests declared member
types is not counted. No production counter, truncation, or precision-reducing
bailout is introduced. No test expectation is weakened to meet a work budget.

```sh
pnpm --dir packages/pyright-internal exec jest --testPathPatterns=protocolRequirementComplexity.test --runInBand --forceExit
```

## NumPy Integration Gate

Use Node 24.15.0 and a dedicated Python 3.12 environment with NumPy 2.4.6. CI pins
Python 3.12.3; the runner records the exact Python version and resolved NumPy path.
Build the current source before measuring:

```sh
pnpm --dir packages/pyright-internal run build
pnpm run build:cli:dev
python3.12 -m venv .numpy-canary-venv
.numpy-canary-venv/bin/python -m pip install numpy==2.4.6
node build/benchmark/numpyCanary.cjs --python "$PWD/.numpy-canary-venv/bin/python"
```

The runner checks the exact default-settings `np.array([np.mean, np.sum])`
expression and a separate file with precise float64 array/nested-list assertions
and one intentional incompatible-dtype argument. Missing imports, extra
diagnostics, lost precision, and a missing negative diagnostic all fail the gate.

Three fresh processes per fixture must produce identical diagnostics. The exact
workload's median must be at most 10 seconds, and each process has an external
30-second timeout. These are coarse regression limits, not a promise of a
particular latency on every runner. Do not increase them just to pass a regression.
There is no automatic retry that discards a slow sample.

Optional `--baseline-root /path/to/built/worktree` alternates candidate and
baseline order and checks exact diagnostic parity. Both roots must already be
built. For the known slow upstream baseline, use `--timeout-seconds 120`; this
does not change the candidate median limit. Use `--output /path/to/empty-directory`
to preserve independent runs; the default output location is reused.

Artifacts contain all completed timing records, raw stdout/stderr, bundle and
fixture hashes, commits, working-tree patches, environment details, and budgets.
Bundle hashes identify the executed code; a recorded commit alone does not prove
that a developer's preexisting build is current. The workflow always rebuilds.

The dedicated NumPy workflow runs on relevant pull requests, weekly, and on
manual dispatch. Normal CI also discovers the work-count tests automatically.
Hosted execution and branch-protection requirements must be verified after
publication; local validation does not configure required GitHub checks.

## Further Coverage

The gates cover overload-width scaling on the known rejection path and independent
recursive-depth/member-count scaling. Solver-visit and attempted alternative
counters and bounded profile capture remain future work. Retain
cycle, inference-state, and ownership tests alongside any added performance gate.