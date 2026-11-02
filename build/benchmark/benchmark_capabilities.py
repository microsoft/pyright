"""Small behavioral probes, evaluated separately from corpus timings."""

from __future__ import annotations

import hashlib
import json
import re
import tempfile
from pathlib import Path
from typing import Callable, TypedDict


CASES = {
    "assert_type": (
        "Exact-type assertion control",
        'from typing import assert_type\n'
        'assert_type(int("1"), int)\n'
        'assert_type(int("1"), str)  # expect-error\n',
    ),
    "unannotated_return": (
        "Unannotated return inference",
        'from typing import assert_type\n'
        'def inferred():\n'
        '    return int("1")\n'
        'assert_type(inferred(), int)\n'
        'bad: str = inferred()  # expect-error\n',
    ),
    "unannotated_body": (
        "Unannotated function body checking",
        'def checked():\n'
        '    good: int = 1\n'
        '    bad: str = 1  # expect-error\n',
    ),
    "generics": (
        "Generic type propagation",
        'from typing import TypeVar, assert_type\n'
        'T = TypeVar("T")\n'
        'def first(values: list[T]) -> T:\n'
        '    return values[0]\n'
        'values: list[int] = [1]\n'
        'assert_type(first(values), int)\n'
        'bad: str = first(values)  # expect-error\n',
    ),
    "overloads": (
        "Overload selection",
        'from typing import assert_type, overload\n'
        '@overload\n'
        'def choose(value: int) -> int: ...\n'
        '@overload\n'
        'def choose(value: str) -> str: ...\n'
        'def choose(value: int | str) -> int | str:\n'
        '    return value\n'
        'assert_type(choose(int("1")), int)\n'
        'bad: str = choose(int("1"))  # expect-error\n',
    ),
    "protocols": (
        "Structural protocol checking",
        'from typing import Protocol, assert_type\n'
        'class Reader(Protocol):\n'
        '    def read(self) -> int: ...\n'
        'class Good:\n'
        '    def read(self) -> int:\n'
        '        return 1\n'
        'class Bad:\n'
        '    def read(self) -> str:\n'
        '        return "wrong"\n'
        'good: Reader = Good()\n'
        'assert_type(good.read(), int)\n'
        'bad: Reader = Bad()  # expect-error\n',
    ),
    "narrowing": (
        "Union narrowing",
        'from typing import assert_type\n'
        'def narrow(value: int | str) -> None:\n'
        '    if isinstance(value, int):\n'
        '        assert_type(value, int)\n'
        '        bad: str = value  # expect-error\n'
        '    else:\n'
        '        assert_type(value, str)\n',
    ),
    "imported_types": (
        "Imported type propagation",
        'from typing import assert_type\n'
        'from capability_support import typed_value\n'
        'assert_type(typed_value(), int)\n'
        'bad: str = typed_value()  # expect-error\n',
    ),
}
SUPPORT_SOURCE = "def typed_value() -> int:\n    return 1\n"
for _name, _label in (
    ("installed_typed", "Installed typed-package precision"),
    ("installed_untyped", "Installed untyped-package precision"),
):
    CASES[_name] = (
        _label,
        "from typing import assert_type\n"
        f"from capability_{_name} import typed_value\n"
        "assert_type(typed_value(), int)\n"
        "bad: str = typed_value()  # expect-error\n",
    )
SUITE_VERSION = 2
SUITE_SHA256 = hashlib.sha256(
    json.dumps([SUITE_VERSION, CASES, SUPPORT_SOURCE], sort_keys=True).encode("utf-8")
).hexdigest()


class CapabilityOutput(TypedDict):
    stdout: str
    stderr: str
    returncode: int
    timed_out: bool
    oom_killed: bool
    files_selected: int | None


class Diagnostic(TypedDict):
    file: str
    line: int
    rule: str
    category: str


class CaseResult(TypedDict):
    passed: bool
    positive_diagnostic_lines: list[int]
    negative_diagnostic_lines: list[int]
    expected_error_line: int
    positive_diagnostics: list[Diagnostic]
    negative_diagnostics: list[Diagnostic]


class CheckerResult(TypedDict, total=False):
    ok: bool
    error: str
    cases: dict[str, CaseResult]
    evidence: dict[str, CapabilityOutput]


class CapabilitySuite(TypedDict):
    version: int
    sha256: str
    cases: dict[str, str]
    results: dict[str, CheckerResult]


def parse_diagnostics(checker: str, output: str) -> list[Diagnostic]:
    """Read primary diagnostics and rule IDs, never source excerpts or notes."""
    diagnostics: list[Diagnostic] = []
    if checker in ("pyright", "pyright-threads", "pyright-pip"):
        pattern = r"(?m)^\s+([^\n]+\.pyi?):(\d+):\d+ - (?:error|warning|information): "
        matches = list(re.finditer(pattern, output))
        for index, match in enumerate(matches):
            block = output[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(output)]
            rule = re.search(r"\((report\w+)\)", block)
            if rule is None:
                raise ValueError("Pyright diagnostic has no recognized rule ID")
            diagnostics.append(_diagnostic(match[1], int(match[2]), rule[1]))
    elif checker in ("ty", "ty-infer", "pyrefly"):
        pattern = (
            r"(?m)^(?:error|warning|info)\[([\w-]+)\]:[^\n]*"
            if checker in ("ty", "ty-infer")
            else r"(?m)^(?:ERROR|WARN|INFO) [^\n]* \[([\w-]+)\]"
        )
        matches = list(re.finditer(pattern, output))
        for index, match in enumerate(matches):
            block = output[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(output)]
            location = re.search(r"(?m)^\s*-->\s+([^\n]+\.pyi?):(\d+):\d+", block)
            if location is None:
                raise ValueError(f"{checker} diagnostic has no primary source location")
            diagnostics.append(_diagnostic(location[1], int(location[2]), match[1]))
    elif checker in ("mypy", "zuban"):
        for match in re.finditer(r"(?m)^([^\n]+\.pyi?):(\d+)(?::\d+)?: (?:error|warning): (.+)$", output):
            rule = re.search(r"\[([\w-]+)\]\s*$", match[3])
            if rule is None:
                raise ValueError(f"{checker} diagnostic has no recognized rule ID")
            code = rule[1]
            if checker == "zuban" and code == "misc" and match[3].startswith("Expression is of type "):
                code = "assert-type"
            diagnostics.append(_diagnostic(match[1], int(match[2]), code))
    else:
        raise ValueError(f"No diagnostic adapter for {checker}")
    return diagnostics


