# Advisory mypy_primer analysis

After the existing raw mypy_primer comment is posted, **Explain mypy_primer
differences** analyzes the complete eight-shard output and posts a separate,
commit-specific explanation. It is advisory: it does not approve PRs, change
labels, merge changes, or make mypy_primer diagnostic differences fail CI.

The PR comment leads with potential regressions and unresolved investigations,
not a diagnostic-count table. Each project analysis states baseline evidence,
changed behavior, downstream impact, a causal explanation, PR attribution, and
the remaining uncertainty or next check. Type-erasure signals are ranked first;
other assessed changes are collapsed. The linked workflow run's
`mypy-primer-analysis-report` artifact always contains the complete explanation,
evidence, and limitations for every project. The original raw diff remains
available. Added/removed counts refer to diagnostic headers; message rewrites can
count on both sides. A separate column counts added/removed indented detail lines,
including projects where no diagnostic header changed.

Explanations longer than 1,800 characters do not prevent publication. The comment
shows the first 1,800 Unicode code points with an explicit truncation notice, while
the artifact retains the complete explanation. Truncation happens before Markdown
escaping, without splitting surrogate pairs. The 60,000-character comment budget
still falls back to a compact regression outline when expanded details do not fit.
Nonempty explanations and the overall 1,000,000-character input bound remain
required. Other field limits, project coverage, assessment/evidence validation,
and stale-PR checks are unchanged.

Concise primer diffs omit unchanged headers and context. The parser therefore
preserves detail lines separately rather than attributing them to a nearby
diagnostic or inventing a location or severity. The manifest's `groups` summarize
headers, and `detailGroups` summarize detail lines; each uses only rule labels
explicitly present on that line, or `unspecified` when absent. Both retain bounded
examples, with complete evidence in the raw artifacts. Detail-only projects still
require an assessment, even with zero added/removed headers.

The collector also extracts generic `regressionSignals`: new assertion failures
returning bare `Any`/`Unknown`, other assertion failures, removed checking diagnostics
without replacements at the same locations/rules, and newly appearing gradual
types in diagnostic details. These are investigation leads, not confirmed bugs or
proof that the PR caused them. Detail-only signals do not pair unrelated lines.
Signals stay visible in the regression section even if the model labels a project
an improvement or a stub issue; such a label cannot silently dismiss the warning.
This is not an exhaustive detector, and absence of signals does not establish safety.

Assessments distinguish expected improvements, newly exposed typing issues,
possible regressions, and changes needing human review. Neither fewer diagnostics
nor a successful primer job establishes correctness. The agent is specifically
instructed to investigate assertion failures, type precision loss, and diagnostics
that may have disappeared because a result became `Any` or `Unknown`.
PR attribution is separate: `likely-pr`, `unclear`, or `unlikely-pr`. A likely
attribution requires an implementation citation pinned to the analyzed head and
line, as well as a causal explanation. Source links do not independently prove the
reasoning, so these remain advisory findings. Conformance intent and newly changed
test expectations are not evidence that a loss of downstream checking is harmless.
New assertion failures must not be blamed on stubs without inspecting the relevant
declarations. The agent cannot execute reproductions and must label static reasoning
and proposed follow-up checks accordingly.

When the only changed project is the canonical `sympy` project, the comment is a
short notice that treats these differences as non-blocking primer noise. It keeps
the recorded counts and full-report link instead of presenting a regression table.
This is a reporting policy, not proof that the checker change is harmless. The
complete validated analysis remains in the artifact, and mixed-project runs retain
their normal per-project analysis, including SymPy.

## Manual previews

After the manual trigger is merged into `main`, select **Run workflow** under
**Explain mypy_primer differences**, or run:

```text
gh workflow run mypy-primer-analysis.lock.yml --repo microsoft/pyright --ref main -f primer-run-id=31429223864 -f primer-run-attempt=1
```

This example previews the final recorded primer run for PR #11601. Use the
**Run mypy_primer on PR** run ID, not the raw-comment or analysis run ID. The run
must be successful, its requested attempt must match, and all eight shards plus
the PR-number artifact must still be available. The PR must match the source
repository, branch, and head commit; superseded heads are still skipped.

