# Advisory mypy_primer analysis

After the existing raw mypy_primer comment is posted, **Explain mypy_primer
differences** analyzes the complete eight-shard output and posts a separate,
commit-specific explanation. It is advisory: it does not approve PRs, change
labels, merge changes, or make mypy_primer diagnostic differences fail CI.

The PR comment lists every changed project, deterministic added/removed diagnostic
counts, an assessment, confidence, and a short explanation, followed by expandable
evidence and limitations when they fit. The linked workflow run's
`mypy-primer-analysis-report` artifact always contains the complete explanation,
evidence, and limitations for every project. The original raw diff remains
available. Message rewrites can count as both additions and removals.

Assessments distinguish expected improvements, newly exposed typing issues,
possible regressions, and changes needing human review. Neither fewer diagnostics
nor a successful primer job establishes correctness. The agent is specifically
instructed to investigate assertion failures, type precision loss, and diagnostics
that may have disappeared because a result became `Any` or `Unknown`.

## Activation and maintenance

The Markdown workflow and its generated `.lock.yml` must be merged into `main`
before the automatic `workflow_run` trigger becomes active. Organization-billed
Copilot inference must be available to the repository; the workflow requests
`copilot-requests: write` and does not require a personal token. If organization
policy disallows this inference permission, a repository administrator must resolve
that configuration before the workflow can run. See the
[Copilot authentication reference](https://github.github.com/gh-aw/reference/auth/).

The initial limits are 25 AI credits, 30 agent turns, and 15 minutes for the agent.
They can be adjusted in `.github/workflows/mypy-primer-analysis.md`. The agent must
mark insufficiently investigated projects as needing review rather than inventing
evidence to meet its budget.

The workflow is compiled with GitHub Agentic Workflows v0.86.2:

```text
gh aw compile mypy-primer-analysis --validate
```

Commit the Markdown source and generated lock file together; do not edit the lock
file manually. For `gh aw compile --staged`, the publisher reads the staged flag
from the trusted activation artifact: v0.86.2 does not propagate that flag's
environment variable into custom output jobs. Missing activation metadata fails
closed rather than defaulting to live publication.

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
  require an unambiguous GitHub commit-to-PR association.
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
