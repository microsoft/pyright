import json
import tempfile
import unittest
from pathlib import Path

import merge_benchmark_results


def _result(package: str, time: float) -> dict:
    return {
        "timestamp": f"2026-09-21T12:00:0{int(time)}+00:00",
        "date": "2026-09-21",
        "platform": "linux",
        "runner_class": "github-ubuntu-latest",
        "type_checkers": ["pyright"],
        "type_checker_versions": {"pyright": "1.2.3"},
        "package_count": 1,
        "aggregate": {},
        "results": [
            {
                "package_name": package,
                "error": None,
                "metrics": {
                    "pyright": {
                        "ok": True,
                        "execution_time_s": time,
                        "peak_memory_mb": time * 100,
                    }
                },
            }
        ],
    }


class MergeBenchmarkResultsTest(unittest.TestCase):
    def test_merges_packages_and_recomputes_aggregate(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            first = root / "first.json"
            second = root / "second.json"
            first.write_text(json.dumps(_result("click", 1.0)), encoding="utf-8")
            second.write_text(json.dumps(_result("numpy", 2.0)), encoding="utf-8")

            merged = merge_benchmark_results.merge_results([second, first])

        self.assertEqual(
            [result["package_name"] for result in merged["results"]],
            ["click", "numpy"],
        )
        self.assertEqual(merged["package_count"], 2)
        self.assertEqual(
            merged["aggregate"]["pyright"]["total_execution_time_s"], 3.0
        )
        self.assertEqual(merged["timestamp"], "2026-09-21T12:00:02+00:00")

    def test_rejects_different_metadata(self) -> None:
        first = _result("click", 1.0)
        second = _result("numpy", 2.0)
        second["runner_class"] = "different"

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            paths = []
            for index, data in enumerate((first, second)):
                path = root / f"{index}.json"
                path.write_text(json.dumps(data), encoding="utf-8")
                paths.append(path)

            with self.assertRaisesRegex(ValueError, "different benchmark metadata"):
                merge_benchmark_results.merge_results(paths)

    def test_rejects_duplicate_packages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            paths = []
            for index in range(2):
                path = root / f"{index}.json"
                path.write_text(
                    json.dumps(_result("click", float(index + 1))),
                    encoding="utf-8",
                )
                paths.append(path)

            with self.assertRaisesRegex(ValueError, "Duplicate package result"):
                merge_benchmark_results.merge_results(paths)


if __name__ == "__main__":
    unittest.main()
