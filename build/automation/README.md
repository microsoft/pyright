# Parallel Pyright issue review

`review_issues.py` uses the Python Copilot SDK to investigate open **microsoft/pyright** issues in bounded chunks.
Each issue first gets an isolated historical/main reproduction comparison and evidence gate. Cases that remain
unresolved get a behavior investigation from `pyright-issue-by-design-reviewer` (`review.md`), a separate duplicate
investigation (`duplicates.md`), and a
tool-less adjudication. Issues in each chunk are evaluated concurrently, with automatic root-cause analysis for
reports that do not qualify for closure. The console displays a table with **By Design**, **Dupe**, and
**Root Cause Summary** columns before publication.
**Non-dry runs automatically label qualified non-reproductions, close verified fixed/by-design/duplicate issues,
or post a qualified root-cause investigation while leaving other issues open.** There is no per-issue publication
prompt. Use `--dry-run` to disable all comment drafting and GitHub mutations, and `--no-rca` to disable RCA.
The explicit `--rehearse-closures` exception runs closing-comment preparation without enabling publication;
ordinary `--dry-run` behavior is unchanged.
Dry runs save per-issue `proposal.json` files and a run-level `proposals.json`, including the proposed action
(`close_fixed`, `label_not_reproducible`, `close_by_design`, `close_duplicate`, `post_root_cause`, `leave_open`, or `blocked`), per-claim confidence,
blocking reasons, and evidence paths. These are unreviewed action proposals, not closing-comment drafts or
publication authorization. Writer/draft validation and publication freshness checks remain unperformed.
Failed or screened-out issues remain explicit; run completion does not mean every investigation succeeded.
The console does not implement fixes.
The original `pyright-issue-reviewer` remains a separate read-only, non-executing reviewer and is not used by this console.

## Publication-disabled closure rehearsal

`--rehearse-closures` exercises the **real rich-mirror writer, factual reviewer and pre-publication gates** for
by-design, duplicate and fixed candidates. It requires an explicit `--issues` list and a fresh `--state-dir`,
implies noninteractive read-only publication, disables RCA and separate diagnostic experiments, and uses cached
checker targets unless `--prepare-targets` is explicitly supplied. It never grants execution approval.
It is not exploratory reproduction and cannot promote observation-only receipts or unresolved claims.

For a fresh, bounded investigation followed by closure rehearsal:

```powershell
uv run --env-file .env build\automation\review_issues.py --rehearse-closures `
    --issues 11946 --chunk-size 1 --timeout 300 --reproduction-timeout 300 `
    --target-cache C:\issue-reviews\prepared-targets --state-dir C:\issue-reviews\closure-rehearsal
```

To exercise only a selected **frozen candidate**, without reinvestigation, use `--rehearsal-from` and a distinct,
non-overlapping output directory:

```powershell
uv run --env-file .env build\automation\review_issues.py --rehearse-closures --overnight `
    --issues 11946 --chunk-size 1 --timeout 300 `
    --rehearsal-from C:\issue-reviews\frozen-overnight `
    --state-dir C:\issue-reviews\derived-closure-rehearsal
```

Retain the source run's applicable mode, model, target-cache, registry and editor options when comparing identity
(the example source used `--overnight`). The controller copies only the selected entry, reports and check ledger
byte-for-byte. Embedded execution paths remain frozen read-only inputs; new SDK logs, drafts and rejection artifacts
go to the derived directory, including fixed-comment checks. It does not copy an entire run, rewrite source
artifacts, recompute their adjudication or bypass implementation/context, report-integrity, canonical-issue,
issue/discussion freshness, screening, target-integrity or claim-eligibility gates.
Changing controller code or evidence contracts normally makes an old candidate **stale**. That is a useful saved
rejection, not permission to reseal it. A fresh investigation is needed to exercise later stages under the new
contract; do not call those unexecuted stages successful.

Each issue retains `rehearsal.json`, the proposed `comment.md` once produced, and the normal factual-check/SDK
artifacts. Run-level `rehearsals.json` records completion separately from per-issue results. Stage outcomes are
`untested`, `running`, `passed` or `rejected` for eligibility, writing, factual review and final eligibility.
Failures retain the draft and available factual problems, with explicit blocking reasons. Missing prerequisites
and failed investigations leave unreached closure stages untested. An existing publication ledger requires manual
reconciliation rather than being resumed by rehearsal. Standalone non-reproduction labels and RCA comments are
outside closure rehearsal.

The GitHub transport rejects every non-GET request and GraphQL in this mode, in addition to the controller's
read-only publication guards. No comments, issue/repository labels or closures can be sent, and no retry/publication
ledger is created. Final eligibility reuses the live pre-publication checks after factual review and rechecks the
discussion against the pre-draft snapshot. Checks that require an actual comment, label or closure, and GitHub's
confirmation of those mutations, remain explicitly **untested**. Even a passed rehearsal has
`publication_ready=false`; it is not publication authorization and its state cannot be resumed as a live run.

## Unattended closure-only review

Use **`--overnight`** to advance through every selected chunk without prompting. This is a separate publication
policy: only existing evidence-gated **fixed, by-design or duplicate closures** may publish. Their explanation
comments still use `rich-mirror`, factual validation and final freshness checks, with any associated closure
labels. Non-reproduction labels and standalone RCA comments are disabled; all other cases remain open for
review in the local report. This does not substitute confidence scores for evidence or relax closure gates.

Start with a small rehearsal:

```powershell
uv run --env-file .env build\automation\review_issues.py --overnight --dry-run `
    --issues 11899 11890 11882 --chunk-size 1 --state-dir C:\issue-reviews\overnight-trial
```

Omit `--issues` to select all open issues. `--dry-run` does not draft or publish comments, labels or closures;
its "would close" results remain unreviewed candidates pending writing and publication checks. Do not remove
`--dry-run` until those candidates and the configured permissions have been reviewed.

Configure permissions **before launch**. The SDK permission handlers remain restricted: probes needing operator
approval are denied and recorded instead of asking for input. Overnight mode uses only integrity-verified cached
checker targets by default. `--target-cache <directory>` reuses an existing cache; unavailable or changed targets
remain blocked. `--prepare-targets` explicitly preauthorizes the existing trusted-registry download/build path,
not arbitrary commands, package installs or issue-provided scripts. Choose `--reproduction-registry` explicitly
when using the approved alternative feed. Source-CLI behavior checks still need the existing local build
(`pnpm run build:cli:dev`); do not change source or build outputs during a run.

The controller performs one bounded version preflight for the source CLI and isolated controller-interpreter
mypy, shared across concurrent issues. `capabilities.json` preserves commands, versions, outputs and failures;
behavior assignments receive the same snapshot. Unavailable mypy stays explicitly unperformed, and requests
are rejected without repeating the failed subprocess. Preflight never installs dependencies, changes interpreters,
executes reporter code, or establishes a semantic comparison/reproduction. Runtime Python still needs per-probe
human approval and is explicitly unavailable unattended.

Bounded tool descriptions and parameter schemas state the calling convention: `github_read` searches are
already scoped to `microsoft/pyright`, so omit `repo:`, `org:` and `user:`. Pyright and mypy accept no caller CLI
arguments. Configure Pyright in scratch `pyrightconfig.json`; mypy needs an existing scratch-relative `.py` file.
Rejected requests retain the original request and actionable correction guidance, never silently rewritten scope
or arguments. These setup improvements do not relax reproduction, evidence, screening or publication gates.

When strict reproduction is blocked, overnight mode also attempts **separate controller-run diagnostic
observations**, without another model-planning turn. This bounded fallback checks explicitly labeled Python
fences and an unambiguous captured setup. Separate snippets run as isolated specimens, never concatenated;
distinct explicitly named files from one document can form a conditional multi-file specimen. Same-filename
variants and different documents remain separate. Original/control relationships and cross-snippet dependencies
are not inferred. Source IDs, file paths and these qualifications remain visible for each specimen. At most
eight source/settings cases run; an exceeded budget or capture limitation blocks explicitly rather than truncating.
The fallback retains the captured source unchanged and preserves
reported settings. When different documents mention different Python/checking settings, the fallback can use
a coherent profile from the document containing the source as a **conditional experiment**. Other declarations
and their contexts remain visible in the report, including possible corrections; selecting the original
document does not establish that later comments are irrelevant. Separate complete configurations, commands,
URLs or prose paragraphs in that document can also supply independent **conditional setting profiles**.
For example, explicit Python 3.13 and 3.14 comparison commands can each be checked without treating them as
contradictory settings for one execution. Settings from one configuration stay together; profiles are never a
cross-product of version/mode fragments. Equivalent static settings share a check, preferring explicit configuration
over interpreter-version prose while retaining all captured contexts and patch-version qualifications.
These profiles do not establish which case was the original, a control or an authoritative correction.
Conflicting values within one context, unsupported declarations, ambiguous source layouts and unavailable targets
remain explicit blockers.
Only genuinely absent settings receive disclosed experimental defaults: `pythonVersion=3.13` and
`typeCheckingMode=standard`. `--no-observations` disables this fallback.
The fallback uses the same reported-version reference reader as target selection, including references such
as `npx pyright@1.1.414`. Ambiguous or unavailable historical versions block that target, not independent
main/latest experiments. Checker-version references remain captured; this does not relax Python/checking
configuration requirements or the strict path's historical-target selection.

The fallback only statically checks source; it never executes reporter Python, installs dependencies or
substitutes an older main target. It uses the same cache-only/preauthorized-target policy as the strict path.
Missing imports and runtime-dependency differences remain visible in raw diagnostics. Results, source/settings
capture, target identities and assumptions are saved under `<issue>\diagnostic-observations\<attempt>`, and
summarized in the morning report. They are **not faithful historical reproduction, fix verification, type-precision
proof, or independent closure evidence**. The strict comparison and all publication gates remain unchanged.

Target-cache restoration, integrity hashing, archive extraction, main-bundle copying and owned-directory cleanup
run in worker threads so slow filesystem operations do not block another issue's screening timeouts or retry wait.
The same provenance and before/after integrity checks remain mandatory, including resumed assessments and
publication revalidation. Cancellation drains the current filesystem operation before cleanup or cache-lock
release; it never leaves a worker writing into a directory that has already been removed. Screening budgets,
retry limits and fail-closed decisions are unchanged.

Reconstruction/evidence-gate turns have an independent `--reproduction-timeout` budget (default 900 active
seconds each, including bounded correction), so shortening `--timeout` for other stages does not accidentally
starve reconstruction. Clearly absent checking-mode reports skip strict model planning in favor of recording
that blocker and attempting the separate observation path.

Missing reported settings are never silently promoted to facts. `--exploratory-reproduction --overnight --dry-run` permits
the existing disclosed, observation-only experiments, but cannot authorize live closures. Legacy
`--non-interactive --dry-run` still stops after one chunk; `--overnight` takes precedence for all-chunk processing.
Switching between overnight and other publication policies requires a fresh state directory. A compatible
overnight dry run can later resume live, but must perform the pending writing and freshness checks first.

The state directory retains raw investigations and evidence and contains **`overnight-report.md`** and
**`overnight-report.json`**, updated after each chunk and on normal exceptions/interruption. They include every
selected issue, including unchanged cached results, failures, screening skips and pending issues, and distinguish
closure candidates from confirmed closures and partial publication failures. A completed run does not mean every
issue was resolved. Hard process termination leaves the latest checkpoint report, which must not be interpreted
as a completed run. Dry runs also retain the existing per-issue and run-level action proposals.

A supported, observed, non-low-confidence bug claim is sufficient for a `bug` classification even when regression
history, an ancillary example or a proposed repair remains unresolved. Those claims and qualifications stay in
the report. This is intentionally asymmetric: one supported bug establishes a reason to keep the issue open,
but by-design and duplicate closure retain their existing all-claims evidence requirements.
Completed keep-open bug investigations have the `keep_open_bug` outcome rather than `needs_review`.
Fresh claims must also supply `expectation`: `mandatory_rule`, `intended_behavior`, `additional_analysis` or
`unresolved`, with an explicit expected behavior, reason and claim-local source evidence. Requirement/accepted-intent
evidence includes an exact excerpt retained in `Source.finding` and an application to the code's actual premises,
settings and versions. Accepted intent identifies a verified regression test, documented contract or applicable
maintainer decision; today's implementation, proposed PRs, labels and runtime/mypy parity alone do not suffice.
Only a mandatory-rule or established-intent failure supports `bug`. Desirable additional analysis is not
automatically a bug, and lack of a spec mandate does not automatically establish by-design behavior.
Old schema-version-one entries remain readable with a missing/null expectation explicitly **not recorded**:
no evidence is inferred, old bug tags do not become supported under the new gate, and missing bases block new
by-design and duplicate closures. Fresh reviews reject null expectations; existing frozen runs are not rewritten
or rescored. The reports expose per-claim bases and category counts, not an accuracy claim based on bug labels.
The report also records `triage_category`, `next_action`, per-category counts and the investigator's recommendation,
distinguishing semantic decisions, missing applicable product execution, transient infrastructure failures and
screening rejections. Disabled RCA is a policy note, not a failed investigation.
Duplicate metadata can explicitly prefer the current issue as canonical. `keep current` requires completed
searches, inspected source-linked shared causes and consistent canonical preferences without unresolved candidates;
it never authorizes closing either issue. Ordinary duplicate closure still requires a different verified canonical.

