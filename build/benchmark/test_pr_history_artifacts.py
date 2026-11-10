import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import pr_history_artifacts


def _artifact(
    artifact_id: int,
    pr_number: int,
    run_id: int,
    run_attempt: int,
    created_at: str,
) -> dict:
    return {
        "id": artifact_id,
        "name": (
            f"typecheck-benchmark-history-pr-{pr_number}-"
            f"run-{run_id}-attempt-{run_attempt}-"
            f"base-{'a' * 40}-candidate-{'b' * 40}"
        ),
        "run_id": run_id,
        "created_at": created_at,
    }


class PrHistoryArtifactsTest(unittest.TestCase):
    def test_selects_latest_artifact_for_each_run_attempt(self) -> None:
        artifacts = [
            _artifact(1, 10, 100, 1, "2026-09-21T10:00:00Z"),
            _artifact(2, 10, 100, 1, "2026-09-21T11:00:00Z"),
            _artifact(3, 10, 100, 2, "2026-09-21T12:00:00Z"),
            _artifact(4, 11, 102, 1, "2026-09-21T13:00:00Z"),
            {
                "id": 5,
                "name": "unrelated",
                "run_id": 103,
                "created_at": "later",
            },
        ]

        selected = pr_history_artifacts.select_artifacts(artifacts)

        self.assertEqual(
            selected,
            [
                {"id": 2, "pr_number": 10, "run_id": 100, "run_attempt": 1},
                {"id": 3, "pr_number": 10, "run_id": 100, "run_attempt": 2},
                {"id": 4, "pr_number": 11, "run_id": 102, "run_attempt": 1},
            ],
        )

    def test_rejects_artifact_with_mismatched_run_identity(self) -> None:
        artifact = _artifact(1, 10, 100, 2, "2026-09-21T10:00:00Z")
        artifact["run_id"] = 101

        self.assertEqual(pr_history_artifacts.select_artifacts([artifact]), [])

    def test_extracts_expected_chart_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            archive_path = root / "history.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                for name in pr_history_artifacts.EXPECTED_FILES:
                    archive.writestr(name, name)

            destination = root / "output"
            pr_history_artifacts.extract_archive(archive_path, destination)

            self.assertEqual(
                {path.name for path in destination.iterdir()},
                pr_history_artifacts.EXPECTED_FILES,
            )

    def test_rejects_nested_archive_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            archive_path = root / "history.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                for name in pr_history_artifacts.EXPECTED_FILES:
                    archive.writestr(
                        f"nested/{name}" if name == "index.html" else name, name
                    )

            with self.assertRaisesRegex(ValueError, "Unexpected PR history"):
                pr_history_artifacts.extract_archive(
                    archive_path, root / "output"
                )

    def test_rejects_oversized_archive_entries_before_extracting(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            archive_path = root / "history.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                for name in pr_history_artifacts.EXPECTED_FILES:
                    archive.writestr(name, name)

            destination = root / "output"
            with mock.patch.object(pr_history_artifacts, "MAX_FILE_SIZE", 1):
                with self.assertRaisesRegex(ValueError, "too large"):
                    pr_history_artifacts.extract_archive(archive_path, destination)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
