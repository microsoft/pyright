# Interactive Pyright issue review

`review_issues.py` uses the Python Copilot SDK to investigate open **microsoft/pyright** issues in bounded chunks.
Each issue gets a behavior investigation from `pyright-issue-by-design-reviewer` (`review.md`), a separate duplicate
investigation (`duplicates.md`), and a
tool-less adjudication. The console displays only the resulting tags, then offers supported by-design or duplicate
issues for individual closure approval. It does not fix bugs or publish anything automatically.
The original `pyright-issue-reviewer` remains a separate read-only, non-executing reviewer and is not used by this console.

## Setup

Requires `uv`, authenticated `copilot` and `gh` executables, Node.js, and a prepared source CLI.
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
instructions into this repository. Without the profile, investigations work but commenting/closure is blocked.

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

Each classifier attempt has a 30-second bound. On HTTP 429 only, the controller makes at most one retry,
waiting for `Retry-After` (seconds or an HTTP date), or 60 seconds if no valid delay is returned.
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
not the controller's pre-analysis target-issue screening. Other errors and a second HTTP 429 still block
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
or interrupted ordinal, without storing the fragments or repeated context.
They also distinguish the original response hash from the hash of the new documents actually classified, count
reused/new documents, and record serialized-state sizes, HTTP attempts and retry-wait time. A blocking console message
identifies its source and issue number, selected label, injection score and allow threshold.
Target-issue checks are saved in the issue directory. Research tool records instead explicitly identify
`not_screened_research`; they are not passing classifier decisions. `run.json` and screening audits record the
`target_issue_and_comments` scope, which is also included in the policy hash. Normal investigation reports remain
separate. Changing the integration or configured endpoint/deployment invalidates review context; token refresh
does not change the screening policy.

Configure only an approved service: screening transmits the target issue and its discussion to that deployment,
not the agents' separate research reads.
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
