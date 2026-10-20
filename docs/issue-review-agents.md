# Pyright issue review

`pyright-issue-by-design-reviewer` investigates one supplied issue for supervised backlog review without changing
tracked files or publishing. It can run focused checks and create inspected scratch reproducers. Despite its name,
it evaluates by-design claims rather than assuming them; valid bugs and uncertainty remain first-class outcomes.
It follows the baseline [issue analysis skill](../.github/skills/pyright-issue-analysis/SKILL.md), with this guide
and its own profile defining the stronger evidence and output requirements.

The original `pyright-issue-reviewer` remains unchanged: read-only analysis and maintainer-response drafts, without
execution or edits. `pyright-issue-fixer` remains the separate, explicitly selected implementation role.

## Usage and boundaries

Explicitly select the by-design reviewer in an interactive session, or invoke it from this checkout:

```sh
copilot --agent pyright-issue-by-design-reviewer --prompt "Investigate microsoft/pyright#11867. Reproduce the report and assess the typing rules and historical design decisions. Do not modify tracked files or publish."
```

Restart the CLI after changing agent profiles so it discovers their current definitions. Tool permissions remain subject
to the host. An existing session may retain the old tool allowlist even after reading the edited profile; verify actual
execution and scratch writing in a fresh invocation before a batch. `execute` and `edit` are not a sandbox: the reviewer
must restrict writes to its scratch directory and normal ignored build outputs. It may not install dependencies, run
reporter projects, edit tests, or mutate GitHub.
The caller supplies a distinct absolute scratch path, revision/build information, and any read-only issue evidence.
The caller owns dependency setup and shared builds; reviewers must not race changing build outputs or expectations.
If a tool or source is unavailable, report the limitation rather than inventing evidence.

No response draft is needed for an audit. A request to investigate is not permission to post, relabel, close, commit,
or fix. If a GitHub draft is requested, apply the user's required writing pass separately from the technical review.

### Console-owned injection screening

The SDK console requires Microsoft-Decision-1 screening before exposing an issue and its discussion to any analysis role,
including resumed work. Related GitHub tool evidence is screened at ingress; a blocking result aborts the role.
Flagged, uncertain, failed and over-budget checks skip the issue without override. This classifier is separate from
the behavior/duplicate investigators and adjudicator: it does not decide whether a report is a bug or by design,
authorize execution/publication, or certify that a passing report is safe.

