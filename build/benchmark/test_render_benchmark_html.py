import json
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

import render_benchmark_html


def _result(checker: str, time: float, memory: float, ok: bool = True) -> dict:
    return {
        "timestamp": "2026-07-30T12:00:00+00:00",
        "platform": "linux",
        "platform_details": "Linux test runner",
        "python_version": "3.14.6",
        "cpu_count": 4,
        "type_checkers": [checker],
        "type_checker_versions": {checker: "1.2.3"},
        "aggregate": {
            checker: {
                "packages_tested": 1 if ok else 0,
                "packages_failed": 0 if ok else 1,
                "total_execution_time_s": time if ok else 0,
                "p50_execution_time_s": time if ok else 0,
                "p50_peak_memory_mb": memory if ok else 0,
            }
        },
        "results": [
            {
                "package_name": "example",
                "metrics": {
                    checker: {
                        "ok": ok,
                        "execution_time_s": time,
                        "peak_memory_mb": memory,
                    }
                },
            }
        ],
    }


class _SemanticParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.headings: list[str] = []
        self.cells: list[str] = []
        self._capture: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("title", "h1", "h2", "th", "td"):
            self._capture = tag

    def handle_endtag(self, tag: str) -> None:
        if self._capture == tag:
            self._capture = None

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if not value or not self._capture:
            return
        if self._capture == "title":
            self.title += value
        elif self._capture in ("h1", "h2"):
            self.headings.append(value)
        else:
            self.cells.append(value)


