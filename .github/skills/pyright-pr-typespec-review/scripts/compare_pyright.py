#!/usr/bin/env python3
"""Run two built Pyright commands and compare a manifest of isolated probes."""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time


_MINIMUM_TIMEOUT_SECONDS = 24 * 24 * 60 * 60


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_stream(path, value):
    # TimeoutExpired can contain bytes even when subprocess uses text mode.
    # Preserve partial bytes verbatim, including an unfinished UTF-8 sequence.
    path.write_bytes(value.encode("utf-8") if isinstance(value, str) else (value or b""))


def key(path):
    return os.path.normcase(str(path.resolve()))


def signatures(data):
    grouped = {}
    for diag in data["generalDiagnostics"]:
        file = Path(diag["file"])
        if not file.is_absolute():
            raise ValueError("Expected absolute diagnostic file paths from Pyright")
        span = diag["range"]
        grouped.setdefault(key(file), []).append({
            "severity": diag["severity"],
            "line": span["start"]["line"] + 1,
            "column": span["start"]["character"] + 1,
            "end_line": span["end"]["line"] + 1,
            "end_column": span["end"]["character"] + 1,
            "rule": diag.get("rule"),
            "message": diag["message"],
        })
    for values in grouped.values():
        values.sort(key=lambda x: json.dumps(x, sort_keys=True))
    return grouped


def verify_coverage(label, cases, root, grouped, output):
    # JSON diagnostics do not enumerate clean files. A total file count cannot
    # distinguish a checked, clean case from an omitted case plus support files.
    verified, missing = [], []
    for case in cases:
        (verified if key(root / case["file"]) in grouped else missing).append(case["file"])
    write_json(output / f"{label}.coverage.json", {
        "verified_cases": verified, "missing_cases": missing,
    })
    if missing:
        raise ValueError(
            f"{label} has no diagnostic evidence for manifest cases: {', '.join(missing)}. "
            "Ensure they are included and add an unconditional top-level reveal_type(0) "
            "to cases that otherwise produce no diagnostics."
        )


def check_expectation(case, observed, baseline):
    errors = [d for d in observed if d["severity"] == "error"]
    if case["expect"] == "unchanged":
        return observed == baseline
    if case["expect"] == "accept":
        return not errors
    if not errors:
        return False
    expected = case.get("errors")
    if expected is None:
        return True
    # Match more specific expectations first so a line-only expectation cannot
    # consume the sole diagnostic matching a rule-specific expectation.
    remaining = list(errors)
    for want in sorted(expected, key=lambda x: "rule" in x, reverse=True):
        match = next((i for i, d in enumerate(remaining)
                      if d["line"] == want["line"]
                      and ("rule" not in want or d["rule"] == want["rule"])), None)
        if match is None:
            return False
        remaining.pop(match)
    return not remaining


