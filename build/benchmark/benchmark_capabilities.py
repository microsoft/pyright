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
SUITE_VERSION = 1
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


class CaseResult(TypedDict):
    passed: bool
    positive_diagnostic_lines: list[int]
    negative_diagnostic_lines: list[int]
    expected_error_line: int


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


def _diagnostic_lines(output: str) -> dict[str, set[int]]:
    locations: dict[str, set[int]] = {}
    for match in re.finditer(r"([\w.-]+\.pyi?):(\d+)(?::\d+)?", output):
        locations.setdefault(Path(match[1]).stem, set()).add(int(match[2]))
    return locations


def run_capability_suite(
    checkers: list[str],
    run: Callable[[str, Path, list[Path]], CapabilityOutput],
) -> CapabilitySuite:
    suite: CapabilitySuite = {
        "version": SUITE_VERSION,
        "sha256": SUITE_SHA256,
        "cases": {name: label for name, (label, _) in CASES.items()},
        "results": {},
    }
    with tempfile.TemporaryDirectory(prefix="typecheck-capabilities-") as directory:
        root = Path(directory)
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
            locations: dict[str, dict[str, set[int]]] = {}
            error = None
            for phase in ("positive", "negative"):
                try:
                    output = run(checker, root / phase, paths[phase])
                except OSError as exc:
                    error = f"{phase}: unable to evaluate capabilities: {exc}"
                    break
                evidence[phase] = output
                text = output["stdout"] + "\n" + output["stderr"]
                if output["timed_out"] or output["oom_killed"]:
                    error = f"{phase}: capability checker timed out or exceeded memory limit"
                elif output["returncode"] not in (0, 1):
                    error = f"{phase}: fatal checker exit {output['returncode']}"
                elif output["files_selected"] != len(CASES):
                    error = f"{phase}: capability source-file count is not verified"
                else:
                    locations[phase] = _diagnostic_lines(text)
                    if set(locations[phase]) - CASES.keys():
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
            control_passed = (
                not locations["positive"].get("assert_type")
                and locations["negative"].get("assert_type") == {expected["assert_type"]}
            )
            for name in CASES:
                positive = locations["positive"].get(name, set())
                negative = locations["negative"].get(name, set())
                cases[name] = {
                    "passed": control_passed and not positive and negative == {expected[name]},
                    "positive_diagnostic_lines": sorted(positive),
                    "negative_diagnostic_lines": sorted(negative),
                    "expected_error_line": expected[name],
                }
            suite["results"][checker] = {
                "ok": True, "cases": cases, "evidence": evidence,
            }
    return suite