class RenderBenchmarkHtmlTest(unittest.TestCase):
    def test_native_count_mismatches_are_not_comparable_or_in_summary_totals(self) -> None:
        pyright = _result("pyright", 2.0, 200.0)
        mypy = _result("mypy", 1.0, 100.0)
        for checker, result, count in (("pyright", pyright, 2), ("mypy", mypy, 1)):
            result["results"][0]["metrics"][checker].update(
                files_selected=count, file_count_verified=True
            )
        report = render_benchmark_html.render_html({"pyright": pyright, "mypy": mypy})
        self.assertEqual(report.count("Not comparable"), 2)
        self.assertIn("2 native source files", report)
        self.assertIn("1 native source files", report)
        self.assertNotIn("2.00s", report)
        self.assertNotIn("1.00s", report)
        self.assertNotIn("<strong>2.0s</strong>", report)
        self.assertTrue(pyright["results"][0]["metrics"]["pyright"]["ok"])

    def test_repository_configuration_audit_is_visible_and_escaped(self) -> None:
        result = _result("ty", 1.0, 100.0)
        result["results"][0]["repository_configs"] = [
            {
                "path": "nested/pyproject.toml", "checkers": ["ty"],
                "sections": ["tool.ty"], "settings": ["tool.ty.rules.all"],
                "disposition": "not applied: explicit benchmark config",
            },
            {
                "path": "broken.toml", "checkers": [], "sections": [], "settings": [],
                "parse_error": "<invalid TOML>",
            },
        ]
        report = render_benchmark_html.render_html({"ty": result})
        self.assertIn("Repository configuration audit", report)
        self.assertIn("nested/pyproject.toml", report)
        self.assertIn("tool.ty.rules.all", report)
        self.assertIn("not applied: explicit benchmark config", report)
        self.assertIn("Scan parse error: &lt;invalid TOML&gt;", report)
        self.assertNotIn("<invalid TOML>", report)

    def test_renders_behavior_matches_without_quality_adjusting_times(self) -> None:
        pyright = _result("pyright", 2.0, 200.0)
        ty = _result("ty", 1.0, 100.0)
        for checker, result in (("pyright", pyright), ("ty", ty)):
            result["capability_suite"] = {
                "version": 1,
                "sha256": "same",
                "cases": {"returns": "Return inference"},
                "results": {
                    checker: {
                        "ok": True,
                        "cases": {
                            "returns": {
                                "passed": checker == "pyright",
                                "positive_diagnostic_lines": [] if checker == "pyright" else [3],
                                "negative_diagnostic_lines": [4] if checker == "pyright" else [],
                                "expected_error_line": 4,
                            }
                        },
                    }
                },
            }
        report = render_benchmark_html.render_html({"pyright": pyright, "ty": ty})
        parser = _SemanticParser()
        parser.feed(report)
        self.assertIn("Behavior matches", parser.cells)
        self.assertIn("1 / 1", parser.cells)
        self.assertIn("0 / 1", parser.cells)
        self.assertIn("2.00s", parser.cells)
        self.assertIn("1.00s", parser.cells)
        self.assertIn("Behavioral capability probes", parser.headings)
        self.assertIn("Positive diagnostic lines: [3]", report)
        self.assertIn("do not certify equivalent analysis", report)

        ty["capability_suite"]["sha256"] = "different"
        with self.assertRaisesRegex(ValueError, "different capability suites"):
            render_benchmark_html.render_html({"pyright": pyright, "ty": ty})
        ty["capability_suite"]["sha256"] = "same"
        ty["capability_suite"]["results"]["ty"] = {
            "ok": False, "error": "<failed audit>",
        }
        report = render_benchmark_html.render_html({"pyright": pyright, "ty": ty})
        self.assertIn("Not evaluated", report)
        self.assertIn("&lt;failed audit&gt;", report)
        self.assertNotIn("<failed audit>", report)

    def test_requires_matching_manifests_and_verified_native_counts(self) -> None:
        pyright = _result("pyright", 2.0, 200.0)
        ty = _result("ty", 1.0, 100.0)
        for checker, result in (("pyright", pyright), ("ty", ty)):
            result["checker_config_version"] = 4
            result["results"][0].update(
                source_file_count=5, source_manifest_sha256="same"
            )
            result["results"][0]["metrics"][checker].update(
                files_selected=5, file_count_verified=True
            )
        report = render_benchmark_html.render_html({"pyright": pyright, "ty": ty})
        self.assertIn("5 source files selected", report)
        self.assertEqual(report.count("5 source files verified"), 2)

        ty["checker_config_version"] = 3
        with self.assertRaisesRegex(ValueError, "different benchmark configuration versions"):
            render_benchmark_html.render_html({"pyright": pyright, "ty": ty})
        ty["checker_config_version"] = 4
        ty["results"][0]["source_manifest_sha256"] = "different"
        with self.assertRaisesRegex(ValueError, "different source manifests"):
            render_benchmark_html.render_html({"pyright": pyright, "ty": ty})
        ty["results"][0]["source_manifest_sha256"] = "same"
        ty["results"][0]["metrics"]["ty"]["files_selected"] = 4
        with self.assertRaisesRegex(ValueError, "source-file count is not verified"):
            render_benchmark_html.render_html({"pyright": pyright, "ty": ty})

    def test_renders_ty_inference_as_a_separate_profile(self) -> None:
        report = render_benchmark_html.render_html(
            {
                "ty-infer": _result("ty-infer", 2.0, 200.0),
                "ty": _result("ty", 1.0, 100.0),
            }
        )
        parser = _SemanticParser()
        parser.feed(report)
        self.assertLess(parser.cells.index("ty"), parser.cells.index("ty (return inference)"))
        self.assertIn("do not measure equivalent analysis or time per rule", report)

    def test_loads_one_result_per_checker(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pyright = root / "pyright.json"
            mypy = root / "mypy.json"
            pyright.write_text(json.dumps(_result("pyright", 2.0, 200.0)))
            mypy.write_text(json.dumps(_result("mypy", 1.0, 100.0)))

            results = render_benchmark_html.load_checker_results([mypy, pyright])

        self.assertEqual(results, {"mypy": _result("mypy", 1.0, 100.0), "pyright": _result("pyright", 2.0, 200.0)})

    def test_loads_multiple_checkers_from_one_result(self) -> None:
        combined = _result("pyright", 2.0, 200.0)
        threaded = _result("pyright-threads", 1.0, 250.0)
        combined["type_checkers"].append("pyright-threads")
        combined["type_checker_versions"].update(threaded["type_checker_versions"])
        combined["aggregate"].update(threaded["aggregate"])
        combined["results"][0]["metrics"].update(
            threaded["results"][0]["metrics"]
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "pyright.json"
            path.write_text(json.dumps(combined))
            results = render_benchmark_html.load_checker_results([path])

        self.assertEqual(set(results), {"pyright", "pyright-threads"})
        self.assertIs(results["pyright"], results["pyright-threads"])

    def test_renders_comparison_semantics(self) -> None:
        report = render_benchmark_html.render_html(
            {
                "pyright": _result("pyright", 2.0, 200.0),
                "pyright-threads": _result("pyright-threads", 1.0, 250.0),
                "mypy": _result("mypy", 1.0, 100.0),
                "zuban": _result("zuban", 0.0, 0.0, ok=False),
            }
        )
        parser = _SemanticParser()
        parser.feed(report)

        self.assertEqual(parser.title, "Python type checker benchmark")
        self.assertEqual(
            parser.headings,
            [
                "Python type checker benchmark",
                "Run summary",
                "Package comparison",
                "Pyright threading comparison",
                "Pyright release history",
            ],
        )
        self.assertEqual(
            parser.cells,
            [
                "Checker", "Measured", "Failed", "Total time", "Median time", "Median RSS",
                "pyright", "1.2.3", "1", "0", "2.0s", "2.0s", "200 MB",
                "pyright (threads)", "1.2.3", "1", "0", "1.0s", "1.0s", "250 MB",
                "mypy", "1.2.3", "1", "0", "1.0s", "1.0s", "100 MB",
                "zuban", "1.2.3", "0", "1", "0.0s", "0.0s", "0 MB",
                "Package", "pyright", "pyright (threads)", "mypy", "zuban",
                "example", "2.00s", "200 MB", "1.00s", "250 MB", "1.00s",
                "100 MB", "Not measured", "Package", "Single-thread",
                "Multi-thread", "Speedup", "example", "2.00s", "200 MB",
                "1.00s", "250 MB", "2.00x",
            ],
        )

    def test_renders_pyright_stats_when_available(self) -> None:
        pyright = _result("pyright", 2.0, 200.0)
        metrics = pyright["results"][0]["metrics"]["pyright"]
        metrics.update(
            {
                "files_parsed": 456,
                "files_checked": 123,
                "phase_times_s": {
                    "find_source_files": 0.1,
                    "read_source_files": 0.2,
                    "tokenize": 0.3,
                    "parse": 0.4,
                    "resolve_imports": 0.5,
                    "bind": 0.6,
                    "check": 7.8,
                    "detect_cycles": 0.9,
                },
            }
        )

        report = render_benchmark_html.render_html({"pyright": pyright})
        parser = _SemanticParser()
        parser.feed(report)

        self.assertIn("Pyright analysis stats", parser.headings)
        self.assertIn("Parsed/bound", parser.cells)
        self.assertIn("456", parser.cells)
        self.assertIn("123", parser.cells)
        self.assertIn("7.800s", parser.cells)


if __name__ == "__main__":
    unittest.main()