# Evaluation and state traces

This is **developer-only, local tooling**, not a Pyright analyzer option. It runs a
real `Program` using an existing **unbundled CommonJS build**, instruments selected
native functions in memory, and writes a versioned NDJSON artifact. Ordinary
analysis has no recorder import, hook, mutation counter, or runtime cost.

The recorder, native adapter, artifact reader, local viewer, and CLI are separate
modules in `packages/pyright-internal/src/trace`.
Artifacts do not require Copilot, an MCP server, a heap profiler, or a network
service. They can contain source paths, diagnostic text, and literal values;
keep them local and treat artifacts from others as untrusted data.

For agent-assisted discovery, use the thin
[evaluation-tracing skill](../.github/skills/evaluation-tracing/SKILL.md).
This document is the canonical manual; the CLI and viewer also work without an
agent or skill installation.

## Build and capture

Use the repository's existing dependencies and build. From the repository root,
in PowerShell:

```powershell
pnpm --dir packages\pyright-internal run build
$trace = 'packages\pyright-internal\out\packages\pyright-internal\src\trace\cli.js'
$inputFile = 'packages\pyright-internal\src\tests\samples\evaluationTrace1.py'
node $trace capture --target . --input $inputFile --output .generated\evaluation-traces\ordinary.ndjson
```

An output file must not already exist. The repository ignores
`.generated/evaluation-traces/`. The tool never rewrites target source or
runtime files, patches `require` globally, or uses a global recorder. Each
capture has its own module cache, bridge, run identity, and weak owner registry.
Native dependencies outside the unbundled source directory use normal Node
resolution and are not instrumented.

For a smaller capture, use `--file`, `--start`, and `--end`. The file defaults to
the input. Offsets are **zero-based UTF-16 offsets**, as used by Pyright's parser.
The start is inclusive and the end exclusive. A matching native call starts a
recorded scope; its nested native calls remain visible, even in another file.
The entire original analysis still runs. A range can match multiple nodes and
occurrences; it is not an exclusive ownership declaration.

```powershell
$text = [IO.File]::ReadAllText((Resolve-Path $inputFile))
$start = $text.IndexOf('result.append')
$end = $start + 'result.append(identity(value))'.Length
node $trace compare --target . --input $inputFile --start $start --end $end `
    --output .generated\evaluation-traces\ordinary-scoped.ndjson
```

`compare` runs three independent real analyses: uninstrumented, audit-only, and
fully recorded. It compares all final diagnostic fields, the remaining live
diagnostic sink, native experimental counters when available, and parsed-input
hashes. The audit-only and recorded runs also compare a deterministic digest of
the **actual observed** call/return/branch/cache/write sequence, callback
boundaries, identities, and selected raw type/result fields. They do not print
types or ask extra type questions. The clean and audit summaries are written
beside the trace as `.clean.json` and `.audit.json`.

This digest is scoped evidence, not a comprehensive semantic hash. The clean
run has no internal event digest. Report its time separately: audit and tracing
times include observer overhead, which can be substantial. The comparison does
not remove or simulate native work, change an analysis budget, or certify reuse.
Use traces to identify behavior worth investigating, then native CPU profiling
and separate uninstrumented timings to establish its cost. Event order,
timestamps, or fewer recorded calls alone do not establish time savings.

The runner currently uses Python 3.12, the target's bundled typeshed, and the
normal `ConfigOptions` defaults. It does not discover project configuration.
`--runtime` can select a different unbundled `src` directory explicitly. Bundled
webpack output, ESM, async native hooks, and arbitrary analyzer versions are not
supported by this adapter.

Privately loaded local JavaScript must contain **no dynamic `import()` expressions**,
including imports inside functions that have not been called. The loader inspects
the JavaScript AST and rejects such a module synchronously, with its path and
location, **before executing that module's body**. This prevents module-initializer
promises from later rejecting because the private VM has no dynamic-import
handler. Comments, string literals, and ordinary methods named `import` are not
dynamic imports. External dependencies that already use native Node loading retain
their existing behavior; unsupported local modules are never silently delegated
to a process-wide loader.

This restriction also applies to the custom-driver API. For example, compatible
experimental builds may contain `common/tomlUtils.js` with `import('smol-toml')`;
loading it directly, or through `analyzer/service.js`, is unsupported even though
the Program-only capture graph does not load it. Required ancestors may already
have executed before a dependency is rejected; this is not a transaction that
rolls back their side effects. Failed module entries are removed from the private
cache so retry cannot return their partial exports.

## Experimental role adapter

Ordinary capture does not require an overload experiment. To inspect a compatible
experimental build, supply `--experimental` and the **existing** target repository
and Python input:

```powershell
$target = 'D:\work\pyright-experiment'
$inputFile = Join-Path $target 'packages\pyright-internal\src\tests\samples\overloadResultController1.py'
$text = [IO.File]::ReadAllText($inputFile)
$start = $text.IndexOf('ret.nonexistent()')
node $trace compare --target $target --input $inputFile --experimental `
    --start $start --end ($start + 'ret.nonexistent()'.Length) `
    --output .generated\evaluation-traces\failed-pair.ndjson
