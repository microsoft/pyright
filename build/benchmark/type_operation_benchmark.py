#!/usr/bin/env python3
"""Compare clean CLI scaling for generated type-operation workloads."""

import argparse
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

from typecheck_benchmark import ProcessResult, run_process_with_timeout

WORKLOADS = ("literal-union", "typeddict-update", "overload-width")
CONFIG = {"pythonVersion": "3.12", "typeCheckingMode": "standard"}


def fixture(workload: str, size: int) -> tuple[str, int, tuple[str, ...]]:
    keys = [f'"key{i}"' for i in range(size)]
    last = keys[-1]
    if workload == "literal-union":
        source = f"""\
from typing import Literal, assert_type

Key = Literal[{", ".join(keys)}]

def check(key: Key) -> None:
    if key == {last}:
        assert_type(key, Literal[{last}])

check({last})
"""
        negative = 'check("not_a_key")'
        rules = ("reportArgumentType",)
    elif workload == "typeddict-update":
        parity = (size - 1) % 2
        fields = "\n".join(
            f"    key{i}: {'int' if i % 2 == parity else 'str'}" for i in range(size)
        )
        source = f"""\
from typing import Literal, TypedDict, assert_type

class Payload(TypedDict):
{fields}

def check(value: Payload, pair: tuple[Literal[{last}], int]) -> None:
    assert_type(value.update([pair]), None)
    assert_type(value[{last}], int)
"""
        negative = f"    value.update([({last}, 'wrong')])"
        rules = ("reportCallIssue", "reportArgumentType")
    elif workload == "overload-width":
        signatures = "\n".join(
            f"@overload\ndef decode(key: Literal[{key}]) -> Literal[{i}]: ..." for i, key in enumerate(keys)
        )
        source = f"""\
from typing import Literal, assert_type, overload

{signatures}
def decode(key: str) -> int:
    return 0

assert_type(decode({last}), Literal[{size - 1}])
"""
        negative = 'decode("not_a_key")'
        rules = ("reportCallIssue", "reportArgumentType")
    else:
        raise ValueError(f"Unknown workload: {workload}")
    return source + negative + "\n", len(source.splitlines()), rules


def check_result(result: ProcessResult, filename: Path, line: int, rules: tuple[str, ...]) -> list[dict]:
    if result["timed_out"] or result["oom_killed"] or result["returncode"] != 1:
        raise ValueError(f"Expected diagnostic exit (1), got {result}")
    if result["stderr"]:
        raise ValueError(f"Unexpected stderr: {result['stderr']}")

    output = json.loads(result["stdout"])
    diagnostics = output["generalDiagnostics"]
    expected = [(filename, line, "error", rule) for rule in rules]
    actual = [
        (Path(d["file"]), d["range"]["start"]["line"], d["severity"], d.get("rule"))
        for d in diagnostics
    ]
    if actual != expected or output["summary"]["filesAnalyzed"] != 1:
        raise ValueError(f"Expected only {rules} at {filename}:{line + 1}: {output}")
    return [{**d, "file": filename.name} for d in diagnostics]


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def build_info(root: Path) -> dict:
    dist = root / "packages" / "pyright" / "dist"
    cli = dist / "pyright.js"
    if not cli.is_file():
        raise ValueError(f"Missing {cli}; build the CLI in {root} first")
    return {
        "commit": subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip(),
        "bundleSha256": {
            entry.name: hashlib.sha256(entry.read_bytes()).hexdigest()
            for entry in sorted(dist.glob("*.js"))
        },
    }


def run(args: argparse.Namespace) -> dict:
    roots = {"baseline": args.baseline_root.resolve(), "candidate": args.candidate_root.resolve()}
    report = {
        "node": subprocess.check_output([args.node, "--version"], text=True).strip(),
        "python": sys.version,
        "platform": platform.platform(),
        "cpuCount": os.cpu_count(),
        "builds": {name: build_info(root) for name, root in roots.items()},
        "runnerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "config": CONFIG,
        "timeoutSeconds": args.timeout,
        "runs": args.runs,
        "cases": [],
    }
    # Use one typeshed for both runs to isolate analyzer differences.
    typeshed = roots["baseline"] / "packages" / "pyright-internal" / "typeshed-fallback"
    if not typeshed.is_dir():
        raise ValueError(f"Missing baseline typeshed: {typeshed}")
    report["typeshed"] = str(typeshed)
    env = {**os.environ, "PYTHONNOUSERSITE": "1", "PYTHONPATH": ""}
    env.pop("NODE_OPTIONS", None)
    with tempfile.TemporaryDirectory(prefix="pyright-type-operations-") as directory:
        project = Path(directory)
        config = project / "pyrightconfig.json"
        config.write_text(json.dumps(CONFIG), encoding="utf-8")
        for workload in args.workloads:
            for size in args.sizes:
                source, line, rules = fixture(workload, size)
                filename = project / f"{workload}-{size}.py"
                filename.write_bytes(source.encode("utf-8"))
                samples = {name: [] for name in roots}
                expected = None
                for repetition in range(args.runs):
                    order = list(roots)
                    if (len(report["cases"]) + repetition) % 2:
                        order.reverse()
                    for name in order:
                        cli = roots[name] / "packages" / "pyright" / "dist" / "pyright.js"
                        result = run_process_with_timeout(
                            [
                                args.node,
                                str(cli),
                                "--project",
                                str(config),
                                "--typeshedpath",
                                str(typeshed),
                                "--pythonpath",
                                sys.executable,
                                "--outputjson",
                                str(filename),
                            ],
                            project,
                            timeout=args.timeout,
                            memory_limit_mb=0,
                            environment=env,
                            encoding="utf-8",
                        )
                        try:
                            diagnostics = check_result(result, filename, line, rules)
                            if expected is not None and diagnostics != expected:
                                raise ValueError(f"Diagnostic mismatch: {diagnostics} != {expected}")
                        except (ValueError, KeyError, TypeError) as exc:
                            raise ValueError(f"{workload} size {size}, {name} run {repetition + 1}: {exc}") from exc
                        expected = diagnostics
                        samples[name].append(
                            {
                                "wallSeconds": result["execution_time_s"],
                                "peakRssMiB": result["peak_memory_mb"] or None,
                            }
                        )
                report["cases"].append(
                    {
                        "workload": workload,
                        "size": size,
                        "sourceSha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
                        "diagnostics": expected,
                        "samples": samples,
                        "medianWallSeconds": {
                            name: statistics.median(sample["wallSeconds"] for sample in values)
                            for name, values in samples.items()
                        },
                    }
                )
                filename.unlink()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-root", type=Path, required=True)
    parser.add_argument("--candidate-root", type=Path, required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--sizes", nargs="+", type=positive_int, default=[10, 50, 100, 500, 1000])
    parser.add_argument("--workloads", nargs="+", choices=WORKLOADS, default=WORKLOADS)
    parser.add_argument("--runs", type=positive_int, default=3)
    parser.add_argument("--timeout", type=positive_int, default=120)
    args = parser.parse_args()
    if min(args.sizes) < 2:
        parser.error("--sizes must be at least 2")
    try:
        print(json.dumps(run(args), indent=2))
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