Use a **fresh state directory** after these policy/code changes. Prior run evidence is not upgraded or rewritten;
new observation attempts and read-only comparisons must retain their own source/settings and target provenance.

## Read-only issue assessment

The versioned assessment workflow is separate from the publication-capable console above. Its goal is a useful
per-claim assessment, not a closure proposal. It cannot draft comments, label, close, resume a publication ledger
or fall through to automatic RCA, even when observations look fixed or a validity assessment proposes by-design
behavior. Existing strict and exploratory console modes retain their original contracts.

Assessment keeps these questions separate:

| Question | Evidence or result |
| --- | --- |
| What does the report supply? | Controller-captured source and settings with document locations, provenance and hashes. Original code is selected by captured ID, not regenerated by the model. |
| Is a claim executable? | Ready, partial or blocked, with concrete setup requirements and missing evidence. Partial/blocked claims do not require guessed diagnostic messages. |
| What was actually observed? | Separately identified historical discovery, frozen verification, pristine original runs and separate precision controls. Missing execution remains unobserved. |
| Is the concern valid? | Per-claim specification, documented-policy and precedent reasoning, with applicable premises, counterevidence and explicit uncertainty. |
| Is action authorized? | No. The assessment workflow is permanently read-only, independently of its conclusions. |

Executable verification claims retain exact symptom and affirmative precision requirements. An independent
supported claim may progress while another is blocked, provided shared source and setup support the observation;
the unresolved claim is not dropped from the report or treated as resolved. Runtime dependencies, checker-bundled
stubs and version requirements are distinct capabilities. Unknown compatibility and experimental assumptions
must not become reported facts or silently trigger installation.

Playground URLs are parsed as bounded reported query declarations, with exact raw spans and explicit URL-decoding
provenance. Encoded example code is not reconstructed or executed. Unrelated URLs are not configuration evidence;
malformed values, conflicting declarations and unsupported settings still block. Only `strict=true` establishes
strict checking; `strict=false` does not invent a basic/standard mode. Invalid literal patch-version settings
remain invalid. Ordinary static diagnostics/revealed types use the CLI adapter without claiming that the reporter
invoked it. Genuinely editor/LSP/runtime-only concerns remain separate unsupported claims; supporting diagnostic
lines, workarounds and precision controls need not become redundant material claims.

Reported Python/checking settings are applied automatically; `setting_choices` is exclusively for explicitly
authorized experimental assumptions about genuinely absent settings. Repeating a reported value there is rejected
with correction guidance, even when its reason says "reported". No assumed-settings permission is needed to use
captured settings, and the controller does not silently remove or reinterpret invalid choices.

If different original/control examples supply different settings, a claim may provide `reported_settings`:
each selection names `setting` (`pythonVersion` or `typeCheckingMode`), captured `declaration_ids`, an exact
surrounding `context` (`document_id`, `start`, `end`, `quote`), and a `reason` explaining its association with that
original. Values always come from the capture. The selection must include every same-setting declaration in its
JSON/shell fence, playground URL or prose paragraph and every overlapping declaration in its context. Conflicting
keys/options within one such unit remain conflicting. Unsupported/invalid declarations, other configuration
settings, malformed configuration and unsupported surfaces cannot be scoped away. Without an explicit selection,
the existing conservative global conflict behavior remains unchanged.

This is evidence-bound interpretation, **not approval of historical configuration**. Selected and excluded
declarations remain in the materialized setup, and its exact context/reason/source grouping/settings are hashed
into the claim's discovery, verification and setup proofs. Results disclose the conditional setup in progress
records and semantic input. The controller attaches a non-removable qualification that prevents a fully supported
validity verdict, even if the model omits it or a capability proof approves that exact setup. Original/control
comparisons not executed under the selected setup remain explicitly unverified; precision controls still use
the pristine original's exact configuration. New settings do not upgrade old checkpoints or the faithful-historical
holdout gate. A source-level `# pyright: strict` is not promoted to unknown whole-project configuration.

Discovery is useful when suitable original source and setup exist but exact diagnostic wording was not supplied.
The controller freezes the reported claim scope, failure direction and pristine inputs first. Historical discovery captures actual
output without calling it reproduction, a fix or affirmative non-reproduction. A later verification plan is
frozen separately and needs fresh original/control executions. Main/latest outcomes cannot be used to choose a
convenient historical symptom, and discovery receipts cannot substitute for verification. An unexpected diagnostic
that is absent historically must not become a missing-diagnostic claim to force reproduction. Exact reported
wording can support honest all-negative verification; unknown wording that was not observed remains unresolved.
One material concern may have several reported diagnostics. `DiscoveryScope.reported_symptoms` freezes their
exact messages/rules at individual captured source locations before discovery, without splitting them into
redundant claims. Different messages use a null common `reported_message`. Refinement must retain every frozen
location and scoped symptom; a single convenient diagnostic cannot establish the whole concern.
An abbreviated report excerpt or CLI presentation suffix is not a complete JSON diagnostic message. When no
complete message is available, preserve the raw quote, known rule and narrow question/locations with unknown
wording; only then may historical discovery supply exact wording at those locations. Known wording is immutable.
An unobserved diagnostic rule must also have been frozen from the report; otherwise its predicate uses null.
The read-only assessor's explicit `--allow-rule-location-predicates` opt-in additionally handles missing
diagnostics whose complete wording is unavailable. It still starts with historical discovery: freeze every
single-line symptom location and any reported rule first. An explicitly reported comparison may be frozen in
`DiscoveryScope.reported_context` with its source ID, line, exact report quote, and
`relation="same_rule_comparison"`. Only an actual error rule at that exact historical comparison may supply
an otherwise unknown rule. `relation="supporting_diagnostic"` retains other report-grounded diagnostic context,
but never supplies a missing rule. Quotes, selected sources, bounds and context/symptom separation are checked
before discovery; a convenient neighboring diagnostic cannot become a comparison after seeing the output.

Refinement may then use `message=null`, an explicit error rule and the identical frozen line in both
broken/absent and resolved/present predicates. Known wording cannot be discarded, missing locations cannot be
dropped, and guessed rules, broad ranges and line-only/any-error matching remain forbidden. Exact historical
messages at the frozen context locations can be retained in `context_diagnostics`: these permit only that
saved error/warning when present, without making its presence a reproduction or precision condition. Other
errors/warnings still block. Separate precision trees preserve original whole lines and append instrumentation;
the original execution remains pristine and affirmative exact type checks must pass. A different diagnostic
rule does not count as the intended diagnostic or a fix. Receipts and validity input disclose when rule/location
rather than exact-message matching was used. The policy is frozen per run and cannot upgrade an existing
checkpoint. Default assessment and all publication callers retain exact-message-only classification.

Refinement is a planning stage: it proposes justified predicates and, when needed, a complete separate precision
tree before those checks have executed. Predicted precision types are expectations to test, never observed output.
The controller checks the proposed tree during the role's shared correction budget, freezes both variants, and
runs originals before controls. A failing precision expectation still blocks the observation; no failed or
unexecuted control is promoted to evidence. Complaint presence/absence does not settle semantic correctness.

Precision predicates are invariants required on both broken and resolved targets, not expectations that the
bug is already fixed. For wrong-type complaints, retain a justified affirmative corrected-type predicate in
`resolved` alongside invariant checks; disappearance of a bad type or an unrelated successful query does not
prove affected-type safety. If those expectations cannot be justified, keep the assessment blocked.
Before freezing an executable plan, the controller rejects contradictory presence/absence requirements and
incompatible types at one standalone reveal query, including conflicts with shared precision across claims.
Original precision must be compatible with each claim's broken and resolved states. Separate control precision
is checked in its own phase; multiple queries on one line remain subject to runtime checks rather than being
assumed to identify a single query. Contradictions reach the existing role correction budget, not automatic
predicate removal, weakened expectations or extra model attempts.

For recognized default CLI diagnostic rendering, the controller supplies optional diagnostic candidates with exact
raw report spans. It removes only the two-space renderer prefix on continuation lines and a separately recorded
rule suffix; this is not arbitrary whitespace normalization or an observed checker result. Canonical wording is
frozen before discovery and remains unchanged even when the historical diagnostic is absent. Unrecognized output
still requires exact reported text or honestly unknown wording.

Validity responses add model qualifications to the frozen claim/language qualifications; the controller preserves
their union without asking the model to retype it. `rule.section=null` asks the controller to attach the canonical
section from that exact saved evidence ID. Final records must have matching sections and verbatim excerpts;
invented non-null sections, altered excerpts, wrong domains and cross-claim references still fail. A claim-local
reference catalog makes those scope constraints explicit, including for additional material claims. Controller
assumptions still prohibit a supported conclusion; attachment never silently downgrades a finding. Readiness-stage
reasons are labeled as pre-execution context, not substituted for the current controller receipt ledger.
If all independently qualified original observations are absent and none is reproduced, the alleged product
bug remains inconclusive. Conditional specification analysis belongs in its explanation, not a `bug/qualified`
disposition. Unobserved/discovery/control records do not override original observations; a genuinely reproduced
historical symptom still counts when main/latest are absent. A supplied stub/configuration/dependency cause
uses `stub_or_environment`, even when the specification correctly explains that behavior. Without qualified
original reproduction, that causal finding remains qualified or inconclusive rather than supported.

Validity input factors byte-identical source/setup records and exact checker-target metadata across authorized
claims. Execution content retains all parsed stdout fields and diagnostic text; repeated absolute filename prefixes
are factored by diagnostic index and reconstruct exactly as prefix+file. Non-JSON, duplicate-key or nonfinite output
remains verbatim with its parse failure, never a success-shaped replacement. Complete receipts and raw stdout remain
in their original artifacts with hashes. No claims, diagnostics or normative excerpts are truncated, observations
are not upgraded, and the 192,000-byte input limit and single 180-second validity-role budget are unchanged.
The rule catalog states each reference's actual domain and the exact controller Python target. A mismatched rule
is invalid even in an inconclusive finding; missing applicability needs a precise information request instead.

Calibration uses a small, explicitly named development set before another backlog campaign. Expected judgments
and solution-bearing resolutions stay outside model input. Candidate references remain provisional until human
review; synthetic contract cases are not actual issue/checker observations. Execution coverage, useful
information requests, unnecessary abstentions, incorrect settled conclusions, operational failures, latency
and raw SDK usage are reported separately. Old twenty-case protocols and scores are not rewritten.

### Assessment entry points

`assess_issues.py` runs readiness, eligible historical discovery/refinement, fresh verification, and independent
validity assessment in one command. Each model role has one 180-second active budget, including its ordinary
correction; there is no automatic retry with a reset budget. The default is cache-only. `--prepare-targets` is
the separate explicit opt-in for trusted target acquisition/builds, never for installing reporter dependencies.

```powershell
python build\automation\assess_issues.py --issue 12345 --state-dir .assessment-new `
    --target-cache C:\approved-target-cache --catalog C:\approved-target-cache\catalog.json `
    --main-sha FULL_UPSTREAM_MAIN_SHA
```

Replace the issue number, paths, and pinned SHA with the intended inputs. Omitted Python/checking settings stay
missing unless `--allow-assumed-settings` explicitly authorizes bounded, disclosed experimental choices.
Prose interpreter versions may end a sentence with a period; the captured version/span excludes that
punctuation without changing report bytes. Malformed, explicitly quoted and literal/CLI setting values
are not repaired this way, and other missing settings remain blockers.
`--reference URL` supplies bounded authoritative typing/Python rules, pinned Pyright documentation, or relevant
Pyright precedent for controller retrieval. Ordinary live validity roles also receive only `read_reference`
for bounded authority discovery, not native reads, shell, checker execution or general web/issue search.
Supplied URLs, subsequent searches/pages and the one correction share 12 requests, 48,000 characters
and 4,000 characters per read; failed reads consume requests. Model-initiated reads and any correction
remain within the existing 180-second role deadline.
Each new excerpt is screened before it is saved or made citable. This is not autonomous precedent search.
Reference screening also retains exact inputs and attempted classifier requests in a separate
`roles\validity\screening-diagnostics` quarantine. These files are diagnostics, not authorized reference evidence;
rejected or cancelled excerpts never enter the citation catalog.
Python language rules are
version-qualified and cannot override mandatory static typing rules. Without adequate normative evidence,
semantic conclusions remain qualified or inconclusive. No CPython or mypy comparison is implied by a static
checker receipt.

