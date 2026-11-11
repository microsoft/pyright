# Instructions for coding agents

Pyright is a Python static type checker written in TypeScript. Before changing code, read
[the repository Copilot instructions](.github/copilot-instructions.md) and the applicable contributor and test-policy
guidance.

## Pyright issue fixes

For a reported issue, use the `pyright-issue-fixer` agent when available, with the issue URL or number, a minimal
reproduction, and relevant configuration. Follow the
[issue-analysis workflow](.github/skills/pyright-issue-analysis/SKILL.md): verify the report against the current
checkout, establish a baseline, make a focused fix, add regression coverage, and perform the fixer's pre-handoff
self-review.

When that custom agent is unavailable, follow the same workflow directly. Do not treat a passing motivating test as
proof that nearby valid and invalid behavior is preserved. Compare focused baseline and fixed-checkout results where
feasible, inspect exact diagnostics and revealed types, check architectural ownership and performance implications,
and report limitations honestly.

## Pull requests

Before submitting a code change, complete the checklist in
[the pull request template](.github/PULL_REQUEST_TEMPLATE.md). A full coordinated PR review is a separate workflow;
the self-review checklist is not a substitute when one is requested.

Do not commit, push, publish comments, or create or update a pull request unless the user explicitly authorizes that
action.
