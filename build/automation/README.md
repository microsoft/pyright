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
Dry runs save per-issue `proposal.json` files and a run-level `proposals.json`, including the proposed action
(`close_fixed`, `label_not_reproducible`, `close_by_design`, `close_duplicate`, `post_root_cause`, `leave_open`, or `blocked`), per-claim confidence,
blocking reasons, and evidence paths. These are unreviewed action proposals, not closing-comment drafts or
publication authorization. Writer/draft validation and publication freshness checks remain unperformed.
Failed or screened-out issues remain explicit; run completion does not mean every investigation succeeded.
The console does not implement fixes.
The original `pyright-issue-reviewer` remains a separate read-only, non-executing reviewer and is not used by this console.

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

Only the fixed project npm package URL is acquired. Published packages require project identity and SHA-512
integrity; archive links and path escapes are rejected. Main is fetched from the fixed upstream repository,
checked against its pinned SHA, and installed with the upstream frozen lockfile and dependency scripts disabled.
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

Non-dry publication uses the existing closure ledger with distinct fixed/label reasons, evidence and draft hashes.
It rechecks implementation/target/input identity and screened issue/discussion freshness before each mutation,
preserves unrelated labels, reconciles exact marker/authored comments and existing labels on retry, and verifies
the final completed/open state. Changed evidence or ambiguous outcomes stop for inspection instead of posting
another comment. Fixed comments always use rich-mirror followed by bounded factual checking; investigator prose
is never directly published. No-live-action tests use fake GitHub/SDK clients; target acquisition can be smoke-tested
without invoking inference or touching any issue.
An unfinished fixed-closure ledger is also reconciled when a lost response left the issue already closed and
therefore absent from GitHub's open-issue listing.

## Setup

Requires `uv`, authenticated `copilot` and `gh` executables, Node.js, Git, pnpm, and a prepared source CLI.
Historical reproduction also requires verified HTTPS access to `registry.npmjs.org`; the isolated main build
needs upstream GitHub access and the pinned upstream lockfile's dependencies. Missing network access, TLS trust,
versions or build prerequisites are recorded as blocked, never as a successful negative check.
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
The required surface follows the material complaint, not the client name in environment metadata. Self-contained
typing, abstractness, and diagnostic-correctness questions can use the CLI even when reported in Pylance/Neovim.
The report records `surface_reason` and leaves historical/editor integration unverified. Actual diagnostic-delivery
failures, editor/CLI discrepancies, completions, interpreter handoff, and configuration discovery still need their
real surface; a component check cannot settle those claims.

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
reference agreement, false by-design decisions against the reference, abstentions, and operational failures.
Executed claims must match controller records, and resolved verdicts require actual Pyright output and a retrieved
source. Those checks do not prove that the cited rule applies or the reasoning is sound; inspect the report against
the hidden reference after its conclusion is frozen. The summary deliberately does not call agreement "accuracy".

Evaluation version 2 shares production's `ReviewEvidence`/`Claim` validation, actual execution-provenance checks,
and by-design closure gates. Findings include a disposition, confidence/reason, sources, and three reproduction
targets for each material claim. The overall verdict/confidence remain semantic summaries, not authorization.
Summary rows expose each closure gate separately, including historical research; that gate is **blocked in this
restricted benchmark**, and invented historical-search records are rejected. A supported semantic conclusion
can therefore coexist with no closure candidate. Duplicate adjudication and publication checks are not simulated.

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