`--snapshot` accepts a typed controller-frozen `AssessmentInput`; `--frozen-targets` and `--normative-evidence`
must match its hashes. Frozen blind inputs prohibit identity/resolution research and old validity-input injection,
including on resume. Sources are always recaptured from exact report/discussion bytes, not reconstructed from
candidate files or prior checker receipts. Synthetic inputs have no fabricated GitHub identity or creation date.
Individual `--phase` operations use only this workflow's version-one checkpoints, not publication ledgers.
`--setup-evidence` accepts an operator-approved `AssessmentSetupEvidence` JSON record containing `schema_version=1`,
`capture_hash`, `targets_hash` and `capabilities`. It requires a fresh `--snapshot` and `--frozen-targets`;
the hashes bind the exact controller source capture and full ordered target records. Capability digests and
bounded local proof-file bytes are rechecked before an SDK client starts. These are existing setup proofs,
not installation permission, fresh issue observations or general feature equivalence. Different source grouping,
configuration, capture identity or target records need separately approved evidence. The API exposes the same
check through `validate_setup_evidence`; normal requirement resolution still rejects incompatible capabilities.
Optional `selections` preserve the exact reconstruction behind those proofs. Each selection contains
`setup_hash`, captured-source `associations` (source ID, path and optional exact filename quote), and
`setting_choices`, including their original assumption-reason text. The controller rematerializes every selection
and resolves its exact requirements against the supplied capabilities before any model call. A changed path,
source grouping, setting, or assumption provenance cannot reuse a proof merely because the effective settings
look equivalent. Selections must agree with the snapshot's frozen choices; a disagreement requires a separately
reviewed new input/selection, not editing or upgrading previous evidence.
The readiness prompt exposes this validated catalog, and its validator rejects renaming selected source IDs or
relabeling assumptions rather than silently losing applicable proofs. Selection identities are frozen with the
policy and checkpoint. Separate examples remain separate groups; a proof for one group does not approve another,
and unsupported concerns stay explicit. These associations are controller conventions, not newly reported filenames.
Selections may additionally freeze `reported_settings`; the controller rechecks their captured IDs/context and
requires the matching claim to retain the exact approved selections. Such setup proofs do not remove their
conditional semantic qualification.
For the API, pass the complete record through `setup_evidence=` to `assess`; capability-only
`setup_capabilities=` remains supported but does not supply a reconstruction catalog. The two overrides cannot
be combined. Frozen benchmark runners do not implicitly acquire this new input; their contracts remain unchanged.
The controller filename catalog distinguishes captured filename quotes from inferred path conventions. A command
mentioning a filename cannot substitute for that source's captured `filename_evidence`.

Static-only assessment can accept a `reportMissingModuleSource` warning for `typing_extensions` when the exact
source group has complete approved stub/feature proofs for that exact checker target, and the bundled stub still
matches its captured hash. The warning must identify the unchanged original module token with the exact rule,
severity, wording, path and position. Controls must preserve the original source as a prefix and add only
instrumentation over existing values, not new imports or uses of the module object/alias. This prevents a
deduplicated import warning from approving additional unproved features. The warning remains verbatim in discovery and verification receipts, with
`raw.static_stub_support` naming capability digests retained in setup evidence. Discovery remains discovery, and
independent originals and affirmative precision controls remain necessary. Missing static imports, unproved
features, other warnings/errors, stderr and Any/Unknown precision loss still block. Proofs do not carry across
targets, source groups or versions. The default reproduction/publication classifier remains strict unless the
assessment controller explicitly supplies the proved module context. Static evidence does not establish runtime
installation, execute Python, supply a missing reporter dependency version or relax historical-fidelity gates.

### Small calibration, not an accuracy claim

The six tracked candidates remain **provisional**: four synthetic reporter contracts and two verbatim, previously
examined reports. The two real reports have unsettled semantic references and disclosed checking-mode assumptions;
they are neither bug gold nor independent holdouts. No approval or live calibration result is supplied with the
fixtures. Review exact input and judgment hashes before creating a separate human-reviewed candidate file.
References may explicitly allow an alternative conclusion only while the claim has no verified original
reproduction. The synthetic omitted-assignment-error case accepts an evidence-qualified concern or an inconclusive
report assessment in that situation; inconclusive is not an automatic reference match after actual reproduction.
This records a reference judgment, not permission to run the cohort or an approval of the other references.

```powershell
python build\automation\evaluate_issue_assessment.py inspect
python build\automation\run_issue_assessment_benchmark.py freeze --cases reviewed-cases.json `
    --targets frozen-targets.json --sources normative-sources.json --output calibration-freeze-new
python build\automation\run_issue_assessment_benchmark.py run --cases reviewed-cases.json `
    --targets frozen-targets.json --sources normative-sources.json `
    --protocol calibration-freeze-new\protocol.json --target-cache C:\approved-target-cache `
    --output calibration-run-new
```

`frozen-targets.json` is a list of `FrozenTargetAssignment` records: exact candidate `input_sha256`
(`record_hash(candidate.input)`), honest selection provenance, and three existing `ReproductionTarget` assignments.
`normative-sources.json` is a list of controller-captured `ValidityEvidence`, not expected answers. Use the cache's
actual approved `--registry` when needed. Freezing performs no SDK, checker, screening, or acquisition work.
Execution refuses provisional references before starting any of them or creating evaluation output. Changed
approvals, code, profiles, SDK, targets, or source records require a new freeze; old results are not rewritten.

The runner calls the actual read-only assessor, with opaque identities and separately scoped normative evidence.
It retains phase artifacts, raw SDK usage and independent original/control/discovery receipts. Fresh executions
on synthetic report sources count as real executions, separately from retained-public-report coverage. Discovery
cannot qualify a verified original observation; controls cannot establish the original symptom.
Originals that already contain affirmative precision queries can qualify those checks directly; the ledger marks
that proof explicitly without inventing a separate control execution. Phase failures remain visible even when a
later validity assessment produces useful qualified findings. Confirmed completed
receipts survive an unknown total as an explicitly marked lower bound, not a fabricated zero. Numeric SDK cost
units are not converted to dollars, and token capacity is not labeled consumed tokens. Additional discovered
claims remain visible and require reference review; they are never mapped to a convenient expected claim.
Useful information requests and unnecessary abstention still require explicit human utility judgments. Reference
agreement does not prove semantic correctness or authorize closure.

Summaries also report `judgment_quality`: primary reference matches, matches accepted only through a conditional
alternative, non-abstaining decisions, and inconclusive results. An always-inconclusive baseline uses the same
saved observations and reference conditions, without another model call. Matching that baseline is not evidence
that the assessor distinguishes bugs from correct behavior. Decision coverage measures non-abstaining predictions
among completed scored claims; non-abstaining reference-agreement yield retains all planned scored claims in its
denominator, including missing and failed cases. Empty denominators produce `null`, not a passing percentage.
Metrics separate all references, human-reviewed references, and human-reviewed retained-report holdouts. Synthetic
and previously exposed development results are not independent real-issue accuracy. The disposition confusion
counts use only singleton settled references, exclude additional unreferenced claims, and do not consider
qualification status; exact status matching remains required for agreement. A reference permitting multiple
dispositions does not supply a unique gold label. An allowed abstention is not declared incorrect, useful, or
unnecessary by these metrics. No rate establishes semantic accuracy or authorizes unattended rollout.

For an explicitly approved semantic-only development check, `ValidityEvidence.target="experimental"` identifies
a deliberately chosen conditional checker setup rather than a historical, main or latest observation.
Experimental execution evidence can be `discovery_only` or `unobserved`, never `verified_reproduced` or
`verified_absent`. It cannot support a settled product defect or overturn verified-negative originals.
Using saved experimental evidence to assess conditional reasoning does not exercise the full assessor, prove
historical fidelity, change an independent-holdout gate, or authorize an unattended run.

Validity prompts identify whether reference retrieval is actually exposed. Frozen snapshots, frozen normative
evidence and supplied `--validity-input` remain saved-evidence-only, with no model-initiated lookups.
For ordinary live input, screened returned references extend the claim-local catalog without changing the
frozen initial input or its hash. Default reads of authoritative HTML section URLs locate
the actual visible anchor, not a table-of-contents link or the page introduction. Missing, hidden or ambiguous
anchors and unsuccessful text searches fail explicitly. Explicit nonzero offsets still page the document's
visible text; each saved excerpt records its actual absolute offset. Pinned Markdown/precedent readers do not
resolve HTML anchors: use an unfragmented URL with explicit text search or paging instead.

Conditional rule application is assessed separately from missing historical settings, untested variants and
an unknown implementation cause, while retaining those obligations and qualifications. Having no verified
originals is not a verified-negative result. The nonempty all-negative-original rule remains unchanged, and
neither these distinctions nor correct reference delivery establishes improved model judgment accuracy.

## Historical reproduction before RCA

`pyright-issue-reproducer` reconstructs an inspected static-only scenario from the screened issue and complete
discussion. It does not execute reporter code/commands or diagnose a cause. The controller freezes pristine
report-faithful `files`, explicit Python/checking settings, exact original symptom predicates and affirmative
precision controls. Added queries belong only in a separate complete `control_files` tree, with the same file set
and configuration. Every original target executes before any instrumented controls, in separate immutable probe
directories with independent raw receipts. Only original executions establish reproduction/resolution; controls
must also pass but cannot replace the original or erase a reproduced symptom. If the original symptom cannot be
observed without modification, the stage abstains. Both frozen variants are compared identically against:

- The explicitly reported published Pyright version, when available; otherwise the newest actual npm publication
  on/before **issue creation**, not its last update. Date-based selection is explicitly approximate, not a claim
  about the reporter's exact binary.
- Actual upstream `microsoft/pyright` **main pinned to a full commit SHA**, fetched into an isolated target cache.
  The feature checkout and its prepared CLI cannot stand in for this target, even with matching version strings.
- The latest npm publication at selection time, independently executed to distinguish released fixes from fixes
  awaiting release. An unavailable latest target does not invalidate an otherwise verified historical/main fix.

Only the fixed project npm package is acquired. Direct npm remains the default and requires its published SHA-512
integrity. An operator may explicitly select the configured Microsoft feed with
`--reproduction-registry https://packagefeedproxy.microsoft.io/npm`; there is no automatic registry fallback.
This mode uses the installed npm client with certificate verification and package scripts disabled for metadata
and exact-version package acquisition. It verifies the feed's published SHA-1 checksum when SHA-512 metadata is
absent, and separately records SHA-512 of the acquired archive. That local SHA-512 receipt is **not** claimed to
be a published checksum. Registry choice, exact metadata/acquisition commands and both checksums are preserved
and bound to cache/run identity. Unexpected package identities/URLs and checksum mismatches remain blocked;
archive links and path escapes are rejected. Main is fetched from the fixed upstream repository,
checked against its pinned SHA, and installed with the upstream frozen lockfile and dependency scripts disabled.
Its uniquely owned source work directory uses the system temporary root to avoid Windows loader path limits,
not the deep hashed runtime cache. Both released and source-built targets retain and execute their unchanged
package `index.js` beside complete `dist` assets; running the inner bundle directly skips upstream typeshed-root
initialization. The cache layout is separately keyed, and resumed direct-bundle targets are rejected.
The known upstream CLI build script runs only in this private source/dependency tree. Git long-path support and
hook suppression are command-local; global Git/OS settings and shared checkouts are unchanged. Acquisition/build
commands, outputs and target manifests are retained under `targets`. This executes trusted project build tooling,
not arbitrary issue commands, and is **not a security sandbox**. Cache contents and frozen inputs are rehashed
before publication. A missing/unsupported tool or package stays blocked rather than using a prepared local bundle.
Identical preparation failures are reused within the run instead of repeatedly installing/downloading the same
unavailable target; a new run can retry them. Uniquely created preparation work directories are removed on success
and failure; failed runtime directories are removed too. Successful integrity-checked runtime caches and exact
preparation logs are retained. Cleanup never scans or removes unrelated cache directories.

The independent `pyright-issue-reproduction-gate` checks the complete report, material claims, effective setup,
actual outputs and target provenance. Oversized receipts use the same 12,000-byte indexes and exact paginated
saved reads as RCA; full raw receipts/errors are retained. Receipt hashes and all claim IDs must match.
The scenario/selection snapshot uses this transport too. Approval requires complete delivery of indexed
scenario/input/output/error fields, not just an index, preview, or partial page.
Negative results require analyzed files, exact symptom-specific observations and affirmative expected output,
not just success, an error-count change or a missing diagnostic. Missing imports, Any/Unknown degradation,
changed/disabled checks, unrelated new errors and output-format differences are not fixes.
Nonempty stderr also blocks the comparison and preserves its exact text, including ignored/unrecognized,
invalid or inapplicable configuration settings and setup failures outside JSON. Keys are not validated against
today's diagnostic list: each selected checker must actually accept the frozen settings without setup output.
Separate control receipts are marked `verified`, never used as negative original reproduction evidence.
The first runner supports self-contained CLI diagnostic/type claims only. Editor/LSP delivery, navigation,
environment discovery, unavailable third-party dependencies, crashes/performance and other unsupported symptoms
remain blocked. Semantic and integration claims in a mixed report stay separate; a CLI result cannot settle
an unresolved integration claim. Current limitations intentionally favor abstention over unsafe issue-wide action.

