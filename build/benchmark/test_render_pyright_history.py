import json
import tempfile
import unittest
import xml.etree.ElementTree as ElementTree
from html.parser import HTMLParser
from pathlib import Path

import render_pyright_history

REPO_ROOT = Path(__file__).resolve().parents[2]


class _HistoryHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.headings: list[str] = []
        self.cells: list[str] = []
        self.images: list[tuple[str, str]] = []
        self.links: list[str] = []
        self._capture: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag in ("title", "h1", "h2", "th", "td"):
            self._capture = tag
        if tag == "img":
            self.images.append((attributes.get("src", ""), attributes.get("alt", "")))
        if tag == "a":
            self.links.append(attributes.get("href", ""))

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


def _result(version: str, published_at: str, scale: float = 1.0) -> dict:
    return {
        "timestamp": "2026-09-14T12:00:00+00:00",
        "python_version": "3.14.6",
        "runner_class": "github-ubuntu-latest",
        "runner_image": "ubuntu24",
        "memory_limit_mb": 8192,
        "node_options": "--max-old-space-size=6656",
        "dependency_isolation": "pip-target-per-package",
        "runs_per_package": 1,
        "warmup_runs": 0,
        "type_checkers": ["pyright-pip"],
        "type_checker_versions": {"pyright-pip": version},
        "release_version": version,
        "release_published_at": published_at,
        "results": [
            {
                "package_name": "alpha",
                "commit": "a" * 40,
                "check_paths": ["src"],
                "exclude_directories": [],
                "metrics": {
                    "pyright-pip": {
                        "ok": True,
                        "execution_time_s": 2.0 * scale,
                        "peak_memory_mb": 100.0 * scale,
                    }
                },
            },
            {
                "package_name": "beta",
                "commit": "b" * 40,
                "check_paths": ["lib"],
                "exclude_directories": [],
                "metrics": {
                    "pyright-pip": {
                        "ok": True,
                        "execution_time_s": 4.0 * scale,
                        "peak_memory_mb": 200.0 * scale,
                    }
                },
            },
        ],
    }


