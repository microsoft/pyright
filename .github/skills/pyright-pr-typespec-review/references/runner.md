# Differential runner

`python scripts/compare_pyright.py <config.json>` runs two already-built Pyright CLI commands against one project. It makes no source changes and does not install dependencies. Use a new evidence directory for each run; output files in that directory are replaced.

First run `python scripts/compare_pyright.py <config.json> --validate-only` after preparing sources and whenever changing the manifest. This validates configuration structure, referenced project/case paths, and expectation syntax without invoking the checker commands or creating the output directory. Success here does not verify the revisions, executable availability, project inclusion, Python semantics, or expectations against real diagnostics. Normal execution still performs the coverage and evidence checks below.

Example configuration (paths relative to this JSON file unless absolute):

```json
{
  "project": "cases/pyrightconfig.json",
  "case_root": "cases",
  "output_dir": "results",
  "timeout_seconds": null,
  "common_args": ["--pythonversion", "3.12"],
  "base": {
    "revision": "full-pre-PR-SHA",
    "cwd": "base-checkout",
    "argv": ["node", "C:/review/base-cli.cjs", "--typeshedpath", "C:/review/base-checkout/packages/pyright-internal/typeshed-fallback"]
  },
  "candidate": {
    "revision": "full-PR-head-SHA",
    "cwd": "pr-checkout",
    "argv": ["node", "C:/review/pr-cli.cjs", "--typeshedpath", "C:/review/pr-checkout/packages/pyright-internal/typeshed-fallback"]
  },
  "cases": [
    {"file": "valid.py", "expect": "accept"},
    {"file": "invalid.py", "expect": "reject", "errors": [{"line": 11, "rule": "reportArgumentType"}]},
    {"file": "control.py", "expect": "unchanged"}
  ]
}
```

Commands are argument arrays passed directly to subprocess, never shell strings. Executables such as `node` resolve through PATH; paths embedded in `argv` should be absolute or intentionally relative to that command's `cwd`. Only configuration path fields are resolved relative to the config file. Do not include --outputjson or --project in argv; the runner appends those. Use the same typeshed content and relevant configuration for both builds.

`timeout_seconds` defaults to `null`, so checker execution has no overall completion deadline. Leave it omitted or `null` unless a concrete API or platform constraint makes a finite limit unavoidable. For that exception, use at least 2,073,600 seconds (24 days) and add a nonempty `timeout_reason` that documents the constraint. Explicit interruption still cancels the owned checker process, and command-start failures remain infrastructure failures.

For a source build whose compiled `src/pyright.js` exports `main` without invoking it, make a tiny `.cjs` launcher that calls `require(<absolute compiled-entry path>).main()`. Check the build layout and entrypoint of the actual revision. Do not assume an installed CLI package or its wrapper has the same entrypoint contract.

Set `include` explicitly in the test project's pyrightconfig.json so every manifest case is analyzed. **The runner requires at least one diagnostic from each manifest file on both revisions.** Pyright's JSON does not list clean files, so a total `filesAnalyzed` count is not enough to verify coverage. If any case lacks diagnostic evidence, the runner exits 2 and lists it in `<label>.coverage.json` (`base` or `candidate`); it cannot silently pass as `accept` or `unchanged`.

For cases that can otherwise be diagnostic-free, add an unconditional, reachable, top-level information diagnostic to the probe itself:

```python
reveal_type(0)  # Coverage witness: emits information, not an error.
```

Place it after any required module docstring and `from __future__` imports, before code that could make it unreachable. It is retained in comparisons but does not fail `accept` or count against expected errors. Update expected line numbers when inserting it. Existing manifests with clean cases need this witness before using the stricter runner. The runner does not insert it or modify source files. Run CPython reproductions separately without the witness, since a bare `reveal_type` is a checker feature.

A diagnostic proves that the file was visited, not that every branch or assertion was evaluated. Continue to isolate probes from unreachable code as described in `SKILL.md`. Keep support code free of unintended diagnostics; errors outside listed cases are reported separately.

Expectations:

- `accept`: no error diagnostics. Use `assert_type` in the source to check inference; isolate it from unreachable preceding code.
- `reject`: at least one error. If `errors` is supplied, it is matched one-to-one against all error diagnostics, using one-based `line` and optional `rule`. Extra or missing errors fail the expectation. This prevents unrelated errors from satisfying a negative test.
- `unchanged`: all diagnostic signatures (severity, location, rule, message), including reveal_type output, equal the baseline. This detects changes; it does not endorse baseline behavior. Do not attach `errors`: that field is valid only with `reject`. If a finding also requires specific diagnostics on both revisions, inspect those obligations separately or use an isolated `reject` case; do not weaken the unchanged comparison.

The runner evaluates whole files. It does not infer whether a removed error belonged to setup, a type assertion, or the consumer cited by a finding. Keep independently failing assertions in separate probes and classify findings from their exact operation-level evidence. An `unchanged` case's baseline matches itself by construction; `base_matches: true` is not an independent correctness result for that expectation.

## Evidence lifecycle and export

Exercise a small valid declaration early and checkpoint each completed project before a long suite or final prose export. If a surrounding controller has its own manifest/runtime schema, validate it with that controller's documented mechanism too; this runner does not validate an external declaration. Declare runtime versions and observable expected outcomes before treating execution as verification. Do not invent missing expectations during recovery.

Keep replayable inputs separate from generated outputs: configuration, checker cases, runtime programs, required helpers, stubs, and fixtures are inputs; checker JSON, logs, coverage records, and report-generation files are evidence. Supply an explicit input inventory when the controller requires one, preserving non-Python dependencies. Do not export every file automatically or select inputs by extension alone. Save evidence through the provided bounded file/export tools rather than embedding an entire report in a shell command. These conventions reduce lost results and oversized drafts; they do not replace the controller's validation or independent replay.

Outputs include raw JSON, stderr, commands/status/timing, per-revision coverage evidence, and `comparison.json` with baseline and candidate expectations, accept/reject transitions and diagnostic changes. On timeout, captured stdout/stderr bytes are preserved verbatim, even if stdout is incomplete JSON or ends mid-character; run metadata records `completed: false` and `timed_out: true`. Reject-to-accept is a **candidate change**, not an automatic fix or finding: interpret it against the oracle. Warnings/information do not fail `accept`, but are retained. The script does not adjust expectations or label a PR safe.

Exit status: 0 means all manifest files have diagnostic evidence on both revisions and candidate expectations matched with no unlisted errors; 1 means a candidate expectation failed or unlisted errors exist; 2 means invalid input, missing coverage evidence, an incomplete run or an infrastructure failure. Each `errors` entry must be an object with a positive integer `line` (not a boolean) and, optionally, a nonempty string `rule`. Pyright's diagnostic exit 1 is handled normally. A known baseline failure is preserved in the output and does not itself fail the candidate run.

Runner regression tests: `python -B scripts/test_compare_pyright.py`. These exercise the runner using subprocess fixtures and require no Pyright installation.