| Historical | Pinned main | Qualified automatic action |
| --- | --- | --- |
| Reproduced | Affirmatively resolved | Rich-mirror explanation and close with `state_reason=completed` |
| Affirmatively not reproduced | Affirmatively not reproduced | Add/reuse `not reproducible`; leave issue **open**, without a comment |
| Either | Reproduced | Continue behavior/duplicate investigation and default RCA |
| Blocked/failed/incomplete | Any | No reproduction-based action; retain blockers and continue existing investigation |
| Either | Blocked/failed/incomplete | No reproduction-based action; retain blockers and continue existing investigation |

A fixed comment may name an independently verified published version. If the selected latest publication still
fails, it explicitly says **fixed on main / awaiting release**, reusing `fixed in next version (main)` or
`addressed in next version` when available. If release status is unverified, it says so rather than promising
availability in a release. Closure does **not** wait for release, per the selected policy. Reproduction does not
claim specification correctness, by-design behavior or a causal diagnosis.

Per-issue `entry.json` contains a separate `reproduction_stage`, not a semantic disposition. Its attempt directory
contains `selection.json` (creation/update times, exact target identities and reasons), `receipts.jsonl` (IDs,
commands, inputs, actual outputs and outcomes) and `reproduction.json` (gate, hashes, blockers and proposed labels).
Interrupted attempts reuse matching receipts without spending execution attempts; changed inputs/targets are
rejected before action. `--retry-failed` can retry blocked comparisons in a fresh attempt while retaining old
artifacts. Use a fresh state directory after changed implementation inputs.

`--dry-run`/`--read-only` disables **all** comment drafting and GitHub mutations, including repository-label creation.
Proposals preserve exact intended labels and completed-closure reasons plus release wording, target provenance,
gate evidence and blockers. `--no-rca` disables RCA only, not reproduction. Qualified reproduction actions need no
behavior/duplicate investigation or expensive RCA. The existing source-CLI audit's prohibition on claiming
released-checker provenance remains intact: these new separately recorded targets do not retroactively validate it.

### Opt-in exploratory reproduction

Strict reproduction remains the default. `--exploratory-reproduction` is an explicit, **observation-only** alternative
when the report omits effective Python/checking settings. Reconstruction may choose source-compatible Python 3.8-3.15
or basic/standard/strict checking, recording each chosen setting, exact string value and rationale separately from
verbatim quoted reported settings. Every effective Python/checking value needs exactly one disclosure. Reported
settings and pristine source must be preserved; other missing prerequisites cannot be assumed away. The host rejects
unbounded, duplicate, mismatched or undisclosed choices, invented setting quotes and changes to recognized literal
`pythonVersion`/`typeCheckingMode` declarations (including playground query parameters). The independent gate still
checks the full report, including settings expressed in prose and source compatibility.

**The entire exploratory stage is ineligible for labels, closures and comment drafting**, even with an empty
assumptions list, an approved gate or fixed-looking comparison outcomes. It stops after reproduction: no behavior/
duplicate adjudication or RCA expansion. This host policy also applies without `--dry-run`, to resumed checkpoints,
pending publication ledgers and direct drafting/publication calls. Proposals say `blocked`/observation-only, not
`close_fixed` or `label_not_reproducible`. Use `--dry-run` as an additional read-only safeguard.

Controller-owned run/stage policy, scenario disclosures and receipt/evidence hashes bind the mode and settings.
Use a **fresh state directory** to change modes; a flag cannot upgrade strict or exploratory saved evidence.
Legacy strict checkpoints retain their original scenario/evidence projection. Routine controller responsibilities
(target preparation, original-first execution, precision verification) are workflow expectations/limitations, not
missing report prerequisites. Saved freeform prerequisites are never deleted or reinterpreted. Genuine missing
dependencies, unsupported surfaces, unsafe/inapplicable configuration and unavailable original observations remain
blocked; stderr/setup, import, exact original and precision validators are unchanged.

Exploratory results do not change previous frozen-run scores. A later live pilot needs separate authorization,
fresh state, a declared short per-role `--timeout` rather than an implicit 900 seconds, and actual production checker
receipts before claiming execution. Offline unit runners and adversarial approved-looking records are regression
fixtures only, not issue observations or live gate approvals. This opt-in does not authorize another cohort run.

Non-dry publication uses the existing closure ledger with distinct fixed/label reasons, evidence and draft hashes.
It rechecks implementation/target/input identity and screened issue/discussion freshness before each mutation,
preserves unrelated labels, reconciles exact marker/authored comments and existing labels on retry, and verifies
the final completed/open state. Changed evidence or ambiguous outcomes stop for inspection instead of posting
another comment. Fixed comments always use rich-mirror followed by bounded factual checking; investigator prose
is never directly published. No-live-action tests use fake GitHub/SDK clients; target acquisition can be smoke-tested
without invoking inference or touching any issue.
An unfinished fixed-closure ledger is also reconciled when a lost response left the issue already closed and
therefore absent from GitHub's open-issue listing.

### Developmental reproduction evaluation (2026-10-22)

The completed evaluations do **not** establish backlog-wide effectiveness or readiness for automatic issue actions.
Both frozen twenty-case attempts blocked before any checker execution. The first had nineteen SDK/API schema
rejections and one missing original. After transport repair, the second had eleven unmet-prerequisite scenarios,
four semantically invalid records, four 900-second timeouts of undetermined cause, and one missing original.
These are blocked coverage, not semantic misses, successful negative results or proof of safe publication.
Old protocols, results and scores were preserved rather than selectively repaired or rerun.

A separately authorized two-case developmental report replay used exploratory mode plus `--dry-run`, with
180 seconds active per model role including correction. It completed in 504.7 seconds across three model
sessions and four requests:

