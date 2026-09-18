# Bounded local overload results

Supported automatic overload results are enabled by default in `ConfigOptions`
and `Program`, including CLI, language-server and background-worker analysis.
There is no new public project, command-line or editor setting. The internal
`ConfigOptions.experimentalOverloadResults = false` escape hatch retains the
ordinary evaluator for baseline comparisons. Omitted options use the default,
including after configuration serialization, service cloning and reload.

Explicit internal `Program` controller injection takes precedence over the
configuration default, including fixed-seed and test-only checking controls.
Injecting both controller kinds remains an error. Automatic activation does
**not** imply checker live-cache handoff: production configuration supplies
`checkerHandoff: false`, and even an injected automatic controller requires
explicit `checkerHandoff: true` to exercise that separate, unadopted experiment.

This is not full general overload conformance. Within the existing bounded
proof and local-use admission domain, an ambiguous `list[Any]` call can retain
`list[int]` and `list[str]` alternatives. Supported assignments and operations
require one complete successful alternative for the entire operation, not a
combination of partial successes. Public queries display these alternatives as
`OverloadResult[list[int], list[str]]`, not `Any`, `Unknown`, or an ordinary union
that would reject invariant assignments. `OverloadResult` is an internal type
representation, not new Python annotation syntax.

The producer restriction remains direct positional Name calls using supported
function parameters. Nested invariant and nominal generic shapes are supported
only within the existing selector proof domain. Constructors, bound-method
producers, unsupported or escaping use graphs, and unsupported gradual argument
shapes remain ordinary. Concrete calls preserve ordinary precision; admission
or resource cutoffs do not grant more permissive fallback types.

## Automatic activation

Ordinary overload matching first evaluates a real argument/parameter match.
For a complete, successful, unexpanded match at a supported direct assignment
call, the controller checks whether its arguments could contain invariant
`Any`. Concrete calls continue through the ordinary evaluator without module
scanning, candidate operations, reservations or private cache restoration.
Evaluator routing and projection hooks stay disconnected until an admitted
activation installs operation roots. Controller initialization and disposal
still occur, and ordinary checking retains the statement restart boundary.

A potentially ambiguous call runs the existing bounded selector. This probe
is additional real matching work, not a claim that all alternatives have
already been solved. A successful probe queues activation; incomplete or
rejected probes do not install a carrier or an ordinary-result owner.

When a request started outside speculation and return inference, a selected
probe immediately unwinds to that request boundary before activation is
flushed. Continuing the provisional ordinary evaluation could otherwise cache
dependent values or publish false member errors. A top-level baseline operation can
discover an independent producer outside its own node set through native code
flow; it likewise unwinds before retaining the interrupted outcome. Candidate
trials do not discover new producers. A request entered from an already-active
external speculative context still leaves activation pending until a safe
ordinary request.

At a non-speculative, non-inference evaluator checkpoint, the controller runs
the existing bounded module admission graph. It considers all syntactic seeds
when establishing the graph, preserving the existing dependency/escape
decisions and whole-module resource limits. Only records depending on activated,
admitted producers receive operation ownership and reservations.

Activation restarts the enclosing evaluator request, or the enclosing checker
statement when checking is in progress. The checker statement boundary is
necessary to publish assignment and checker diagnostics from the newly owned
operation. No partially evaluated `TypeResult` is promoted to a carrier.
The existing private cache transactions, baseline operations, real alternative
validations and diagnostic publication then perform the work.

The candidate/proof/graph/node limits and actual candidate-call accounting are
unchanged. Active producers still perform the existing charged candidate
discovery operation; the earlier native probe is separately reported through
`activationArgumentChecks`, `activationProbes` and `activationProofUnits`.
Rejected concrete calls no longer perform the old charged discovery operation.

## Ownership and invalidation

Activation state is local to an evaluator/controller and keyed by parse-node
identity. Replacement parse generations do not inherit activations or pending
probes. Disposal clears pending work and retires owned outcomes.

Memory-pressure eviction requested by lazy import lookup is deferred until the
owning Program invocation unwinds. A checker retains one evaluator/controller
for the complete file; analysis releases that ownership between files, not at
the end of the entire project. Language-service requests retain ownership across
nested and asynchronous work. Pending eviction runs when the outermost invocation
finishes, including cancellation or failure, without changing the memory threshold.
Program disposal cancels pending eviction; a late async completion or rejection
must not recreate an evaluator after shutdown or replace the request's outcome.
Each controller's discovery callback is bound to its own evaluator, never a
replacement evaluator's caches. Direct use of a retired controller remains an error.

Ordinary public queries do not become experimental operations merely because
another function in the module activated a producer. Records that already own
ordinary or failed outcomes still require their private restoration and
cache-validity guards; automatic activation does not bypass those guards.

Native overload matching may speculatively query an earlier operation to
determine whether a call returns. Exact-node cache isolation permits this only
when the operation root is disjoint from every active speculative root.
Overlapping roots in either direction remain forbidden, as does isolation in
return inference. The native speculative stack and its undo entries are not
disabled or replaced.

An earlier, unowned statement in the same function can also be evaluated as
a native flow prerequisite of a private operation. Its cache entries survive
exact-node isolation, so its node-associated diagnostics are sent to the
surrounding native sink rather than being discarded with the private trial.
Existing native suppression, reachability and diagnostic deduplication still
apply. Diagnostics within an owned operation remain private until its complete
witness or ordinary fallback is checked.

The regression tests cover analysis-first and cold queries, same-file ordinary
functions, annotated producer diagnostics, cancellation/reentry and resource
cutoffs. The activation-order matrix distinguishes independent `int`/`str` and
`bytes`/`float` producers, their aliases and generic projections, repeated public
queries, and original/edited/restored parse generations. It compares complete
native diagnostics and TypeResult metadata, proves actual carrier selection,
and requires a single complete witness for mixed-element `extend` operations.
Separate tests preserve pending activation across external call speculation and
exercise disjoint/overlapping cache roots under completion, error and cancellation.

Timing is measured separately from observer instrumentation; no timing threshold
is asserted in CI. Earlier V3 residual measurements are historical evidence,
not measurements of subsequent correctness or default-wiring changes. Enabling
the default is not zero-overhead certification; current comparisons must keep
analysis, public-query work and observation counters separate.
