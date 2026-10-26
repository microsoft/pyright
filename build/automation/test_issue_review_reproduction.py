# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import base64
import hashlib
import io
import json
import os
import stat
import tarfile
import tempfile
import unittest
from argparse import Namespace
from http.client import HTTPMessage
from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.request import Request

from copilot import ToolInvocation
from pydantic import JsonValue

from issue_review_evidence import evidence_json
from issue_review_models import (
    Closure, DraftCheck, Entry, ExploratoryReproductionScenario, Label, ReproductionGate, ReproductionScenario,
)
from issue_review_reproduction import (
    MICROSOFT_FEED, MICROSOFT_REGISTRY, NPM_REGISTRY, UPSTREAM, RegistryRedirects,
    ReleaseCatalog, TargetStore, classify, fingerprint, observe_claims, registry_base, release_wording, scenario_inputs,
    select_targets, tree_hash, validate_exploratory_settings, validate_registry_url,
)
from issue_review_safety import ScreeningBlocked
from review_issues import (
    AGENTS, Agent, AutomationError, ChunkResult, Console, ReproductionEvidenceTools, digest, dry_run_proposal,
    arguments, context_hash, main as review_main, reproduction_response, require_run_mode, unfinished_reproduction_publication,
)
from test_review_issues import FakeGitHub, audit, issue, save_evidence


def scenario() -> ReproductionScenario:
    control = {
        "file": "sample.py", "line": 2, "severity": "information",
        "message": 'Type of "value" is "Literal[1]"', "rule": None, "present": True,
    }
    symptom = {
        "file": "sample.py", "line": 3, "severity": "error",
        "message": "Unsupported rejection", "rule": "reportAssignmentType", "present": True,
    }
    return ReproductionScenario.model_validate({
        "summary": "An incorrect rejection with stable input types", "reported_version": None, "version_quote": None,
        "files": {"sample.py": "value = 1\nreveal_type(value)\nresult: int = value\n"},
        "configuration": {"typeCheckingMode": "standard", "pythonVersion": "3.10"},
        "claims": [{
            "id": "assignment", "report_quote": "A small reproducer", "surface": "cli",
            "broken": [symptom], "resolved": [control, {**symptom, "present": False}], "precision": [control],
        }],
        "prerequisites": [], "limitations": ["No causal attribution"],
    })


def scenario_with_controls() -> ReproductionScenario:
    probe = scenario()
    probe.files = {"sample.py": "value = 1\nresult: int = value\n"}
    probe.control_files = {"sample.py": probe.files["sample.py"] + "reveal_type(value)\n"}
    probe.claims[0].broken[0].line = 2
    probe.claims[0].resolved = [probe.claims[0].broken[0].model_copy(update={"present": False})]
    probe.claims[0].precision[0].line = 3
    return probe


def missing_diagnostic_scenario() -> ReproductionScenario:
    probe = scenario_with_controls()
    predicate = {**probe.claims[0].broken[0].model_dump(), "message": None, "present": False}
    data = probe.model_dump()
    data["claims"][0]["broken"] = [predicate]
    data["claims"][0]["resolved"] = [{**predicate, "present": True}]
    return ReproductionScenario.model_validate(data)


def exploratory_scenario() -> ExploratoryReproductionScenario:
    probe = scenario_with_controls()
    return ExploratoryReproductionScenario.model_validate({
        **probe.model_dump(),
        "configuration_assumptions": [
            {"setting": key, "value": value, "reason": "Omitted in this unit report; chosen for this source-compatible experiment"}
            for key, value in probe.configuration.items()
        ],
        "reported_configuration": [],
    })


def catalog() -> dict:
    return {
        "versions": {
            version: {
                "name": "pyright", "version": version, "repository": {"url": UPSTREAM},
                "dist": {
                    "tarball": f"https://registry.npmjs.org/pyright/-/pyright-{version}.tgz",
                    "integrity": "sha512-" + base64.b64encode(b"x" * 64).decode(),
                },
            } for version in ("1.1.1", "1.1.2", "1.1.3")
        },
        "time": {
            "1.1.1": "2025-01-01T00:00:00Z", "1.1.2": "2025-02-01T00:00:00Z",
            "1.1.3": "2025-03-01T00:00:00Z",
        },
        "dist-tags": {"latest": "1.1.3"},
    }


def microsoft_catalog() -> dict:
    metadata = catalog()
    for version, package in metadata["versions"].items():
        package["dist"] = {
            "tarball": f"{MICROSOFT_FEED}/pyright/-/pyright-{version}.tgz",
            "shasum": "a" * 40,
        }
    return metadata


def record(
    cwd: Path, *, broken: bool, version: str = "1.1.1", phase: str = "original", separate_controls: bool = False,
) -> dict:
    def diagnostic(message: str, line: int, severity: str, rule: str | None = None) -> dict:
        return {
            "file": str(cwd / "sample.py"), "severity": severity, "message": message,
            "range": {"start": {"line": line - 1, "character": 0}, "end": {"line": line - 1, "character": 1}},
            **({"rule": rule} if rule else {}),
        }
    diagnostics = (
        [diagnostic('Type of "value" is "Literal[1]"', 3 if separate_controls else 2, "information")]
        if not separate_controls or phase == "control" else []
    )
    if broken:
        diagnostics.append(diagnostic("Unsupported rejection", 2 if separate_controls else 3, "error", "reportAssignmentType"))
    return {
        "target": {"version": version}, "cwd": str(cwd), "exit_code": int(broken), "phase": phase,
        "stdout": json.dumps({"version": version, "generalDiagnostics": diagnostics, "summary": {"filesAnalyzed": 1}}),
        "stderr": "",
    }