| Report | Actual observations | Qualification |
| --- | --- | --- |
| [#11015](https://github.com/microsoft/pyright/issues/11015) | Historical 1.1.406 reproduced both reported keyword errors; pinned upstream main `4e9ebcb013fd552a754371e519b9f44074bef849` and published 1.1.414 did not. Six checker receipts, all originals before separate controls, one analyzed file and empty stderr per execution. All eight precision predicates passed on every control; the evidence gate approved. | Python 3.14 was reported, but standard checking was explicitly assumed. This is a conditional fixed-pattern observation, not an actionable closure. |
| [#11876](https://github.com/microsoft/pyright/issues/11876) | A noncontiguous evidence quote was rejected before target selection; no checker execution or gate session occurred. | No reproduction or resolution conclusion. |

For both entries, eleven host action/drafting entry points rejected observation-only results before action I/O.
No comments, labels, closures or drafts were produced. This pilot did not demonstrate the both-negative
`label_not_reproducible` path or validate by-design/duplicate decisions.

The later correction routes exact quote and reported-setting checks through the existing bounded SDK correction
loop, without relaxing evidence requirements or deleting prerequisites. The subsequent complete twenty-case run
described below exercised that path without manually repairing the saved scenarios.
Raw evidence remains outside Git. The pilot's frozen protocol SHA-256 is
`d96a786f5b6b20009af583f3a53c43c96d818c8d870e8da91b2072a9f6502b62`; results SHA-256 is
`1ad4babd35f71198ac46006056c6f0dcdfe513b1a1082b877be1144c2cf7c180`.
Use a fresh, explicitly scoped, observation-only dry run for further evaluation; automatic issue actions are
not yet recommended.

A later complete run of the same twenty cases on `576b8688fa047ec861fa66861c6322c67d7c0789` completed in
28m07s. Two cases reached gate-approved comparisons: #11015 showed the historical/fixed pattern with strict
checking assumed, and #11876 reproduced on historical/main/latest with standard checking assumed. Eighteen
were unobserved: seven role timeouts, seven unmet prerequisites, two setting-validation failures, one missing
original and one overly strict literal-source check in the session-only adapter. No affirmative both-negative
case, by-design/duplicate decision or publication path was evaluated; all proposals stayed blocked.

Offline timeout inspection found two rejected first responses followed by correction timeouts within the same
180-second budget. The other five timed out on their first wait with no saved final response or usage; their
causes are not established. Added lifecycle metadata is diagnostic instrumentation, not a claimed provider/SDK
fix. A separate corrected adapter accepts whole supported Markdown fences after removing only their structural
indentation, preserving Python/string whitespace and recording distinct literal/rendered provenance. It never
globally dedents, joins blocks or rewrites source. This offline correction does not revise frozen outcomes or
remove genuine missing prerequisites; no corrected cohort/checker run has been performed.

One later authorized reconstruction-only diagnostic for #11037 completed with one correction in 84.4 active
seconds within the unchanged 180-second shared budget. Request correlation, final responses and root interactive
idle signaling completed normally. Its first response had an empty diagnostic message; the corrected record
passed structural/report validation but retained missing dependencies and contradictory limitations/predicates.
No checker or evidence gate was run. This concurrency-one observation neither qualifies reproduction evidence
nor establishes the cause of the earlier concurrency-two timeout.

## Blinded historical RCA evaluation

`evaluate_issue_rca.py` is a thin adapter around the production RCA controller, tools, validators, investigator,
tool-less gate and independent adversary. It does not use the open-issue console or alter the role prompts.
It starts directly at RCA and does not exercise the historical-versus-main reproduction stage.
It accepts a reviewed anonymous `BlindReport` JSON file, an isolated historical source archive with a matching
source-built CLI/maps, and a new output directory. Native tools, current source, tests, git and GitHub research
are unavailable to the SDK roles. Historical implementation reads and scratch writes use bounded custom tools;
normative references are limited to Python/typing/PEP hosts. Target-report injection screening remains mandatory.
No publication, source fixes, historical checkout switching or shared build replacement occurs.

```powershell
uv run build\automation\evaluate_issue_rca.py --report C:\benchmark\reports\case-a.json --source C:\benchmark\targets\v0 --output C:\benchmark\runs\pilot
```

Prepare and inspect inputs separately: remove issue identity, resolutions, fix references and solution-bearing
edits; retain unchanged original code and distinguish reported configuration from experimental settings.
The source root needs `benchmark-provenance.json` containing `source_commit`, `archive_sha256`, `source_sha256`
and `build_sha256`; compute the latter two with `target_fingerprint(root, False/True)` after the historical build.
These controller-recorded hashes detect subsequent changes, not an independently certified build provenance.
Keep archives, builds, reports, held-out references and execution evidence outside Git.

`--cohort manifest.json --chunk-size 3` runs bounded concurrent chunks through one shared screening queue.
The manifest contains `protocol_version`, `protocol_sha256`, `harness_sha256`, `implementation_sha256`
and unique `cases` with `id`, absolute `report`/`source`
paths, `report_sha256`, `source_sha256` and `build_sha256`. Freeze it only after verifying the original reported
failure on each chosen historical target. A case with a genuine missing surface can instead declare
`availability: "unavailable"` and `availability_reason`; it remains an explicit result, not a successful diagnosis.
Hashes use the module's `digest` function; report hashes use validated `BlindReport.model_dump_json()`.
The harness hash covers the adapter file, and the protocol hash covers `PROTOCOL`.
Use `implementation_fingerprints()` to freeze the controller, runtime, helper and role profiles.

Protocol version 2 exposes `rca_run(project="controls\\pyrightconfig.json")` for separate control projects.
Paths inside each config are relative to that config's directory. Each role receives its own unchanged
`original.py` and `pyrightconfig.json`; neither can be overwritten. Inspect actual analyzed-file counts and
diagnostics before counting intended controls as executed. Freeze the full source/configuration tree before
each same-project clean/debug pair; adding even excluded controls requires a fresh clean run.
Version 1 lacked project selection, so its excluded control files were not execution evidence.
Version 3 retains the production bounded evidence schemas and forwarding, including `pointer`, `offset` and
`max_chars` for saved-evidence reads. Historical implementation reads also retain ID-bearing raw receipts and
use the same delivery index/page transport. Include `issue_review_evidence.py` in the implementation freeze.
Delivery completeness is independent of capture completeness: paging cannot recover a failed or absent observation.
`evidence-delivery.jsonl` preserves the actual bounded initial/readback text, read arguments, encoded sizes and
attempt counts for transport auditing, separately from the unchanged raw execution ledger.
A gate requiring an independent adversary before the controller has reached that role is a sequencing failure,
not evidence that the primary causal diagnosis is wrong; the repaired gate evaluates primary evidence first.
Reruns on previously examined cases are paired regression evaluations, not fresh holdouts. Preserve the old
reports/results and freeze a new version/output directory rather than resuming their role sessions.

Compare frozen findings with withheld fix/regression evidence separately. A `found` status or file/keyword
overlap is not causal correctness; an inconclusive or gate-rejected result may still contain helpful findings.
Report exact mechanisms, partial matches, wrong diagnoses, operational errors and unavailable cases separately,
with explicit denominators. Controller-reviewed references remain provisional, not human-approved gold;
public-report/model memorization cannot be ruled out. Do not tune prompts or selectively rerun failed cases.

## Setup

Requires `uv`, authenticated `copilot` and `gh` executables, Node.js, Git, pnpm, and a prepared source CLI.
Historical reproduction also requires verified HTTPS access to `registry.npmjs.org` or explicit selection of the
configured Microsoft feed (which additionally requires the installed npm client); the isolated main build
needs upstream GitHub access and the pinned upstream lockfile's dependencies. Missing network access, TLS trust,
versions or build prerequisites are recorded as blocked, never as a successful negative check.
The selected registry also applies to the isolated main dependency install; its frozen lockfile integrity and
disabled dependency scripts remain mandatory.
Issue screening also requires an existing Microsoft-Decision-1 deployment and Microsoft Entra ID inference access.
The script declares Python 3.11+ and its dependencies using PEP 723 metadata. `uv run` manages the Python
environment automatically; no manual virtual environment or `pip install` is needed.
Run these PowerShell commands from the repository root:

```powershell
uv --version
pnpm install --frozen-lockfile
pnpm run build:cli:dev
gh auth status
copilot --version
```

The runner sets `USE_TGREP=false` only for its Copilot child process. This keeps normal ripgrep searches available
without optional indexed search, whose diagnostic events can contain values the SDK cannot decode
(`SessionIndexedSearchData` / `disabledReason` assertion failures). Classifier configuration, Entra credential
secrets/token-file paths, and legacy scorer secrets are removed from Copilot and reproduction child environments;
other inherited settings are preserved. Your shell environment and other Copilot processes are not changed.

For closing or potential-root-cause comment drafts, install your `rich-mirror` profile in the normal personal agents directory, or supply
`--writer-agent C:\path\to\rich-mirror.agent.md`. The runner reads that profile; it does not copy your personal writing
instructions into this repository. Non-dry runs require this profile and fail before investigation if it is missing.
Use `--dry-run` to investigate without a writer profile.

### Required prompt-injection screening

The classifier now uses **Microsoft-Decision-1**, replacing the Pi Scorer/TypeSafe SDK integration.
Configure the existing Foundry **resource endpoint** and deployment name in the shell that runs the console:

```powershell
$env:AZURE_ENDPOINT = "<your existing Foundry resource endpoint>"
$env:DEPLOYMENT_NAME = "<your existing deployment name>"
```

Use the resource endpoint, not a project URL or the complete provider route. No subscription, resource group,
resource name or endpoint is hardcoded. The adapter posts to
`{AZURE_ENDPOINT}/providers/microsoft/v1/systemone`; the request's `model` is `DEPLOYMENT_NAME`.
Use the actual deployment name, which can differ from the catalog model name `Microsoft-Decision-1`.
To find it without changing Azure resources:

```powershell
az cognitiveservices account deployment list --resource-group "<resource-group>" --name "<resource-name>" --output table
```

It uses `azure.identity.DefaultAzureCredential` with the scope
`https://cognitiveservices.azure.com/.default`. For local development, sign in with `az login` before running;
managed identity and the other noninteractive DefaultAzureCredential sources also work when configured.
The selected identity needs inference access to the existing resource/deployment. Resource provisioning,
RBAC changes and interactive sign-in are not performed by this application.
If unavailable cloud credentials delay local authentication, you can optionally set
`$env:AZURE_TOKEN_CREDENTIALS = "AzureCliCredential"` to select your existing CLI sign-in through
DefaultAzureCredential. Omit that setting when using managed identity or another credential source.

For local testing, these three settings can instead go in the repository-root `.env` file, which Git ignores:

```dotenv
AZURE_ENDPOINT=https://<your-resource>.services.ai.azure.com
DEPLOYMENT_NAME=<your-existing-deployment-name>
AZURE_TOKEN_CREDENTIALS=AzureCliCredential
```

`AZURE_TOKEN_CREDENTIALS` names a credential source; it is **not an access token**. Run `az login` to sign in,
then select the intended subscription with `az account set --subscription <subscription-id>`.
DefaultAzureCredential obtains and refreshes tokens through that CLI sign-in. Do not copy tokens into `.env`.
The CLI identity still needs the **Cognitive Services User** role at the Foundry resource scope; sign-in alone
does not grant inference access.

Load the file explicitly through uv; the Python client does not load `.env` on its own:

```powershell
uv run --env-file .env build\automation\review_issues.py --issues 11689 --dry-run
```

For a headless dry-run pilot, use a fresh state directory and an explicit bounded issue list:

```powershell
uv run --env-file .env build\automation\review_issues.py --issues 11899 11868 11858 --chunk-size 3 --dry-run --non-interactive --state-dir "$env:USERPROFILE\.copilot\issue-review\dry-run-pilot"
```

`--non-interactive` requires `--dry-run`. It explicitly blocks runtime/editor probes needing human approval;
it never grants approval or silently executes them. It also stops before the next chunk's continuation prompt.
Prepared Pyright checks, available mypy, scoped research, duplicate analysis, adjudication, and default RCA
remain enabled. Missing runtime evidence must remain visible in the findings and can prevent a proposal.

**Local authentication can remain disabled. API keys are neither used nor retrieved.** Do not paste access tokens
into code, environment configuration for this client, reports or chat. The adapter acquires tokens internally,
does not log tokens, headers or response bodies, and disables Azure HTTP logging for its credential.
The old `TYPESAFE_*` configuration is not used as a fallback. Both new configuration variables are required.

Before any Copilot analysis, the controller screens the target issue's complete title/body/labels and discussion.
Resumed reviews, direct investigation and drafting stages, and publication paths cannot skip that target-issue check.
Research reads are not separately classified: this includes searches, historical and duplicate issues, PRs,
changed-file text, release metadata, and RCA source reads. This policy applies regardless of the research item's
age or open/closed status. Native GitHub web fetches remain denied so investigators use the scoped, audited
`github_read` tool, not because research results must pass the classifier.

Older issues can still contain hostile text or be edited; their age is not a safety guarantee. The narrower
scope deliberately relies on the agents treating all research as untrusted evidence, plus existing tool
restrictions and execution/publication approvals. It avoids classifying a large historical corpus for each
compact target issue without representing that corpus as classifier-approved.

Decision-1 is a general classifier, not a built-in guarantee of prompt-injection detection. This integration
asks a fixed **Choice** question with `benign` and `injection` criteria, supplying issue text as structured
**untrusted data**. Its current, provisional operating rule permits a selected `benign` label with an injection
probability at or below `0.1`; values between `0.1`
and `0.9` are uncertain, and values at or above `0.9` are flagged. Both uncertain and flagged results skip the
issue, with **no override**. These are operating thresholds, not calibrated accuracy or confidence guarantees.
Missing configuration, invalid responses, timeouts, authentication/service errors, and unavailable audit storage
also block analysis of the target issue.
Unrelated issues in the batch can still proceed.

Each classifier attempt has a 30-second bound. The controller makes at most one retry for a timeout, a classified
connection failure, or HTTP 429/500/502/503/504. It waits for `Retry-After` (seconds or an HTTP date) when supplied,
60 seconds for HTTP 429 without that header, or two seconds for other transient failures.
Both attempts use identical evidence and classifier policy, and the audit records the retry's error category,
safe HTTP status, attempt count and wait. Authentication/validation errors, malformed responses, uncertain/flagged
answers and storage failures are not retried.
All checks in this console share one cancellable classifier queue: requests and their retry waits are
serialized, and queued checks recheck the allow-cache before making a request. Concurrent checks of identical
passing evidence therefore share the first result instead of independently retrying and racing each other.
Already-cached passing evidence does not wait for unrelated requests.
The in-memory cache can reuse the unchanged target record or its complete discussion between controller
checks. New or changed content must pass; a group is cached only after every fragment passes. Discussion
identities include the parent issue. No individual phrase, partial body, or failed group is reusable.
Reused scores retain the worst observed group risk, not a newly inferred per-document probability.

Each active screening part, including both attempts and its retry wait, has a two-minute limit.
A delay that exceeds that remaining budget blocks without retrying.
Queue waits and HTTP retry waits print safe progress messages. The SDK's `--timeout` bounds agent turns,
not the controller's pre-analysis target-issue screening. Non-transient errors and an exhausted retry still block
analysis; there is no safety override. The reusable REST client itself never retries.
Separate console processes do not share this queue, so avoid running them against the same low-quota deployment.
Credential subprocesses can use the full attempt budget; authentication and HTTP together must still finish
within that attempt's 30-second bound.
Evidence that fits both the 64 KiB text ceiling and the 24 KiB serialized-state budget is screened in one request.
Larger target issues and discussions are screened as bounded overlapping fragments, never truncated or
summarized to obtain a passing result. Each fragment stays within 64 KiB including its envelope, carries the
complete document's hash and its ordinal/offsets, repeats up to 1 KiB of untrusted prefix context, and overlaps
its neighbor by 2 KiB of serialized evidence. The fragment planner accounts for JSON escaping, including Unicode.
The planner also measures `{"content": ...}` after all JSON escaping and keeps it within 24 KiB. This leaves
headroom for the rubric and request framing in Decision-1's 32K-token context: a 64 KiB text fragment alone does
not bound token usage, especially for token-dense logs or multiply escaped JSON. The serialized-state bound is
conservative, not a claim to measure the provider's tokenizer. The total evidence budget is 1 MiB and at most
64 fragments; exceeding either budget still blocks explicitly.

Every fragment must select `benign` with risk at or below `0.1` before any of the original evidence reaches the
investigator. The recorded aggregate uses the highest observed fragment risk, not an average or a claim of a
calibrated whole-document probability. A flagged, uncertain, malformed, failed or cancelled fragment prevents
whole-input cache insertion and release of partial evidence. The queue slot is held for the complete set of
fragments. Large target issues require more classifier requests and can be slow on low-quota deployments;
large research responses do not create classifier requests or fragments.

Only a complete passing result is reused in memory for identical content under the same scorer policy;
edited comments or a changed tail invalidate the complete-input cache even if the issue timestamp did not change.
Unchanged complete documents within the new response may still be reused; its new or edited documents must pass.
There is no persisted "safe forever" cache or command-line switch to disable screening.

Local `screening.jsonl` records store source identifiers, content/policy hashes, timestamps, outcome, returned model,
selected label, probabilities and numeric injection risk, not the input text, tokens or endpoint.
Queue duration, total elapsed time and completion timestamps distinguish a queued check from an active request.
Multipart records include fragment hashes, byte counts, individual outcomes, completion counts and the failing
or interrupted ordinal, without embedding fragments or repeated context in the ledger.
They also distinguish the original response hash from the hash of the new documents actually classified, count
reused/new documents, and record serialized-state sizes, HTTP attempts and retry-wait time. A blocking console message
identifies its source and issue number, selected label, injection score and allow threshold.
Target-issue checks are saved in the issue directory. Research tool records instead explicitly identify
`not_screened_research`; they are not passing classifier decisions. `run.json` and screening audits record the
`target_issue_and_comments` scope, which is also included in the policy hash. Normal investigation reports remain
separate. Changing the integration or configured endpoint/deployment invalidates review context; token refresh
does not change the screening policy.

The read-only assessor's bounded `read_reference` path additionally retains quarantined diagnostics under
`roles\validity\screening-diagnostics`. This exception does not enable input retention for ordinary issue or
discussion screening. Each immutable diagnostic contains the exact canonical reference envelope, actual attempted
classifier states, fixed rubric, classifier-configuration/policy identities and original outcome; multipart
requests and retry counts remain distinguishable. Successful, rejected, failed, cached and cancelled attempts are
retained independently. `screening.jsonl` binds each file's hash and outcome. No endpoint, credentials, environment
variables or raw service error body is included. Treat these local files as untrusted source data, keep them out
of Git, and do not give them to an issue agent or convert them into a passing citation. Failure to save a required
diagnostic or audit blocks analysis and removes its whole-input cache entry.

Inspect one diagnostic offline without configuring or contacting the classifier:

```powershell
python build\automation\evaluate_issue_screening.py --diagnostic C:\run\roles\validity\screening-diagnostics\FILE.json `
    --output C:\new-screening-inspection.json
```

Keep its original adjacent `screening.jsonl`; inspection validates the exact artifact hash and recorded outcome.
Add `--reclassify` only to explicitly send the saved input to the existing approved classifier again. It requires
the identical policy and classifier configuration, a new output/audit directory and fresh in-memory screening
state. It reconstructs the whole original input, not just a successful prefix, and verifies captured request
states before contacting the service. Original files and issue results never change. The new status can differ
because inference is not deterministic; this is a replay observation, not a human label, accuracy score, safety
override or authorization to resume a blocked review. Earlier hash-only records cannot recover an exact lost
classifier input; do not silently substitute a new retrieval for an old rejected excerpt.

Configure only an approved service: screening transmits the target issue and its discussion to that deployment,
not the publication console's separate research reads. The read-only assessor also screens the bounded
authoritative excerpts delivered through its explicit `read_reference` capability.
Transport-mocked regression tests verify the fail-closed workflow and wire contract, not detection quality.
Before a backlog run, evaluate representative labeled benign reports, attack attempts and ambiguous examples
against the actual configured deployment, including quoted attacks and legitimate repro commands. Existing
tool restrictions, source inspection and execution/publication approvals still apply even after a passing score.
Overlap preserves nearby boundary context, but chunking can lose relationships across distant fragments; passing
all fragments is not proof that an attack distributed across the document will be detected.

### Classifier evaluation and throughput

The rubric distinguishes attempts to control the AI's workflow from human-to-human troubleshooting and
historical maintainer actions. A person explaining why they closed an earlier issue is not, by itself, directing
the AI to close its current issue. Claimed maintainer authority never permits an instruction to bypass the
AI's rules or approvals. The numeric thresholds and no-override policy are unchanged.

Run the small labeled evaluation without starting an issue agent or publishing anything:

```powershell
uv run --env-file .env build\automation\evaluate_issue_screening.py --output "$env:TEMP\pyright-screening-evaluation.json"
```

The synthetic corpus separates development cases used to refine the rubric from validation cases not used for
that refinement. `--split validation` selects the latter. `--cases path.json` accepts additional labeled cases
with `id`, `category` (`benign`, `attack`, `ambiguous`), `split`, and `evidence` fields. The command returns nonzero
for benign cases blocked by the policy, unsafe cases allowed, or service failures. HTTP/authentication failures
are reported separately, never counted as successful attack detection. Fresh policy state per example prevents
cache hits from masquerading as repeated inference measurements. Output/audits contain decisions, probabilities,
timings and hashes, not fixture text. These small regression sets are not a statistical accuracy calibration;
evaluate representative real reports and adversarial examples before a backlog-wide run.

Deployment request quota is independent of the console queue. For example, a deployment advertising one request
per minute cannot finish dozens of distinct screenings quickly, even if individual inference takes seconds.
Check the deployment's actual request rate and available Azure quota; increasing deployment capacity requires
operator approval and can allow higher inference spend. The console never changes Azure resources or retrieves
API keys. Raising `--timeout`, adding workers, or splitting evidence into more parts does not raise that quota.

### Reusable Choice client

`issue_review_classifier.py` defines a provider-independent asynchronous `ChoiceClassifier` protocol,
`ChoiceClassification` result (`choice`, `probabilities`, optional returned `model`) and typed failures.
`issue_review_decision.py` implements that interface using the existing standard-library `http.client` convention.
These two modules support **Python 3.10+** and depend on `azure-identity` and Pydantic, not the GitHub Copilot SDK.
The full console still requires Python 3.11+ for its existing SDK/deadline workflow.

For example, with `build\automation` on the Python import path:

```python
import asyncio

from issue_review_decision import MicrosoftDecisionClassifier


async def main():
    classifier = MicrosoftDecisionClassifier.from_environment()
    result = await classifier.classify(
        {"message": "The integration crashes."},
        name="team",
        instructions="Which team should handle this request?",
        criteria={
            "billing": "Charges, invoices and refunds",
            "engineering": "Software errors and outages",
        },
    )
    print(result.choice, result.probabilities)


asyncio.run(main())
```

Labels, descriptions, question names and text/JSON state are caller-supplied. Responses must include a valid
Choice answer, exactly the requested labels, finite probabilities in `[0, 1]` summing to one, and a selected
highest-probability label. Invalid or oversized responses raise `ClassificationResponseError`.
`ClassificationAuthenticationError` covers credential failures and HTTP 401/403; other non-success statuses
raise `ClassificationHTTPError` with a `status` attribute. `ClassificationTimeoutError` and
`ClassificationConnectionError` distinguish timeouts from transport failures. Error messages exclude response
bodies and underlying credential exception text. Console screening errors include the HTTP status when available:
for HTTP 404, check both the resource endpoint and the deployment name; for HTTP 401/403, check the selected
identity and its inference permissions; for HTTP 429, check the deployment's request quota.
Only target issues and their discussions require screening requests. A very low request quota can still
slow a batch or a fragmented target issue despite the controller's bounded retry.
The reusable client does not retry requests or follow redirects.
Synchronous identity/HTTP work runs off the event loop; cancellation or timeout prevents a pending credential
acquisition from starting a late inference request. Already-running synchronous I/O finishes under its socket
timeout, without exposing its result to the cancelled caller.

## Run

Start with a small, read-only cohort rather than the entire backlog:

```powershell
uv run build\automation\review_issues.py --issues 11881 11876 --dry-run
```

Review the current open-issue snapshot in chunks of five:

```powershell
uv run build\automation\review_issues.py --chunk-size 5
```

Copilot stages default to **GPT-6.1 Sol** (`gpt-6.1-sol`), including both investigators, adjudication, RCA, comment writing
and factual checks. Use `--model` to override it; the selected model is displayed at startup and saved in the run
and session metadata. Decision-1 uses `DEPLOYMENT_NAME`, not `--model`.
Native tools vary by model: the runner accepts `rg` or `grep` for search, and `apply_patch`
or the `create`/`edit` pair for scratch writing. It validates the active capabilities before inference and records
the actual tool names per session. Duplicate investigations have no write tools; command execution remains
controller-owned and scratch writes remain permission-scoped. Every investigation, writing pass,
and factual check consumes model usage. `--timeout` bounds each ordinary SDK turn's active time in seconds (default 900);
RCA investigation and independent-countercheck turns use a separate `--rca-timeout` budget (default 900).
Output correction shares the original turn's budget rather than starting another full allowance.
When evidence is missing, correction may use remaining authorized tools and allowance, or preserve an inconclusive
finding; repeating an unsupported conclusion is not a repair. Waiting for operator approval does not consume that
budget, and approval prompts do not block the SDK event loop.
Product checks still count toward the turn budget and retain their own process timeouts. Timing out aborts
the turn, records an explicit error and SDK/tool-event timing, and does not manufacture an inconclusive verdict.
Both investigators run for every issue, including
by-design findings; the old `--duplicates` flag is accepted for compatibility but no longer needed.
All issues in a chunk run concurrently in separate SDK sessions, scratch directories and RCA runtimes.
Dependent stages within an issue stay ordered: behavior investigation, duplicate investigation, adjudication,
then evidence-gated RCA when needed. Comment writing and factual checks also run as part of the parallel
evaluation phase. After all evaluations settle, the console prints one table row per issue, including failures
and skipped items, then publishes sequentially to preserve checkpoint ordering. One issue's expected failure
does not cancel the other issues. Interrupting the chunk cancels outstanding issue tasks and their SDK sessions.
If RCA fails after validated behavior and duplicate investigations, their judgments remain visible in the table
and proposal fields; the action remains blocked. Saved summaries count behavior coverage and RCA failures separately.
The console still asks before starting the next chunk. `--chunk-size` bounds concurrent issue pipelines, not
the number of SDK turns or credits; a larger chunk can substantially increase CPU, memory and model usage.
Execution approval prompts are serialized across roles/issues, and waiting for that shared prompt does not
consume a role's SDK deadline.
Malformed audit output gets at most one corrective turn in the same session; a second validation failure is saved
as a failure, not silently accepted or converted into an issue disposition.
`sdk-events.jsonl` includes lifecycle metadata for each response attempt: phase, monotonic elapsed time,
remaining active allowance and approval pauses; message/origin/turn IDs, root-versus-subagent events, idle mode,
and cancellation/abort/disconnect completion. Only the first delta per kind and root/subagent scope is logged,
with cumulative counts retained in response/timeout summaries. Final-response metadata records byte size and
SHA-256, not message content; new metadata never copies prompts, reasoning or delta text. Existing separately
saved raw responses and usage/error records remain unchanged.
Select `controller.timeout` by event type, not by log position: cleanup events can follow it. A final-message or
usage event alone does not establish structured SDK completion, which also requires the SDK's request correlation
and root idle signaling. Missing old lifecycle events cannot establish provider silence or a completion defect.
Structured responses use strict provider-compatible schemas: every declared field is required on the wire, including
fields with local defaults, while nullable fields can still be `null`. Local Pydantic evidence validation remains
unchanged; defaults continue to support older checkpoints.
Reproduction scenario and gate responses encode maps as typed `key`/`value` entry arrays, avoiding open-ended
objects and untyped `JsonValue` definitions in the provider's strict schema. Configuration entry values contain
JSON text so their original types and values survive transport. The controller rejects duplicate keys, malformed
or nonfinite JSON, then applies the unchanged scenario/gate models and evidence validators. Raw wire responses
and decoded records are saved separately; this representation changes neither saved scenario semantics nor action gates.
Report-quote and reported-setting evidence checks participate in the existing bounded response correction before
target selection. Quotes must remain exact contiguous spans; a failed quote is not repaired by the host. Genuine
unmet prerequisites still block execution, and saved scenarios are revalidated rather than silently corrected.

`--dry-run` and `--read-only` are aliases: they disable GitHub mutations and comment drafting, not scratch-file creation
or checking. Reconstructed
Python runtime probes require separate approval after their source and arguments are displayed. They execute on
your machine, **not in a sandbox**. Decline code you do not trust. The source CLI runs automatically with restricted
scratch configuration; released Pyright versions and missing dependencies are not downloaded. Mypy is compared only
if it is already installed in this Python environment. Missing versions/tools remain explicit limitations.
To include mypy in uv's isolated script environment, use `uv run --with mypy build\automation\review_issues.py ...`.
CLI investigations must attempt the **actual prepared Pyright product**, using
`node packages\pyright\index.js --project <scratch>\pyrightconfig.json --outputjson`. This statically checks the
reconstructed Python example; it is separate from executing that example in CPython. The behavior Markdown report
includes the investigator's findings plus controller-recorded commands, configuration/source snapshots, exit codes,
and full output. Reported diagnostics and expected behavior must be distinguished from observed diagnostics/types.

`run_check(kind="pyright")` executes only the prepared checkout CLI. When the controller has selected historical,
main or latest artifacts in the reproduction/diagnostic stages, the reviewer also receives `run_prepared_check`.
It accepts only the advertised opaque `target_id`, an `original`/`control` phase, and a mandatory
`configuration_reason`. It never accepts a checker path, version, command or acquisition request.
The controller uses `TargetStore.restore`, `verify` and `run_static`; a missing cache, changed provenance or
changed artifact blocks the experiment. This investigator tool is always **cache-only**, even if the operator
authorized target preparation for a preceding controller stage. No downloads, installs or builds are added.

Prepared checks freeze 1-30 scratch Python/stub files (64 KiB each) and an explicit, restricted
`pyrightconfig.json` into a fresh controller-owned execution directory outside investigator write scope.
Stub-only specimens are supported without adding a fabricated `.py` companion.
`pythonVersion` and `typeCheckingMode` must be explicit; no missing reporter setting is guessed.
`configuration_reason` must explain the experimental choices and missing reporter settings. Configuration
scope paths must be relative and remain inside scratch. Inputs and outputs are screened; target/input integrity
is rechecked around the existing controlled execution, with the role's cancellation/deadline still active.
There are at most 12 attempts per investigation. Separate controls must reference a successful original receipt
for the same target, file set and exact configuration; they never replace the original observation.

The receipt identifies the exact npm release or pinned upstream-main SHA, selected registry, artifact checksums,
runtime tree hash, target-selection reason, full configuration/source snapshots, exact command/cwd/exit code,
stdout/stderr, original/control relationship and receipt hash. `target_selection` distinguishes explicitly
reported releases from approximate issue-creation as-of releases, latest-at-selection releases and pinned main.
**Every reviewer prepared-target receipt is experimental, not faithful reproduction, and action-ineligible**,
including an execution of an explicitly reported version. Settings/source correspondence to the reporter remains
unverified. Actual observed diagnostics belong in the report's checks and Markdown; they do not upgrade the
source-checkout audit's release reproduction statuses, satisfy its checkout check, or pass the independent strict
reproduction/action gates. Missing checking-mode evidence remains a historical-reproduction blocker, not a
checker-execution failure. Small receipts are returned directly; large ones use the existing bounded delivery
index and `read_prepared_evidence` exact JSON-pointer pages. Complete raw receipts remain in
`prepared-checks/<receipt-id>.json` and successful screened executions in `checks.jsonl`.

The validator rejects release-target reproduction claims based on the source checkout or these experimental
receipts, even when version strings match. The narrowly scoped headless LSP capability below can observe
workspace progress and diagnostic publication. Other language-server,
editor-specific, packaging, and similar checks remain blocked rather than being inferred from a CLI result.
Non-CLI surfaces or insufficient reproduction cannot receive a confident `by design`/`bug` tag or a closure offer.
The required surface follows the material complaint, not the client name in environment metadata. Self-contained
typing, abstractness, and diagnostic-correctness questions can use the CLI even when reported in Pylance/Neovim.
The report records `surface_reason` and leaves historical/editor integration unverified. Actual diagnostic-delivery
failures, editor/CLI discrepancies, completions, interpreter handoff, and configuration discovery still need their
real surface; a component check cannot settle those claims.

### Bounded headless language-server progress observations

Ordinary behavior investigation (including overnight review with RCA disabled) exposes `lsp_progress_probe` and
`lsp_read_evidence`. The same bounded tools are available during RCA, but they do not supply inspector/root-cause
evidence. This is **not** arbitrary LSP execution, an editor adapter, or a replacement for the strict historical
reproduction stage. Receipts remain experimental, `action_ineligible: true`, and `faithful_reproduction: false`;
they cannot authorize a release/fix/duplicate claim or a closure.

The caller prepares the actual checkout server with `pnpm run build:cli:dev`. The probe copies its full `dist`
and unchanged upstream `langserver.index.js`, preserving bundled-stub initialization. It never uses the CLI
entrypoint to infer LSP behavior. A controller-bound prepared target can supply the same wrapper/bundle after
`TargetStore.restore/verify`; acquisition is not available to the investigator. A sealed older cache missing
the wrapper remains blocked, not modified/resealed. Matching version strings alone are not release provenance.

Create a dedicated scratch folder containing inspected `.py`/`.pyi` files and an explicit `pyrightconfig.json`
with `"pythonVersion": "3.14"`. Only optional `typeCheckingMode` is supported beyond that setting; omission is
preserved, not silently rewritten as a reporter choice. Other configurations/files remain unsupported.
Call, for example:

```json
{"project":"progress-case","open_file":"a.py","target_id":"checkout","observation_seconds":15}
```

The source is statically analyzed, never executed. The controller freezes it and runs three fresh workspace/
server processes in order: original Python-target 3.14/workspace (no document opened), a separate 3.13 static-target/
workspace control, and 3.14/openFilesOnly with the selected source open. **The 3.13 control does not switch the
interpreter.** Actual interpreter path/version, platform, Node, target revision/provenance, runtime/source hashes,
all workspace inputs, fixed client capabilities/settings, sanitized child environment, exact commands and complete
bounded bidirectional protocol transcripts are retained outside agent-writable scratch.
The runner's interpreter may differ from a report's; for #11925, Python 3.14.3 is not the reported 3.14.9.
The missing original initialize exchange, no-config/interpreter-discovery variant, historical build and editor
behavior remain unverified unless separately observed through their actual supported surface.

The client only initializes, answers scoped configuration/progress-token creation, optionally opens one source,
observes, then shuts down/exits. It performs no diagnostic pulls, watched-file edits, arbitrary requests/commands,
reporter-script downloads, shell access, installs, or GitHub mutations. Unknown server requests fail qualification
without executing them. Windows servers start suspended, enter a kill-on-close job, then resume; POSIX servers
have a new process group. Owned descendants are terminated and stdout/stderr drained on success, failure and
cancellation; a cancelled attempt retains partial evidence rather than becoming successful.

Bounds are 16 sources, 64 KiB of input, 64 input-tree entries, 256 KiB/frame, 2 MiB of aggregate message bodies,
2,048 events and 64 KiB stderr. Each case observes 1-30 seconds (default 15), with bounded initialization/shutdown/
cleanup. Each runtime allows at most three matrix attempts. Over-limit, malformed, incomplete configuration,
missing source-publication, server error, early exit and unsupported-request captures are failed/partial, never
successful truncated evidence. Large receipts use the existing exact JSON-pointer paging transport through
`lsp_read_evidence`; an index/preview is not a complete transcript.

Progress summaries preserve token type/identity, **creation versus begin/report/end**, event order and unmatched/
active lifecycles at the pre-shutdown cutoff. An end caused by shutdown is not analysis completion. Diagnostic
summaries preserve publication URI, version, order, count and prior count. An empty publication can clear earlier
diagnostics; it is not independently an error or proof that a library stub is the counted file. A token active at
the bounded cutoff establishes neither a permanent hang, CPU idleness, remaining-file identity, templatelib
causation nor a duplicate. Compare the controls and retain interpreter/configuration qualifications.

Focused coverage: from `build\automation`, run `python -m unittest test_issue_review_lsp`.

## Reports and tags

The two investigators return Markdown findings with machine-validation metadata in an internal SDK envelope.
The controller saves the Markdown files and execution ledger; it does not dump the JSON records to the console.
The independent `pyright-issue-adjudicator` reads both reports without tools and returns classification tags.
The console presents those tags with a one-line RCA summary, for example:

```text
| Issue | By Design           | Dupe | Root Cause Summary                     |
|-------|---------------------|------|----------------------------------------|
| #123  | Yes                 | No   | Not needed                             |
| #456  | No                  | #321 | Not needed                             |
| #789  | Needs investigation | No   | found: observed producer and condition |
```

Either axis can be `needs investigation`. That blocks automatic closure, even if the other axis is conclusive.
An incomplete search is not `no dupe found`, and related symptoms are not duplicates. `no dupe found` describes
the completed bounded search, not a guarantee about the entire backlog. Stub/environment problems, enhancements,
low-confidence claims, and conflicting evidence are not forced into binary bug/design classifications.
These tags are local results, not automatic GitHub label changes.

## Automatic root-cause analysis

RCA runs by default for reports that do not qualify for by-design or duplicate closure. This includes confirmed
bugs with no supported duplicate, not just `needs investigation` tags. Pass `--no-rca` to disable both RCA
and RCA comment publication; by-design/duplicate closure behavior is unchanged. For example:

```powershell
uv run build\automation\review_issues.py --issues 11881 11876 --dry-run --no-rca
```

There is no RCA opt-in prompt. Three bounded roles, inspired by Pyrx's investigator, evidence gate and adversary, run:
an investigator gathers evidence, a tool-less gate checks the causal explanation, and an independent challenger
tries a competing explanation. The gate/challenger run only when the investigator finds a potential cause.
Missing specification or historical evidence goes to authoritative research rather than unnecessary debugging.
The gate evaluates the investigator's primary evidence **before** the adversary runs. It must not reject solely
for absence of that future role's independent execution. Acceptance only starts the challenge; a publishable RCA
still requires the independently executed countercheck and all existing publication checks.

The result is saved as `<state-dir>\<issue>\root-cause.md`, including blocked, inconclusive and failed attempts.
Each attempt also retains its own report, SDK records and evidence under `rca\<attempt>`. RCA does not change the
original tags: understanding a producer does not establish a bug, by-design intent, or a confirmed fix.

For implementation claims, the runner copies the prepared CLI, source maps and stubs into the attempt's private
runtime. It uses Node's native inspector with source-mapped TypeScript breakpoints and bounded read-only expressions;
it does not attach to an existing process, open an inspector port, edit shared source, or install tools.
The host requires actual breakpoint hits and observed state, matching clean/debug input and diagnostic results,
and an independently executed countercheck. Proposed/unhit breakpoints and source inspection alone are insufficient.
The adversary may also cite its own successfully retrieved authoritative sources; these supplement, but never
replace, the executed countercheck required for an implementation/integration cause. Invalid citation feedback
identifies unsupported IDs and missing qualifying checks.
Stale build/source mappings fail explicitly; rebuild before retrying. Each executable role has at most eight product
attempts, retained across checkpoint resumption. Optional boolean breakpoint conditions target the example rather
than the first unrelated import/stub hit. Conditions are evaluated with the same side-effect rejection and timeout
as state expressions, not passed to an unrestricted debugger condition. A bounded pause limit prevents runaway
conditional captures. Private-copy creation and instrumentation can be slow; these captures are not performance measurements.
Multiple conditions at one mapped location share a debugger breakpoint while retaining independent first-match
captures. A failed condition does not discard another target at that location. Found implementation locations
still require an error-free debug execution matching the clean baseline: a producer hit mixed with failed
conditions must be recaptured, not relabeled as sufficient. Validation feedback identifies the selected captures,
errors, and actual hit locations, and resumption preserves the previous failure to resolve.
Before execution an explicit reproduction plan identifies the surface, target versions, prerequisites, setup,
expected failure and controls. Editor/LSP issues cannot use a CLI proxy. CLI investigations reuse the earlier
inspected scratch example/configuration when available. Debugging requires a relevant clean baseline first.
Preserve that original source/configuration. For separate controls, `rca_run` accepts a scratch-relative JSON
`project`, for example `controls\pyrightconfig.json`, with paths relative to the selected configuration's directory.
All paths remain scratch-only. The default is still `pyrightconfig.json`; editor runs do not accept project selection.
Create every intended source/configuration file before taking a clean baseline. A debug run must use the same
project and complete input snapshot from this role: even adding an excluded control or editing another config
requires a fresh clean run. Stale pairs are rejected before debugger execution without spending a product attempt.
The runner also detects source/configuration changes during execution. Resumption restores project-specific
baselines from the ledger; the adversary cannot borrow the investigator's executions.

RCA execution, authoritative-source and saved-evidence tools cap each text response at 12,000 encoded bytes.
Small receipts are returned normally; large ones return a deterministic delivery index with observation/error
counts, previews and exact JSON pointers. The complete captured receipt stays in `checks.jsonl` and the existing
debug artifacts. The index is not a complete capture or a qualification verdict, and previews are explicitly
marked. Rejected expressions and unavailable values are not converted into successful observations.

Use `rca_read_evidence(evidence_id="...", pointer="/debug/hits/0/evaluations/0")` for an exact selected value,
or `pointer=""` for the whole receipt. Pages return canonical JSON text fragments with character `offset`,
`total_chars`, `next_offset`, and hashes of the selected value and full receipt. Continue with the returned
offset and combine fragments before parsing a split value. The byte cap also accounts for JSON escaping;
`max_chars` is at most 4,096 and a page can be shorter to fit. `value_complete` describes delivery of the selected
value only; `capture_truncated` still exposes a partially retrieved authority source. Paging cannot recover
content that was never captured and never spends a product attempt. Validators continue reading full raw receipts.
Prefer existing scalar fields or small plain projections to recursive type/AST graphs or printer/helper calls;
the inspector's side-effect rejection, capture limits and clean/debug qualification rules are unchanged.

The causal report should connect upstream inputs, the first decisive decision, subsequent state and the symptom.
A control must distinguish the strongest competing explanation; a downstream cache observation alone is not proof
that the cache is the cause. Preserve useful partial mechanisms when the evidence cannot distinguish alternatives.
Behavior reports also include a controller-rendered per-claim disposition/reproduction table. A supported policy
can coexist with a historical diagnostic that no longer reproduces; unresolved material claims still block closure.
For a blocked conclusion, a tool-less challenger checks the plan, capabilities and ledger for an avoidable setup
mistake or ignored evidence. It can authorize **one** materially different supported attempt, never downloads,
broader permissions, interpreter selection, or an override of denied execution. Earlier findings/plans are retained.

### Isolated editor interpreter-handoff investigations

The focused `editor_interpreter` adapter runs the actual Pyright extension and existing Python extension in a new
VS Code process/profile/workspace. It covers interpreter handoff, not arbitrary UI actions or a general LSP/test runner.
Prepare the extension and source maps **before** starting the console:

```powershell
pnpm run build:extension:dev
uv run build\automation\review_issues.py --issues 11689 --retry-rca --dry-run
```

Each executable role separately asks permission before editor checks. These create standard-library venvs with
the runner's Python, launch temporary editor windows, and terminate only their owned process trees (a kill-on-close
job on Windows). No reporter Python runs. The adapter does not select an interpreter, inject/mock API inputs,
reuse a personal editor profile, download a host/extension, or install packages. Automatic updates/sync are disabled,
existing Python companions are copied, competing Pylance is disabled, and an extension allowlist pins the copied
versions. Hosts configured to bootstrap additional VSIX extensions are rejected before launch.

Before copying assets, Windows preflight inspects the installed host's update mutex without acquiring or releasing
it. An active update blocks execution; finish the update before retrying with `--retry-rca`. If the update races
preflight and the host refuses startup, the adapter preserves stdout/stderr and refuses repeated launches for that
attempt. It never bypasses an update lock or terminates your editor/updater.

Editor setup and execution print separate phase start/completion/failure messages and a heartbeat every 15 seconds.
Executed phases save `editor-events.jsonl` beside `sdk-events.jsonl`, with UTC timestamps, elapsed phase times,
copy/link-scan/hash counts and the current file, case directories, and owned process IDs/startup/cleanup activity.
Errors appear immediately; an SDK timeout also includes the last editor phase and earlier editor error, if any.
These logs distinguish slow copying/hashing from venv creation or an editor/probe wait without logging the full
environment. Cancellation stops asset workers at their next progress checkpoint.

Preparation's full content hash is the first run's baseline, without an immediate duplicate hash pass.
Every completed experiment still fully verifies assets afterward; reused snapshots are also fully checked before
execution. Hashing streams file contents and preserves the existing receipt format and managed-index exclusions.

Windows discovery considers existing `code` and `code-insiders` installations, preferring a non-bootstrap host.
Specify an existing executable or installed Python-extension directory when necessary:

```powershell
uv run build\automation\review_issues.py --issues 11689 --retry-rca --dry-run `
    --rca-code-path 'C:\path\to\Code.exe' `
    --rca-python-extension 'C:\path\to\ms-python.python-version'
```

Missing/ambiguous assets, unsupported engine ranges, incompatible hosts, or overly long Windows probe paths are
explicit blockers, not failed product reproductions. Use a shorter `--state-dir` if requested. There is no automatic
build/install/download fallback. Automatic host discovery is Windows-specific; other platforms need an explicit
compatible executable/layout.

For #11689 the adapter tests activated `python_env`, `venv`, and `venv` under `python_envs`, each with a fresh profile.
Each opens an otherwise empty workspace from that workspace's directory, with the environment outside it.
Neutral case-directory names avoid introducing another `python`-prefixed ancestor into the basename control.
It captures startup `VIRTUAL_ENV`/`PATH`, exact host/extension/Python versions, feature flags, actual
`getExecutionDetails`/environment API results, Pyright output and server `pythonPath`, and per-case errors.
The directory-valued handoff must reach the actual server to count as the failure. A clean/debug comparison
normalizes only owned paths, preserving versions/settings/API/handoff outcomes and controls.
Editor-client breakpoints are relative to `packages\vscode-pyright\src`; found implementation claims need actual
producer hits/state, matching clean/debug evidence and an independently executed countercheck.
An API-only/component observation is partial evidence, not an integration reproduction.
Current-host non-reproduction cannot settle the historical VSCodium/Python/Pyright combination.

General LSP/focused-test adapters, arbitrary source patching and historical binary execution remain unavailable.
The private copy is **not a security sandbox**; RCA approval does not approve executing reporter Python.

Only a cause that passes the gate and survives challenge qualifies for automatic posting. In normal mode the runner
prepares a `rich-mirror` technical handoff and fact-checks it before publication. The comment preserves material
reproduction/configuration, actual versus expected behavior, observed producer/state, clean/debug comparison,
counterchecks, alternatives, supported links and limitations; it is not the abbreviated table summary.
Posting is comment-only: it never labels or closes the issue, edits an old comment, or claims an accepted diagnosis.
Blocked, inconclusive and failed RCA remains local rather than being posted as an established cause.
Evidence gates do not make model reasoning infallible.

`--dry-run` still performs automatic local RCA and saves the report, but disables comment drafting and posting.
Existing results are reused. `--retry-rca` resumes a failed/interrupted versioned RCA checkpoint when the review,
issue, local inputs, report, ledger, and private runtime still match. It retains the plan, executed observations,
scratch, completed gate, and per-role check allowance; a fresh SDK session retrieves prior observations by
controller evidence ID. Changed evidence blocks resumption rather than being silently trusted. Completed
blocked/inconclusive or legacy attempts use a new directory, preserving the previous artifacts. Qualified unposted
results resume publication without repeating the investigation.

```powershell
uv run build\automation\review_issues.py --issues 11876 --retry-rca --dry-run
```

Use `--rca-timeout` to adjust RCA without extending every behavior/research turn or invalidating compatible evidence:

```powershell
uv run --env-file .env build\automation\review_issues.py --issues 11899 --retry-rca --dry-run --timeout 300 --rca-timeout 900
```

An interrupted or failed attempt remains explicit; use `--retry-rca` to investigate again.
Ambiguous comment POST results retain the fact-checked body/marker for automatic reconciliation on resume.
After verifying that the only discussion change is its own approved comment, the runner updates its issue snapshot
for cache reuse; any concurrent reporter/discussion change blocks completion instead.

## Automatic publication and closing

By-design closures require **every claim** to be high-confidence specification-correct or an intentional limitation,
supported by historical searches and observed applicable checkout checks. Duplicate closures require a supported
validity result, high-confidence shared-cause evidence, inspected canonical issue/discussion, and a current canonical
snapshot. A closed canonical report may indicate a regression rather than a duplicate. Neither `needs investigation`
tag qualifies. These are conservative eligibility gates, not proof that the model's reasoning is correct.

For eligible reports, `rich-mirror` prepares the explanation and a separate tool-less pass checks factual
consistency. For by-design closure the controller posts the explanation with verified specification/policy and
supporting historical-issue links when available, adds `as designed`, and closes with reason `not_planned`.
For a duplicate it posts the shared-cause explanation and canonical-issue link, then closes with reason
`not_planned`, without adding an `as designed` or assumed duplicate label. A supported duplicate takes precedence
when both classifications apply. Missing/failed factual checks or stale evidence prevent publication.

The console posts the investigation comment **before** labeling and closing. Other labels are preserved.
If posting fails, closure does not proceed. If a later step fails, the existing comment is not edited or deleted.
The controller alone owns mutations; investigators and writers have no mutation tools.

The duplicate investigator compares underlying triggers, root causes, differences, discussions, and fixes rather
than matching titles. It never closes either issue itself. A duplicate is not converted into a by-design finding.

## Checkpoints and recovery

Default state: `~\.copilot\issue-review\microsoft-pyright`, overridable with `--state-dir`.
Each issue directory contains `review.md`, `duplicates.md`, `adjudication.json`, supporting validation records,
any comment draft, execution ledger,
SDK session/usage/error metadata, scratch files, and `entry.json`. The shared `run.json` records the checkout,
runtime/SDK, requested model, latest-release metadata, and input fingerprint.

Unchanged completed reviews and keep-open decisions are reused. Changed issue timestamps/content, source/build,
profiles/skill/instructions, requested model, runtime/SDK, or shared release metadata invalidate that cache.
`--retry-failed` retries failed investigations. Use a separate state directory for an independent calibration or
to reconsider already-kept issues. Earlier reviews using the runtime's unpinned default are invalidated by this
updated input fingerprint; new reviews explicitly request the selected model.

Before publishing, the controller checks for stale issue and local inputs. It persists the approved body and a
unique hidden marker before posting, then reconciles the authenticated user's matching comment when resuming.
This prevents blindly reposting after an ambiguous network failure. A resumed partial closure continues
automatically only if its saved evidence and checkpoints remain valid. Changed reports, execution evidence, issue discussion/content, canonical issue,
or ambiguous state stops further mutation.
GitHub does not make comment/label/close a single conditional transaction: a final read/write race remains possible,
and a posted comment or label can remain on an open issue after failure.

Do not change the source or shared build while a run is active. A state-directory lock prevents simultaneous
controllers using the same checkpoint. After a crash, remove `run.lock` only after verifying that process is stopped.
If an unfinished publication's review inputs changed, inspect its checkpoint and GitHub state manually rather than
discarding the marker or automatically accepting an outdated explanation. Existing JSON-only reviews are invalidated
by the updated review-input fingerprint and reinvestigated; unfinished publications are never silently migrated.
Do not commit generated evidence.

## Blinded by-design evaluation

`evaluate_issue_design.py` evaluates only the behavior reviewer: no duplicate investigator, RCA, writing pass,
GitHub comments, labels, or closures. It first captures frozen issue reports and separately stores the hidden
reference resolutions. Evaluation sees anonymous case IDs, body text, and explicitly selected pre-resolution
clarifications, never titles, real issue numbers, labels, state, or resolution comments. External links and known
cohort identities are removed. Body edits can contain answers: inspect each input and use `input_body` to supply
a reviewed pre-resolution version when necessary. Original body history is not automatically reconstructed.

For an inspected, self-contained Python example, set `repro_block` to its one-based fenced-code index and
provide explicit `configuration` if needed (otherwise the benchmark assumes standard mode and Python 3.12).
The controller freezes and runs that exact sample in a separate, non-editable original directory before the
agent creates controls. Its actual output is supplied without a verdict, and the report must include its
execution record. This prevents a reconstruction with added `reveal_type` calls or merged controls from silently
replacing the original behavior. It does not execute Python or reporter projects.

The small `design_benchmark_cases.json` contains four development candidates (two historical design decisions
and two proposed bug controls) plus two unrun holdout candidates. **All references are provisional**, not
human-approved ground truth. Open bug labels and old as-designed decisions need independent validation against
the intended version. Do not promote automation-generated closures to trusted references without independent
review. `family` prevents related cases from crossing development/holdout splits. Expand and review the cohort
before making reliability claims; this pilot is not the planned 30-40-case evaluation.

```powershell
$data = "$env:USERPROFILE\.copilot\issue-review-benchmark\development"
uv run --env-file .env build\automation\evaluate_issue_design.py capture --data $data
uv run --env-file .env build\automation\evaluate_issue_design.py run --data $data --output "$data\baseline-1"
```

The second development iteration uses `design_benchmark_iteration2.json`: four fresh historical decisions
(cross-call side effects, constrained TypeVar distribution, strict lambda inference, and private-name diagnostics),
the underscore confidence anchor, and both existing bug controls. Its original examples are inspected before
capture, with explicit checking modes and Python targets. This is still a provisional development cohort,
not a holdout or human-approved accuracy measurement. Run all seven cases explicitly:

```powershell
$data = "$env:USERPROFILE\.copilot\issue-review-benchmark\iteration2"
uv run --env-file .env build\automation\evaluate_issue_design.py capture --cases build\automation\design_benchmark_iteration2.json --data $data --limit 7
uv run --env-file .env build\automation\evaluate_issue_design.py run --data $data --output "$data\baseline-1" --limit 7
```

Both operations require the same fail-closed Decision-1 configuration as the console. Capture screens the full
original issue and discussion; each evaluation screens its frozen anonymous input again. There is no bypass.
Prepare the source CLI before evaluation; do not change it during a run. Use a new capture directory for changed
inputs, and a new `--output` directory for each agent revision. `--limit` defaults to four cases, `--timeout` to
300 active seconds per SDK turn, and `--model` to `gpt-6.1-sol`. Runs are sequential, with a fresh SDK session
per case. The existing SDK permits one corrective response if structured output/evidence validation fails.

This first pilot deliberately uses **restricted research**, not unrestricted production retrieval. The runtime
exposes only controlled scratch writing, up to six actual Pyright/mypy checks, and authoritative typing/Python/PEP
HTTPS or checkout `docs/*.md` reads. It has no native filesystem, shell, web search, GitHub, or Python-execution
tools. Redirects, arbitrary files, and references mentioning a cohort issue are refused. References, prior runs,
and expected labels cannot be read through the tools. Public-issue memorization by the underlying model cannot
be ruled out. Unrelated historical issue search is unavailable in this pilot, so results do not establish
accuracy for the production agent's full research workflow.
Documentation reads have bounded searchable pages so SDK output-size handling cannot replace evidence with a
file that the blinded agent is forbidden to read. The original controller baseline is additional to the six
agent-requested checks. Product content hashes are reused only while the file set, sizes, and timestamps remain
unchanged; this is a normal-build change guard, not protection against adversarial timestamp-preserving edits.

Outputs include per-case `review.md`, structured findings, actual product-check/source-read ledgers, SDK usage,
and run fingerprints for the agent, workflow, SDK, source diff, and prepared CLI/stubs. `summary.json` separates
reference agreement, false by-design/bug decisions against the reference, abstentions, and operational failures.
Executed claims must match controller records, and resolved verdicts require actual Pyright output and a retrieved
source. Those checks do not prove that the cited rule applies or the reasoning is sound; inspect the report against
the hidden reference after its conclusion is frozen. The summary deliberately does not call agreement "accuracy".

Evaluation version 2 shares production's `ReviewEvidence`/`Claim` validation, actual execution-provenance checks,
and by-design closure gates. Findings include a disposition, confidence/reason, sources, and three reproduction
targets for each material claim. The overall verdict/confidence remain semantic summaries, not authorization.
Summary rows expose each closure gate separately, including historical research; that gate is **blocked in this
restricted benchmark**, and invented historical-search records are rejected. A supported semantic conclusion
can therefore coexist with no closure candidate. Duplicate adjudication and publication checks are not simulated.

Evaluation version 3 additionally requires explicit per-claim expectations and rejects an overall bug verdict
without an observed mandatory-rule or established-intent failure. It records bug/by-design reference coverage
and false-bug reference disagreements as well as false-design disagreements: more bug labels alone are not
evidence of improved accuracy. Reference resolutions remain evidence to inspect, not unquestionable ground truth.
An inspected stub example can use `repro_filename="original.pyi"` rather than silently changing its context to
`.py`; scratch controls may also use `.pyi`. For a caller-approved existing prepared source artifact outside this
checkout, `--source-cli C:\trusted-checkout\packages\pyright\index.js` records and rechecks the actual wrapper,
bundle/stub content hash and path. It does not install/build anything or assert published-release provenance or
a verified source-to-build revision. The benchmark implementation revision remains separately identified.

Hidden references may specify `expected_design_closure`; omitted values remain unscored rather than being
inferred from old labels. The two existing bug controls provisionally specify `false`. Closure metrics distinguish
evaluated/scored coverage, candidate closures, reference agreement, and false closure proposals. A run with
zero eligible closures or no reviewed closure references does not establish automatic-closure safety. Version 1
artifacts lack these per-claim/gate results and are not silently rescored as if they supplied them. Run metadata
records the findings-schema hash and evaluation version; use a fresh output directory for the new protocol.

Capture holdout cases separately with `--split holdout`; use the same flag to run that capture. Do not inspect
holdout answers or tune against its findings before freezing the agent changes. The initial holdout candidates
still need independent input/reference review. Keep generated snapshots and investigations local and uncommitted.

## Offline checks

```powershell
uv run --no-project --with-requirements build\automation\requirements.txt python -m unittest discover -s build\automation -p "test_*.py"
uv run --no-project --with-requirements build\automation\requirements.txt python -c @'
import subprocess
import sys

raise SystemExit(subprocess.call([
    "node", r"packages\pyright\index.js", r"build\automation", "--pythonpath", sys.executable,
]))
'@
```

`requirements.txt` provides the same dependencies for these development checks; a test keeps it in sync with the
script's inline metadata.
The tests use fake GitHub and SDK clients; they do not consume inference or mutate real issues.
For the evidence standard and report/adjudication contracts, see [the issue-review guide](../../docs/issue-review-agents.md).
