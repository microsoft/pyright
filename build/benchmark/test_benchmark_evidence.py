import copy
import unittest

from benchmark_evidence import validate_compatibility, validate_evidence


def modern_result() -> dict:
    return {
        "checker_config_version": 8, "platform": "linux", "architecture": "x86_64",
        "runner_class": "test", "runner_image": "ubuntu", "cpu_count": 4,
        "python_version": "3.14.6", "memory_measurement": "/proc/<pid>/status",
        "memory_limit_mb": 8192, "dependency_isolation": "pip-target-per-package",
        "uncounted_validation_runs_per_checker": 1, "runs_per_package": 3,
        "warmup_runs": 1, "timeout_s": 1800, "installed_packages": [],
        "import_path_overrides": {},
        "type_checkers": ["pyright"],
        "results": [{
            "package_name": "example", "commit": "abc", "check_paths": ["source"],
            "exclude_directories": [], "resolved_dependencies": [],
            "repository_configs": [], "metrics": {
                "pyright": {
                    "ok": True, "file_count_verified": True, "files_selected": 2,
                    "execution_time_s": 10.0, "peak_memory_mb": 100.0,
                },
            },
        }],
    }


class BenchmarkEvidenceTest(unittest.TestCase):
    def test_requires_native_count_and_preparation_evidence(self) -> None:
        for field in ("file_count_verified", "files_selected"):
            result = modern_result()
            del result["results"][0]["metrics"]["pyright"][field]
            with self.assertRaisesRegex(ValueError, "not verified"):
                validate_evidence(result)
        result = modern_result()
        del result["results"][0]["resolved_dependencies"]
        with self.assertRaisesRegex(ValueError, "resolved_dependencies"):
            validate_evidence(result)

    def test_rejects_mixed_environments_scope_and_dependencies(self) -> None:
        baseline = modern_result()
        for field, value in (
            ("python_version", "3.11.0"), ("platform", "win32"), ("cpu_count", 8),
            ("installed_packages", [{"name": "library", "version": "2"}]),
        ):
            candidate = copy.deepcopy(baseline)
            candidate[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "ncompatible"):
                validate_compatibility(baseline, candidate)
        for field, value in (
            ("commit", "def"), ("check_paths", ["other"]),
            ("resolved_dependencies", [{"name": "library", "version": "2"}]),
        ):
            candidate = copy.deepcopy(baseline)
            candidate["results"][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, field):
                validate_compatibility(baseline, candidate)


if __name__ == "__main__":
    unittest.main()
