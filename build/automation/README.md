# Interactive Pyright issue review

`review_issues.py` uses the Python Copilot SDK to investigate open **microsoft/pyright** issues in bounded chunks.
Each issue gets a behavior investigation from `pyright-issue-by-design-reviewer` (`review.md`), a separate duplicate
investigation (`duplicates.md`), and a
tool-less adjudication. The console displays only the resulting tags, then offers supported by-design or duplicate
issues for individual closure approval. It does not fix bugs or publish anything automatically.
The original `pyright-issue-reviewer` remains a separate read-only, non-executing reviewer and is not used by this console.

## Setup

Requires `uv`, authenticated `copilot` and `gh` executables, Node.js, and a prepared source CLI.
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
(`SessionIndexedSearchData` / `disabledReason` assertion failures). Other inherited environment settings are preserved;
your shell environment and other Copilot processes are not changed.

For closing or potential-root-cause comment drafts, install your `rich-mirror` profile in the normal personal agents directory, or supply
`--writer-agent C:\path\to\rich-mirror.agent.md`. The runner reads that profile; it does not copy your personal writing
instructions into this repository. Without the profile, investigations work but commenting/closure is blocked.

## Run

Start with a small, read-only cohort rather than the entire backlog:

```powershell
uv run build\automation\review_issues.py --issues 11881 11876 --dry-run
```

Review the current open-issue snapshot in chunks of five:

```powershell
uv run build\automation\review_issues.py --chunk-size 5
```

All stages default to **GPT-6.1 Sol** (`gpt-6.1-sol`), including both investigators, adjudication, RCA, comment writing
and factual checks. Use `--model` to override it; the selected model is displayed at startup and saved in the run
and session metadata. Native tools vary by model: the runner accepts `rg` or `grep` for search, and `apply_patch`
or the `create`/`edit` pair for scratch writing. It validates the active capabilities before inference and records
the actual tool names per session. Duplicate investigations have no write tools; command execution remains
controller-owned and scratch writes remain permission-scoped. Every investigation, writing pass,
and factual check consumes model usage. `--timeout` bounds each SDK turn's active time in seconds (default 900);
waiting for operator approval does not consume that budget, and approval prompts do not block the SDK event loop.
Product checks still count toward the turn budget and retain their own process timeouts. Timing out aborts
the turn, records an explicit error and SDK/tool-event timing, and does not manufacture an inconclusive verdict.
Both investigators run for every issue, including
by-design findings; the old `--duplicates` flag is accepted for compatibility but no longer needed.
The app investigates, adjudicates, and handles the decision for one issue before moving to the next, then asks before
the next chunk. A chunk is a count bound, not a concurrency setting or credit ceiling.
Malformed audit output gets at most one corrective turn in the same session; a second validation failure is saved
as a failure, not silently accepted or converted into an issue disposition.
Structured responses use strict provider-compatible schemas: every declared field is required on the wire, including
fields with local defaults, while nullable fields can still be `null`. Local Pydantic evidence validation remains
unchanged; defaults continue to support older checkpoints.

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

The runner executes only the prepared checkout CLI, not published Pyright releases. Its validator rejects
release-target reproduction claims based on that checkout, even when version strings match. Language-server,
editor-specific, packaging, and similar checks remain blocked rather than being inferred from a CLI result.
Non-CLI surfaces or insufficient reproduction cannot receive a confident `by design`/`bug` tag or a closure offer.

## Reports and tags

The two investigators return Markdown findings with machine-validation metadata in an internal SDK envelope.
The controller saves the Markdown files and execution ledger; it does not dump the JSON records to the console.
The independent `pyright-issue-adjudicator` reads both reports without tools and returns local classification tags:

```text
#123: by design | no dupe found
#456: bug | dupe of #321
#789: needs investigation | no dupe found
```

Either axis can be `needs investigation`. That means no closure option, even if the other axis is conclusive.
An incomplete search is not `no dupe found`, and related symptoms are not duplicates. `no dupe found` describes
the completed bounded search, not a guarantee about the entire backlog. Stub/environment problems, enhancements,
low-confidence claims, and conflicting evidence are not forced into binary bug/design classifications.
These tags are local results, not automatic GitHub label changes.

## Optional root-cause analysis

If either tag is `needs investigation`, the console asks `Do you want to perform root cause analysis? [y/N]`.
The default is no. Approval starts three bounded roles, inspired by Pyrx's investigator, evidence gate and adversary:
an investigator gathers evidence, a tool-less gate checks the causal explanation, and an independent challenger
tries a competing explanation. The gate/challenger run only when the investigator finds a potential cause.
Missing specification or historical evidence goes to authoritative research rather than unnecessary debugging.