def execute(label, spec, cfg, resolve, output):
    argv = spec["argv"]
    common = cfg.get("common_args", [])
    if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
        raise ValueError(f"{label}.argv must be a nonempty string array")
    if not isinstance(common, list) or not all(isinstance(x, str) for x in common):
        raise ValueError("common_args must be a string array")
    command = argv + common + ["--outputjson", "--project", str(resolve(cfg["project"]))]
    cwd = resolve(spec.get("cwd", "."))
    started = time.monotonic()
    meta = {"revision": spec.get("revision"), "command": command, "cwd": str(cwd)}
    try:
        proc = subprocess.run(command, cwd=cwd, capture_output=True,
                              timeout=cfg.get("timeout_seconds"), shell=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        write_stream(output / f"{label}.stdout.json", getattr(exc, "stdout", None))
        write_stream(output / f"{label}.stderr.txt", getattr(exc, "stderr", None))
        meta.update(completed=False, timed_out=isinstance(exc, subprocess.TimeoutExpired),
                    error=str(exc), seconds=round(time.monotonic() - started, 3))
        write_json(output / f"{label}.run.json", meta)
        raise ValueError(f"{label} command did not complete: {exc}") from exc
    meta.update(completed=True, exit_code=proc.returncode, seconds=round(time.monotonic() - started, 3))
    write_stream(output / f"{label}.stdout.json", proc.stdout)
    write_stream(output / f"{label}.stderr.txt", proc.stderr)
    write_json(output / f"{label}.run.json", meta)
    if proc.returncode not in (0, 1):
        raise ValueError(f"{label} CLI exit {proc.returncode}; inspect saved stderr")
    data = json.loads(proc.stdout)
    if (not isinstance(data, dict) or not isinstance(data.get("generalDiagnostics"), list)
            or not isinstance(data.get("summary"), dict)):
        raise ValueError(f"{label} output is not a Pyright diagnostic report")
    if not all(isinstance(d, dict) for d in data["generalDiagnostics"]):
        raise ValueError(f"{label} diagnostics must be objects")
    for field in ("errorCount", "filesAnalyzed"):
        value = data["summary"].get(field)
        if type(value) is not int or value < 0:
            raise ValueError(f"{label} summary.{field} must be a nonnegative integer")
    errors = sum(d.get("severity") == "error" for d in data["generalDiagnostics"])
    if data["summary"].get("errorCount") != errors:
        raise ValueError(f"{label} error count disagrees with diagnostics")
    if proc.returncode == 1 and errors == 0:
        raise ValueError(f"{label} exit 1 without error diagnostics; inspect saved output")
    return data, meta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--validate-only", action="store_true",
                        help="Validate the configuration and input paths without running either checker")
    args = parser.parse_args()
    config = args.config.resolve()
    cfg = read_json(config)
    if not isinstance(cfg, dict):
        raise ValueError("config must be an object")
    def resolve(value):
        if not isinstance(value, str) or not value:
            raise ValueError("Configuration paths must be nonempty strings")
        return (config.parent / value).resolve()
    project = resolve(cfg["project"])
    root = resolve(cfg["case_root"])
    if not project.is_file():
        raise ValueError("project must point to an existing pyrightconfig.json")
    if not root.is_dir():
        raise ValueError("case_root must point to an existing directory")
    timeout = cfg.get("timeout_seconds")
    timeout_reason = cfg.get("timeout_reason")
    if timeout is None:
        if timeout_reason is not None:
            raise ValueError("timeout_reason requires a finite timeout_seconds value")
    else:
        if (type(timeout) not in (int, float) or not math.isfinite(timeout)
                or timeout < _MINIMUM_TIMEOUT_SECONDS):
            raise ValueError(
                f"timeout_seconds must be null or at least {_MINIMUM_TIMEOUT_SECONDS} seconds (24 days)"
            )
        if not isinstance(timeout_reason, str) or not timeout_reason.strip():
            raise ValueError(
                "timeout_reason must document the unavoidable API or platform constraint"
            )
    common = cfg.get("common_args", [])
    if not isinstance(common, list) or not all(isinstance(x, str) for x in common):
        raise ValueError("common_args must be a string array")
    for label in ("base", "candidate"):
        spec = cfg[label]
        if not isinstance(spec, dict):
            raise ValueError(f"{label} must be an object")
        argv = spec.get("argv")
        if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
            raise ValueError(f"{label}.argv must be a nonempty string array")
        resolve(spec.get("cwd", "."))
    cases = cfg["cases"]
    if not isinstance(cases, list) or not cases:
        raise ValueError("cases must be a nonempty array")
    case_keys = set()
    for case in cases:
        if not isinstance(case, dict):
            raise ValueError("Each case must be an object")
        if not isinstance(case.get("file"), str) or not case["file"]:
            raise ValueError("Each case.file must be a nonempty string")
        path = (root / case["file"]).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f"Case must be an existing file within case_root: {case['file']}")
        if key(path) in case_keys:
            raise ValueError(f"Duplicate case: {case['file']}")
        case_keys.add(key(path))
        if case["expect"] not in ("accept", "reject", "unchanged"):
            raise ValueError(f"Invalid expectation: {case['expect']}")
        if "errors" in case:
            if case["expect"] != "reject" or not isinstance(case["errors"], list) or not case["errors"]:
                raise ValueError("errors requires reject and a nonempty array")
            for error in case["errors"]:
                if not isinstance(error, dict):
                    raise ValueError("Each expected diagnostic must be an object")
                if type(error.get("line")) is not int or error["line"] < 1:
                    raise ValueError("Expected diagnostic lines must be positive integers")
                if "rule" in error and (not isinstance(error["rule"], str) or not error["rule"]):
                    raise ValueError("Expected diagnostic rules must be nonempty strings")
    output = resolve(cfg["output_dir"])
    if output.exists() and not output.is_dir():
        raise ValueError("output_dir must be a directory path")
    if args.validate_only:
        print(json.dumps({"configuration_valid": True, "cases": len(cases),
                          "checkers_executed": False}))
        return 0
    output.mkdir(parents=True, exist_ok=True)
    reports, runs = {}, {}
    for label in ("base", "candidate"):
        data, runs[label] = execute(label, cfg[label], cfg, resolve, output)
        reports[label] = signatures(data)
        verify_coverage(label, cases, root, reports[label], output)
    results = []
    for case in cases:
        path_key = key(root / case["file"])
        base = reports["base"][path_key]
        candidate = reports["candidate"][path_key]
        def disposition(ds):
            return "reject" if any(d["severity"] == "error" for d in ds) else "accept"
        results.append({
            "file": case["file"], "expected": case["expect"],
            "base": disposition(base), "candidate": disposition(candidate),
            "base_matches": check_expectation(case, base, base),
            "candidate_matches": check_expectation(case, candidate, base),
            "diagnostics_changed": base != candidate,
            "base_diagnostics": base, "candidate_diagnostics": candidate,
        })
    unlisted = {label: {path: ds for path, ds in grouped.items()
                       if path not in case_keys and any(d["severity"] == "error" for d in ds)}
                for label, grouped in reports.items()}
    summary = {
        "cases": len(results),
        "candidate_expectations_met": sum(r["candidate_matches"] for r in results),
        "newly_accepted": [r["file"] for r in results if r["base"] == "reject" and r["candidate"] == "accept"],
        "newly_rejected": [r["file"] for r in results if r["base"] == "accept" and r["candidate"] == "reject"],
        "expectation_failures": [r["file"] for r in results if not r["candidate_matches"]],
        "unlisted_error_files": {k: list(v) for k, v in unlisted.items()},
    }
    write_json(output / "comparison.json", {"runs": runs, "summary": summary,
                                            "cases": results, "unlisted_errors": unlisted})
    print(json.dumps(summary, indent=2))
    return int(bool(summary["expectation_failures"] or any(unlisted.values())))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print(f"Comparison could not complete: {exc}", file=sys.stderr)
        sys.exit(2)
