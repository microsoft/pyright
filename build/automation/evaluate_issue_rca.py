# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "github-copilot-sdk==1.0.19", "pydantic>=2.11,<3", "PyYAML>=6.0,<7", "azure-identity>=1.25,<2",
# ]
# ///

"""Run the production RCA controller against anonymous reports and historical source builds."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from copilot import CopilotClient, RuntimeConnection, Tool, ToolInvocation, ToolResult
from copilot.generated.rpc import PermissionDecisionApproveOnce, PermissionDecisionReject
from copilot.generated.session_events import PermissionRequestCustomTool
from pydantic import Field, JsonValue

from evaluate_issue_design import AUTHORITIES, BlindReport, ScratchWrite
from issue_review_models import Entry, Issue, Record
from issue_review_safety import InjectionScreening, ScreeningBlocked, child_environment
from review_issues import (
    AGENTS, ROOT, SDK, Agent, AutomationError, Console, GitHub, RootCauseTools,
    atomic_write, digest, process, show,
)


PROTOCOL_VERSION = 3
PROTOCOL = (
    "This is an anonymous historical-source benchmark. The supplied anonymous issue number is only a local "
    "schema identifier, not a GitHub issue. Do not identify the report or seek its resolution. The supplied "
    "historical source tree and source-built CLI match one another. They are an experimental pre-fix target, "
    "not necessarily the exact reporter release. Only controller custom tools exist. Native reads, shell, git, "
    "GitHub, delegation, arbitrary web access and current source/tests are unavailable. "
    "Use write_scratch for Python/JSON repro files; read_historical_source for pre-fix TypeScript implementation "
    "source. Use its find field with no file to search allowed source files, then read paged line ranges. "
    "Source paths and debugger breakpoints are relative to pyright-internal/src, e.g. analyzer/typeEvaluator.ts. "
    "Use rca_read_source only for typing.python.org, docs.python.org and peps.python.org normative evidence. "
    "Use the unchanged original example/config for the first clean check before constructing separate controls. "
    "Do not overwrite original.py or pyrightconfig.json. Both are supplied unchanged in each role's scratch. "
    "After the original clean run, create separate control files/configs and select them with "
    "rca_run(project='controls\\\\pyrightconfig.json'); paths within a config are relative to that config's "
    "directory. Never count a written or excluded control as executed: inspect filesAnalyzed and diagnostics "
    "for the intended files. Zero-file success is not control evidence. Freeze the FULL .py/.pyi/.json tree "
    "before each exact clean/debug pair for the same project/cwd/runtime; adding even excluded files requires "
    "a new clean run. Stale-pair setup rejection does not spend an actual product attempt. "
    "Execution, source and saved-evidence results use the production bounded evidence transport. Large results "
    "return an evidence_index with failure counts and exact JSON pointers, not a complete capture. "
    "Use rca_read_evidence(evidence_id='...', pointer='/debug/hits/0/evaluations/0', offset=0, max_chars=4096) "
    "for selected saved values, or pointer='' for the whole receipt; follow next_offset and combine canonical "
    "JSON fragments before interpreting split values. Reads spend no product attempts. Indexes/pages cannot "
    "recover observations that failed or were never captured. "
    "Preserve reported versus explicit experimental settings. A non-reproduction is not success. "
    "This is a paired rerun on previously examined public cases, not a new holdout. Old findings, scores and "
    "withheld repairs are unavailable. Do not draft comments or product fixes. "
    "All normal RCA gates, eight attempts per role and independent adversarial execution still apply.\n"
)

EVALUATION_FILES = (
    "build/automation/evaluate_issue_rca.py",
    "build/automation/evaluate_issue_design.py",
    "build/automation/review_issues.py",
    "build/automation/issue_review_rca.py",
    "build/automation/issue_review_evidence.py",
    "build/automation/issue_review_debug.cjs",
    "build/automation/issue_review_models.py",
    "build/automation/issue_review_safety.py",
    "build/automation/issue_review_editor.py",
    ".github/agents/pyright-issue-root-cause.md",
    ".github/agents/pyright-issue-root-cause-gate.md",
    ".github/agents/pyright-issue-root-cause-adversary.md",
)


def implementation_fingerprints() -> dict[str, str]:
    return {name: digest((ROOT / name).read_text(encoding="utf-8")) for name in EVALUATION_FILES}


class SourceRead(Record):
    file: str = ""
    start: int = Field(default=1, ge=1)
    count: int = Field(default=120, ge=1, le=240)
    find: str = Field(default="", max_length=200)


def source_path(root: Path, name: str) -> Path:
    base = (root / "packages" / "pyright-internal" / "src").resolve()
    path = (base / name).resolve()
    if (
        not path.is_relative_to(base) or path.suffix != ".ts"
        or "tests" in path.relative_to(base).parts or not path.is_file()
    ):
        raise AutomationError("Only historical implementation .ts files are readable; tests and other roots are withheld")
    return path


class BlindTools(RootCauseTools):
    def __init__(self, original: RootCauseTools, source: Path):
        original.runtime.root = source
        original.runtime.helper = ROOT / "build" / "automation" / "issue_review_debug.cjs"
        super().__init__(
            original.github, original.scratch, original.release, original.evidence, original.runtime,
            adversary=original.investigator == "root_cause_adversary", plan=original.plan,
        )
        self.source = source
        self.tools = [tool for tool in self.tools if tool.name in {"rca_run", "rca_read_evidence"}] + [
            Tool("write_scratch", "Write inspected scratch-local .py/.pyi/.json input files.",
                 self.write_scratch, ScratchWrite.model_json_schema()),
            Tool("read_historical_source", "Read historical implementation source; with file='' and find, search "
                 "historical implementation files. Large results use the saved-evidence index/page transport. "
                 "Tests, git, fixes and current source are withheld.",
                 self.read_source, SourceRead.model_json_schema()),
            Tool("rca_read_source", "Read normative typing/Python/PEP HTTPS documentation.",
                 self.read_authority, {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}),
        ]

    def record_delivery(self, phase: str, result: ToolResult, arguments: dict[str, JsonValue]) -> ToolResult:
        with (self.evidence / "evidence-delivery.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({
                "phase": phase, "investigator": self.investigator, "arguments": arguments,
                "result_type": result.result_type, "response_bytes": len(result.text_result_for_llm.encode("utf-8")),
                "response": result.text_result_for_llm, "attempts": self.check_count,
            }) + "\n")
        return result

    def _record_result(self, record: dict[str, JsonValue], *, failed: bool = False) -> ToolResult:
        result = super()._record_result(record, failed=failed)
        if record.get("tool") != "rca_read_evidence":
            self.record_delivery("initial", result, {"evidence_id": record.get("id")})
        return result

    async def rca_read_evidence(self, invocation: ToolInvocation) -> ToolResult:
        result = await super().rca_read_evidence(invocation)
        return self.record_delivery("readback", result, invocation.arguments)

    def permission(self, request, invocation):
        if (
            isinstance(request, PermissionRequestCustomTool)
            and request.tool_name in {tool.name for tool in self.tools}
            and not self.screening_stopped and self.screening_error is None
            and not getattr(request, "managed_approval_required", False)
            and not getattr(request, "request_sandbox_bypass", False)
        ):
            return PermissionDecisionApproveOnce()
        return PermissionDecisionReject(feedback="Only blinded controller custom tools are available")

    async def write_scratch(self, invocation: ToolInvocation) -> ToolResult:
        try:
            request = ScratchWrite.model_validate(invocation.arguments)
            path = (self.scratch / request.file).resolve()
            if not path.is_relative_to(self.scratch) or path.suffix not in {".py", ".pyi", ".json"}:
                raise AutomationError("Only scratch-local Python/stub/JSON inputs can be written")
            if path in {self.scratch / "original.py", self.scratch / "pyrightconfig.json"}:
                raise AutomationError("The frozen original example and configuration cannot be overwritten")
            atomic_write(path, request.content)
            self.log({"tool": "write_scratch", "file": request.file, "sha256": digest(request.content)})
            return ToolResult(text_result_for_llm=f"Wrote {request.file}", result_type="success")
        except (OSError, ValueError, AutomationError) as error:
            return ToolResult(text_result_for_llm=str(error), result_type="failure", error=str(error))

    async def read_source(self, invocation: ToolInvocation) -> ToolResult:
        try:
            request = SourceRead.model_validate(invocation.arguments)
            base = self.source / "packages" / "pyright-internal" / "src"
            if not request.file:
                if not request.find:
                    raise AutomationError("Supply a file or a literal search phrase")
                matches = []
                for path in sorted(base.rglob("*.ts")):
                    if "tests" in path.relative_to(base).parts:
                        continue
                    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                        if request.find.lower() in line.lower():
                            matches.append({"file": str(path.relative_to(base)), "line": index, "text": line[:500]})
                            if len(matches) == 40:
                                break
                    if len(matches) == 40:
                        break
                result = {"matches": matches, "limit": 40}
            else:
                path = source_path(self.source, request.file)
                content = path.read_text(encoding="utf-8")
                lines = content.splitlines()
                start = request.start
                if request.find and start == 1:
                    start = next(
                        (max(1, index - 15) for index, line in enumerate(lines, 1)
                         if request.find.lower() in line.lower()), 1,
                    )
                result = {
                    "file": request.file, "sha256": digest(content), "total_lines": len(lines),
                    "content": "\n".join(f"{i}: {lines[i - 1]}" for i in range(start, min(len(lines) + 1, start + request.count))),
                }
            return self._record_result({
                "id": uuid.uuid4().hex, "kind": "historical_source", "tool": "read_historical_source", **result,
            })
        except (OSError, ValueError, AutomationError) as error:
            return self._failed_result("read_historical_source", error)

    async def read_authority(self, invocation: ToolInvocation) -> ToolResult:
        url = invocation.arguments.get("url", "")
        if not isinstance(url, str) or urlparse(url).hostname not in AUTHORITIES:
            message = "Only normative typing/Python/PEP hosts are permitted; no issue/fix/history references"
            return ToolResult(text_result_for_llm=message, result_type="failure", error=message)
        return await super().rca_read_source(invocation)


class BlindSDK(SDK):
    def __init__(self, client, model, timeout, source, report):
        super().__init__(client, model, timeout)
        self.source, self.report = source, report

    async def run(self, agent, prompt, scratch, **kwargs):
        if isinstance(original := kwargs.get("tools"), RootCauseTools):
            frozen = {
                "original.py": self.report.repro_source,
                "pyrightconfig.json": json.dumps({**self.report.configuration, "include": ["original.py"]}),
            }
            for name, content in frozen.items():
                path = original.scratch / name
                if path.exists() and path.read_text(encoding="utf-8") != content:
                    raise AutomationError("Role scratch differs from the frozen original source/configuration")
                if not path.exists():
                    atomic_write(path, content)
            kwargs["tools"] = BlindTools(original, self.source)
        kwargs["native_tools"] = []
        return await super().run(agent, PROTOCOL + prompt, scratch, **kwargs)


class FrozenGitHub(GitHub):
    def __init__(self, issue: Issue, report: BlindReport, scorer: InjectionScreening):
        super().__init__(scorer=scorer)
        self.frozen_issue, self.report = issue, report

    async def issue(self, number: int) -> Issue:
        if number != self.frozen_issue.number:
            raise AutomationError("Only this anonymous report is available")
        return self.frozen_issue

    async def comments(self, number: int):
        await self.issue(number)
        return []

    async def screen_issue(self, issue: Issue, directory: Path):
        await self.screen(self.report.model_dump(mode="json"), directory, "anonymous-target-report")

    async def api(self, *args, **kwargs):
        raise AutomationError("GitHub research and mutations are disabled in the blinded benchmark")


class BlindConsole(Console):
    def __init__(self, *args, report: BlindReport, **kwargs):
        super().__init__(*args, **kwargs)
        self.report = report

    def require_report_evidence(self, entry: Entry):
        # This benchmark starts at RCA, not at behavior/duplicate classification.
        if entry.review_markdown != self.report.model_dump_json():
            raise AutomationError("Frozen anonymous RCA input changed")

    def report_hash(self, entry: Entry):
        self.require_report_evidence(entry)
        assert entry.review_markdown is not None
        return digest(entry.review_markdown)


def target_fingerprint(source: Path, build: bool) -> str:
    base = source / "packages" / ("pyright" if build else "pyright-internal")
    base = base / ("dist" if build else "src")
    result = hashlib.sha256()
    for path in sorted(base.rglob("*")):
        if not path.is_file() or (not build and "tests" in path.relative_to(base).parts):
            continue
        result.update(str(path.relative_to(base)).encode())
        result.update(hashlib.sha256(path.read_bytes()).digest())
    return result.hexdigest()


async def run_case(report_path: Path, source: Path, output: Path, client, scorer, args):
    output.mkdir(parents=True, exist_ok=False)
    report = BlindReport.model_validate_json(report_path.read_bytes())
    if report.repro_source is None:
        raise AutomationError("A reviewed unchanged standalone repro is required")
    provenance_path = source / "benchmark-provenance.json"
    provenance = json.loads(provenance_path.read_text(encoding="utf-8-sig"))
    if not provenance.get("source_commit") or not provenance.get("archive_sha256"):
        raise AutomationError("Historical source/build provenance is required")
    fingerprints = {name: target_fingerprint(source, build) for name, build in (("source", False), ("build", True))}
    if any(provenance.get(f"{name}_sha256") != fingerprint for name, fingerprint in fingerprints.items()):
        raise AutomationError("Historical source or built CLI differs from its frozen build provenance")
    issue = Issue(
        number=1, title="Anonymous report", body=report.body, html_url="about:blank",
        state="open", updated_at="frozen", comments=0,
    )
    github = FrozenGitHub(issue, report, scorer)
    profile = Agent.load(AGENTS / "pyright-issue-root-cause.md", "pyright-issue-root-cause")
    console = BlindConsole(
        github, BlindSDK(client, args.model, args.timeout, source, report), output,
        profile, profile, None, digest(PROTOCOL), provenance["source_commit"], {},
        read_only=True, rca_timeout=args.rca_timeout, report=report,
        ask=lambda _: "n",
    )
    original = output / "1" / "scratch" / "frozen"
    original.mkdir(parents=True)
    atomic_write(original / "original.py", report.repro_source)
    atomic_write(original / "pyrightconfig.json", json.dumps({**report.configuration, "include": ["original.py"]}))
    entry = Entry(
        issue=issue, input_hash=console.key(issue), context_hash=console.context_hash,
        review_markdown=report.model_dump_json(), duplicates_markdown="Historical research withheld.",
        scratch_directory=str(original),
    )
    started = time.monotonic()
    implementation = implementation_fingerprints()
    atomic_write(output / "run.json", json.dumps({
        "case_id": report.id, "report_sha256": digest(report.model_dump_json()),
        "protocol_version": PROTOCOL_VERSION, "evaluation_type": "paired_previously_examined_cohort",
        "implementation_sha256": implementation,
        "protocol_sha256": digest(PROTOCOL), "historical_source": str(source),
        "source_provenance": provenance, "model": args.model,
        "sdk_version": importlib.metadata.version("github-copilot-sdk"),
        "controller_revision": (await process(["git", "rev-parse", "HEAD"], ROOT))[1].strip(),
        "controller_diff_sha256": digest((await process(["git", "diff", "HEAD"], ROOT))[1]),
        "harness_sha256": digest(Path(__file__).read_text(encoding="utf-8")),
        "rca_controller_sha256": digest((ROOT / "build" / "automation" / "review_issues.py").read_text(encoding="utf-8")),
        "profile_sha256": {agent.name: digest(agent.prompt) for agent in console.rca_agents},
        "reference_status": "controller_reviewed_provisional",
        "limitations": ["Public-report/model memorization cannot be excluded", "No human-approved gold references"],
    }, indent=2))
    error = None
    try:
        await console.investigate_root_cause(entry)
        if implementation_fingerprints() != implementation:
            raise AutomationError("Benchmark controller or role profiles changed during this case")
        if any(
            target_fingerprint(source, name == "build") != fingerprint
            for name, fingerprint in fingerprints.items()
        ):
            raise AutomationError("Historical source or build changed during this case")
    except (OSError, ValueError, AutomationError, TimeoutError, ScreeningBlocked) as failure:
        error = str(failure)
    result = {
        "id": report.id, "status": entry.root_cause.status if entry.root_cause else "failed",
        "elapsed_seconds": round(time.monotonic() - started, 3), "error": error,
        "root_cause": None if entry.root_cause is None else entry.root_cause.model_dump(mode="json"),
    }
    atomic_write(output / "result.json", json.dumps(result, indent=2))
    show(f"{report.id}: {result['status']} ({result['elapsed_seconds']}s)")
    return result


async def run_cohort(manifest: Path, output: Path, client, scorer, args):
    frozen = json.loads(manifest.read_text(encoding="utf-8-sig"))
    cases = frozen["cases"]
    if frozen.get("protocol_sha256") != digest(PROTOCOL):
        raise AutomationError("Cohort protocol differs from the frozen protocol")
    if frozen.get("harness_sha256") != digest(Path(__file__).read_text(encoding="utf-8")):
        raise AutomationError("Harness differs from the frozen cohort implementation")
    if frozen.get("protocol_version") != PROTOCOL_VERSION:
        raise AutomationError("Cohort protocol version differs from this runner")
    if frozen.get("implementation_sha256") != implementation_fingerprints():
        raise AutomationError("Controller or role profiles differ from the frozen cohort")
    if not cases or len({case["id"] for case in cases}) != len(cases):
        raise AutomationError("Cohort needs nonempty unique case IDs")
    output.mkdir(parents=True, exist_ok=False)
    atomic_write(output / "cohort.json", manifest.read_text(encoding="utf-8-sig"))
    results = []
    for start in range(0, len(cases), args.chunk_size):
        async def run(case):
            destination = output / case["id"]
            try:
                if frozen["implementation_sha256"] != implementation_fingerprints():
                    raise AutomationError("Controller or role profiles changed after the cohort freeze")
                report = BlindReport.model_validate_json(Path(case["report"]).read_bytes())
                if report.id != case["id"] or digest(report.model_dump_json()) != case["report_sha256"]:
                    raise AutomationError("Anonymous report differs from its frozen cohort input")
                provenance = json.loads(
                    (Path(case["source"]) / "benchmark-provenance.json").read_text(encoding="utf-8-sig")
                )
                if any(provenance.get(key) != case[key] for key in ("source_sha256", "build_sha256")):
                    raise AutomationError("Historical target provenance differs from the frozen cohort")
                if case.get("availability") == "unavailable":
                    destination.mkdir(parents=True, exist_ok=False)
                    result = {
                        "id": case["id"], "status": "unavailable", "error": None,
                        "reason": case["availability_reason"], "root_cause": None,
                    }
                    atomic_write(destination / "result.json", json.dumps(result, indent=2))
                    return result
                return await run_case(
                    Path(case["report"]), Path(case["source"]), destination, client, scorer, args,
                )
            except (OSError, ValueError, AutomationError, ScreeningBlocked) as failure:
                destination.mkdir(parents=True, exist_ok=True)
                result = {"id": case["id"], "status": "failed", "error": str(failure), "root_cause": None}
                atomic_write(destination / "result.json", json.dumps(result, indent=2))
                show(f"{case['id']}: failed: {failure}")
                return result

        results.extend(await asyncio.gather(*(run(case) for case in cases[start:start + args.chunk_size])))
        atomic_write(output / "summary.json", json.dumps({
            "planned": len(cases), "completed": len(results), "results": results,
            "mechanism_scoring": "Separate controller comparison with held-out fixes; status is not correctness",
        }, indent=2))
    return results


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--report", type=Path)
    inputs.add_argument("--cohort", type=Path)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--chunk-size", type=int, default=3)
    parser.add_argument("--model", default="gpt-6.1-sol")
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--rca-timeout", type=float, default=900)
    args = parser.parse_args()
    if args.timeout <= 0 or args.rca_timeout <= 0 or args.chunk_size < 1:
        parser.error("Timeouts and chunk size must be positive")
    if args.report is not None and args.source is None:
        parser.error("--report requires --source")
    scorer = InjectionScreening.from_environment()
    connection = RuntimeConnection.for_stdio(path="copilot")
    async with CopilotClient(
        connection=connection, working_directory=str(ROOT), env={**child_environment(), "USE_TGREP": "false"},
    ) as client:
        if args.cohort is not None:
            results = await run_cohort(args.cohort.resolve(), args.output.resolve(), client, scorer, args)
        else:
            assert args.source is not None and args.report is not None
            results = [await run_case(
                args.report.resolve(), args.source.resolve(), args.output.resolve(), client, scorer, args,
            )]
    return int(any(result["error"] is not None for result in results))


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