Manual mode permits verified closed or merged PRs but never posts a PR comment.
The regular publishing job is disabled for manual dispatch, the separate preview
job has read-only GitHub permissions, and the publisher rejects preview manifests.
The same analysis model, budget, report validation, and threat detection apply.
After a successful run, open the **preview** job's summary or download
`mypy-primer-analysis-report`: `comment.md` contains the comment preview and
`full-report.md` contains the full analysis. Both are labeled as previews.
Automatic workflow-run analysis still requires a current, open PR.

## Activation and maintenance

The Markdown workflow and its generated `.lock.yml` must be merged into `main`
before the automatic `workflow_run` trigger becomes active. Organization-billed
Copilot inference must be available to the repository; the workflow requests
`copilot-requests: write` and does not require a personal token. If organization
policy disallows this inference permission, a repository administrator must resolve
that configuration before the workflow can run. See the
[Copilot authentication reference](https://github.github.com/gh-aw/reference/auth/).

The limits are 100 AI credits, 30 agent turns, and 15 minutes for the agent.
They can be adjusted in `.github/workflows/mypy-primer-analysis.md`. The agent must
mark insufficiently investigated projects as needing review rather than inventing
evidence to meet its budget.

The analysis uses `engine.model: gpt-5.6-terra` rather than the lightweight Luna
model, with a larger budget for causal regression investigation; consult the
[Copilot pricing table](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
for current rates. Keep `sandbox.agent.token-steering: false` so the
proxy preserves the selected model rather than steering requests to another one.
The 100-credit analysis budget is approximately $1; it does not guarantee completion
or detection of every regression.
The model must be enabled for the organization, and its advisory assessments
still require human review. Threat detection explicitly retains its existing
`detection` model alias rather than inheriting the analysis model.

Every activated analysis must submit exactly one `publish_primer_analysis` report.
This safe-output submission queues the trusted publisher; it is not a direct GitHub
write. `noop` is disabled, and an independent post-step validates successful agent
executions after safe-output ingestion, using the normalized `agent_output.json`
and the same report validator as the publisher. Empty, no-op-only,
incomplete, duplicate, or malformed submissions fail the agent job rather than
leaving a misleading green run with publication skipped. The validator and manifest
are staged before execution into the runtime directory mounted read-only in the
analysis sandbox. The check does not post a comment or replace threat detection,
staged-mode handling, or stale-PR validation. Inaccessible evidence should produce
a low-confidence `needs-review` report, not a no-op.

Keep `typing.python.org` in `safe-outputs.allowed-domains`: the report validator
and agent instructions allow typing-specification citations alongside GitHub links.
gh-aw sanitizes the serialized report before validation; redacting an allowed
citation can also consume its closing JSON quote and corrupt an otherwise valid
report. This output-only allowance does not expand the agent's network access or
disable URL redaction and the publisher's evidence-host checks.

Keep `tools.cli-proxy: false` explicit. The agent denies shell execution, so GitHub
reads and safe-output submissions must use MCP directly, not shell-backed CLI
wrappers. Regeneration must retain both MCP servers and omit CLI-only prompt
instructions; do not resolve tool-access failures by enabling shell execution.

The workflow is compiled with GitHub Agentic Workflows v0.88.7. Use that exact
compiler version for regeneration; check the installed version first:

```text
gh aw version
gh aw compile mypy-primer-analysis --validate
```

The older v0.86.2 compiler advertised shell-backed tools even with
`cli-proxy: false`. v0.88.7 omits that guidance when bash is disabled and supplies
MCP-compatible safe-output instructions. It still prepares CLI wrappers
internally, but they are not advertised to the agent or required for MCP access.

Keep `engine.version: 1.0.80` explicit as well. Without it, the installer can select
a newer CLI through the runtime compatibility catalog even when generated metadata
records `1.0.80`. CLI `1.0.83` connects to the bundled gateway `v0.4.18` but its
native `tools/list` requests fail with MCP error `-32022` (unsupported protocol
version). CLI `1.0.80` supports native tool discovery with that gateway.

A preflight harness starts the installed CLI in headless mode and checks its live
GitHub and safe-output tool lists, including `publish_primer_analysis`. It uses
the same authenticated gateway inside the analysis sandbox, an isolated CLI
home in its writable `/tmp/gh-aw` mount, no repository credentials, and an
unreachable local inference endpoint.
It never sends a prompt or calls a tool. Missing tools or protocol errors fail the
job before paid analysis starts; gateway health or successful initialization alone
does not establish compatibility. Only successful discovery launches the unmodified
standard Copilot harness, preserving its arguments, environment, and exit status.
The trusted collector stages the preflight scripts from the workflow commit, not
from the candidate PR. `pre-agent-steps` only copies them into the runtime directory:
that hook runs before gateway setup in this compiler version.
The compiler omits its outer AWF startup retry wrapper for custom harnesses, so
preflight failures stop immediately. The standard harness's inference retries
remain unchanged.

Before changing the CLI pin or gateway, repeat native tool discovery against the
actual selected binaries; compilation alone cannot catch transport incompatibility.
The preflight checks discovery, not model quality or successful comment publication.

The compiler owns the `github/gh-aw-actions/setup` runtime as well as the generated
script calls. `.github/aw/actions-lock.json` records its version-to-SHA resolution;
the generated metadata, runtime pin, and compiler version must agree. A standalone
runtime bump can remove scripts that the existing generated workflow still calls
(for example, v0.86.2's `install_ripgrep.sh` is absent from v0.88.4). Dependabot
therefore ignores only `github/gh-aw-actions`; unrelated action updates remain
enabled. The existing primer workflow tests also check compiler/runtime consistency.

To upgrade, deliberately select the compiler version, regenerate with its matching
runtime, and review the generated diff and resolution lock together. Do not override
the runtime independently or manually edit `.lock.yml`. Keep authored workflow
changes, any resolution-lock changes, and regenerated output together in the same
commit. Check permissions, tools, container/action pins, and the threat-detection
and publisher gates; rerun the primer tests and compile again to confirm stable
output. If Dependabot updated other actions in the generated workflow, reconcile
their authored Markdown pins before regeneration rather than silently downgrading
them. Local compilation does not prove a live comment was posted: `workflow_run`
uses the trusted default-branch workflow, so a PR-only repair cannot fix an existing
run on `main`.

For `gh aw compile --staged`, the publisher reads the staged flag from the trusted
activation artifact rather than relying on an environment variable inherited by
custom output jobs. Missing activation metadata fails closed rather than
defaulting to live publication.

`build/ci/mypyPrimerAnalysis.ts` runs using Node's built-in TypeScript
stripping in `actions/github-script` v9, without installing PR dependencies. Its
regression coverage runs with the existing Jest suite:

```text
pnpm --dir packages/pyright-internal exec jest mypyPrimerAnalysis.test --runInBand
```

## Trust boundaries and limitations

- Analysis starts from the trusted raw-comment workflow, not directly from a fork.
  Its small handoff artifact identifies the upstream primer run and attempt.
- Preparation verifies the source workflow, repository, successful run, artifact
  inventory, PR association, and current head. Fork runs with missing PR metadata
  are associated by listing open PRs in the target repository with the run's head
  owner and branch. Exactly one PR must match the head repository, branch, SHA,
  and base repository, and its number must agree with the uploaded artifact.
  GitHub's commit-to-PR lookup can return an empty list for an open fork PR, so it
  is not used for this fallback. Missing or ambiguous matches fail explicitly.
- All eight shards are required. Missing, duplicate, expired, oversized, or
  old-attempt artifacts cause an explicit failure, not a partial success report.
  Partial reruns that reuse old shard artifacts should be rerun in full.
- The agent has read-only GitHub access, no shell or editing tools, and no PR code
  checkout. Logs, descriptions, and source are untrusted data. It cannot execute
  candidate code, install dependencies, or perform historical reproductions.
- A separate publisher checks that every project appears exactly once, supplies
  the authoritative counts, restricts the destination to the verified PR, and
  rechecks its head and run attempt before posting. Threat detection must explicitly
  succeed before publication; missing or failed verdicts cannot authorize a comment.
  Staged mode never posts.
- The corpus's exact dependency environments and source revisions are not always
  available in primer artifacts. The report must disclose missing provenance and
  distinguish inspection of current upstream code from evidence about the run.
  Primer also analyzes the synthetic PR merge commit, not just the author's head;
  the agent must use recorded new/base commits or disclose that distinction.

An AI failure, incomplete report, or stale-head rejection does not erase the raw
primer result or imply that the changes are safe. Review workflow failures and the
report's unresolved groups as part of ordinary PR review.
