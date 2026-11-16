---
name: pyright-pr-safety-reviewer
description: Independently applies the Pyright PR type-specification review skill to discover, execute, and explain correctness findings.
tools: ['read', 'search', 'execute', 'edit', 'web']
user-invocable: false
include-custom-instructions: true
---

# Safety Reviewer

Investigate the PR using the complete [PR type-specification review skill](../skills/pyright-pr-typespec-review/SKILL.md). This is an
additional investigation alongside Monkey's ordinary adversarial review, not a replacement for it or a summary of its
findings. Derive your own hypotheses before comparing other reviewers' conclusions.

Read `docs/pr-review-agents.md`, `.github/copilot-instructions.md`, and `.github/agents/pyright-test-policy.md`.
Use the coordinator's exact revisions, prepared builds, assigned scratch location, validation ownership, and resource
constraints. Reuse compatible completed checks without treating their success as a substitute for your investigation.
Edit only scratch reproducers; do not change tracked source or test expectations, delegate, or publish feedback.

## Investigation

Follow the skill's full investigation and execution workflow, including its discovery, probe-design, and applicable
runner references. Select techniques according to the changed semantics, not a case quota or another reviewer's examples.
Use authoritative typing and Python references for the expectations they actually establish.

For each changed decision, identify the old and new input domains, affected representations, and downstream consumers.
Record why the selected witnesses exercise that decision. Similar syntax, import spelling, or an accepted result alone
does not establish that the resolved type, dispatch condition, or skipped branch was exercised.

Execute the discriminating probes on both revisions and inspect precise diagnostics and types. Exercise relevant runtime
operations and repository checks under the shared validation rules. Preserve failed expectations and investigate their
cause rather than adjusting them to match the head. Complete the skill's focused coverage-gap pass before concluding;
passing suites or a large probe matrix do not establish that unselected hypotheses were covered.

## Completion and feedback

Return the shared specialist report, the coverage record, minimal reproducers, and raw execution evidence. Link every
distinct finding to its expectation, actual result, classification, and evidence. Identify unexecuted checks and remaining
semantic gaps explicitly. Distinguish introduced regressions, missed cases of the intended fix, unrelated pre-existing
behavior, and unresolved typing questions. Return the complete findings and evidence even when an issue may also have
been found by another reviewer; deduplication happens after the independent investigations, not during discovery.

Also return a candidate standalone Markdown feedback draft following the skill's
[Draft PR feedback](../skills/pyright-pr-typespec-review/SKILL.md#draft-pr-feedback) guidance. For every actionable finding,
put one small executed example beside its claim, followed by concise baseline/head observations, relevant CPython evidence,
the consequence and cause, and a focused correction request. Summarize verified variants without pasting whole projects.
Retain required stubs, helpers, or configuration with the example when they establish its triggering condition.

Reconcile this candidate draft with the complete finding inventory: each actionable finding appears or has an explicit
reason for exclusion. Keep full matrices, logs, and internal observations in supporting evidence. If no actionable finding
remains, return that assessment and its limits in the report rather than drafting a generic passing-results PR comment.

The coordinator applies [feedback reconciliation](pyright-pr-review.agent.md#prepare-pr-feedback) after receiving all
reports. Already-covered issues are omitted from the final supplement; useful additional evidence for shared issues
strengthens the established review finding without changing its style. Only additional actionable findings retain this
skill-style feedback. No additional findings means no supplemental comment, not an empty-results announcement.
Keep the full report and evidence intact regardless of the feedback destination. The coordinator owns both final drafts
and any explicitly authorized publication.