The classifier receives structured untrusted evidence and a fixed controller-authored Choice rubric with
`benign` and `injection` labels. Its provider-independent interface returns the selected label and full probability
distribution. The Decision-1 adapter uses Microsoft Entra ID through `DefaultAzureCredential`, never API keys.
Evidence above the single-request limit is split into bounded, overlapping fragments with repeated untrusted
context; every fragment must pass before the complete evidence is released or cached. Aggregate risk is the
maximum fragment risk, never an average. Fragmentation does not truncate the evidence, but it can lose
relationships between distant passages and is not a guarantee against distributed prompt injection.
Its provisional thresholds need evaluation against labeled benign and adversarial examples on the actual
deployment; mocked workflow tests do not establish detection accuracy. Existing permission limits and human
approvals remain mandatory. Interactive agent invocations outside this console do not automatically receive
this screening layer. See the [automation setup](../build/automation/README.md#required-prompt-injection-screening)
for explicit deployment configuration, privacy boundaries, bounds and local audit records.

## Decision standard

Reproduction and validity are separate questions. A reproduced diagnostic may be correct; a historical bug may no longer
reproduce. Record the reported release, current release, and checkout separately, even when only one is available.
Inspect actual types and diagnostics, not just exit codes or total error counts.

Use the current typing specification for the rules it covers, with version applicability and exact section links.
Python runtime semantics, conformance tests, other checkers, and Pyright tests are supporting evidence, not replacements
for applicable typing rules. Neither runtime acceptance nor agreement with another checker proves static correctness.
Distinguish required, recommended and optional behavior, and use revision-qualified sources when historical changes
matter. Relevant [typing conformance tests](https://github.com/python/typing/tree/main/conformance) can support the
analysis. A Pyright precision/performance limitation is not automatically a limitation of all Python type checkers.
If the example already violates a typing rule, separate the required rejection from subsequent recovery diagnostics.

An "as designed" explanation must distinguish:

| Disposition            | Required support                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Specification-correct  | An applicable rule and an explanation connecting it to the example.                             |
| Intentional limitation | A permitted approximation or established project policy, its source, and the relevant tradeoff. |

Missing specification coverage is not proof of intent. Existing code and tests establish behavior, not necessarily
correctness. Generic claims about undecidability do not establish that a particular request is infeasible. Deliberate
limitations may cause genuine false positives and justify enhancements. A documented policy that violates an applicable
mandatory typing rule remains a bug/specification-compliance concern; intentional behavior does not excuse nonconformance.

Search historical as-designed decisions and competing bugs/fixes/spec changes. Record the queries, inspect decision
comments, and explain the precedent's assumptions, scope, and continued applicability. Do not treat labels or repeated
AI-generated summaries as independent confirmation. A historical decision does not override newer applicable rules.
Challenge a proposed conclusion with a discriminating example or explain why decisive evidence already settles it.

For crashes, import resolution, performance, packaging, and language-service issues, use the relevant reproduction surface.
Typing-spec analysis and mypy comparisons can be inapplicable; say why. Do not call a single CLI/test duration a meaningful
interactive-latency or scaling measurement.

## Calibration before a backlog run

Start with a small named cohort spanning a clear typing bug, specification-correct rejection, deliberate analysis
limitation, and insufficient-evidence case. Include open reports and historical decisions. State why each was selected;
do not claim this small sample proves reliability across the backlog.

Run each issue in a fresh context. Ask for evidence, not a desired verdict, and do not inject another reviewer's
conclusion. Published issue discussion remains available because assessing its reasoning is part of the job.
Consequently, matching an existing label is not a blind accuracy measurement.

Review these properties before expanding:

-   Did reproduction actually execute against the claimed build and conditions?
-   Are specification claims supported by the cited sections, with discretion and version changes identified?
-   Does a historical precedent really apply, and was competing evidence considered?
-   Does the conclusion survive its counterexample, with blocked checks and uncertainties preserved?
-   Is real user impact acknowledged without confusing a limitation with invalid Python?
-   Is the audit record complete and consistent with the execution evidence?

Correct workflow failures and rerun only the affected cases. Human disagreement, missing dependencies, and an unresolved
semantic question remain explicit; do not force a verdict to complete the batch. The highest-risk error is dismissing a
real bug as intentional behavior without adequate support.

## Markdown findings and adjudication

The SDK console runs two investigators for **every issue**. `pyright-issue-by-design-reviewer` produces `review.md`;
`pyright-issue-dupe-investigator` produces `duplicates.md`. These are readable investigations, not GitHub comment
drafts. Each includes evidence, reasoning, precise sources, competing explanations, confidence and limitations.

The behavior report includes the minimal reproducer, configuration, product/build and relevant product surface,
expected versus observed diagnostics/types, exact commands, typing-specification and historical analysis, and user
impact. For CLI issues the reviewer must attempt the actual prepared Pyright executable, not infer reproduction
from source inspection, a test assertion, CPython execution, or another checker. The controller appends its own
execution ledger, including source/configuration snapshots and full stdout/stderr. Observed reproduction requires
matching actual Pyright JSON output, command, working directory, and exit status.

The initial behavior-review runner supports checkout CLI execution only. Published releases and LSP/editor/packaging
surfaces remain blocked at this stage, not inferred from a CLI proxy; optional RCA has the separate editor adapter
described below. An appropriate unsupported surface or insufficient reproduction requires `needs investigation`,
never a closure offer. Optional runtime probes remain separately approval-gated.

Investigators use internal structured transport envelopes so the controller can validate evidence without parsing
prose: `ReviewFindings` contains `markdown` and `audit`; `DuplicateFindings` contains `markdown` and `report`.
The duplicate record contains repository/issue identity, summary, bounded candidate relationships/confidence,
shared-cause reasoning, differences, canonical rationale, evidence links, uncertainties, `searches`, and
`search_complete`. Incomplete access/searches must not be reported as a completed no-match result.
The Markdown files are the review artifacts; supporting JSON records are not dumped to the console.

The separate, tool-less `pyright-issue-adjudicator` reads both Markdown reports and validation metadata. Its
`Adjudication` record contains `issue_number`, the controller's `report_hash`, `validity` (`by design`, `bug`,
`needs investigation`), `duplicate_status` (`dupe`, `no dupe found`, `needs investigation`), `duplicate_of` (canonical
number only for `dupe`, otherwise null), and a saved reasoning `rationale`. Only the two tags are displayed.

The host rejects unsupported classifications and evidence/hash mismatches rather than silently accepting or
downgrading them. A duplicate needs high-confidence shared-cause evidence with a canonical issue/comment link and
actual canonical issue/discussion reads. A no-match result requires completed bounded searches with no unresolved
candidate, backed by successful, non-incomplete GitHub search results. Neither means the entire backlog was exhausted.
Validity and duplication are independent: a duplicate is not automatically by design.
Either `needs investigation` tag prevents closure. Tags are local results, not automatic GitHub labels.

### Optional root-cause escalation

For either unresolved tag, the console offers opt-in investigation with default-no consent. It saves
`root-cause.md` and preserves per-attempt artifacts, including explicit blockers, uncertainty and failures.
The `pyright-issue-root-cause` investigator gathers missing authoritative or executable evidence;
`pyright-issue-root-cause-gate` checks the causal packet without tools, then
`pyright-issue-root-cause-adversary` independently tests a competing explanation if the gate passes.
These roles adapt Pyrx's evidence/gate/challenge pattern without depending on a Pyrx checkout.

Implementation claims need a real producer hit and observed state from the prepared product, identical clean/debug
inputs and matching diagnostics, plus an independent executable countercheck. The controller privately copies the
CLI bundles, maps and stubs, checks source-map/source agreement, and uses bounded read-only native inspector
evaluations. It does not modify shared source, install tooling, attach to another process, or open a debugger port.
This is not the evaluation-trace adapter, a performance measurement, or a security sandbox. Unsupported surfaces,
arbitrary source patching and published-release execution remain unavailable; source reading alone is not proof.
Missing normative/history evidence should be researched rather than automatically routed to debugging.

A tool-less reproduction-planning turn selects the actual surface before execution, with explicit prerequisites,
target versions, setup, expected failure and controls. Existing verified CLI repro inputs are reused where applicable.
Editor interpreter integration has a separate owned extension-host adapter: private prepared Pyright/installed
Python-extension assets, fresh workspace/profile/activated venvs, and separately approved execution. It observes the
real interpreter API, Pyright handoff and server path rather than selecting/injecting an interpreter. Source-mapped
editor hits use the actual client bundle. CLI diagnostics are not an editor evidence requirement; instead the host
requires observed integration failure, matching clean/debug version/settings/API/handoff outcomes and controls.
The #11689 scenario includes `python_env`, `venv`, and `python_envs/venv`. API-only/component results remain partial;
current-host non-reproduction does not resolve historical combinations. Unsupported general LSP/focused-test
surfaces and missing prerequisites remain explicit blockers, without automatic downloads.

Editor attempts persist timestamped phase/heartbeat events in `editor-events.jsonl` and report copy/hash progress,
venv creation, owned host startup/cleanup and failures separately. SDK timeouts retain the last phase and earlier
editor error. Read-only Windows update-mutex checks reject an updating host before asset copying; a startup update
race blocks repeated launches for that attempt, rather than hiding the prerequisite failure behind another timeout.
The operator must finish the update before retrying; the controller never bypasses it.

A blocked-result challenge checks avoidable setup mistakes, available evidence and supported alternatives.
At most one materially different alternative is allowed, within the original permissions and product-check budget.
Operator denial and genuine missing prerequisites cannot be waived. Both attempts' plans/findings remain in the
report. This is not a loop that keeps trying unrelated CLI examples until a conclusion appears.

Only a found cause that passes both gate and challenge can be offered for a separately approved potential-cause
comment. `rich-mirror` writes it, a tool-less pass checks factual consistency, and the controller displays the exact
draft before default-no issue-specific posting consent. Posting never labels/closes the issue or changes the
original adjudication. Observed implementation behavior is not by-design intent or a confirmed fix.
Stale evidence/local inputs/discussion block posting. Saved markers reconcile ambiguous POSTs without duplicate
comments. `--dry-run` permits approved local investigation but disables drafting/publication.
See the console README for `--retry-rca`, private-runtime requirements, limitations and recovery.

## Supporting audit record

For an SDK backlog assignment, this record is the `audit` member of `ReviewFindings`; the investigator also supplies
the full Markdown report. A calibration caller may request this record directly.
Use `null` for unavailable scalar values and empty arrays for empty collections; explain material omissions in
`uncertainties`. Do not invent timestamps, versions, commands, source access, or observations.
Host-required interim status messages are separate from the final record.

Required top-level fields:

| Field                                     | Value                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`                          | Integer `1`.                                                                                                               |
| `repository`, `issue_number`, `issue_url` | Repository identity, positive integer issue number, and canonical issue URL.                                               |
| `issue_updated_at`, `reviewed_at`         | Observed issue update timestamp and review timestamp, in ISO 8601.                                                         |
| `checkout_revision`                       | Full inspected Git SHA, or `null` if unavailable. Identify material worktree differences in `uncertainties`.               |
| `summary`                                 | Concise account of the claim and conclusion.                                                                               |
| `product_surface`                         | `cli`, `language_server`, `editor`, `packaging`, or `other`; identify the surface needed to reproduce this report.         |
| `claims`                                  | Nonempty array of claim records described below.                                                                           |
| `checks`                                  | Array of executed or proposed check records described below.                                                               |
| `sources`                                 | Array of source records described below.                                                                                   |
| `historical_searches`                     | Array of `{query, outcome}` records; outcome distinguishes results, no matches, and failed/unavailable access.             |
| `uncertainties`                           | Array of remaining limitations, including inaccessible sources and unperformed comparisons.                                |
| `next_action`                             | Specific next evidence, workaround, enhancement consideration, or localized fix hypothesis; not a publication instruction. |

Each `claims` entry contains:

-   `id`, `summary`: a unique claim ID and the specific reported behavior/expectation.
-   `disposition`: `bug`, `specification_correct`, `intentional_limitation`, `stub_or_environment`, `enhancement`, or
    `inconclusive`. The disposition concerns this claim; identify when it is a historical bug already fixed in a target.
-   `confidence`, `confidence_reason`: `high`, `medium`, or `low`, with an evidence-based explanation.
-   `reproduction`: exactly three `{target, version, status, check_ids}` entries, one each for `reported_release`,
    `current_release`, and `checkout`. Version may be `null`. Status is `reproduced`, `not_reproduced`, `blocked`,
    `not_attempted`, or `not_applicable`. Check IDs refer to `checks`; `reproduced` and `not_reproduced` require an executed,
    applicable check. Do not infer one target's result from another's version string.
-   `basis`: reasoning connecting observations to the rule, permitted approximation, or documented policy.
-   `source_ids`: references to supporting `sources`. Specification-correct and intentional-limitation claims require
    applicable source evidence, not merely an existing implementation or label.
-   `counterevidence`: the competing explanation and its result, or why decisive evidence settles it.
-   `falsification`: what finding would overturn the conclusion.
-   `user_impact`: the actual concern, including false positives or a useful enhancement despite intentional behavior.

Each `checks` entry contains `id`, `status` (`executed`, `blocked`, or `proposed`), `command`, `cwd`, `exit_code`,
and `observations`. Commands identify the actual executable and relevant flags/configuration. Observations include
diagnostic identities/locations, revealed types, runtime results, or measured outcomes as applicable. Nonexecuted checks
have a `null` exit code and no claimed observed result; explain blockers or predicted results explicitly.
An executed checker returning diagnostics is not an execution failure merely because its exit code is nonzero.

Each `sources` entry contains `id`, `kind`, `location`, `finding`, and `applicability`. Kind is `typing_spec`,
`python_docs`, `maintainer_decision`, `repository`, `checker_comparison`, or `reporter`.
Location is the exact URL or revision-qualified repository path. Finding distinguishes the source's claim from
independently observed behavior. Applicability explains assumptions, relevant versions, possible supersession, and,
for design decisions, author/date and why the precedent applies. IDs must be unique within each collection and all
references must resolve. A retrieved issue report remains reporter evidence, not an executed check.

## Backlog orchestration

Keep scheduling separate from the one-issue reviewer. The
[interactive Python console](../build/automation/README.md) uses the
[Copilot SDK custom-agent support](https://github.com/github/copilot-sdk/blob/main/docs/features/custom-agents.md)
to create a fresh session for each issue. Explicitly select the reviewer as the session's active `agent`; merely registering
it in `custom_agents` does not ensure it handles the prompt. Configure the skill directories and preload the issue-analysis
skill, and verify profile, instruction, and tool loading against the installed SDK/runtime before processing real issues.
Consume the final assistant response or a validated saved record, not the concatenation of streamed messages. CLI `--silent`
can still include interim commentary, so its entire stdout is not necessarily a single JSON document.

A runner should paginate a snapshot of open issues excluding PRs, preserve issue update times, validate each audit
record, and checkpoint results outside the source tree. Keep completed, blocked, failed, and pending work distinct.
Resume only when the issue, checkout, reviewer/skill instructions, and relevant configuration still match; otherwise
mark the result stale. Preserve partial evidence on failure, and never turn an SDK timeout into an issue disposition.
Use bounded concurrency with distinct scratch locations and a shared immutable build. Record model/runtime and review
input revisions for provenance. Honor the user's model choice: this console defaults to their preferred
`gpt-6.1-sol`, with `--model` overriding it for every stage.
Supply immutable shared release/build metadata once rather than rediscovering it for every issue, while keeping each
issue's semantic analysis in a fresh context. Record usage and elapsed time so a pilot can inform an explicitly bounded run.

Use narrow permission handling and read-only GitHub access rather than blanket tool approval. Agent instructions alone
are not a security boundary for shell tools; enforce host permissions and isolation separately.
Group duplicate claims and reuse applicable evidence, but account for every issue individually.
Default output is a local audit report for human adjudication, never automatic comments, labels, or closures.

The console handles investigation, adjudication, and any closure decision **one issue at a time** within bounded
chunks. It can separately prepare a `rich-mirror` closing comment and check factual consistency.
Only an explicit typed confirmation for that issue authorizes publication and closure.
For by-design closure, every claim must pass the high-confidence design gate with observed applicable product
evidence. The controller posts the explanation, adds `as designed`, and closes as `not_planned`.
For duplicate closure, the adjudicator must identify a supported duplicate with a current verified canonical
snapshot; the controller posts the shared-cause explanation and canonical link, then closes as `not_planned`
without inventing a duplicate label or adding `as designed`. The canonical issue is not modified.
Either `needs investigation` tag blocks both closure paths. Eligibility never replaces maintainer judgment.

Comment publication precedes closure. Checkpoints retain partial failures and reconcile existing comments rather
than blindly posting twice. Changed reports, execution evidence, issue discussion/content, canonical snapshots, or
local review inputs stop publication. `--dry-run`/`--read-only` disables comment drafting and all GitHub mutations.