def _diagnostic(path: str, line: int, rule: str) -> Diagnostic:
    categories = {
        "reportAssertTypeFailure": "assert-type", "type-assertion-failure": "assert-type",
        "assert-type": "assert-type", "reportAssignmentType": "assignment",
        "invalid-assignment": "assignment", "bad-assignment": "assignment",
        "assignment": "assignment", "arg-type": "argument",
    }
    return {
        "file": Path(path.strip()).stem, "line": line, "rule": rule,
        "category": categories.get(rule, f"other:{rule}"),
    }


def run_capability_suite(
    checkers: list[str],
    run: Callable[[str, Path, list[Path], Path], CapabilityOutput],
) -> CapabilitySuite:
    suite: CapabilitySuite = {
        "version": SUITE_VERSION,
        "sha256": SUITE_SHA256,
        "cases": {name: label for name, (label, _) in CASES.items()},
        "results": {},
    }
    with tempfile.TemporaryDirectory(prefix="typecheck-capabilities-") as directory:
        root = Path(directory)
        dependencies = root / "dependencies"
        for name in ("installed_typed", "installed_untyped"):
            package = dependencies / f"capability_{name}"
            package.mkdir(parents=True)
            (package / "__init__.py").write_text(SUPPORT_SOURCE, encoding="utf-8")
            if name == "installed_typed":
                (package / "py.typed").write_text("", encoding="utf-8")
        paths: dict[str, list[Path]] = {}
        expected: dict[str, int] = {}
        for phase in ("positive", "negative"):
            project = root / phase
            project.mkdir()
            (project / "capability_support.py").write_text(SUPPORT_SOURCE, encoding="utf-8")
            paths[phase] = []
            for name, (_, source) in CASES.items():
                lines = source.splitlines(keepends=True)
                expected[name] = next(
                    index for index, line in enumerate(lines, 1) if "# expect-error" in line
                )
                if phase == "positive":
                    lines = [
                        "\n" if "# expect-error" in line else line for line in lines
                    ]
                path = project / f"{name}.py"
                path.write_text("".join(lines), encoding="utf-8")
                paths[phase].append(path)

        for checker in checkers:
            evidence: dict[str, CapabilityOutput] = {}
            locations: dict[str, list[Diagnostic]] = {}
            error = None
            for phase in ("positive", "negative"):
                try:
                    output = run(checker, root / phase, paths[phase], dependencies)
                except OSError as exc:
                    error = f"{phase}: unable to evaluate capabilities: {exc}"
                    break
                evidence[phase] = output
                if output["timed_out"] or output["oom_killed"]:
                    error = f"{phase}: capability checker timed out or exceeded memory limit"
                elif output["returncode"] not in (0, 1):
                    error = f"{phase}: fatal checker exit {output['returncode']}"
                elif output["files_selected"] != len(CASES):
                    error = f"{phase}: capability source-file count is not verified"
                else:
                    try:
                        locations[phase] = parse_diagnostics(checker, output["stdout"])
                    except ValueError as exc:
                        error = f"{phase}: {exc}"
                        break
                    if {item["file"] for item in locations[phase]} - CASES.keys():
                        error = f"{phase}: unexpected diagnostics outside capability cases"
                    elif bool(locations[phase]) != (output["returncode"] == 1):
                        error = f"{phase}: unrecognized or inconsistent diagnostic output"
                if error:
                    break
            if error:
                suite["results"][checker] = {
                    "ok": False, "error": error, "evidence": evidence,
                }
                continue
            cases: dict[str, CaseResult] = {}
            def case_diagnostics(phase: str, name: str) -> list[Diagnostic]:
                return [item for item in locations[phase] if item["file"] == name]

            def expected_diagnostics(name: str, items: list[Diagnostic]) -> bool:
                category = "assert-type" if name == "assert_type" else "assignment"
                return (
                    len(items) == 1 and items[0]["line"] == expected[name]
                    and (
                        items[0]["category"] == category
                        or (name == "generics" and items[0]["category"] == "argument")
                    )
                )

            control_passed = not case_diagnostics("positive", "assert_type") and expected_diagnostics(
                "assert_type", case_diagnostics("negative", "assert_type")
            )
            for name in CASES:
                positive = case_diagnostics("positive", name)
                negative = case_diagnostics("negative", name)
                cases[name] = {
                    "passed": control_passed and not positive and expected_diagnostics(name, negative),
                    "positive_diagnostic_lines": sorted({item["line"] for item in positive}),
                    "negative_diagnostic_lines": sorted({item["line"] for item in negative}),
                    "expected_error_line": expected[name],
                    "positive_diagnostics": positive,
                    "negative_diagnostics": negative,
                }
            suite["results"][checker] = {
                "ok": True, "cases": cases, "evidence": evidence,
            }
    return suite
