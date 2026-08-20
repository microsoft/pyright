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
    def test_loads_one_result_per_checker(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pyright = root / "pyright.json"
            mypy = root / "mypy.json"
            pyright.write_text(json.dumps(_result("pyright", 2.0, 200.0)))
            mypy.write_text(json.dumps(_result("mypy", 1.0, 100.0)))

            results = render_benchmark_html.load_checker_results([mypy, pyright])

        self.assertEqual(results, {"mypy": _result("mypy", 1.0, 100.0), "pyright": _result("pyright", 2.0, 200.0)})

    def test_renders_comparison_semantics(self) -> None:
        report = render_benchmark_html.render_html(
            {
                "pyright": _result("pyright", 2.0, 200.0),
                "mypy": _result("mypy", 1.0, 100.0),
                "zuban": _result("zuban", 0.0, 0.0, ok=False),
            }
        )
        parser = _SemanticParser()
        parser.feed(report)

        self.assertEqual(parser.title, "Python type checker benchmark")
        self.assertEqual(
            parser.headings,
            ["Python type checker benchmark", "Run summary", "Package comparison"],
        )
        self.assertEqual(
            parser.cells,
            [
                "Checker", "Measured", "Failed", "Total time", "Median time", "Median RSS",
                "pyright", "1.2.3", "1", "0", "2.0s", "2.0s", "200 MB",
                "mypy", "1.2.3", "1", "0", "1.0s", "1.0s", "100 MB",
                "zuban", "1.2.3", "0", "1", "0.0s", "0.0s", "0 MB",
                "Package", "pyright", "mypy", "zuban", "example", "2.00s", "200 MB",
                "1.00s", "100 MB", "Not measured",
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