The result is saved as `<state-dir>\<issue>\root-cause.md`, including blocked, inconclusive and failed attempts.
Each attempt also retains its own report, SDK records and evidence under `rca\<attempt>`. RCA does not change the
original tags: understanding a producer does not establish a bug, by-design intent, or a confirmed fix.

For implementation claims, the runner copies the prepared CLI, source maps and stubs into the attempt's private
runtime. It uses Node's native inspector with source-mapped TypeScript breakpoints and bounded read-only expressions;
it does not attach to an existing process, open an inspector port, edit shared source, or install tools.
The host requires actual breakpoint hits and observed state, matching clean/debug input and diagnostic results,
and an independently executed countercheck. Proposed/unhit breakpoints and source inspection alone are insufficient.
Stale build/source mappings fail explicitly; rebuild before retrying. Each executable role has at most eight product
checks. Private-copy creation and instrumentation can be slow; these captures are not performance measurements.
Before execution an explicit reproduction plan identifies the surface, target versions, prerequisites, setup,
expected failure and controls. Editor/LSP issues cannot use a CLI proxy. CLI investigations reuse the earlier
inspected scratch example/configuration when available. Debugging requires a relevant clean baseline first.
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

Only a cause that passes the gate and survives challenge qualifies for a posting offer. In normal mode the runner
prepares a `rich-mirror` comment, fact-checks it, displays the exact draft, and separately asks
`Post this as a potential root cause to issue #123? [y/N]`. The default is no. Approval to investigate is **not**
approval to publish. Posting is comment-only: it never labels or closes the issue, edits an old comment, or claims
an accepted diagnosis. Read the report and draft carefully; evidence gates do not make model reasoning infallible.

`--dry-run` still offers opt-in local RCA and saves the report, but disables comment drafting and posting.
Declined/completed choices are reused. `--retry-rca` reoffers declined or unsuccessful RCA with fresh consent and
a new attempt, or reoffers posting an already-qualified unposted result without repeating its investigation:

```powershell
uv run build\automation\review_issues.py --issues 11876 --retry-rca --dry-run
```

An interrupted or failed attempt remains explicit; use `--retry-rca` to investigate again.
Ambiguous comment POST results retain the approved body/marker for reconciliation and another posting approval.
After verifying that the only discussion change is its own approved comment, the runner updates its issue snapshot
for cache reuse; any concurrent reporter/discussion change blocks completion instead.

## Human-approved closing

By-design closures require **every claim** to be high-confidence specification-correct or an intentional limitation,
supported by historical searches and observed applicable checkout checks. Duplicate closures require a supported
validity result, high-confidence shared-cause evidence, inspected canonical issue/discussion, and a current canonical
snapshot. A closed canonical report may indicate a regression rather than a duplicate. Neither `needs investigation`
tag qualifies. These are conservative eligibility gates, not proof that the model's reasoning is correct.

For eligible reports:

1. Inspect `review.md` and `duplicates.md` in the issue's state directory; `v` displays both reports in the console.
2. Choose `p` to prepare a comment through `rich-mirror`; a separate tool-less pass checks factual consistency.
3. Read the exact comment and type `close 123` to authorize that issue only. For by-design closure this posts the
   explanation, adds `as designed`, and closes with reason `not_planned`. For a duplicate it posts the shared-cause
   explanation and canonical-issue link, then closes with reason `not_planned`, without adding an `as designed` or
   assumed duplicate label. Any other answer leaves the issue open. `k` keeps it open; `q` stops the run.

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
This prevents blindly reposting after an ambiguous network failure. A resumed partial closure requires another
explicit per-issue confirmation. Changed reports, execution evidence, issue discussion/content, canonical issue,
or ambiguous state stops further mutation.
GitHub does not make comment/label/close a single conditional transaction: a final read/write race remains possible,
and a posted comment or label can remain on an open issue after failure.

Do not change the source or shared build while a run is active. A state-directory lock prevents simultaneous
controllers using the same checkpoint. After a crash, remove `run.lock` only after verifying that process is stopped.
If an unfinished publication's review inputs changed, inspect its checkpoint and GitHub state manually rather than
discarding the marker or automatically accepting an outdated explanation. Existing JSON-only reviews are invalidated
by the updated review-input fingerprint and reinvestigated; unfinished publications are never silently migrated.
Do not commit generated evidence.

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