class RenderPyrightHistoryTest(unittest.TestCase):
    def test_appends_candidate_to_release_history(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            older = root / "older.json"
            base = root / "base.json"
            candidate = root / "candidate.json"
            release_output = root / "release-output"
            candidate_output = root / "candidate-output"
            older.write_text(json.dumps(_result("1.1.406", "2025-10-01")))
            base_data = _result("1.1.998", "", 0.95)
            candidate_data = _result("1.1.999", "", 0.9)
            for data in (base_data, candidate_data):
                data.pop("release_version")
                data.pop("release_published_at")
            base.write_text(json.dumps(base_data))
            candidate.write_text(json.dumps(candidate_data))
            release_history = render_pyright_history.write_history(
                [older], release_output
            )

            history = render_pyright_history.write_candidate_history(
                release_output / "history.json",
                [base, candidate],
                ["Base", "PR #123"],
                candidate_output,
            )

            self.assertEqual(history["profile"], release_history["profile"])
            self.assertEqual(
                [release["version"] for release in history["releases"]],
                ["1.1.406", "Base", "PR #123"],
            )
            self.assertEqual(
                history["releases"][2],
                {
                    "version": "PR #123",
                    "published_at": "",
                    "measured_at": "2026-09-14T12:00:00+00:00",
                    "packages": {
                        "alpha": {
                            "execution_time_s": 1.8,
                            "peak_memory_mb": 90.0,
                        },
                        "beta": {
                            "execution_time_s": 3.6,
                            "peak_memory_mb": 180.0,
                        },
                    },
                    "comparison": True,
                },
            )
            namespace = {"svg": "http://www.w3.org/2000/svg"}
            chart = ElementTree.fromstring(
                (candidate_output / "execution-time.svg").read_text()
            )
            self.assertEqual(
                chart.find("svg:desc", namespace).text,
                "One line per benchmark package across Pyright releases plus the base and pull request comparison.",
            )
            self.assertEqual(
                [
                    element.text
                    for element in chart.findall("svg:text", namespace)
                    if element.attrib.get("text-anchor") == "middle"
                ],
                ["1.1.406", "2025-10-01", "Base", "PR #123"],
            )
            page_parser = _HistoryHtmlParser()
            page_parser.feed((candidate_output / "index.html").read_text())
            self.assertIn("Benchmark runs", page_parser.headings)
            self.assertEqual(page_parser.cells[0], "Version / comparison")
            self.assertIn("Base", page_parser.cells)
            self.assertIn("PR #123", page_parser.cells)

    def test_rejects_candidate_with_mismatched_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            release = root / "release.json"
            candidate = root / "candidate.json"
            output = root / "output"
            release.write_text(json.dumps(_result("1.1.406", "2025-10-01")))
            candidate_data = _result("1.1.999", "")
            candidate_data["python_version"] = "3.15.0"
            candidate.write_text(json.dumps(candidate_data))
            render_pyright_history.write_history([release], output)

            with self.assertRaisesRegex(ValueError, "different benchmark profile"):
                render_pyright_history.append_candidates(
                    output / "history.json", [candidate], ["PR #123"]
                )

    def test_checked_in_history_records_current_package_corpus(self) -> None:
        history = json.loads(
            (
                REPO_ROOT / "docs" / "typecheck-benchmark" / "history" / "history.json"
            ).read_text(encoding="utf-8")
        )
        baseline = json.loads(
            (
                REPO_ROOT
                / "build"
                / "benchmark"
                / "baselines"
                / "latest-linux-x64.json"
            ).read_text(encoding="utf-8")
        )

        self.assertEqual(
            history["package_corpus"],
            render_pyright_history._package_corpus(baseline),
        )

    def test_rejects_candidate_with_mismatched_history_corpus(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            release = root / "release.json"
            candidate = root / "candidate.json"
            output = root / "output"
            release.write_text(json.dumps(_result("1.1.406", "2025-10-01")))
            candidate_data = _result("1.1.999", "")
            candidate_data["results"][0]["commit"] = "c" * 40
            candidate.write_text(json.dumps(candidate_data))
            render_pyright_history.write_history([release], output)

            with self.assertRaisesRegex(ValueError, "history package corpus"):
                render_pyright_history.append_candidates(
                    output / "history.json", [candidate], ["PR #123"]
                )

    def test_renders_release_history_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            newer = root / "newer.json"
            older = root / "older.json"
            manifest = root / "manifest.json"
            output = root / "output"
            newer.write_text(json.dumps(_result("1.1.407", "2025-10-24", 0.8)))
            older.write_text(json.dumps(_result("1.1.406", "2025-10-01")))
            manifest.write_text(
                json.dumps(
                    {
                        "releases": [
                            {"version": "1.1.406", "published_at": "2025-10-01"},
                            {"version": "1.1.407", "published_at": "2025-10-24"},
                        ]
                    }
                )
            )

            history = render_pyright_history.write_history(
                [newer, older], output, manifest
            )

            self.assertEqual(
                [release["version"] for release in history["releases"]],
                ["1.1.406", "1.1.407"],
            )
            self.assertEqual(history["packages"], ["alpha", "beta"])
            for name in (
                "history.json",
                "execution-time.svg",
                "peak-memory.svg",
                "index.html",
            ):
                self.assertTrue((output / name).is_file())
            namespace = {"svg": "http://www.w3.org/2000/svg"}
            execution_chart = ElementTree.fromstring(
                (output / "execution-time.svg").read_text()
            )
            self.assertEqual(
                execution_chart.attrib,
                {
                    "role": "img",
                    "aria-labelledby": "title description",
                    "viewBox": "0 0 1280 760",
                },
            )
            self.assertEqual(
                execution_chart.find("svg:title", namespace).text,
                "Pyright execution time by package",
            )
            self.assertEqual(
                execution_chart.find("svg:desc", namespace).text,
                "One line per benchmark package across Pyright releases.",
            )
            subtitles = [
                element.text
                for element in execution_chart.findall("svg:text", namespace)
                if element.attrib.get("y") == "61"
            ]
            self.assertEqual(
                subtitles,
                ["Earliest release = 100% for each package - lower is better"],
            )
            release_labels = [
                element.text
                for element in execution_chart.findall("svg:text", namespace)
                if element.attrib.get("text-anchor") == "middle"
            ]
            self.assertEqual(
                release_labels,
                ["1.1.406", "2025-10-01", "1.1.407", "2025-10-24"],
            )
            self.assertEqual(
                [
                    element.text
                    for element in execution_chart.findall(
                        "svg:text[@class='label']", namespace
                    )
                ],
                ["alpha", "beta"],
            )
            self.assertEqual(
                len(execution_chart.findall("svg:polyline", namespace)),
                2,
            )
            self.assertEqual(
                [
                    circle.find("svg:title", namespace).text
                    for circle in execution_chart.findall("svg:circle", namespace)
                ],
                [
                    "alpha - 1.1.406: 2.00 s (100.0%)",
                    "alpha - 1.1.407: 1.60 s (80.0%)",
                    "beta - 1.1.406: 4.00 s (100.0%)",
                    "beta - 1.1.407: 3.20 s (80.0%)",
                ],
            )

            page_parser = _HistoryHtmlParser()
            page_parser.feed((output / "index.html").read_text())
            self.assertEqual(page_parser.title, "Pyright package performance by release")
            self.assertEqual(
                page_parser.headings,
                [
                    "Pyright package performance by release",
                    "Execution time",
                    "Peak memory",
                    "Methodology",
                    "Release runs",
                ],
            )
            self.assertEqual(
                page_parser.images,
                [
                    (
                        "execution-time.svg",
                        "Per-package Pyright execution time across releases",
                    ),
                    (
                        "peak-memory.svg",
                        "Per-package Pyright peak memory across releases",
                    ),
                ],
            )
            self.assertEqual(page_parser.links, ["../", "history.json"])
            self.assertEqual(
                page_parser.cells,
                [
                    "Version",
                    "Published",
                    "Packages measured",
                    "Measured at",
                    "1.1.406",
                    "2025-10-01",
                    "2",
                    "2026-09-14T12:00:00+00:00",
                    "1.1.407",
                    "2025-10-24",
                    "2",
                    "2026-09-14T12:00:00+00:00",
                ],
            )

    def test_rejects_mismatched_corpus(self) -> None:
        first = _result("1.1.406", "2025-10-01")
        second = _result("1.1.407", "2025-10-24")
        second["results"][0]["commit"] = "c" * 40
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            first_path = root / "first.json"
            second_path = root / "second.json"
            first_path.write_text(json.dumps(first))
            second_path.write_text(json.dumps(second))

            with self.assertRaisesRegex(ValueError, "different package corpus"):
                render_pyright_history.load_history([first_path, second_path])

    def test_rejects_missing_manifest_release(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            result = root / "result.json"
            manifest = root / "manifest.json"
            result.write_text(json.dumps(_result("1.1.406", "2025-10-01")))
            manifest.write_text(
                json.dumps(
                    {
                        "releases": [
                            {"version": "1.1.406", "published_at": "2025-10-01"},
                            {"version": "1.1.407", "published_at": "2025-10-24"},
                        ]
                    }
                )
            )

            with self.assertRaisesRegex(ValueError, "missing releases: 1.1.407"):
                render_pyright_history.load_history([result], manifest)


if __name__ == "__main__":
    unittest.main()