class SelectionTests(unittest.TestCase):
    def test_creation_not_update_selects_approximate_actual_publication(self):
        report = issue().model_copy(update={
            "created_at": "2025-02-15T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
        })
        targets = select_targets(catalog(), report, scenario(), "", "a" * 40)
        historical, main, latest = targets
        self.assertEqual(historical.version, "1.1.2")
        self.assertTrue(historical.approximate)
        self.assertIn("not the reporter's exact binary", historical.selection_reason)
        self.assertEqual(historical.published_at, "2025-02-01T00:00:00Z")
        self.assertEqual(main.identity, "a" * 40)
        self.assertEqual(main.source, UPSTREAM)
        self.assertEqual(latest.version, "1.1.3")

    def test_explicit_reported_version_takes_precedence_and_must_be_published(self):
        report = issue().model_copy(update={"body": "Pyright 1.1.1", "created_at": "2025-04-01T00:00:00Z"})
        probe = scenario().model_copy(update={"reported_version": "1.1.1", "version_quote": "Pyright 1.1.1"})
        selected = select_targets(catalog(), report, probe, "", "b" * 40)[0]
        self.assertEqual(selected.version, "1.1.1")
        self.assertFalse(selected.approximate)
        with self.assertRaisesRegex(ValueError, "approximation"):
            select_targets(catalog(), report, scenario(), "", "a" * 40)
        probe.reported_version, probe.version_quote = "1.1.99", "Pyright 1.1.99"
        report.body = probe.version_quote
        blocked = select_targets(catalog(), report, probe, "", "a" * 40)[0]
        self.assertEqual(blocked.status, "blocked")
        self.assertIn("unavailable", blocked.error or "")

    def test_no_creation_date_or_no_old_publication_is_blocked(self):
        with self.assertRaisesRegex(ValueError, "creation"):
            select_targets(catalog(), issue(), scenario(), "", "a" * 40)
        report = issue().model_copy(update={"created_at": "2024-01-01T00:00:00Z"})
        with self.assertRaisesRegex(ValueError, "No published"):
            select_targets(catalog(), report, scenario(), "", "a" * 40)

    def test_untrusted_tarball_and_unpinned_main_are_rejected(self):
        report = issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"})
        metadata = catalog()
        metadata["versions"]["1.1.2"]["dist"]["tarball"] = "https://attacker.example/pyright.tgz"
        selected = select_targets(metadata, report, scenario(), "", "a" * 40)
        self.assertEqual(selected[0].status, "blocked")
        self.assertIn("artifact URL", selected[0].error or "")
        with self.assertRaisesRegex(ValueError, "full commit"):
            select_targets(catalog(), report, scenario(), "", "main")

    def test_release_wording_requires_independent_observation(self):
        targets = select_targets(catalog(), issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"}), scenario(), "", "a" * 40)
        self.assertIn("latest published Pyright version 1.1.3", release_wording(targets, {"latest": "not_reproduced"}))
        self.assertIn("awaiting release", release_wording(targets, {"latest": "reproduced"}))
        self.assertIn("unverified", release_wording(targets, {"latest": "blocked"}))


class RegistryTests(unittest.IsolatedAsyncioTestCase):
    def test_only_explicit_approved_registry_origins_are_accepted(self):
        self.assertEqual(registry_base(MICROSOFT_REGISTRY + "/"), MICROSOFT_REGISTRY)
        for registry in (
            "http://packagefeedproxy.microsoft.io", "https://attacker.example",
            "https://user:password@packagefeedproxy.microsoft.io",
            MICROSOFT_REGISTRY + "/other", MICROSOFT_REGISTRY + "?token=secret",
        ):
            with self.subTest(registry=registry), self.assertRaises(ValueError):
                registry_base(registry)
        validate_registry_url(MICROSOFT_REGISTRY + "/pyright")
        with self.assertRaises(ValueError):
            validate_registry_url("https://packagefeedproxy.microsoft.io/pyright")
        with self.assertRaisesRegex(ValueError, "selected origin"):
            RegistryRedirects().redirect_request(
                Request(NPM_REGISTRY + "/pyright"), io.BytesIO(), 302, "Redirect", HTTPMessage(),
                MICROSOFT_REGISTRY + "/pyright",
            )

    def test_feed_checksums_require_explicit_selection_and_preserve_dates(self):
        report = issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"})
        metadata = microsoft_catalog()
        rejected = select_targets(metadata, report, scenario(), "", "a" * 40)
        self.assertEqual(rejected[0].status, "blocked")
        self.assertIn("SHA-512", rejected[0].error or "")
        selected = select_targets(metadata, report, scenario(), "", "a" * 40, registry=MICROSOFT_REGISTRY)
        self.assertEqual(selected[0].version, "1.1.2")
        self.assertEqual(selected[0].published_at, "2025-02-01T00:00:00Z")
        self.assertEqual(selected[0].integrity, "sha1-" + base64.b64encode(bytes.fromhex("a" * 40)).decode())
        self.assertTrue(all(target.registry == MICROSOFT_REGISTRY for target in selected))

    def test_feed_rejects_wrong_sources_and_malformed_stronger_checksums(self):
        report = issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"})
        for field, value in (
            ("tarball", "https://attacker.example/pyright/-/pyright-1.1.2.tgz"),
            ("integrity", "sha512-invalid!"),
            ("shasum", "not-a-checksum"),
        ):
            with self.subTest(field=field):
                metadata = microsoft_catalog()
                metadata["versions"]["1.1.2"]["dist"][field] = value
                selected = select_targets(metadata, report, scenario(), "", "a" * 40, registry=MICROSOFT_REGISTRY)
                self.assertEqual(selected[0].status, "blocked")

    def test_registry_choice_is_explicit_and_part_of_runtime_identity(self):
        with patch("sys.argv", ["review_issues.py", "--dry-run"]):
            self.assertEqual(arguments().reproduction_registry, NPM_REGISTRY)
        with patch("sys.argv", ["review_issues.py", "--dry-run", "--reproduction-registry", MICROSOFT_REGISTRY]):
            self.assertEqual(arguments().reproduction_registry, MICROSOFT_REGISTRY)
        self.assertNotEqual(
            context_hash([], "test", editor_options={"reproduction_registry": NPM_REGISTRY}),
            context_hash([], "test", editor_options={"reproduction_registry": MICROSOFT_REGISTRY}),
        )

    async def test_official_catalog_preserves_verified_download_receipt(self):
        raw = json.dumps(catalog()).encode()
        with tempfile.TemporaryDirectory() as temporary, patch("issue_review_reproduction.download", return_value=raw):
            runner = AsyncMock()
            store = TargetStore(Path(temporary), runner)
            result = await store.catalog()
            self.assertEqual(result.dist_tags["latest"], "1.1.3")
            runner.assert_not_awaited()
            log = json.loads(next(Path(temporary).glob("catalog-*.json")).read_text())
            self.assertEqual(log["commands"][0]["content"], raw.decode())
            self.assertEqual(log["commands"][0]["sha256"], hashlib.sha256(raw).hexdigest())

    async def test_feed_catalog_uses_normal_strict_ssl_npm_and_saves_exact_commands(self):
        metadata = microsoft_catalog()
        outputs = [
            json.dumps({key: metadata[key] for key in ("time", "dist-tags")}),
            json.dumps(list(metadata["versions"].values())),
        ]
        with tempfile.TemporaryDirectory() as temporary:
            runner = AsyncMock(side_effect=[(0, output, "") for output in outputs])
            store = TargetStore(Path(temporary), runner, registry=MICROSOFT_REGISTRY)
            with patch("issue_review_reproduction.shutil.which", return_value="trusted-npm"):
                result = await store.catalog()
            self.assertEqual(result.model_dump(by_alias=True), metadata)
            for call in runner.await_args_list:
                command = call.args[0]
                self.assertIn("--strict-ssl=true", command)
                self.assertIn("--ignore-scripts", command)
                self.assertIn("--registry=https://packagefeedproxy.microsoft.io/npm", command)
            self.assertIn("pyright@1", runner.await_args_list[1].args[0])
            log = json.loads(next(Path(temporary).glob("catalog-*.json")).read_text())
            self.assertEqual([item["stdout"] for item in log["commands"]], outputs)

    async def test_invalid_feed_catalog_is_blocked_with_raw_output_retained(self):
        for versions in ({}, [{"version": "1.1.2"}, {"version": "1.1.2"}]):
            with self.subTest(versions=versions), tempfile.TemporaryDirectory() as temporary:
                runner = AsyncMock(side_effect=[(0, '{"time":{},"dist-tags":{}}', ""), (0, json.dumps(versions), "")])
                store = TargetStore(Path(temporary), runner, registry=MICROSOFT_REGISTRY)
                with patch("issue_review_reproduction.shutil.which", return_value="trusted-npm"):
                    with self.assertRaises(ValueError):
                        await store.catalog()
                log = json.loads(next(Path(temporary).glob("catalog-*.json")).read_text())
                self.assertEqual(log["commands"][-1]["stdout"], json.dumps(versions))
                self.assertTrue(log["error"])

    async def test_feed_acquisition_verifies_published_checksum_and_records_separate_sha512(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz") as stream:
            for name in ("package/index.js", "package/dist/pyright.js"):
                source = b"// trusted fixture"
                member = tarfile.TarInfo(name)
                member.size = len(source)
                stream.addfile(member, io.BytesIO(source))
        content = archive.getvalue()
        metadata = microsoft_catalog()
        metadata["versions"]["1.1.2"]["dist"]["shasum"] = hashlib.sha1(content).hexdigest()
        report = issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"})
        target = select_targets(metadata, report, scenario(), "", "a" * 40, registry=MICROSOFT_REGISTRY)[0]
        with tempfile.TemporaryDirectory() as temporary:
            async def runner(command, cwd):
                if "pack" in command:
                    (cwd / "pyright-1.1.2.tgz").write_bytes(content)
                    return 0, '[{"name":"pyright","version":"1.1.2","filename":"pyright-1.1.2.tgz"}]', ""
                return 0, "pyright 1.1.2\n", ""
            execute = AsyncMock(side_effect=runner)
            store = TargetStore(Path(temporary), execute, registry=MICROSOFT_REGISTRY)
            with patch("issue_review_reproduction.shutil.which", return_value="trusted-npm"):
                await store.prepare(target)
                restored = target.model_copy(update={"artifact_sha512": None, "status": "selected"})
                await store.prepare(restored)
            expected = "sha512-" + base64.b64encode(hashlib.sha512(content).digest()).decode()
            self.assertEqual(target.artifact_sha512, expected)
            self.assertEqual(restored.artifact_sha512, expected)
            self.assertEqual(execute.await_count, 2)
            pack = execute.await_args_list[0].args[0]
            self.assertIn("--ignore-scripts", pack)
            self.assertIn("--strict-ssl=true", pack)
            log = json.loads(next(Path(temporary).glob("*/preparation-*.json")).read_text())
            self.assertEqual(log["acquisitions"][0]["expected_integrity"], target.integrity)
            self.assertEqual(log["acquisitions"][0]["artifact_sha512"], expected)
            with self.assertRaisesRegex(ValueError, "registry"):
                await TargetStore(Path(temporary), execute).prepare(target)

    async def test_feed_checksum_mismatch_blocks_before_extraction_or_execution(self):
        report = issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"})
        target = select_targets(microsoft_catalog(), report, scenario(), "", "a" * 40, registry=MICROSOFT_REGISTRY)[0]
        with tempfile.TemporaryDirectory() as temporary:
            async def runner(command, cwd):
                (cwd / "pyright-1.1.2.tgz").write_bytes(b"corrupted package")
                return 0, '[{"name":"pyright","version":"1.1.2","filename":"pyright-1.1.2.tgz"}]', ""
            execute = AsyncMock(side_effect=runner)
            store = TargetStore(Path(temporary), execute, registry=MICROSOFT_REGISTRY)
            with patch("issue_review_reproduction.shutil.which", return_value="trusted-npm"):
                with self.assertRaisesRegex(ValueError, "failed integrity verification"):
                    await store.prepare(target)
            self.assertEqual(execute.await_count, 1)
            self.assertIsNone(target.cli)
            self.assertFalse(list(Path(temporary).glob("*/target.json")))
            self.assertFalse(list(Path(temporary).glob("*/runtime-*")))
            log = json.loads(next(Path(temporary).glob("*/preparation-*.json")).read_text())
            self.assertEqual(log["acquisitions"][0]["expected_integrity"], target.integrity)
            self.assertNotEqual(log["acquisitions"][0]["integrity"], target.integrity)
            self.assertIn("failed integrity verification", log["error"])

    async def test_feed_pack_identity_and_filename_must_match_before_reading_archive(self):
        report = issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"})
        for field, value in (
            ("name", "other-package"), ("version", "1.1.3"), ("filename", "..\\pyright-1.1.2.tgz"),
        ):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                target = select_targets(microsoft_catalog(), report, scenario(), "", "a" * 40, registry=MICROSOFT_REGISTRY)[0]
                package = {"name": "pyright", "version": "1.1.2", "filename": "pyright-1.1.2.tgz", field: value}
                execute = AsyncMock(return_value=(0, json.dumps([package]), ""))
                store = TargetStore(Path(temporary), execute, registry=MICROSOFT_REGISTRY)
                with patch("issue_review_reproduction.shutil.which", return_value="trusted-npm"):
                    with self.assertRaisesRegex(ValueError, "exact selected Pyright package"):
                        await store.prepare(target)
                self.assertEqual(execute.await_count, 1)
                self.assertIsNone(target.cli)
                self.assertFalse(list(Path(temporary).glob("*/target.json")))
                self.assertFalse(list(Path(temporary).glob("*/runtime-*")))

    async def test_official_acquisition_does_not_accept_sha1_fallback(self):
        metadata = catalog()
        report = issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"})
        target = select_targets(metadata, report, scenario(), "", "a" * 40)[0]
        target.integrity = "sha1-" + base64.b64encode(hashlib.sha1(b"fixture").digest()).decode()
        with tempfile.TemporaryDirectory() as temporary, patch("issue_review_reproduction.download", return_value=b"fixture"):
            runner = AsyncMock()
            with self.assertRaisesRegex(ValueError, "does not permit"):
                await TargetStore(Path(temporary), runner).prepare(target)
            runner.assert_not_awaited()


class TransportTests(unittest.TestCase):
    def wire_scenario(self, probe: ReproductionScenario | None = None) -> dict:
        raw = json.loads((probe or scenario_with_controls()).model_dump_json())
        for name in ("files", "control_files", "configuration"):
            raw[name] = [
                {"key": key, "value": json.dumps(value, allow_nan=False) if name == "configuration" else value}
                for key, value in raw[name].items()
            ]
        return raw

    def test_exploratory_wire_preserves_disclosures_and_strict_semantic_validation(self):
        probe = exploratory_scenario()
        wire = self.wire_scenario(probe)
        decoded = ExploratoryReproductionScenario.model_validate_json(
            reproduction_response(ExploratoryReproductionScenario, json.dumps(wire))
        )
        self.assertEqual(decoded, probe)
        self.assertEqual(decoded.files, scenario_with_controls().files)
        self.assertEqual(decoded.control_files, scenario_with_controls().control_files)
        with self.assertRaises(ValueError):
            reproduction_response(ReproductionScenario, json.dumps(wire))
        for name in ("files", "control_files", "configuration"):
            repeated = self.wire_scenario(probe)
            repeated[name].append(repeated[name][0])
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                reproduction_response(ExploratoryReproductionScenario, json.dumps(repeated))
        for invalid in ("NaN", "1e999", '{"nested":{"value":1,"value":2}}', "not JSON"):
            malformed = self.wire_scenario(probe)
            malformed["configuration"][0]["value"] = invalid
            with self.assertRaises(ValueError):
                reproduction_response(ExploratoryReproductionScenario, json.dumps(malformed))
        wire["claims"][0]["precision"][0]["present"] = False
        with self.assertRaisesRegex(ValueError, "affirmative"):
            reproduction_response(ExploratoryReproductionScenario, json.dumps(wire))

    def test_assumptions_are_bounded_complete_unique_and_match_exact_configuration(self):
        valid = exploratory_scenario().model_dump()
        for setting, value in (("pythonVersion", "3.16"), ("typeCheckingMode", "off"), ("pythonPlatform", "Linux")):
            with self.subTest(setting=setting, value=value):
                raw = json.loads(json.dumps(valid))
                raw["configuration"][setting] = value
                raw["configuration_assumptions"][0] = {"setting": setting, "value": value, "reason": "Chosen"}
                with self.assertRaises(ValueError):
                    ExploratoryReproductionScenario.model_validate(raw)
        for disclosures in (
            valid["configuration_assumptions"] * 2,
            valid["configuration_assumptions"][:1],
            [*valid["configuration_assumptions"][:1], {"setting": "pythonVersion", "value": "3.11", "reason": "Changed"}],
        ):
            with self.subTest(disclosures=disclosures), self.assertRaises(ValueError):
                ExploratoryReproductionScenario.model_validate({**valid, "configuration_assumptions": disclosures})
        with self.assertRaises(ValueError):
            ExploratoryReproductionScenario.model_validate({
                **valid, "reported_configuration": [{"setting": "pythonVersion", "value": "3.10", "report_quote": "Python 3.10"}],
            })

    def test_reported_settings_need_verbatim_quotes_and_cannot_be_overwritten_or_called_assumptions(self):
        probe = exploratory_scenario()
        probe.configuration_assumptions = [item for item in probe.configuration_assumptions if item.setting != "pythonVersion"]
        probe = ExploratoryReproductionScenario.model_validate({
            **probe.model_dump(),
            "reported_configuration": [{"setting": "pythonVersion", "value": "3.10", "report_quote": "Python 3.10"}],
        })
        validate_exploratory_settings(probe, "Python 3.10; checking mode omitted")
        with self.assertRaisesRegex(ValueError, "exact report quotes"):
            validate_exploratory_settings(probe, "Python 3.11")
        for report in (
            '{"pythonVersion":"3.11"} Python 3.10', "?pythonVersion=3.11 Python 3.10",
            "Python 3.10; typeCheckingMode=standard", "Python 3.11; Python 3.10",
            "pyright --pythonversion 3.11 sample.py; Python 3.10",
        ):
            with self.subTest(report=report), self.assertRaises(ValueError):
                validate_exploratory_settings(probe, report)

    def test_run_mode_is_default_strict_and_cannot_upgrade_or_downgrade_saved_runs(self):
        with patch("sys.argv", ["review_issues.py"]):
            self.assertFalse(arguments().exploratory_reproduction)
        with patch("sys.argv", ["review_issues.py", "--exploratory-reproduction"]):
            self.assertTrue(arguments().exploratory_reproduction)
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            path = state / "run.json"
            for record in ({}, {"exploratory_reproduction": False}, {"exploratory_reproduction": True}):
                path.write_text(json.dumps(record), encoding="utf-8")
                unchanged = path.read_bytes()
                mode = record.get("exploratory_reproduction", False)
                require_run_mode(state, mode)
                with self.assertRaisesRegex(AutomationError, "mode changed"):
                    require_run_mode(state, not mode)
                self.assertEqual(path.read_bytes(), unchanged)

    def test_scenario_round_trip_preserves_original_controls_configuration_and_json_types(self):
        probe = scenario_with_controls()
        probe.files["sample.py"] += '\t# "quoted" \\ unicode \u03c0\r\n'
        probe.configuration["json-types"] = {
            "text": '"\\\u03c0', "true": True, "false": False, "null": None,
            "int": 2, "float": 2.0, "negative_zero": -0.0, "array": [1, {"nested": []}],
        }
        decoded = ReproductionScenario.model_validate_json(
            reproduction_response(ReproductionScenario, json.dumps(self.wire_scenario(probe)))
        )
        self.assertEqual(decoded, probe)
        values = decoded.configuration["json-types"]
        assert isinstance(values, dict)
        self.assertIs(type(values["true"]), bool)
        self.assertIs(type(values["int"]), int)
        self.assertIs(type(values["float"]), float)
        self.assertEqual(json.dumps(values["negative_zero"]), "-0.0")
        self.assertNotEqual(decoded.files, decoded.control_files)

    def test_gate_round_trip_retains_exact_claims_and_receipt_digests(self):
        wire = {
            "approved": True, "problems": [], "claim_ids": ["assignment"],
            "receipt_hashes": [{"key": "original:main", "value": "a" * 64}],
        }
        decoded = ReproductionGate.model_validate_json(reproduction_response(ReproductionGate, json.dumps(wire)))
        self.assertEqual(decoded.receipt_hashes, {"original:main": "a" * 64})
        self.assertEqual(decoded.claim_ids, ["assignment"])
        self.assertTrue(decoded.approved)

    def test_duplicate_entries_in_every_map_are_rejected_without_overwriting(self):
        for name in ("files", "control_files", "configuration"):
            with self.subTest(map=name):
                wire = self.wire_scenario()
                wire[name].append(wire[name][0] | {"value": "different"})
                with self.assertRaisesRegex(ValueError, "Duplicate response map key"):
                    reproduction_response(ReproductionScenario, json.dumps(wire))
        with self.assertRaisesRegex(ValueError, "Duplicate response map key"):
            reproduction_response(ReproductionGate, json.dumps({
                "approved": True, "problems": [], "claim_ids": ["assignment"],
                "receipt_hashes": [{"key": "main", "value": "a"}, {"key": "main", "value": "b"}],
            }))

    def test_invalid_nonfinite_and_duplicate_configuration_json_are_rejected(self):
        for value in (
            "not JSON", "", '{"incomplete":', "NaN", "Infinity", "-Infinity", "1e999",
            '{"nested":[NaN]}', '{"nested":{"key":1,"key":2}}',
        ):
            with self.subTest(value=value):
                wire = self.wire_scenario()
                wire["configuration"][0]["value"] = value
                with self.assertRaises(ValueError):
                    reproduction_response(ReproductionScenario, json.dumps(wire))

    def test_duplicate_outer_json_and_wrong_wire_types_are_rejected(self):
        raw = json.dumps(self.wire_scenario())
        with self.assertRaisesRegex(ValueError, "Duplicate response map key"):
            reproduction_response(ReproductionScenario, raw.replace('"summary":', '"summary":"first","summary":', 1))
        for name, value in (("files", {"sample.py": "value = 1\n"}), ("configuration", [{"key": "x", "value": True}])):
            with self.subTest(field=name):
                wire = self.wire_scenario()
                wire[name] = value
                with self.assertRaises(ValueError):
                    reproduction_response(ReproductionScenario, json.dumps(wire))
        for raw in (
            '{"approved":NaN,"problems":[],"claim_ids":[],"receipt_hashes":[]}',
            '{"approved":true,"problems":[],"claim_ids":[],"receipt_hashes":[{"key":"main","value":42}]}',
            '{"approved":true,"problems":[],"claim_ids":[],"receipt_hashes":{}}',
        ):
            with self.subTest(gate=raw), self.assertRaises(ValueError):
                reproduction_response(ReproductionGate, raw)

    def test_decoding_preserves_semantic_scenario_and_gate_validation(self):
        wire = self.wire_scenario()
        wire["reported_version"] = "1.1.408"
        with self.assertRaisesRegex(ValueError, "exact report quote"):
            reproduction_response(ReproductionScenario, json.dumps(wire))
        wire = self.wire_scenario()
        wire["claims"][0]["precision"][0]["present"] = False
        with self.assertRaisesRegex(ValueError, "affirmative"):
            reproduction_response(ReproductionScenario, json.dumps(wire))
        with self.assertRaises(ValueError):
            reproduction_response(ReproductionGate, json.dumps({
                "approved": True, "problems": ["Unaccounted claim"], "claim_ids": ["assignment"],
                "receipt_hashes": [],
            }))


class OutcomeTests(unittest.TestCase):
    def test_reported_context_is_optional_but_its_message_and_rule_must_match_exactly(self):
        probe = missing_diagnostic_scenario()
        data = probe.model_dump()
        data["claims"][0]["context_diagnostics"] = [{
            "file": "sample.py", "line": 1, "severity": "error", "message": "Existing reported context",
            "rule": None, "present": True,
        }]
        probe = ReproductionScenario.model_validate(data)
        with tempfile.TemporaryDirectory() as temporary:
            cwd = Path(temporary)
            original = {**record(cwd, broken=False, separate_controls=True), "scenario_hash": "frozen"}
            control = {**record(cwd, broken=False, separate_controls=True, phase="control"), "scenario_hash": "frozen"}
            self.assertEqual(
                classify(probe, original, control, allow_rule_location_predicates=True), "reproduced",
            )
            base = json.loads(original["stdout"])
            for changes, expected in (({}, "reproduced"), ({"rule": "reportOther"}, "blocked"), ({"message": "New error"}, "blocked")):
                with self.subTest(changes=changes):
                    parsed = {
                        **base, "generalDiagnostics": [*base["generalDiagnostics"], {
                            "file": str(cwd / "sample.py"), "range": {"start": {"line": 0}},
                            "severity": "error", "message": "Existing reported context", **changes,
                        }],
                    }
                    original["stdout"] = json.dumps(parsed)
                    self.assertEqual(
                        classify(probe, original, control, allow_rule_location_predicates=True), expected,
                    )

    def test_rule_location_missing_diagnostic_requires_explicit_opt_in_and_fresh_precision(self):
        probe = missing_diagnostic_scenario()
        with tempfile.TemporaryDirectory() as temporary:
            cwd = Path(temporary)
            original = record(cwd, broken=False, separate_controls=True)
            control = record(cwd, broken=False, separate_controls=True, phase="control")
            original["scenario_hash"] = control["scenario_hash"] = "frozen"
            self.assertEqual(classify(probe, original, control), "blocked")
            self.assertEqual(classify(probe, original, allow_rule_location_predicates=True), "blocked")
            self.assertEqual(
                classify(probe, original, control, allow_rule_location_predicates=True), "reproduced",
            )
            original = {**record(cwd, broken=True, separate_controls=True), "scenario_hash": "frozen"}
            parsed = json.loads(original["stdout"])
            parsed["generalDiagnostics"][0]["message"] = "Different wording for the same frozen rule and location"
            original["stdout"] = json.dumps(parsed)
            self.assertEqual(
                classify(probe, original, control, allow_rule_location_predicates=True), "not_reproduced",
            )

    def test_rule_location_matching_never_accepts_an_unrelated_error_or_imprecise_control(self):
        probe = missing_diagnostic_scenario()
        with tempfile.TemporaryDirectory() as temporary:
            cwd = Path(temporary)
            control = {**record(cwd, broken=False, separate_controls=True, phase="control"), "scenario_hash": "frozen"}
            for mutation in ({"rule": "reportUnknownVariableType"}, {"severity": "warning"}, {"file": str(cwd / "other.py")}):
                with self.subTest(mutation=mutation):
                    original = {**record(cwd, broken=True, separate_controls=True), "scenario_hash": "frozen"}
                    parsed = json.loads(original["stdout"])
                    parsed["generalDiagnostics"][0].update(mutation)
                    original["stdout"] = json.dumps(parsed)
                    self.assertEqual(
                        classify(probe, original, control, allow_rule_location_predicates=True), "blocked",
                    )
            original = {**record(cwd, broken=False, separate_controls=True), "scenario_hash": "frozen"}
            parsed = json.loads(control["stdout"])
            parsed["generalDiagnostics"][0]["message"] = 'Type of "value" is "Unknown"'
            control["stdout"] = json.dumps(parsed)
            self.assertEqual(
                classify(probe, original, control, allow_rule_location_predicates=True), "blocked",
            )

    def test_actual_unrecognized_configuration_stderr_blocks_even_with_exact_positive_control(self):
        with tempfile.TemporaryDirectory() as temporary:
            probe = scenario()
            probe.configuration["reportTotallyNonexistentDiagnostic"] = True
            self.assertIn("reportTotallyNonexistentDiagnostic", scenario_inputs(probe)["pyrightconfig.json"])
            result = record(Path(temporary), broken=False)
            result["stderr"] = 'Config contains unrecognized setting "reportTotallyNonexistentDiagnostic".\n'
            problems = []
            self.assertEqual(observe_claims(probe, result, problems), {"assignment": "blocked"})
            self.assertEqual(classify(probe, result), "blocked")
            self.assertIn(result["stderr"], problems[0])
            self.assertEqual(result["exit_code"], 0)
            self.assertEqual(json.loads(result["stdout"])["summary"]["filesAnalyzed"], 1)

    def test_other_non_json_setup_diagnostics_and_missing_stderr_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            for stderr in (
                'Config "reportAssignmentType" entry must be true, false, "error", "warning", "information" or "none".\n',
                "Configuration file could not be parsed.\n",
                "Python version 3.99 is not supported\n",
                "The venvPath is not a valid directory.\n",
                "Unrecognized checker setup warning\n",
                None,
            ):
                result = record(Path(temporary), broken=False)
                result["stderr"] = stderr
                self.assertEqual(classify(scenario(), result), "blocked", stderr)
            result = record(Path(temporary), broken=False)
            result["stdout"] = "Configuration could not be loaded\n" + result["stdout"]
            self.assertEqual(classify(scenario(), result), "blocked")

    def test_original_and_control_observations_cannot_replace_each_other(self):
        with tempfile.TemporaryDirectory() as temporary:
            probe, cwd = scenario_with_controls(), Path(temporary)
            original = record(cwd, broken=True, separate_controls=True)
            control = record(cwd, broken=False, phase="control", separate_controls=True)
            self.assertEqual(observe_claims(probe, original), {"assignment": "reproduced"})
            self.assertEqual(observe_claims(probe, control), {"assignment": "verified"})
            self.assertEqual(classify(probe, control), "blocked")
            self.assertEqual(classify(probe, original), "blocked")
            self.assertEqual(classify(probe, original, control), "reproduced")
            original = record(cwd, broken=False, separate_controls=True)
            self.assertEqual(classify(probe, original, control), "not_reproduced")
            for mutation in ("stderr", "version", "precision"):
                changed = json.loads(json.dumps(control))
                if mutation == "stderr":
                    changed["stderr"] = "Ignored configuration\n"
                elif mutation == "version":
                    changed["target"]["version"] = "1.1.9"
                else:
                    output = json.loads(changed["stdout"])
                    output["generalDiagnostics"][0]["message"] = 'Type of "value" is "Any"'
                    changed["stdout"] = json.dumps(output)
                self.assertEqual(classify(probe, original, changed), "blocked", mutation)

    def test_separate_controls_freeze_the_same_configuration_and_cannot_supply_original_symptom_locations(self):
        probe = scenario_with_controls()
        original = scenario_inputs(probe)
        controls = scenario_inputs(probe, phase="control")
        self.assertNotIn("reveal_type", original["sample.py"])
        self.assertIn("reveal_type", controls["sample.py"])
        self.assertEqual(original["pyrightconfig.json"], controls["pyrightconfig.json"])
        probe.claims[0].broken[0].line = 3
        with self.assertRaisesRegex(ValueError, "original source location"):
            scenario_inputs(probe)
        probe = scenario_with_controls()
        probe.control_files["extra.py"] = "pass\n"
        with self.assertRaisesRegex(ValueError, "source-file set"):
            scenario_inputs(probe)
        with self.assertRaisesRegex(ValueError, "No separate"):
            scenario_inputs(scenario(), phase="control")

    def test_each_material_claim_can_be_resolved_or_reproduced_without_omission(self):
        with tempfile.TemporaryDirectory() as temporary:
            probe = scenario()
            second = probe.claims[0].model_copy(deep=True)
            second.id = "second"
            second.broken[0].message = "Second reported rejection"
            second.resolved[-1].message = "Second reported rejection"
            probe.claims.append(second)
            self.assertEqual(classify(probe, record(Path(temporary), broken=True)), "reproduced")
            self.assertEqual(classify(probe, record(Path(temporary), broken=False)), "not_reproduced")

    def test_exact_symptom_and_affirmative_precision_are_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            cwd = Path(temporary)
            self.assertEqual(classify(scenario(), record(cwd, broken=True)), "reproduced")
            self.assertEqual(classify(scenario(), record(cwd, broken=False)), "not_reproduced")
            for mutation in ("zero_files", "Any", "Unknown", "missing_import", "wrong_message", "other_error", "version"):
                result = record(cwd, broken=False)
                output = json.loads(result["stdout"])
                if mutation == "zero_files":
                    output["summary"]["filesAnalyzed"] = 0
                elif mutation in {"Any", "Unknown"}:
                    output["generalDiagnostics"][0]["message"] = f'Type of "value" is "{mutation}"'
                elif mutation == "wrong_message":
                    output["generalDiagnostics"][0]["message"] = "An unrelated successful type"
                elif mutation == "version":
                    output["version"] = "9.9.9"
                else:
                    other = dict(output["generalDiagnostics"][0])
                    other["severity"], other["message"] = "error", "Unexpected error"
                    other["rule"] = "reportMissingImports" if mutation == "missing_import" else "reportCallIssue"
                    output["generalDiagnostics"].append(other)
                result["stdout"] = json.dumps(output)
                self.assertEqual(classify(scenario(), result), "blocked", mutation)
            for code in (2, -1):
                self.assertEqual(classify(scenario(), {**record(cwd, broken=False), "exit_code": code}), "blocked")
            self.assertEqual(classify(scenario(), {"error": "unavailable"}), "blocked")

    def test_mixed_unsupported_or_missing_prerequisite_does_not_become_negative(self):
        for surface in ("editor", "lsp", "other"):
            probe = scenario()
            second = probe.claims[0].model_copy(deep=True)
            second.id, second.surface = "navigation", surface
            probe.claims.append(second)
            with self.assertRaisesRegex(ValueError, "unsupported"):
                scenario_inputs(probe)
        probe = scenario()
        probe.prerequisites = ["Exact third-party stubs unavailable"]
        with self.assertRaisesRegex(ValueError, "prerequisites"):
            scenario_inputs(probe)

    def test_scope_and_path_escape_and_absence_only_fix_are_rejected(self):
        for name in ("../escape.py", "C:/escape.py", "..\\escape.py", "/escape.py", "NUL.py"):
            probe = scenario()
            probe.files = {name: "pass"}
            with self.assertRaises(ValueError):
                scenario_inputs(probe)
        for setting in ("exclude", "extraPaths", "venvPath", "pythonPath", "include"):
            probe = scenario()
            probe.configuration[setting] = []
            with self.assertRaises(ValueError):
                scenario_inputs(probe)
        value = scenario().model_dump()
        value["claims"][0]["resolved"] = [{**value["claims"][0]["broken"][0], "present": False}]
        ReproductionScenario.model_validate(value)
        value["claims"][0]["precision"] = []
        with self.assertRaises(ValueError):
            ReproductionScenario.model_validate(value)
        value = scenario().model_dump()
        value["claims"][0]["broken"][0]["present"] = False
        value["claims"][0]["resolved"] = [value["claims"][0]["broken"][0]]
        with self.assertRaisesRegex(ValueError, "without adding type queries"):
            ReproductionScenario.model_validate(value)

    def test_windows_relative_paths_are_supported_without_case_or_separator_aliases(self):
        probe = scenario()
        probe.files = {"pkg\\sample.py": probe.files["sample.py"]}
        for claim in probe.claims:
            for symptom in [*claim.broken, *claim.resolved, *claim.precision]:
                symptom.file = "pkg\\sample.py"
        self.assertIn("pkg\\sample.py", scenario_inputs(probe))
        probe.files["pkg/sample.py"] = probe.files["pkg\\sample.py"]
        with self.assertRaisesRegex(ValueError, "alias"):
            scenario_inputs(probe)


class FakeTargets(TargetStore):
    def __init__(self, directory: Path, outcomes: dict[str, str]):
        super().__init__(directory, self.execute)
        self.outcomes = outcomes
        self.executions = 0
        self.separate_controls = False
        self.control_outcomes: dict[str, str] = {}
        self.stderr: dict[str, str] = {}
        self.phases: list[tuple[str, str]] = []

    async def prepare(self, target):
        runtime = self.directory / target.role
        runtime.mkdir(parents=True, exist_ok=True)
        cli = runtime / "index.js"
        cli.write_text("// trusted fake target\n", encoding="utf-8")
        target.directory, target.cli, target.tree_hash, target.status = str(runtime), str(cli), tree_hash(runtime), "ready"
        target.artifact_sha512 = "sha512-" + base64.b64encode(hashlib.sha512(cli.read_bytes()).digest()).decode()
        if target.role == "main":
            target.version = "1.1.3"

    async def execute(self, command, cwd):
        self.executions += 1
        role = Path(command[1]).parent.name
        phase = "control" if self.separate_controls and "reveal_type" in (cwd / "sample.py").read_text() else "original"
        self.phases.append((phase, role))
        if self.outcomes.get(role) == "blocked":
            raise ValueError("Required target dependency is unavailable")
        version = "1.1.2" if role == "historical" else "1.1.3"
        outcome = self.control_outcomes.get(role, self.outcomes.get(role)) if phase == "control" else self.outcomes.get(role)
        result = record(
            cwd, broken=outcome == "reproduced", version=version, phase=phase, separate_controls=self.separate_controls,
        )
        result["stderr"] = self.stderr.get(role, "")
        return result["exit_code"], result["stdout"], result["stderr"]


class ReproductionGitHub(FakeGitHub):
    def __init__(self):
        super().__init__()
        self.current.created_at = "2025-02-15T00:00:00Z"
        self.repository_labels = {"bug", "fixed in next version (main)"}
        self.calls: list[tuple[str, JsonValue]] = []
        self.lose_response: str | None = None

    async def collection(self, endpoint) -> list[JsonValue]:
        return [{"name": name} for name in sorted(self.repository_labels)]

    async def api(self, method, endpoint, payload=None, *, pages=False):
        operation = (
            "create_label" if endpoint == "repos/microsoft/pyright/labels"
            else endpoint.rsplit("/", 1)[-1] if method == "POST" else "close"
        )
        self.mutations.append(operation)
        self.calls.append((operation, payload))
        if self.fail == operation:
            raise AutomationError(f"Simulated {operation} failure")
        assert isinstance(payload, dict)
        if operation == "create_label":
            name = payload["name"]
            assert isinstance(name, str)
            self.repository_labels.add(name)
        elif operation == "labels":
            names = payload["labels"]
            assert isinstance(names, list)
            for name in names:
                assert isinstance(name, str)
                if name not in {label.name for label in self.current.labels}:
                    self.current.labels.append(Label(name=name))
            self.touch()
        elif operation == "close":
            assert payload["state"] == "closed" and payload["state_reason"] == "completed"
            self.current.state, self.current.state_reason = "closed", "completed"
            self.touch()
        elif operation == "comments":
            self.discussion.append({
                "id": 7, "html_url": "https://github.com/microsoft/pyright/issues/123#issuecomment-7",
                "body": payload["body"], "user": {"login": "reviewer"},
            })
            self.current.comments += 1
            if self.change_after_comment:
                self.current.body = "A material correction"
            self.touch()
        else:
            raise AssertionError(operation)
        if self.lose_response == operation:
            self.lose_response = None
            raise AutomationError("Response lost after successful mutation")
        return {}


class WorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.github = ReproductionGitHub()
        self.targets = FakeTargets(Path(self.temporary.name) / "targets", {
            "historical": "reproduced", "main": "not_reproduced", "latest": "reproduced",
        })
        reviewer = Agent.load(AGENTS / "pyright-issue-by-design-reviewer.md", "pyright-issue-by-design-reviewer")
        duplicate = Agent.load(AGENTS / "pyright-issue-dupe-investigator.md", "pyright-issue-dupe-investigator")
        writer = Agent(reviewer.path, "rich-mirror", "Writer", "Keep the evidence")
        self.sdk = AsyncMock()
        self.planned_scenario = scenario()
        self.sdk.run.side_effect = self.respond
        self.console = Console(
            self.github, self.sdk, Path(self.temporary.name), reviewer, duplicate, writer,
            "context", "f" * 40, None, reproduction_store=self.targets,
        )
        self.console._reproduction_catalog, self.console._reproduction_main = ReleaseCatalog.model_validate(catalog()), "a" * 40
        self.entry = Entry(
            input_hash=self.console.key(self.github.current), context_hash="context", issue=self.github.current.model_copy(deep=True),
        )

    async def respond(self, agent, prompt, directory, **options):
        schema = options.get("schema")
        if schema in (ReproductionScenario, ExploratoryReproductionScenario):
            return self.planned_scenario.model_dump_json()
        if schema is ReproductionGate:
            tools = options["tools"]
            raw = ReproductionGate(
                approved=True, problems=[], claim_ids=["assignment"],
                receipt_hashes={identifier: digest(evidence_json(receipt)) for identifier, receipt in tools.receipts.items()},
            ).model_dump_json()
            options["validate"](raw)
            return raw
        if schema is DraftCheck:
            return DraftCheck(approved=True, problems=[]).model_dump_json()
        if agent.name == "rich-mirror":
            return "This reproduces historically but is fixed on main and awaiting release."
        raise AssertionError(agent.name)

    async def ready(self):
        await self.console.reproduce(self.entry)
        assert self.entry.reproduction_stage is not None
        self.assertEqual(self.entry.reproduction_stage.status, "complete", self.entry.reproduction_stage.error)
        return self.entry.reproduction_stage

    def enable_exploration(self):
        previous = self.console
        self.console = Console(
            self.github, self.sdk, previous.state, previous.reviewer, previous.duplicate, previous.writer,
            "context", "f" * 40, None, reproduction_store=self.targets, exploratory_reproduction=True,
        )
        self.console._reproduction_catalog, self.console._reproduction_main = ReleaseCatalog.model_validate(catalog()), "a" * 40
        self.entry = Entry(input_hash=self.console.key(self.github.current), context_hash="context", issue=self.github.current.model_copy(deep=True))
        self.planned_scenario = exploratory_scenario()
        self.targets.separate_controls = True

    async def test_exploratory_executes_production_probe_path_but_never_authorizes_actions(self):
        self.enable_exploration()
        with patch.object(self.targets, "probe", wraps=self.targets.probe) as probe:
            stage = await self.ready()
            self.assertEqual(probe.await_count, 6)
        self.assertEqual([phase for phase, _ in self.targets.phases], ["original"] * 3 + ["control"] * 3)
        self.assertEqual(stage.outcomes["historical"], "reproduced")
        self.assertEqual(stage.outcomes["main"], "not_reproduced")
        self.assertTrue(stage.gate and stage.gate.approved)  # Adversarial approved-looking unit fixture, not live evidence.
        self.assertIsNone(stage.action())
        self.assertEqual(stage.proposed_labels, [])
        self.assertEqual(self.planned_scenario.files, scenario_with_controls().files)
        records = self.console.reproduction_records(stage)
        self.assertTrue(all(record["policy_hash"] == stage.policy_hash for record in records))
        metadata = self.console.reproduction_gate_records(stage)[0]
        self.assertEqual(metadata["controller_policy"], {"exploratory": True, "hash": stage.policy_hash})
        self.assertIn("OBSERVATION-ONLY", self.sdk.run.await_args_list[0].args[1])
        self.assertEqual(self.github.mutations, [])

    async def test_observation_only_blocks_all_drafting_publication_and_legacy_fallbacks(self):
        self.enable_exploration()
        await self.ready()
        self.entry.review = audit()
        save_evidence(self.console, self.entry)
        self.sdk.reset_mock()
        for reason in ("fixed", "not_reproducible", "by_design", "duplicate"):
            self.entry.closure = Closure(
                marker="unit", body="Unit pending publication", expected_issue=self.entry.issue,
                discussion_hash="unit", reason=reason, duplicate_of=456 if reason == "duplicate" else None,
            )
            self.console.save(self.entry)
            self.assertFalse(unfinished_reproduction_publication(self.entry))
            self.assertIsNone(self.entry.closure_reason())
            proposal = dry_run_proposal(ChunkResult(self.entry.issue, self.entry), rca_enabled=True)
            self.assertEqual(proposal["proposed_action"], "blocked")
            self.assertEqual(proposal["proposed_labels"], [])
            self.assertFalse(proposal["validated_reproduction"])
            self.assertIsNone(proposal["proposed_state_reason"])
            self.assertIsNone(proposal["release_wording"])
            with self.assertRaisesRegex(AutomationError, "observation-only"):
                await self.console.review(self.entry.issue, retry_failed=True)
            for name in ("close", "publish_reproduction", "prepare_comment", "prepare_reproduction_comment",
                         "prepare_root_cause_comment", "post_root_cause", "investigate_root_cause"):
                with self.subTest(reason=reason, method=name), self.assertRaisesRegex(AutomationError, "observation-only"):
                    await getattr(self.console, name)(self.entry)
            for name in ("require_reproduction_evidence", "require_closure_evidence", "require_report_evidence", "require_rca_evidence"):
                with self.subTest(method=name), self.assertRaisesRegex(AutomationError, "observation-only"):
                    getattr(self.console, name)(self.entry)
        await self.console.investigate_duplicates(self.entry)
        await self.console.adjudicate(self.entry)
        await self.console.ensure_root_cause(self.entry)
        await self.console.evaluate(self.entry)
        await self.console.decide(self.entry)
        self.sdk.run.assert_not_awaited()
        self.assertEqual(self.github.mutations, [])

    async def test_exploratory_review_stops_at_reproduction_without_behavior_or_rca(self):
        self.enable_exploration()
        entry = await self.console.review(self.entry.issue, retry_failed=False)
        self.assertEqual(self.sdk.run.await_count, 2)
        self.assertIsNone(entry.review)
        self.assertIsNone(entry.root_cause)
        await self.console.evaluate(entry)
        await self.console.decide(entry)
        self.assertEqual(self.sdk.run.await_count, 2)
        self.assertEqual(entry.decision, "reviewed")
        self.assertEqual(self.github.mutations, [])

    async def test_reconstruction_feedback_checks_quotes_without_rewriting_missing_prerequisites(self):
        self.enable_exploration()
        quote = "First quoted passage."
        self.github.current.body = quote + "\n\nIntervening source and version blocks.\n\nSecond quoted passage."
        self.entry.issue = self.github.current.model_copy(deep=True)
        self.entry.input_hash = self.console.key(self.entry.issue)
        self.planned_scenario.claims[0].report_quote = quote
        await self.ready()
        validate = self.sdk.run.await_args_list[0].kwargs["validate"]
        changed = self.planned_scenario.model_copy(deep=True)
        changed.claims[0].report_quote = quote + "\nSecond quoted passage."
        with self.assertRaisesRegex(AutomationError, "exact contiguous span"):
            validate(changed.model_dump_json())
        changed.claims[0].report_quote = quote
        changed.prerequisites = ["A genuine missing dependency"]
        validate(changed.model_dump_json())
        self.assertEqual(changed.prerequisites, ["A genuine missing dependency"])
        with self.assertRaisesRegex(ValueError, "Unmet report prerequisites"):
            scenario_inputs(changed)

    async def test_saved_freeform_prerequisites_are_never_deleted_or_reinterpreted(self):
        self.enable_exploration()
        self.planned_scenario.prerequisites = ["Missing reporter dependency", "Execute originals before controls"]
        unchanged = list(self.planned_scenario.prerequisites)
        await self.console.reproduce(self.entry)
        stage = self.entry.reproduction_stage
        assert stage is not None and stage.scenario is not None
        self.assertEqual(stage.status, "blocked")
        self.assertEqual(stage.scenario.prerequisites, unchanged)
        self.assertEqual(self.targets.executions, 0)
        self.assertEqual(self.sdk.run.await_count, 1)
        self.assertIn("Missing reporter dependency", stage.error or "")

    async def test_empty_assumption_list_cannot_make_an_exploratory_stage_actionable(self):
        self.enable_exploration()
        self.github.current.body = (self.github.current.body or "") + "\npythonVersion=3.10; typeCheckingMode=standard"
        self.entry.issue = self.github.current.model_copy(deep=True)
        self.entry.input_hash = self.console.key(self.entry.issue)
        self.planned_scenario = ExploratoryReproductionScenario.model_validate({
            **scenario_with_controls().model_dump(), "configuration_assumptions": [],
            "reported_configuration": [
                {"setting": key, "value": value, "report_quote": f"{key}={value}"}
                for key, value in scenario().configuration.items()
            ],
        })
        stage = await self.ready()
        self.assertIsNone(stage.action())
        self.assertTrue(stage.observation_only())

    async def test_mode_changes_fail_before_retry_or_cached_publication_and_preserve_identity(self):
        self.enable_exploration()
        stage = await self.ready()
        with self.assertRaises(ValueError):
            stage.exploratory = False
        restored = self.console.load(self.entry.issue.number)
        assert restored is not None and restored.reproduction_stage is not None
        self.assertIsInstance(restored.reproduction_stage.scenario, ExploratoryReproductionScenario)
        lowered = restored.reproduction_stage.model_copy(update={"exploratory": False})
        self.assertIsNone(lowered.action())
        self.console.exploratory_reproduction = False
        self.sdk.reset_mock()
        for retry in (True, False):
            with self.assertRaisesRegex(AutomationError, "mode changed"):
                await self.console.reproduce(restored, retry_blocked=retry)
            with self.assertRaisesRegex(AutomationError, "mode changed"):
                await self.console.review(restored.issue, retry_failed=retry)
        self.sdk.run.assert_not_awaited()
        self.assertEqual(self.github.mutations, [])

    async def test_strict_checkpoint_cannot_be_upgraded_by_enabling_exploration(self):
        self.console.exploratory_reproduction = True
        with self.assertRaisesRegex(AutomationError, "fresh snapshot/state"):
            await self.console.reproduce(self.entry)
        self.assertIsNone(self.entry.reproduction_stage)
        self.sdk.run.assert_not_awaited()
        self.console.exploratory_reproduction = False
        stage = await self.ready()
        self.console.exploratory_reproduction = True
        self.sdk.reset_mock()
        with self.assertRaisesRegex(AutomationError, "mode changed"):
            await self.console.reproduce(self.entry, retry_blocked=True)
        self.assertFalse(stage.exploratory)
        self.sdk.run.assert_not_awaited()

    async def test_exploratory_policy_tampering_blocks_resume_and_evaluation(self):
        self.enable_exploration()
        stage = await self.ready()
        self.sdk.reset_mock()
        path = Path(stage.directory) / "policy.json"
        policy = path.read_bytes()
        for content in (b"{}", policy.replace(b'"exploratory": true', b'"exploratory": false, "exploratory": true'), None):
            if content is None:
                path.unlink()
            else:
                path.write_bytes(content)
            with self.assertRaisesRegex(AutomationError, "policy"):
                await self.console.reproduce(self.entry)
            with self.assertRaisesRegex(AutomationError, "policy"):
                await self.console.evaluate(self.entry)
            path.write_bytes(policy)
        self.sdk.run.assert_not_awaited()

    async def test_changed_exploratory_value_or_rationale_invalidates_saved_evidence(self):
        self.enable_exploration()
        stage = await self.ready()
        self.sdk.reset_mock()
        for change_value in (False, True):
            raw = self.planned_scenario.model_dump()
            assumption = next(item for item in raw["configuration_assumptions"] if item["setting"] == "pythonVersion")
            if change_value:
                raw["configuration"]["pythonVersion"] = assumption["value"] = "3.11"
            else:
                assumption["reason"] = "A changed explanation"
            stage.scenario = ExploratoryReproductionScenario.model_validate(raw)
            with self.assertRaisesRegex(AutomationError, "evidence changed"):
                await self.console.reproduce(self.entry)
        self.sdk.run.assert_not_awaited()

    async def test_strict_receipt_policy_cannot_be_overridden_by_an_approved_looking_gate(self):
        stage = await self.ready()
        records = self.console.reproduction_records(stage)
        records[0]["policy_hash"] = "changed"
        (Path(stage.directory) / "receipts.jsonl").write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")
        assert stage.gate is not None
        stage.gate.receipt_hashes = {
            str(record["id"]): digest(evidence_json(record)) for record in self.console.reproduction_gate_records(stage)
        }
        stage.evidence_hash = self.console.reproduction_hash(stage)
        with self.assertRaisesRegex(AutomationError, "different controller-owned reproduction policy"):
            self.console.require_reproduction_evidence(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_legacy_strict_checkpoint_projection_and_receipts_remain_compatible(self):
        stage = await self.ready()
        self.assertEqual(self.entry.input_hash, digest("context" + self.entry.issue.model_dump_json()))
        stage.policy_hash = None
        (Path(stage.directory) / "policy.json").unlink()
        records = self.console.reproduction_records(stage)
        for record in records:
            record.pop("policy_hash")
        (Path(stage.directory) / "receipts.jsonl").write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")
        assert stage.gate is not None
        stage.gate.receipt_hashes = {
            str(record["id"]): digest(evidence_json(record)) for record in self.console.reproduction_gate_records(stage)
        }
        stage.evidence_hash = self.console.reproduction_hash(stage)
        raw = json.loads(self.entry.model_dump_json())
        raw["reproduction_stage"].pop("exploratory")
        raw["reproduction_stage"].pop("policy_hash")
        restored = Entry.model_validate(raw)
        self.sdk.reset_mock()
        await self.console.reproduce(restored)
        self.console.require_reproduction_evidence(restored)
        self.sdk.run.assert_not_awaited()
        self.assertEqual(stage.action(), "fixed")
        self.assertNotIn("controller_policy", self.console.reproduction_gate_records(stage)[0])

    async def test_all_result_combinations_require_two_affirmative_checks(self):
        for historical in ("reproduced", "not_reproduced", "blocked"):
            for main in ("reproduced", "not_reproduced", "blocked"):
                with self.subTest(historical=historical, main=main):
                    self.targets.outcomes.update(historical=historical, main=main)
                    self.entry.reproduction_stage = None
                    stage = await self.ready()
                    expected = (
                        "fixed" if historical == "reproduced" and main == "not_reproduced"
                        else "not_reproducible" if historical == main == "not_reproduced" else None
                    )
                    self.assertEqual(stage.action(), expected)
                    self.assertIn("main", stage.outcomes)
                    self.assertEqual(len(stage.receipt_ids), 3)
        self.assertEqual(self.github.mutations, [])

    async def test_added_reveal_masks_original_main_bug_but_cannot_label_or_close(self):
        self.planned_scenario = scenario_with_controls()
        self.targets.separate_controls = True
        self.targets.control_outcomes = {role: "not_reproduced" for role in ("historical", "main", "latest")}
        for historical in ("reproduced", "not_reproduced"):
            self.entry.reproduction_stage = None
            self.targets.outcomes.update(historical=historical, main="reproduced")
            self.targets.phases = []
            stage = await self.ready()
            self.assertEqual(stage.outcomes["main"], "reproduced")
            self.assertIsNone(stage.action())
            self.assertEqual(stage.proposed_labels, [])
            self.assertEqual([phase for phase, _ in self.targets.phases], ["original"] * 3 + ["control"] * 3)
            receipts = self.console.reproduction_records(stage)
            self.assertEqual(len(receipts), 6)
            for receipt in receipts:
                inputs = receipt["inputs"]
                assert isinstance(inputs, dict)
                self.assertEqual("reveal_type" in str(inputs["sample.py"]), receipt["phase"] == "control")
            with self.assertRaisesRegex(AutomationError, "evidence"):
                await self.console.publish_reproduction(self.entry)
            self.assertEqual(self.github.mutations, [])

    async def test_config_warning_prevents_false_label_and_false_fixed_closure(self):
        self.planned_scenario.configuration["reportTotallyNonexistentDiagnostic"] = True
        self.targets.stderr["main"] = 'Config contains unrecognized setting "reportTotallyNonexistentDiagnostic".\n'
        for historical in ("reproduced", "not_reproduced"):
            self.entry.reproduction_stage = None
            self.targets.outcomes["historical"] = historical
            stage = await self.ready()
            self.assertIsNone(stage.action())
            self.assertEqual(stage.outcomes["main"], "blocked")
            receipt = self.console.reproduction_records(stage)[1]
            reasons = receipt["blocking_reasons"]
            assert isinstance(reasons, list)
            self.assertIn(self.targets.stderr["main"], "\n".join(str(reason) for reason in reasons))
            self.assertEqual(receipt["stderr"], self.targets.stderr["main"])
            with self.assertRaises(AutomationError):
                await self.console.publish_reproduction(self.entry)
            self.assertEqual(self.github.mutations, [])

    async def test_separate_controls_resume_without_reexecution_and_remain_required_for_publication(self):
        self.planned_scenario = scenario_with_controls()
        self.targets.separate_controls = True
        stage = await self.ready()
        self.assertEqual(stage.action(), "fixed")
        self.console.require_reproduction_evidence(self.entry)
        stage.status, stage.gate, stage.evidence_hash = "running", None, None
        await self.console.reproduce(self.entry)
        self.assertEqual(self.targets.executions, 6)
        self.assertEqual(len(stage.receipt_ids), 6)
        records = self.console.reproduction_records(stage)
        control = next(
            record for record in records if record.get("phase") == "control"
            and isinstance(target := record.get("target"), dict) and target.get("role") == "main"
        )
        control["stderr"] = 'Config contains unrecognized setting "reportTotallyNonexistentDiagnostic".\n'
        (Path(stage.directory) / "receipts.jsonl").write_text(
            "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8",
        )
        assert stage.gate is not None
        stage.gate.receipt_hashes = {
            str(record["id"]): digest(evidence_json(record)) for record in self.console.reproduction_gate_records(stage)
        }
        stage.evidence_hash = self.console.reproduction_hash(stage)
        with self.assertRaisesRegex(AutomationError, "observations"):
            self.console.require_reproduction_evidence(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_resume_after_originals_runs_only_separate_controls(self):
        self.planned_scenario = scenario_with_controls()
        self.targets.separate_controls = True
        stage = await self.ready()
        original_receipts = self.console.reproduction_records(stage)[:3]
        original_ids = [receipt["id"] for receipt in original_receipts]
        (Path(stage.directory) / "receipts.jsonl").write_text(
            "".join(json.dumps(record) + "\n" for record in original_receipts), encoding="utf-8",
        )
        stage.status, stage.gate, stage.evidence_hash = "running", None, None
        stage.receipt_ids = [str(identifier) for identifier in original_ids]
        stage.outcomes = self.console.reproduction_outcomes(stage)
        self.assertTrue(all(outcome == "blocked" for outcome in stage.outcomes.values()))
        self.targets.phases = []
        await self.console.reproduce(self.entry)
        self.assertEqual([phase for phase, _ in self.targets.phases], ["control"] * 3)
        self.assertEqual([receipt["id"] for receipt in self.console.reproduction_records(stage)[:3]], original_ids)
        self.assertEqual(stage.action(), "fixed")
        self.console.require_reproduction_evidence(self.entry)

    async def test_separate_controls_allow_only_original_based_fixed_or_open_label(self):
        self.planned_scenario = scenario_with_controls()
        self.targets.separate_controls = True
        for historical in ("reproduced", "not_reproduced"):
            self.github = ReproductionGitHub()
            self.console.github = self.github
            self.entry = Entry(
                input_hash=self.console.key(self.github.current), context_hash="context",
                issue=self.github.current.model_copy(deep=True),
            )
            self.targets.outcomes["historical"] = historical
            await self.ready()
            await self.console.evaluate(self.entry)
            await self.console.decide(self.entry)
            if historical == "reproduced":
                self.assertEqual(self.github.current.state_reason, "completed")
                self.assertEqual(self.github.mutations, ["comments", "labels", "close"])
            else:
                self.assertEqual(self.github.current.state, "open")
                self.assertEqual(self.github.mutations, ["create_label", "labels"])

    async def test_fixed_short_circuits_behavior_duplicates_and_rca_and_closes_completed(self):
        with patch.object(self.console, "investigate_duplicates", AsyncMock()) as duplicates:
            entry = await self.console.review(self.github.current, retry_failed=False)
        self.entry = entry
        duplicates.assert_not_awaited()
        self.assertIsNone(entry.review)
        self.assertEqual(self.targets.executions, 3)
        with patch.object(self.console, "ensure_root_cause", AsyncMock()) as rca:
            await self.console.evaluate(entry)
        rca.assert_not_awaited()
        await self.console.decide(entry)
        self.assertEqual(self.github.current.state_reason, "completed")
        self.assertEqual(self.github.mutations, ["comments", "labels", "close"])
        self.assertIn("bug", {label.name for label in self.github.current.labels})
        assert entry.closure is not None
        self.assertEqual(entry.closure.status, "closed")

    async def test_never_reproduced_labels_without_drafting_or_closing(self):
        self.targets.outcomes["historical"] = "not_reproduced"
        stage = await self.ready()
        self.assertEqual(stage.proposed_labels, ["not reproducible"])
        await self.console.evaluate(self.entry)
        await self.console.decide(self.entry)
        self.assertEqual(self.github.mutations, ["create_label", "labels"])
        self.assertEqual(self.github.current.state, "open")
        assert self.entry.closure is not None
        self.assertEqual(self.entry.closure.status, "labeled")
        self.assertFalse(any(call.args[0].name == "rich-mirror" for call in self.sdk.run.call_args_list))

    async def test_unavailable_latest_metadata_does_not_block_verified_main_fix(self):
        metadata = catalog()
        metadata["dist-tags"] = {}
        self.console._reproduction_catalog = ReleaseCatalog.model_validate(metadata)
        stage = await self.ready()
        self.assertEqual(stage.action(), "fixed")
        self.assertEqual(stage.outcomes["latest"], "blocked")
        self.assertIn("unverified", release_wording(stage.targets, stage.outcomes))
        await self.console.evaluate(self.entry)
        await self.console.decide(self.entry)
        self.assertEqual(self.github.current.state_reason, "completed")
        self.assertNotIn("labels", self.github.mutations)

    async def test_main_reproduction_continues_existing_behavior_investigation(self):
        self.targets.outcomes["main"] = "reproduced"
        with self.assertRaisesRegex(AssertionError, "pyright-issue-by-design-reviewer"):
            await self.console.review(self.github.current, retry_failed=False)
        entry = self.console.load(123)
        assert entry is not None and entry.reproduction_stage is not None
        self.assertIsNone(entry.reproduction_stage.action())
        self.assertEqual(entry.reproduction_stage.outcomes["main"], "reproduced")
        self.assertEqual(self.github.mutations, [])

    async def test_multiline_quoted_comment_evidence_preserves_explicit_version_and_claim(self):
        body = 'Pyright version\n1.1.2\nA "quoted" reproducer.\nSecond line.'
        self.github.discussion = [{"id": 8, "body": body}]
        self.github.current.comments = 1
        self.entry.issue = self.github.current.model_copy(deep=True)
        self.entry.input_hash = self.console.key(self.entry.issue)
        probe = scenario()
        probe.reported_version, probe.version_quote = "1.1.2", "Pyright version\n1.1.2"
        probe.claims[0].report_quote = 'A "quoted" reproducer.\nSecond line.'
        async def respond(agent, prompt, directory, **options):
            if options.get("schema") is ReproductionScenario:
                return probe.model_dump_json()
            return await self.respond(agent, prompt, directory, **options)
        self.sdk.run.side_effect = respond
        stage = await self.ready()
        self.assertEqual(stage.action(), "fixed")
        self.assertFalse(stage.targets[0].approximate)

    async def test_execution_failures_retain_attempted_command_and_frozen_inputs(self):
        self.targets.outcomes["main"] = "blocked"
        stage = await self.ready()
        receipt = next(
            item for item in self.console.reproduction_records(stage)
            if isinstance(target := item.get("target"), dict) and target.get("role") == "main"
        )
        self.assertEqual(receipt["outcome"], "blocked")
        self.assertIn("--outputjson", str(receipt["command"]))
        self.assertEqual(receipt["inputs"], scenario_inputs(scenario()))
        self.assertIn("dependency", str(receipt["error"]))

    async def test_interrupted_reproduction_resumes_exact_saved_receipts_not_new_main(self):
        stage = await self.ready()
        original_main = stage.targets[1].identity
        stage.status, stage.gate, stage.evidence_hash = "running", None, None
        stage.receipt_ids, stage.outcomes = [], {}
        self.entry.decision = "failed"
        self.console.save(self.entry)
        self.console._reproduction_main = "b" * 40
        self.sdk.run.reset_mock()
        resumed = await self.console.review(self.github.current, retry_failed=True)
        assert resumed.reproduction_stage is not None
        self.assertEqual(resumed.reproduction_stage.action(), "fixed")
        self.assertEqual(resumed.reproduction_stage.targets[1].identity, original_main)
        self.assertEqual(self.targets.executions, 3)
        self.assertEqual(len(resumed.reproduction_stage.receipt_ids), 3)
        self.assertEqual(self.sdk.run.await_count, 1)

    async def test_gate_missing_claim_or_receipt_hash_cannot_approve_action(self):
        stage = await self.ready()
        assert stage.gate is not None
        original = stage.gate.model_copy(deep=True)
        stage.gate.claim_ids = []
        with self.assertRaises(AutomationError):
            self.console.validate_reproduction_gate(stage, stage.gate)
        stage.gate = original
        stage.gate.receipt_hashes = {}
        with self.assertRaises(AutomationError):
            self.console.validate_reproduction_gate(stage, stage.gate)

    async def test_decoded_gate_still_requires_exact_material_claims_and_receipt_evidence(self):
        stage = await self.ready()
        assert stage.gate is not None
        for changed in ({}, {"forged-receipt": "f" * 64}):
            raw = {
                **stage.gate.model_dump(),
                "receipt_hashes": [{"key": key, "value": value} for key, value in changed.items()],
            }
            decoded = ReproductionGate.model_validate_json(reproduction_response(ReproductionGate, json.dumps(raw)))
            with self.assertRaises(AutomationError):
                self.console.validate_reproduction_gate(stage, decoded)

    async def test_dry_run_proposes_exact_actions_without_drafting_or_any_mutation(self):
        for historical, action in (("reproduced", "close_fixed"), ("not_reproduced", "label_not_reproducible")):
            self.entry.reproduction_stage = None
            self.targets.outcomes["historical"] = historical
            self.console.read_only = True
            await self.ready()
            self.sdk.run.reset_mock()
            await self.console.evaluate(self.entry)
            await self.console.decide(self.entry)
            proposal = dry_run_proposal(ChunkResult(self.entry.issue, self.entry), rca_enabled=True)
            self.assertEqual(proposal["proposed_action"], action)
            self.assertEqual(proposal["proposed_state_reason"], "completed" if action == "close_fixed" else None)
            self.assertFalse(proposal["publication_ready"])
            self.assertTrue(proposal["proposed_labels"])
            self.sdk.run.assert_not_awaited()
            for operation in (self.console.prepare_comment, self.console.prepare_reproduction_comment, self.console.publish_reproduction):
                with self.assertRaisesRegex(AutomationError, "read-only"):
                    await operation(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_cached_comparison_and_saved_reads_do_not_execute_again(self):
        stage = await self.ready()
        await self.console.reproduce(self.entry)
        self.assertEqual(self.targets.executions, 3)
        tools = ReproductionEvidenceTools(self.github, Path(stage.directory), self.console.reproduction_records(stage))
        response = await tools.read_receipt(ToolInvocation(
            session_id="test", tool_call_id="read", tool_name="rca_read_evidence",
            arguments={"evidence_id": stage.receipt_ids[0], "pointer": "/stdout", "offset": 0, "max_chars": 100},
        ))
        self.assertIn("next_offset", response.text_result_for_llm)
        self.assertEqual(self.targets.executions, 3)

    async def test_oversized_gate_requires_complete_exact_fields_not_index_or_partial_pages(self):
        with tempfile.TemporaryDirectory() as temporary:
            receipt: dict[str, JsonValue] = {
                "id": "large", "kind": "reproduction", "stdout": "x" * 30000,
                "stderr": "", "inputs": {"sample.py": "value = 1\n"},
            }
            tools = ReproductionEvidenceTools(self.github, Path(temporary), [receipt])
            with self.assertRaisesRegex(AutomationError, "not completely delivered"):
                tools.require_delivery()
            for field in ("inputs", "stdout", "stderr"):
                offset = 0
                while True:
                    response = await tools.read_receipt(ToolInvocation(
                        session_id="test", tool_call_id="read", tool_name="rca_read_evidence",
                        arguments={"evidence_id": "large", "pointer": "/" + field, "offset": offset, "max_chars": 4096},
                    ))
                    page = json.loads(response.text_result_for_llm)
                    if page["next_offset"] is None:
                        break
                    offset = page["next_offset"]
            tools.require_delivery()
            self.assertEqual(self.targets.executions, 0)
            self.assertEqual(receipt["stdout"], "x" * 30000)

    async def test_screening_failure_cannot_be_reinterpreted_as_non_reproduction_or_mutate(self):
        with patch.object(self.github, "screen", AsyncMock(side_effect=ScreeningBlocked("Target blocked"))):
            with self.assertRaises(ScreeningBlocked):
                await self.console.reproduce(self.entry)
        self.assertIsNone(self.entry.reproduction_stage)
        await self.ready()
        await self.console.evaluate(self.entry)
        with patch.object(self.github, "screen", AsyncMock(side_effect=ScreeningBlocked("Target changed"))):
            with self.assertRaises(ScreeningBlocked):
                await self.console.publish_reproduction(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_changed_issue_discussion_targets_inputs_or_implementation_block_publication(self):
        await self.ready()
        await self.console.evaluate(self.entry)
        for changed in ("issue", "discussion", "target", "input", "implementation", "receipt", "comment"):
            with self.subTest(changed=changed):
                old_issue = self.github.current.model_copy(deep=True)
                old_discussion = list(self.github.discussion)
                old_context = self.console.current_context
                stage = self.entry.reproduction_stage
                assert stage is not None
                target = stage.targets[0]
                path = None
                old_bytes = None
                if changed == "issue":
                    self.github.current.body = "Edited issue"
                elif changed == "discussion":
                    self.github.discussion.append({"id": 8, "body": "new evidence"})
                    self.github.current.comments += 1
                elif changed == "implementation":
                    self.console.current_context = lambda: "changed"
                elif changed == "comment":
                    assert self.entry.comment is not None
                    self.entry.comment += " Unsupported edit"
                else:
                    if changed == "target":
                        assert target.cli is not None
                        path = Path(target.cli)
                    elif changed == "input":
                        path = Path(str(self.console.reproduction_records(stage)[0]["cwd"])) / "sample.py"
                    else:
                        path = Path(stage.directory) / "receipts.jsonl"
                    old_bytes = path.read_bytes()
                    path.write_bytes(old_bytes + b" ")
                with self.assertRaises((AutomationError, ValueError)):
                    await self.console.publish_reproduction(self.entry)
                self.assertEqual(self.github.mutations, [])
                self.github.current, self.github.discussion = old_issue, old_discussion
                self.console.current_context = old_context
                if path is not None:
                    assert old_bytes is not None
                    path.write_bytes(old_bytes)
                if changed == "comment":
                    assert self.entry.comment is not None
                    self.entry.comment = self.entry.comment.removesuffix(" Unsupported edit")

    async def test_each_partial_or_ambiguous_publication_resumes_without_duplicate(self):
        for failure in ("comments", "labels", "close"):
            for ambiguous in (False, True):
                with self.subTest(failure=failure, ambiguous=ambiguous):
                    self.github = ReproductionGitHub()
                    self.console.github = self.github
                    self.entry = Entry(input_hash=self.console.key(self.github.current), context_hash="context", issue=self.github.current.model_copy(deep=True))
                    await self.ready()
                    await self.console.evaluate(self.entry)
                    if ambiguous:
                        self.github.lose_response = failure
                    else:
                        self.github.fail = failure
                    with self.assertRaises(AutomationError):
                        await self.console.publish_reproduction(self.entry)
                    self.github.fail = None
                    restored = self.console.load(123)
                    assert restored is not None
                    await self.console.publish_reproduction(restored)
                    self.assertEqual(len(self.github.discussion), 1)
                    self.assertEqual(self.github.current.state_reason, "completed")
                    self.assertEqual(self.github.mutations.count("comments"), 1 if ambiguous or failure != "comments" else 2)

    async def test_label_creation_and_addition_retries_keep_issue_open(self):
        self.targets.outcomes["historical"] = "not_reproduced"
        for failure in ("create_label", "labels"):
            for ambiguous in (False, True):
                self.github = ReproductionGitHub()
                self.console.github = self.github
                self.entry = Entry(input_hash=self.console.key(self.github.current), context_hash="context", issue=self.github.current.model_copy(deep=True))
                await self.ready()
                if ambiguous:
                    self.github.lose_response = failure
                else:
                    self.github.fail = failure
                with self.assertRaises(AutomationError):
                    await self.console.publish_reproduction(self.entry)
                self.github.fail = None
                await self.console.publish_reproduction(self.entry)
                self.assertEqual(self.github.current.state, "open")
                self.assertNotIn("comments", self.github.mutations)
                self.assertNotIn("close", self.github.mutations)
                self.assertIn("not reproducible", {label.name for label in self.github.current.labels})

    async def test_console_reconciles_lost_close_response_even_when_backlog_lists_only_open_issues(self):
        await self.ready()
        await self.console.evaluate(self.entry)
        self.github.lose_response = "close"
        with self.assertRaises(AutomationError):
            await self.console.publish_reproduction(self.entry)
        self.assertEqual(self.github.current.state, "closed")
        original_api = self.github.api
        async def api(method, endpoint, payload=None, *, pages=False):
            if method == "GET":
                return {"tag_name": "test", "sha": "a" * 40}
            return await original_api(method, endpoint, payload, pages=pages)
        writer = Path(self.temporary.name) / "writer.md"
        writer.write_text("---\nname: rich-mirror\n---\nTest writer.\n", encoding="utf-8")
        args = Namespace(
            state_dir=self.console.state, cli_path="copilot", writer_agent=writer,
            read_only=False, model="test", issues=None, chunk_size=5, timeout=30, retry_failed=False,
            no_rca=True,
        )
        with (
            patch("review_issues.GitHub", return_value=self.github),
            patch.object(self.github, "api", AsyncMock(side_effect=api)),
            patch.object(self.github, "open_issues", AsyncMock(return_value=[])),
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test", ""))),
            patch("review_issues.context_hash", return_value="context"),
            patch("review_issues.git", return_value="f" * 40),
            patch("review_issues.CopilotClient"),
            patch("review_issues.Console", return_value=self.console),
        ):
            await review_main(args)
        self.assertEqual(self.github.mutations, ["comments", "labels", "close"])
        restored = self.console.load(123)
        assert restored is not None and restored.closure is not None
        self.assertEqual(restored.closure.status, "closed")

    async def test_reporter_change_after_fixed_comment_stops_closure(self):
        await self.ready()
        await self.console.evaluate(self.entry)
        self.github.change_after_comment = True
        with self.assertRaises(AutomationError):
            await self.console.publish_reproduction(self.entry)
        self.assertEqual(self.github.mutations, ["comments"])

    async def test_missing_or_negative_gate_never_qualifies(self):
        stage = await self.ready()
        stage.gate = None
        self.assertIsNone(stage.action())
        stage.gate = ReproductionGate(approved=False, problems=["A material claim was omitted"], claim_ids=["assignment"], receipt_hashes={})
        self.assertIsNone(stage.action())
        with self.assertRaises(AutomationError):
            self.console.require_reproduction_evidence(self.entry)


class ArtifactTests(unittest.IsolatedAsyncioTestCase):
    async def test_main_build_uses_pinned_upstream_and_isolated_script_free_dependency_install(self):
        with tempfile.TemporaryDirectory() as temporary:
            calls = []
            async def runner(command, cwd):
                calls.append((command, cwd))
                if "rev-parse" in command:
                    return 0, "a" * 40, ""
                if command[0] == "node":
                    return 0, "pyright 1.1.3\n", ""
                if "webpack" in command:
                    dist = cwd / "packages" / "pyright" / "dist"
                    dist.mkdir(parents=True)
                    (dist / "pyright.js").write_text("// trusted upstream bundle", encoding="utf-8")
                    (dist.parent / "index.js").write_text(
                        "global.__rootDirectory = __dirname + '/dist/';\nrequire('./dist/pyright');\n", encoding="utf-8",
                    )
                    stdlib = dist / "typeshed-fallback" / "stdlib"
                    stdlib.mkdir(parents=True)
                    (stdlib / "builtins.pyi").write_text("class int: ...\n", encoding="utf-8")
                return 0, "", ""
            target = select_targets(catalog(), issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"}), scenario(), "", "a" * 40)[1]
            legacy = Path(temporary) / fingerprint({
                "identity": target.identity, "integrity": target.integrity, "source": target.source,
                "registry": target.registry,
            })
            legacy.mkdir()
            old_manifest = legacy / "target.json"
            old_manifest.write_text(target.model_dump_json(), encoding="utf-8")
            previous_manifest = old_manifest.read_bytes()
            store = TargetStore(Path(temporary), runner)
            with patch("issue_review_reproduction.shutil.which", return_value="trusted-pnpm"):
                await store.prepare(target)
            store.verify(target)
            install = next(command for command, _ in calls if "install" in command)
            self.assertIn("--ignore-scripts", install)
            self.assertIn("--frozen-lockfile", install)
            self.assertIn("--registry=https://registry.npmjs.org", install)
            fetch = next(command for command, _ in calls if "fetch" in command)
            self.assertEqual(fetch[-2:], [UPSTREAM, "a" * 40])
            self.assertIn("core.longpaths=true", fetch)
            self.assertIn("core.hooksPath=NUL", fetch)
            work = next(cwd for command, cwd in calls if "fetch" in command)
            self.assertFalse(work.is_relative_to(Path(temporary)))
            self.assertEqual(work.parent, Path(tempfile.gettempdir()).resolve())
            self.assertTrue(work.name.startswith("pyr-"))
            self.assertTrue(all(
                cwd == work for command, cwd in calls if "install" in command or "webpack" in command
            ))
            self.assertEqual(target.version, "1.1.3")
            self.assertFalse(work.exists())
            self.assertTrue(Path(target.directory or "").is_dir())
            runtime = Path(target.directory or "")
            self.assertEqual(Path(target.cli or ""), runtime / "index.js")
            self.assertEqual((runtime / "index.js").read_text(), "global.__rootDirectory = __dirname + '/dist/';\nrequire('./dist/pyright');\n")
            self.assertEqual((runtime / "dist" / "typeshed-fallback" / "stdlib" / "builtins.pyi").read_text(), "class int: ...\n")
            self.assertEqual(next(command for command, _ in calls if command[0] == "node"), ["node", str(runtime / "index.js"), "--version"])
            self.assertEqual(old_manifest.read_bytes(), previous_manifest)
            self.assertNotEqual(runtime.parent, legacy)

    async def test_resumed_direct_bundle_cannot_pass_integrity_check_with_recomputed_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = select_targets(catalog(), issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"}), scenario(), "", "a" * 40)[1]
            runtime = Path(temporary) / "old-runtime"
            dist = runtime / "dist"
            dist.mkdir(parents=True)
            (dist / "pyright.js").write_text("// exact old bundle", encoding="utf-8")
            (runtime / "index.js").write_text("// authentic package entrypoint", encoding="utf-8")
            target.directory, target.cli = str(runtime), str(dist / "pyright.js")
            target.tree_hash, target.status = tree_hash(runtime), "ready"
            store = TargetStore(Path(temporary), AsyncMock())
            with self.assertRaisesRegex(ValueError, "integrity"):
                store.verify(target)
            target.cli = str(runtime / "index.js")
            store.verify(target)

    async def test_missing_upstream_package_entrypoint_never_marks_main_ready(self):
        with tempfile.TemporaryDirectory() as temporary:
            calls = []
            async def runner(command, cwd):
                calls.append((command, cwd))
                if "rev-parse" in command:
                    return 0, "a" * 40, ""
                if "webpack" in command:
                    dist = cwd / "packages" / "pyright" / "dist"
                    dist.mkdir(parents=True)
                    (dist / "pyright.js").write_text("// bundle without package entrypoint", encoding="utf-8")
                return 0, "", ""
            target = select_targets(catalog(), issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"}), scenario(), "", "a" * 40)[1]
            store = TargetStore(Path(temporary), runner)
            with patch("issue_review_reproduction.shutil.which", return_value="trusted-pnpm"):
                with self.assertRaises(FileNotFoundError):
                    await store.prepare(target)
            self.assertNotEqual(target.status, "ready")
            self.assertFalse(any(command[0] == "node" for command, _ in calls))
            work = next(cwd for command, cwd in calls if "fetch" in command)
            self.assertFalse(work.exists())
            receipt = json.loads(next(
                path for base in Path(temporary).iterdir() for path in base.glob("preparation-*.json")
            ).read_bytes())
            self.assertFalse(receipt["prepared"])
            self.assertFalse(receipt["work_retained"])
            self.assertFalse(receipt["runtime_retained"])
            self.assertFalse((Path(receipt["runtime_directory"]).parent / "target.json").exists())

    async def test_failed_main_install_cleans_only_owned_work_and_runtime_and_preserves_raw_log(self):
        with tempfile.TemporaryDirectory() as temporary:
            preserved = None
            async def runner(command, cwd):
                nonlocal preserved
                if "rev-parse" in command:
                    return 0, "a" * 40, ""
                if "install" in command:
                    source = cwd / "node_modules"
                    for _ in range(3):
                        source /= "long-dependency-" * 4
                    if os.name == "nt":
                        source = Path("\\\\?\\" + str(source))
                    source.mkdir(parents=True)
                    readonly = source / "owned.js"
                    readonly.write_text("partial trusted dependency", encoding="utf-8")
                    readonly.chmod(stat.S_IREAD)
                    preserved = Path(temporary) / "unrelated-existing-cache"
                    preserved.mkdir()
                    (preserved / "keep").write_text("preserve", encoding="utf-8")
                    return 1, "Exact failed dependency output\n", "Exact TLS setup error\n"
                return 0, "", ""
            target = select_targets(
                catalog(), issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"}), scenario(), "", "a" * 40,
            )[1]
            store = TargetStore(Path(temporary), runner)
            with patch("issue_review_reproduction.shutil.which", return_value="trusted-pnpm"):
                with self.assertRaisesRegex(ValueError, "Exact TLS setup error"):
                    await store.prepare(target)
            logs = [log for base in Path(temporary).iterdir() for log in base.glob("preparation-*.json")]
            self.assertEqual(len(logs), 1)
            log = json.loads(logs[0].read_text())
            self.assertFalse(log["prepared"])
            self.assertFalse(log["work_retained"])
            self.assertFalse(log["runtime_retained"])
            self.assertFalse(Path(log["work_directory"]).exists())
            self.assertFalse(Path(log["runtime_directory"]).exists())
            self.assertEqual(log["commands"][-1]["stdout"], "Exact failed dependency output\n")
            self.assertEqual(log["commands"][-1]["stderr"], "Exact TLS setup error\n")
            self.assertIsNotNone(preserved)
            assert preserved is not None
            self.assertEqual((preserved / "keep").read_text(), "preserve")
            self.assertFalse((logs[0].parent / "target.json").exists())

    async def test_release_integrity_no_install_scripts_cache_and_tamper_detection(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w:gz") as archive:
            for name, source in {
                "package/dist/pyright.js": b"// inspected fixture",
                "package/index.js": b"global.__rootDirectory = __dirname + '/dist/';\nrequire('./dist/pyright');\n",
            }.items():
                member = tarfile.TarInfo(name)
                member.size = len(source)
                archive.addfile(member, io.BytesIO(source))
        content = data.getvalue()
        metadata = catalog()
        metadata["versions"]["1.1.2"]["dist"]["integrity"] = "sha512-" + base64.b64encode(hashlib.sha512(content).digest()).decode()
        report = issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"})
        target = select_targets(metadata, report, scenario(), "", "a" * 40)[0]
        with tempfile.TemporaryDirectory() as temporary:
            runner = AsyncMock(return_value=(0, "pyright 1.1.2\n", ""))
            store = TargetStore(Path(temporary), runner)
            with patch("issue_review_reproduction.download", return_value=content) as fetch:
                await store.prepare(target)
                await store.prepare(target)
            fetch.assert_called_once()
            self.assertEqual(runner.await_count, 1)
            assert runner.await_args is not None
            self.assertEqual(runner.await_args.args[0][0], "node")
            assert target.cli is not None
            self.assertEqual(Path(target.cli).name, "index.js")
            self.assertEqual(Path(target.cli).read_bytes(), b"global.__rootDirectory = __dirname + '/dist/';\nrequire('./dist/pyright');\n")
            direct = target.model_copy(update={"cli": str(Path(target.directory or "") / "dist" / "pyright.js")})
            with self.assertRaisesRegex(ValueError, "integrity"):
                store.verify(direct)
            legacy_key = fingerprint({
                "identity": target.identity, "integrity": target.integrity, "source": target.source,
                "registry": target.registry,
            })
            self.assertNotEqual(Path(target.directory or "").parent.name, legacy_key)
            Path(target.cli).write_text("tampered", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "integrity"):
                store.verify(target)

    async def test_bad_integrity_and_archive_links_cannot_prepare_target(self):
        for unsafe in (False, True):
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode="w:gz") as archive:
                member = tarfile.TarInfo("package/dist/pyright.js")
                member.type, member.linkname = tarfile.SYMTYPE, "../../outside"
                archive.addfile(member)
            content = data.getvalue()
            metadata = catalog()
            if unsafe:
                metadata["versions"]["1.1.2"]["dist"]["integrity"] = "sha512-" + base64.b64encode(hashlib.sha512(content).digest()).decode()
            target = select_targets(metadata, issue().model_copy(update={"created_at": "2025-02-15T00:00:00Z"}), scenario(), "", "a" * 40)[0]
            with tempfile.TemporaryDirectory() as temporary, patch("issue_review_reproduction.download", return_value=content):
                store = TargetStore(Path(temporary), AsyncMock())
                with self.assertRaisesRegex(ValueError, "Unsafe|integrity"):
                    await store.prepare(target)
                with self.assertRaisesRegex(ValueError, "Unsafe|integrity"):
                    await store.prepare(target)
                self.assertNotEqual(target.status, "ready")
                self.assertFalse(any(path.is_dir() for path in next(Path(temporary).iterdir()).iterdir()))


if __name__ == "__main__":
    unittest.main()