```

The example selects an expression in the experiment's sample; neither that
expression nor its offset is an adapter allowlist. Any existing input/range is
accepted. `--operation` selects a native **containing-root node ID** from a
previous compatible run (IDs are not stable across edits/builds).

The runner uses `experimentalOverloadResults = true` and the Program options
`{ automatic: true, checkerHandoff: false }` in **all three** comparison modes.
It invokes the real baseline and candidate evaluations, their original isolation
callbacks and continuations. It never inserts a cached result or enables checker
handoff. This optional adapter checks the controller and isolation hooks before
executing target code.

Trial checkpoints distinguish `trial-entry`, `entry` (evaluator linked, before
isolation), `first-result-live` (before continuation), `complete-live` (after
continuation, before isolation unwinds), and `unwind` (after trial cleanup).
Both the expression node and containing root are retained. Expression cache
snapshots use the expression ID, not the containing-root ID. `return` records
preserve actual first results rather than reconstructing them from later cache
reads. Full private diagnostic objects are observed before the sink is cleared;
sink references, cleanup calls, and final trial diagnostic arrays remain distinct.

## Query an artifact

All queries are local and output JSON:

```powershell
$artifact = '.generated\evaluation-traces\failed-pair.ndjson'
node $trace query $artifact coverage
node $trace query $artifact pairs
node $trace query $artifact timeline --kind collection
node $trace query $artifact timeline --span '<run>:s1'
node $trace query $artifact history --entity '<run>:e42'
node $trace query $artifact latest --entity '<run>:e42' --at 5000
node $trace query $artifact neighbors --entity '<run>:e42' --relation observed-read
node $trace query $artifact diff --baseline '<baseline-span>' --replay '<candidate-span>'
node $trace query $artifact summary
```

Use IDs returned by the artifact, not the illustrative IDs above. `pairs` matches
actual `_trial` occurrences for the same operation object. It can return more
than one candidate per baseline. `diff` reports native event counts, the first
outer expression result, checkpoint/owner state, observed state changes, and
six-boundary comparisons (entry/live/unwind for each trial). A state's versions
can differ even when its fields were restored. `observedMutationSurvived` means
the object's own fields changed from entry to live and the same fields were
observed at unwind; it says nothing about opaque/unobserved children or later
execution. A repeated map reference does not imply its entries were rolled back.

Boundary ownership follows the recorded `enter.parent` ancestry: a checkpoint
belongs to its nearest enclosing `_trial` (including the checkpoint's own span).
An outer trial never borrows a nested trial's completion or unwind, regardless
of matching role, expression, or position in the timeline. Missing, interrupted,
truncated, or ambiguous outer boundaries stay unknown. This is derived when
reading existing v1 artifacts; no recapture or schema rewrite is needed.
`TraceReader.checkpoint(span, phase)` exposes this ownership-aware selection and
returns `null` for an unknown boundary. For ordinary scopes without a trial,
it selects within that scope while excluding any nested trial. `firstResult`
uses the same ownership rule, including ordinary expression-call scopes.
Timeline events and diff work counts remain inclusive of nested native work;
the raw boundary list in `diff` remains an inclusive timeline, not the six
selected outer boundaries. `pairs` continues to match actual trial occurrences
by operation identity.

`reference` edges are object-field relationships. `observed-read` edges record
the value returned by an actual cache `get` to an active occurrence.
`observed-return` edges connect a native occurrence to its actual returned object.
Neither object sharing, a call stack, nor these edges proves transitive semantic
dependence, exclusive ownership, or a whole-operation reuse certificate.

`collection-attempt` precedes the native method; `collection` is emitted only
after that method returns. An early-returning `writeTypeCache` can therefore have
no accepted `set`. An undefined `Map.get` is **not** called a proven miss: an
entry may contain undefined. Native `has` calls are separate. Actual `branch`
and `returnSite` IDs resolve to checked native source expressions in the site
manifest, so cache acceptance/rejection can be read from executed guards rather
than guessed by the observer.

## Standalone local viewer

The viewer consumes an existing v1 artifact. It does **not** load or run the
analyzer, instrument a target, recapture results, or modify the selected file.
It works in an ordinary browser without Copilot, MCP, or a frontend build stack.
After the build above, run from the repository root:

```powershell
$trace = 'packages\pyright-internal\out\packages\pyright-internal\src\trace\cli.js'
node $trace view .generated\evaluation-traces\ordinary.ndjson
# Or select any other existing compatible artifact:
node $trace view .generated\evaluation-traces\failed-pair.ndjson --port 0
```

Open the **exact URL printed by the command**, including its random token.
The default port is automatically allocated; `--port` can request a specific
available port. Keep the terminal open. **Ctrl+C** stops that viewer and closes
its connections; closing its browser tab does not stop the server. The printed
PID identifies this server only. Do not terminate other Node/browser processes.
Restarting generates a new URL/token. There is no HTTP shutdown endpoint.

The server binds only `127.0.0.1`, checks the exact Host and same-origin request
headers, requires a viewer-specific API header, and provides no CORS access.
It serves three fixed assets and bounded read-only queries for the one artifact
loaded at startup, not arbitrary files, directories, captured URLs, or shell
commands. No remote assets, telemetry, uploads, or automatic browser/file opening
are used. Recorded strings are inserted as text, never HTML or script. A strict
content-security policy additionally prohibits inline script and embedding.
Keep the token URL private; it is a local access capability, not authentication
against another process already running as you.

### Linked navigation

1. **Timeline:** filter by event kind, text, logical role, or occurrence scope.
   Select a row to set the shared sequence cursor. Depth and parent information
   describe recorded nesting. Scope filters and native work counts remain
   **inclusive** of descendants. A selected occurrence can become the scope
   filter. Source summaries use recorded file names and UTF-16 offset ranges;
   details retain the full recorded paths/URIs, node metadata, hook text and
   native site offsets. The viewer does not read source files or invent Python
   line numbers.
2. **Graph and fields:** event references, graph nodes, and field-reference
   buttons select an identity at the cursor. Arrows are directed. Solid edges
   are references whose **source's latest observed version at the cursor**
   matches the edge version; this also applies to incoming edges. Historical
   references replaced by a later observed version are not displayed as
   current references. Dashed blue/amber edges are executed reads/returns
   recorded **through** the cursor, not ongoing or transitive dependencies.
   Edge-list sequence links move to the actual edge event.
   Event navigation links include labeled payload paths (such as
   `state.typeCache` and `expressionEntries.typeCache`), owner-state maps,
   inputs/sinks, thrown errors, cache metadata, and entity-creation identities.
   These links navigate recorded metadata; they do not add owner-to-cache
   memory/dependency edges. Checkpoints prefer a state/cache link over an
   instrumentation-owner token. Reference count, depth, traversal, item and
   path-text clipping are explicit; omitted links do not imply absence.
3. **History:** newest observations appear first. Clicking one moves the same
   sequence cursor while retaining identity. Rows after the cursor are marked
   explicitly; their fields never fill in missing past state. Details distinguish
   the sequence that introduced a version from a later repeated observation.
   A version describes latest **observed own fields**, not continuously current
   native state. Unobserved identities, partial snapshots, opaque fields, graph
   expansion caps, and capture gaps remain labeled.
4. **Comparison:** select an actual baseline/candidate pair to see distinct first
   TypeResult identities and raw fields, private failure diagnostics, inclusive
   native counts, and six owned entry/live/unwind checkpoints. It uses
   `TraceReader.checkpoint` and `firstResult`, including their nested-trial
   ancestry rules. Boundary buttons show both checkpoint span and owning trial.
   Version cells link to that entity's **actual matching boundary observation**
   sequence, which can be before or after the checkpoint marker (owner-state
   snapshots can follow it). Their labels show the observation sequence and
   tooltips distinguish the version-introduction sequence. The six top boundary
   controls still link to the checkpoint markers. `boundaryComparisons` exposes
   additive `observationSequences` and `stateSequences` arrays; existing v1
   artifacts, versions and inclusive counts are unchanged. Missing outer
   checkpoints/results remain unknown; an inner completion is never substituted.
   Ordinary captures without pairs retain the timeline, graph, fields, and history.

Capture completion/failure, exhausted tracing, dropped records, graph gaps and
the shared cursor remain visible in the sticky status bar. Expanded coverage
retains the recorded footer and adapter domains. **Native TypeResult
`isIncomplete` and own-field snapshot completeness are different facts**;
neither a complete snapshot nor a shared Type identity proves safe reuse.

### Viewer limits and API

The reader rejects malformed/unsupported schemas and missing footers. A
footer-marked thrown, recorder-failed, or exhausted capture remains viewable
with its incomplete coverage; a physically cut-off file is not silently repaired.
The viewer accepts at most 128 MiB and 400,000 records, loaded once into memory.
HTTP responses are capped at 2 MiB and requests have bounded URL/header sizes.
There is no live tailing or background re-reading of the artifact.

The UI paginates timeline events (40), fields (40), histories (25), pairs (25)
and boundary comparison rows (25). API timeline pages are limited to 100.
Graph expansion is one or two hops, capped at 40 nodes and 100 edges with an
explicit cap notice; it is not a whole-heap graph. Diagnostic previews are
limited to 20 records and inclusive count previews to 100 keys; use entity
collection pages or CLI `diff` for more. Payload previews have depth, text and
item caps marked separately from native recorder gaps. The graph may lack
references whose edge records were not recorded by the cursor (including
truncation); absence is not evidence of no reference or effect.

Reusable Node APIs are `ViewerModel(reader, label)`,
`loadViewerModel(artifactPath)`, and
`await startViewer(model, port?) -> { url, close }`.
Call `await close()` for programmatic cleanup. Construct the model from a
validated `TraceReader(readTrace(text))`; model queries do not mutate artifacts.
No external web server, database, or browser test framework is required.

Focused viewer tests use the existing Jest runner and synthetic fixtures that
are checked in as test code:

```powershell
pnpm --dir packages\pyright-internal exec jest evaluationTrace.viewer.test --runInBand --forceExit
```

Leave `PYRIGHT_TRACE_VIEWER_ARTIFACT_DIR` unset for the portable suite. That
optional variable enables acceptance checks against a specific preserved capture
corpus, including its exact identities, sequences, and link counts. The corpus
is not distributed or required for core tests; those checks are not a generic
validator for newly captured files. The viewer itself accepts any compatible
artifact filename. Synthetic fixtures are explicitly identified and are not
evidence of native work.

## Coverage and limits

The initial domains are expression/result occurrences; runtime, expected,
TypeForm and speculative caches; evaluator and flow generations; flow
cache/pending/finally-gate collection operations; call/argument and constraint
boundaries; diagnostic sinks; inferred-return field assignments; and optional
overload isolation/role boundaries. Per-flow-owner snapshots include its actual
cache set. Generation increments are separate events in separate domains.

This is **not a complete memory-write or dependency tracer**. Coverage is listed
per adapter module with matched site counts. In particular:

- Other definition/binder/symbol effects and arbitrary field writes are
  unobserved or snapshot-only. Snapshot deltas report
  `unknown-between-observations`, not fabricated writer events.
- Not every collection operation or property read is instrumented. Contextual
  search helpers are recorded when present; older inline `Array.find` searches
  are not separately instrumented.
- Complete outward flow results do not certify settled internal flow state.
  A complete expression cache entry does not close the flow-generation domain.
- Type metadata is bounded raw data, not a rendered or fully expanded type.
  Functions, proxies, weak collections, accessors, symbol properties and
  depth-limited children are explicitly opaque. No getter, `toJSON`, arbitrary
  printer, inferred-return evaluator, or extra type query is invoked.

Defaults: 200,000 events, 50,000 identities, 64 MiB output, depth 3, 80 own fields
or collection entries, 200 visited entities per snapshot, 4,096 characters per
string. `--events`, `--bytes`, and `--depth` tune the common limits. The API exposes
all limits. Domain-specific checkpoint depth is bounded separately (at most 4);
container/node limits still apply. Limits stop **observation only**, never the
native analysis. A footer reports exhaustion and gaps; snapshots also report
local completeness. Summary records can be omitted if the budget is exhausted;
the API result and `compare`'s clean/audit files still retain final diagnostics.

State identity is weakly assigned and never attached to analyzer objects.
Observed versions describe own primitive/reference fields, not a global mutation
version. Repeated `observation` records identify the checkpoints where unchanged
states were actually seen. References and snapshots contain IDs, not retained
analyzer objects. Only active native frames and weak-keyed live-owner state
getters retain native context.

The header includes adapter/tool/config/input provenance and native hook source
locations. The summary adds hashes of every loaded local runtime module and
parsed Python input. Selected TypeScript sources, the lockfile and compiled tool
files are hashed separately. Those source hashes **do not assert** that an
existing runtime was built from that source. Loaded runtime, selected source and
input files are checked for changes during the run; unrelated Git refs are not
frozen. File-system/import-discovery reads beyond these inputs and external
dependency internals are not a complete filesystem audit.

Missing or ambiguous required AST hooks fail preflight. A recorder error does
not replace native returns/throws inside instrumented operations: the runner
reports failed capture after native cleanup. Missing footers, unsupported schema
versions and malformed records are rejected by the reader. Never treat a partial,
opaque, unmatched or failed capture as evidence of no effect.

## API and tests

The compiled modules expose `Recorder`, `RuntimeLoader`, `NativeBridge`,
`capture`, `compareCaptures`, `readTrace`, and `TraceReader`. `Recorder` accepts a
record sink and does not depend on Pyright. For another driver, create an isolated
loader, inspect its checked sites/coverage, configure a bridge, load native
modules, and invoke their original APIs. Dispose native resources and the loader
in `finally`; finish the recorder with the actual outcome. Do not reuse a loader
or bridge across concurrent analyses. The built-in runner also accepts an
existing native cancellation token.

The recorder's format, reader, and viewer can support another adapter. The
present checked native adapter is Pyright-specific, not a general heap inspector
or a compatibility promise for other analyzers or arbitrary Pyright revisions.

```powershell
pnpm --dir packages\pyright-internal run test:trace
```

This builds the unbundled runtime and runs unit tests plus real ordinary
generic/loop, truncation and cancellation captures. Normal Jest runs execute
the unit tests; the build-dependent integration suite is opt-in through
`PYRIGHT_RUN_TRACE_TESTS=1`. To include an existing read-only experimental target:

```powershell
$env:PYRIGHT_TRACE_EXPERIMENTAL_TARGET = $target
$env:PYRIGHT_TRACE_EXPERIMENTAL_INPUT = $inputFile
$env:PYRIGHT_TRACE_EXPERIMENTAL_START = "$start"
$env:PYRIGHT_TRACE_EXPERIMENTAL_END = "$($start + 'ret.nonexistent()'.Length)"
pnpm --dir packages\pyright-internal run test:trace
```

That additional integration test requires a genuine failed pair, compares native
work/diagnostics, checks the complete live root entry against the actual first
return, checks map-reference restoration, and requires executed replay writes.
It does not weaken any analyzer type assertions or change existing samples.

Reader-only nested-boundary regression coverage can also consume a preserved v1
artifact containing a real nested trial, without running or modifying its target:

```powershell
$env:PYRIGHT_TRACE_REENTRY_ARTIFACT = (Resolve-Path '.generated\evaluation-traces\nested-trials.ndjson').Path
pnpm --dir packages\pyright-internal exec jest evaluationTrace.test --runInBand --forceExit
```

The filename is illustrative, not a fixture allowlist. Ordinary unit tests use
explicitly synthetic traces to cover nested baseline/replay, missing outer
completion/unwind, and non-nested boundary ownership.
