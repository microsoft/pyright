import json
import tempfile
import unittest
from pathlib import Path

import render_pyright_history


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
            execution_chart = (output / "execution-time.svg").read_text()
            self.assertIn("Pyright execution time by package", execution_chart)
            self.assertIn("1.1.406", execution_chart)
            self.assertIn("alpha", execution_chart)
            self.assertIn("Earliest release = 100%", execution_chart)
            self.assertIn("(100.0%)", execution_chart)
            page = (output / "index.html").read_text()
            self.assertIn("Peak memory", page)
            self.assertIn("same package commits", page.lower())

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
