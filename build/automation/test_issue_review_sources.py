# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Offline source/setup contracts. All checker/stub/probe artifacts here are fakes."""

import hashlib
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from issue_review_models import ReproductionTarget
from issue_review_reproduction import fingerprint, tree_hash
from issue_review_sources import (
    ArtifactEvidence, EvidenceSpan, FeatureProbeResult, MaterializedSetup, ReportDocument, ReportedSettingSelection, SettingChoice,
    SetupRequirement, SourceAssociation, SourceCapture, capture_sources, check_bundled_stub_capability,
    check_feature_capability, check_runtime_metadata, check_target_capability, inspect_requirements, materialize_setup,
    reported_setting_qualifications, resolve_setup, source_document_settings, verify_capture, verify_materialized_setup, verify_span,
)


SETTINGS = 'pythonVersion: "3.13"\ntypeCheckingMode: "strict"\n'
UNPACK_REPORT_11876 = (
    "**Describe the bug**\n\nPyright doesn't accept PEP 798 style unpack operations in comprehensions.\n\n"
    "**Code or Screenshots**\n\n\n```python\nprint([*range(x) for x in range(5)])\n```\n\n"
    "```sh\npyright --version\npyright 1.1.414\n```\n\n"
    "```sh\npyright --pythonversion 3.15 test.py\n/private/tmp/test.py\n"
    "  /private/tmp/test.py:1:8 - error: Unpack operation not allowed in comprehension\n"
    "1 error, 0 warnings, 0 informations\n```\n\n\n"
)


def fence(content: str, indentation: int = 0, marker: str = "```", language: str = "python", newline: str = "\n") -> str:
    prefix = " " * indentation
    # split on real Markdown line endings, not Unicode line separators in strings.
    import re
    lines = [match.group() for match in re.finditer(r"[^\r\n]*(?:\r\n|\r|\n|$)", content) if match.group()]
    return prefix + marker + language + newline + "".join(prefix + line for line in lines) + prefix + marker + newline


def capture(body: str, comments: tuple[str, ...] = (), report_id: str = "offline-report") -> SourceCapture:
    return capture_sources(report_id, [
        ReportDocument(id="issue", kind="issue_body", provenance="offline:issue", revision="revision-1", text=body),
        *[
            ReportDocument(id=f"comment-{index}", kind="comment", provenance=f"offline:comment:{index}", text=text)
            for index, text in enumerate(comments)
        ],
    ])


def associate(captured: SourceCapture, index: int = 0, path: str = "sample.py") -> SourceAssociation:
    return SourceAssociation(source_id=captured.blocks[index].id, path=path)


def reported_selection(captured: SourceCapture, quote: str, value: str = "3.13") -> ReportedSettingSelection:
    document = next(item for item in captured.documents if quote in item.text)
    start = document.text.index(quote)
    declaration = next(
        item for item in captured.declarations if item.setting == "pythonVersion" and item.value == value
        and item.evidence.document_id == document.id and start <= item.evidence.start < start + len(quote)
    )
    return ReportedSettingSelection(
        setting="pythonVersion", declaration_ids=(declaration.id,),
        context=EvidenceSpan(document_id=document.id, start=start, end=start + len(quote), quote=quote),
        reason="Select the captured original's target, retaining the comparison as unverified context",
    )


def fake_target(directory: Path) -> ReproductionTarget:
    (directory / "index.js").write_text("// Offline inert fake; never executed\n", encoding="utf-8")
    return ReproductionTarget(
        role="main", identity="a" * 40, version="1.1.414", source="offline:fake-pyright",
        selection_reason="Offline fake only", directory=str(directory), cli=str(directory / "index.js"),
        tree_hash=tree_hash(directory), status="ready",
    )


def verify_fake_target(target: ReproductionTarget) -> None:
    if not target.directory or tree_hash(Path(target.directory)) != target.tree_hash:
        raise ValueError("Offline fake tree changed")


class CaptureTests(unittest.TestCase):
    def test_playground_query_settings_have_exact_bounded_provenance_not_greedy_prose_values(self):
        reported = capture(
            "[Example](https://pyright-play.net/?pythonVersion=3%2E13&strict=true"
            "&reportUnusedVariable=warning&enableExperimentalFeatures=true&code=print%281%29)\n"
            + fence("value = 1\n")
        )
        self.assertEqual(
            {item.setting: item.value for item in reported.declarations},
            {"pythonVersion": "3.13", "typeCheckingMode": "strict",
             "reportUnusedVariable": "warning", "enableExperimentalFeatures": True},
        )
        self.assertTrue(all(item.supported for item in reported.declarations))
        self.assertTrue(all(item.declaration_kind == "playground_query" for item in reported.declarations))
        self.assertEqual(reported.declarations[0].evidence.quote, "pythonVersion=3%2E13")
        for item in reported.declarations:
            verify_span(reported, item.evidence)
        setup = materialize_setup(reported, [associate(reported)], [])
        self.assertEqual(setup.blockers, ())
        self.assertEqual(setup.files, {"sample.py": "value = 1\n"})
        verify_capture(reported)

    def test_url_queries_do_not_relax_invalid_literals_conflicts_or_unknown_playground_modes(self):
        for query in (
            "pythonVersion=3.13&pythonVersion=3.14&strict=true",
            "pythonVersion=3.14.1&strict=true",
            "pythonVersion=3.13&strict=false",
            "pythonVersion=3.13&strict=true&include=outside",
        ):
            with self.subTest(query=query):
                reported = capture("https://pyright-play.net/?" + query + "\n" + fence("value = 1\n"))
                self.assertTrue(materialize_setup(reported, [associate(reported)], []).blockers)
        reported = capture(
            'pythonVersion=3.13&not_a_url\ntypeCheckingMode="strict"\n' + fence("value = 1\n")
        )
        self.assertTrue(any(item.value == "3.13&not_a_url" and not item.supported for item in reported.declarations))
        reported = capture(
            "https://pyright-play.net/?pythonVersion=3%ZZ13&strict=true\n" + fence("value = 1\n")
        )
        self.assertTrue(any(item.code == "invalid_configuration" for item in reported.limitations))

    def test_unrelated_urls_and_encoded_source_are_not_setting_declarations(self):
        reported = capture(
            "https://example.test/?pythonVersion=3.15&typeCheckingMode=strict\n"
            "https://pyright-play.net.example.test/?pythonVersion=3.15\n"
            "https://pyright-play.net/?code=pythonVersion%3D3.15%26strict%3Dtrue\n"
            + SETTINGS + fence("value = 1\n")
        )
        self.assertEqual(
            [(item.setting, item.value) for item in reported.declarations],
            [("pythonVersion", "3.13"), ("typeCheckingMode", "strict")],
        )
        uppercase = capture("HTTPS://PYRIGHT-PLAY.NET/?pythonVersion=3.13&strict=true\n")
        self.assertEqual(
            {item.setting: item.value for item in uppercase.declarations},
            {"pythonVersion": "3.13", "typeCheckingMode": "strict"},
        )

    def test_cli_diagnostic_messages_keep_exact_quotes_and_only_remove_renderer_indentation(self):
        from issue_review_sources import reported_diagnostics

        reported = capture(fence(
            '  sample.py:3:5 - error: Cannot use __aenter__\n'
            '    Attribute "__aenter__" is unknown (reportGeneralTypeIssues)\n'
            '  sample.py:4:1 - information: Type of "value" is "Literal[1]"\n'
            "1 error, 0 warnings, 1 information\n", language="text", indentation=2,
        ))
        diagnostics = reported_diagnostics(reported)
        self.assertEqual(len(diagnostics), 2)
        self.assertEqual(
            diagnostics[0].message, 'Cannot use __aenter__\n  Attribute "__aenter__" is unknown',
        )
        self.assertEqual(diagnostics[0].rule, "reportGeneralTypeIssues")
        self.assertIn('    Attribute "__aenter__"', diagnostics[0].evidence.quote)
        self.assertEqual(diagnostics[1].message, 'Type of "value" is "Literal[1]"')
        for item in diagnostics:
            verify_span(reported, item.evidence)
        self.assertEqual(reported.blocks[0].raw_content.count('      Attribute'), 1)
        self.assertEqual(
            reported_diagnostics(capture(fence('text = "  sample.py:3:5 - error: Not output"\n'))), [],
        )

    def test_cli_message_boundaries_do_not_merge_later_positionless_diagnostics_or_commands(self):
        from issue_review_sources import reported_diagnostics

        reported = capture(fence(
            "  sample.py:1:1 - error: First error (reportAssignmentType)\n"
            "  pyright --version\n"
            '  sample.py:2:1 - information: Type of "value" is "int"\n'
            "  sample.py: warning: A separate positionless warning\n"
            "  sample.py:3:1 - error: Another error (reportArgumentType)\n", language="text",
        ))
        self.assertEqual(
            [item.message for item in reported_diagnostics(reported)],
            ["First error", 'Type of "value" is "int"', "Another error"],
        )
        ambiguous = capture(fence(
            "  sample.py:1:1 - error: No rule suffix or unambiguous continuation boundary\n"
            "  pyright --version\n", language="text",
        ))
        self.assertEqual(reported_diagnostics(ambiguous), [])

    def test_structural_spaces_preserve_python_and_multiline_string_whitespace(self):
        code = 'class C:\n    text = """\n        keep these spaces  \n    """\n    def method(self):\n        return self.text\n'
        for indentation in range(4):
            with self.subTest(indentation=indentation):
                body = fence(code, indentation)
                result = capture(body)
                block = result.blocks[0]
                self.assertEqual(block.content, code)
                self.assertEqual(block.raw_content, body[block.content_start:block.content_end])
                self.assertEqual(block.canonical_sha256, hashlib.sha256(code.encode()).hexdigest())
                self.assertEqual(block.raw_sha256, hashlib.sha256(block.raw_content.encode()).hexdigest())
                self.assertEqual((block.opening_line, block.closing_line), (1, 8))
                self.assertFalse(result.limitations)
                verify_capture(result)

    def test_tabs_in_python_survive_but_structural_tabs_are_not_expanded(self):
        code = "if True:\n\tx = 1\n"
        self.assertEqual(capture(fence(code, 2)).blocks[0].content, code)
        result = capture("  ```python\n \tx = 1\n  ```\n")
        self.assertFalse(result.blocks)
        self.assertEqual(result.limitations[0].code, "ambiguous_tabs")

    def test_line_endings_trailing_spaces_blank_lines_and_unicode_are_exact(self):
        for newline in ("\r\n", "\r", "\n"):
            code = f'text = "a\u2028  b"{newline}value = 1  {newline}  {newline}'
            result = capture(fence(code, 2, newline=newline))
            self.assertEqual(result.blocks[0].content, code)
            self.assertNotEqual(result.blocks[0].raw_sha256, result.blocks[0].canonical_sha256)

    def test_longer_backtick_and_tilde_fences_do_not_end_at_literal_short_fences(self):
        code = 'text = """\n```\nstill literal\n"""\n'
        for marker in ("````", "~~~~"):
            self.assertEqual(capture(fence(code, marker=marker)).blocks[0].content, code)

    def test_separate_identified_comments_and_fences_are_never_joined(self):
        result = capture(fence("x = 1\n") + fence("y = 2\n"), (fence("z = 3\n"),))
        self.assertEqual(len(result.blocks), 3)
        self.assertEqual(len({item.id for item in result.blocks}), 3)
        self.assertEqual({item.document_id for item in result.blocks}, {"issue", "comment-0"})
        self.assertEqual({item.content for item in result.blocks}, {"x = 1\n", "y = 2\n", "z = 3\n"})

    def test_every_supplied_block_is_captured_including_output_and_configuration(self):
        result = capture(
            fence("x = 1\n") + fence('Type of "x" is "Literal[1]"\n', language="")
            + fence('{"pythonVersion":"3.13"}\n', language="json"),
        )
        self.assertEqual(len(result.blocks), 3)
        self.assertEqual(result.blocks[2].language_hint, "json")
        with self.assertRaisesRegex(ValueError, "Non-Python"):
            materialize_setup(result, [associate(result, 2)])

    def test_unclosed_short_wrong_annotated_closing_fences_are_explicit(self):
        for closing in ("", "  ``\n", "  ~~~\n", "  ``` trailing\n"):
            result = capture("  ```python\n  x = 1\n" + closing)
            self.assertFalse(result.blocks)
            self.assertEqual(result.limitations[0].code, "unclosed_fence")
        result = capture(fence("x = 1\n", language="python`bad"))
        self.assertEqual(result.limitations[0].code, "invalid_info")

    def test_unsupported_containers_and_indented_code_are_not_successful_fallbacks(self):
        for body in (fence("x = 1\n", 6), "- ```python\n  x = 1\n  ```\n", "> ```python\n> x = 1\n> ```\n"):
            with self.subTest(body=body):
                result = capture(body)
                self.assertFalse(result.blocks)
                self.assertEqual(result.limitations[0].code, "unsupported_container")
        self.assertEqual(capture("    x = 1\n").limitations[0].code, "unsupported_indented_code")
        self.assertFalse(capture("Reported source:\nx = 1\n").blocks)

    def test_list_indented_10900_source_and_filename_evidence(self):
        foo = 'from typing import TypeVar\n\nT = TypeVar("T")\n'
        bar = 'from .foo import *\n\nclass Foo[T]:\n    def __init__(self, val: T):\n        self.val: T = val\n'
        result = capture("* `foo.py`:\n" + fence(foo, 2) + "* `bar.py`:\n" + fence(bar, 2))
        prepared = materialize_setup(result, [associate(result, 0, "foo.py"), associate(result, 1, "bar.py")])
        self.assertEqual(prepared.files, {"foo.py": foo, "bar.py": bar})
        self.assertFalse(prepared.inferred_paths)
        for block in result.blocks:
            self.assertIsNotNone(block.filename_evidence)
            if block.filename_evidence is not None:
                verify_span(result, block.filename_evidence)
        self.assertEqual(result.blocks[0].filename_hint, "foo.py")

    def test_list_indented_11893_source_and_output_remain_distinct(self):
        working = (
            'from typing import reveal_type\n\nMISSING = sentinel("MISSING")\n\n'
            'def f(x: int | MISSING) -> int:\n    if x is MISSING:\n        return 0\n    return x\n\n'
            'reveal_type(MISSING)\nreveal_type(f(MISSING))\n'
        )
        buggy = working.replace('sentinel("MISSING")', 'sentinel("MISSING", repr="<MISSING>")')
        result = capture(
            "- Working code:\n\n" + fence(working, 2) + "\n  Pyright output:\n\n"
            + fence('Type of "MISSING" is "MISSING"\nType of "f(MISSING)" is "int"\n', 2, language="")
            + "\n- Buggy behavior:\n\n" + fence(buggy, 2)
            + fence('Sentinel requires one positional argument  (reportCallIssue)\n', 2, language=""),
        )
        self.assertEqual(len(result.blocks), 4)
        self.assertEqual(result.blocks[0].content, working)
        self.assertEqual(result.blocks[2].content, buggy)
        self.assertFalse(result.limitations)

    def test_source_ids_bind_report_identity_all_document_bytes_and_provenance(self):
        original = capture(fence("x = 1\n"))
        alternatives = [
            capture(fence("x = 1\n"), report_id="different-report"),
            capture(fence("x = 1\n") + "changed prose"),
            capture(fence("x = 1\n"), ("additional clarification",)),
            capture_sources(original.report_id, [
                original.documents[0].model_copy(update={"provenance": "different:origin"}),
            ]),
            capture_sources(original.report_id, [
                original.documents[0].model_copy(update={"revision": "different-revision"}),
            ]),
        ]
        for changed in alternatives:
            self.assertNotEqual(original.blocks[0].id, changed.blocks[0].id)
            with self.assertRaisesRegex(ValueError, "does not belong"):
                materialize_setup(changed, [associate(original)])

    def test_determinism_serialization_and_duplicate_document_rejection(self):
        original = capture(fence("x = 1\n"), (fence("y = 2\n"),))
        self.assertEqual(original, capture_sources(original.report_id, list(reversed(original.documents))))
        verify_capture(SourceCapture.model_validate_json(original.model_dump_json()))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            capture_sources(original.report_id, [original.documents[0], original.documents[0]])
        with self.assertRaises(ValidationError):
            original.report_id = "mutated"

    def test_tampered_content_hash_offset_or_omitted_source_is_rejected(self):
        original = capture(fence("x = 1\n") + fence("y = 2\n"))
        for field, value in (("content", "x = 2\n"), ("raw_sha256", "a" * 64), ("content_start", 999)):
            bad = original.model_copy(update={"blocks": (original.blocks[0].model_copy(update={field: value}), *original.blocks[1:])})
            with self.assertRaisesRegex(ValueError, "capture changed"):
                verify_capture(bad)
        with self.assertRaises(ValueError):
            verify_capture(original.model_copy(update={"blocks": original.blocks[:1]}))
        span = EvidenceSpan(document_id="issue", start=0, end=3, quote="bad")
        with self.assertRaisesRegex(ValueError, "exact captured"):
            verify_span(original, span)
        span = EvidenceSpan(document_id="issue", start=0, end=999, quote=original.documents[0].text)
        with self.assertRaisesRegex(ValueError, "exact captured"):
            verify_span(original, span)

    def test_capture_bounds_fail_without_truncating(self):
        with self.assertRaises(ValidationError):
            ReportDocument(id="issue", kind="issue_body", provenance="offline", text="x" * 262145)
        oversized = capture(fence("x" * 65537 + "\n"))
        self.assertFalse(oversized.blocks)
        self.assertEqual(oversized.limitations[0].code, "oversized_block")
        with self.assertRaisesRegex(ValueError, "bounded source"):
            capture(fence("x = 1\n") * 129)


class DeclarationAndMaterializationTests(unittest.TestCase):
    def test_source_document_profile_preserves_other_version_context_without_assuming_it_is_irrelevant(self):
        for original, comparison in (("3.10", "3.11"), ("3.12", "3.15")):
            with self.subTest(original=original, comparison=comparison):
                result = capture(
                    f"Running the example on Python {original}.\n\ntypeCheckingMode: strict\n\n" + fence("x=1\n"),
                    (f"Separate regression coverage uses Python {comparison}.",),
                )
                selection = source_document_settings(result, result.blocks[0].id)
                prepared = materialize_setup(result, [associate(result)], reported_settings=selection)
                self.assertFalse(prepared.blockers)
                self.assertEqual(prepared.configuration["pythonVersion"], original)
                self.assertCountEqual([item.value for item in prepared.scoped_declarations], [original, comparison])
                self.assertFalse(prepared.assumptions)
                qualifications = "\n".join(reported_setting_qualifications(prepared, result))
                self.assertIn("Separate regression coverage", qualifications)
                self.assertIn("possible correction", qualifications)
                verify_materialized_setup(result, prepared.associations, (), prepared, reported_settings=selection)

    def test_source_in_comment_uses_that_comment_instead_of_always_preferring_issue_body(self):
        result = capture(
            "The original comparison was on Python 3.10.\n\ntypeCheckingMode: strict\n",
            ("Reproducing on Python 3.11.\n\n" + fence("x=1\n"),),
        )
        selection = source_document_settings(result, result.blocks[0].id)
        prepared = materialize_setup(result, [associate(result)], reported_settings=selection)
        self.assertFalse(prepared.blockers)
        self.assertEqual(prepared.configuration["pythonVersion"], "3.11")
        self.assertEqual(selection[0].context.document_id, "comment-0")
        self.assertIn("original comparison", "\n".join(reported_setting_qualifications(prepared, result)))

    def test_source_document_profile_does_not_choose_between_its_own_conflicting_versions(self):
        result = capture(
            "Python 3.10\n\nPython 3.11\n\ntypeCheckingMode: strict\n\n" + fence("x=1\n"),
            ("A separate environment uses Python 3.12.",),
        )
        selection = source_document_settings(result, result.blocks[0].id)
        self.assertFalse(selection)
        prepared = materialize_setup(result, [associate(result)], reported_settings=selection)
        self.assertTrue(any("Conflicting reported pythonVersion" in blocker for blocker in prepared.blockers))

    def test_source_document_profile_cannot_hide_unsupported_versions_or_invent_local_settings(self):
        result = capture(
            "Python 3.10\n\ntypeCheckingMode: strict\n\n" + fence("x=1\n"),
            ("Python 3.future",),
        )
        with self.assertRaisesRegex(ValueError, "cannot bypass unsupported"):
            materialize_setup(
                result, [associate(result)], reported_settings=source_document_settings(result, result.blocks[0].id),
            )
        result = capture(fence("x=1\n"), ("Python 3.11\n\ntypeCheckingMode: strict",))
        self.assertFalse(source_document_settings(result, result.blocks[0].id))
        self.assertEqual(materialize_setup(result, [associate(result)]).configuration["pythonVersion"], "3.11")
        with self.assertRaisesRegex(ValueError, "require captured Python source"):
            source_document_settings(result, "not-a-source")

    def test_reported_playground_values_need_no_assumptions_or_relabeling(self):
        url = "https://pyright-play.net/?pythonVersion=3.15&strict=true"
        result = capture(f"[Working]({url})\n\n" + fence("value = 1\n") + f"\n[Custom repr]({url})\n")
        prepared = materialize_setup(result, [associate(result)])
        self.assertFalse(prepared.blockers)
        self.assertEqual(prepared.configuration, {"pythonVersion": "3.15", "typeCheckingMode": "strict"})
        self.assertFalse(prepared.assumptions)
        self.assertFalse(prepared.reported_settings)
        with self.assertRaisesRegex(ValueError, "Remove pythonVersion from setting_choices"):
            materialize_setup(result, [associate(result)], [
                SettingChoice(setting="pythonVersion", value="3.15", reason="Reported, not assumed"),
            ])

    def test_conditional_reported_scope_preserves_original_and_comparison_declarations(self):
        original = "Original: pythonVersion: 3.13"
        comparison = "Comparison: pythonVersion: 3.14"
        result = capture(
            original + "\n\ntypeCheckingMode: strict\n\n" + fence("value = 1\n") + comparison + "\n",
        )
        self.assertTrue(materialize_setup(result, [associate(result)]).blockers)
        selection = reported_selection(result, original)
        prepared = materialize_setup(result, [associate(result)], reported_settings=[selection])
        self.assertFalse(prepared.blockers)
        self.assertEqual(prepared.configuration["pythonVersion"], "3.13")
        self.assertEqual(prepared.reported_settings, (selection,))
        self.assertCountEqual([item.value for item in prepared.scoped_declarations], ["3.13", "3.14"])
        self.assertFalse(prepared.assumptions)
        self.assertIn("Conditional reported setup", reported_setting_qualifications(prepared)[0])
        self.assertIn("not independently approved", reported_setting_qualifications(prepared)[0])
        other = materialize_setup(
            result, [associate(result)], reported_settings=[reported_selection(result, comparison, "3.14")],
        )
        self.assertEqual(other.configuration["pythonVersion"], "3.14")
        self.assertNotEqual(other.digest, prepared.digest)
        verify_materialized_setup(result, prepared.associations, (), prepared, reported_settings=[selection])
        restored = MaterializedSetup.model_validate_json(prepared.model_dump_json())
        self.assertEqual(restored, prepared)
        with self.assertRaisesRegex(ValueError, "changed"):
            verify_materialized_setup(result, prepared.associations, (), prepared)
        changed = selection.model_copy(update={"reason": "A different interpretation of the report"})
        self.assertNotEqual(
            materialize_setup(result, [associate(result)], reported_settings=[changed]).digest, prepared.digest,
        )

    def test_reported_selection_does_not_hide_missing_mode_other_settings_or_invalid_configuration(self):
        original = "Original: pythonVersion: 3.13"
        for extra, expected in (
            ("", "Missing reported typeCheckingMode"),
            ("typeCheckingMode: strict\nextraPaths: ['external']\n", "Unsupported or invalid reported extraPaths"),
            ('```json\n{"pythonVersion":\n```\n', "invalid_configuration"),
            ("pythonPlatform: Linux\n\npythonPlatform: Windows\n", "Conflicting reported pythonPlatform"),
        ):
            with self.subTest(extra=extra):
                result = capture(original + "\n\n" + fence("x=1\n") + "Comparison: pythonVersion: 3.14\n\n" + extra)
                prepared = materialize_setup(
                    result, [associate(result)], reported_settings=[reported_selection(result, original)],
                )
                self.assertTrue(any(expected in item for item in prepared.blockers))

    def test_scope_cannot_cherry_pick_a_config_url_shell_command_or_prose_paragraph(self):
        for text in (
            fence('{"pythonVersion":"3.13","pythonVersion":"3.14","typeCheckingMode":"strict"}\n', language="json"),
            "https://pyright-play.net/?pythonVersion=3.13&pythonVersion=3.14&strict=true",
            fence("pyright --pythonversion 3.13 --pythonversion 3.14 sample.py\n", language="sh"),
            "Original pythonVersion: 3.13\nComparison pythonVersion: 3.14",
            "Original pythonVersion: 3.13\r\nComparison pythonVersion: 3.14",
        ):
            with self.subTest(text=text):
                result = capture(fence("x=1\n") + text)
                selection = reported_selection(result, text)
                with self.assertRaisesRegex(ValueError, "cannot omit"):
                    materialize_setup(result, [associate(result)], reported_settings=[selection])
                identifiers = tuple(item.id for item in result.declarations if item.setting == "pythonVersion")
                prepared = materialize_setup(
                    result, [associate(result)],
                    reported_settings=[selection.model_copy(update={"declaration_ids": identifiers})],
                )
                self.assertTrue(any("Conflicting reported pythonVersion" in item for item in prepared.blockers))

    def test_scoped_context_cannot_hide_overlapping_comparison_or_cross_units(self):
        original, comparison = "Original pythonVersion: 3.13", "Comparison pythonVersion: 3.14"
        text = original + "\n\n" + comparison
        result = capture(text + "\n\n" + fence("x=1\n"))
        selection = reported_selection(result, text)
        with self.assertRaisesRegex(ValueError, "cannot omit"):
            materialize_setup(result, [associate(result)], reported_settings=[selection])
        selection = selection.model_copy(update={
            "declaration_ids": tuple(item.id for item in result.declarations if item.setting == "pythonVersion"),
        })
        with self.assertRaisesRegex(ValueError, "one complete reported"):
            materialize_setup(result, [associate(result)], reported_settings=[selection])

    def test_fenced_output_separates_original_command_from_following_comparison_without_blank_lines(self):
        original = "`pyright --pythonversion 3.13 sample.py` reports:"
        result = capture(
            "typeCheckingMode: strict\n\n" + fence("x=1\n") + original + "\n"
            + fence("A reported diagnostic\n", language="") + "With `--pythonversion 3.14`, both lines are reported.\n",
        )
        prepared = materialize_setup(
            result, [associate(result)], reported_settings=[reported_selection(result, original)],
        )
        self.assertFalse(prepared.blockers)
        self.assertEqual(prepared.configuration["pythonVersion"], "3.13")
        self.assertCountEqual([item.value for item in prepared.scoped_declarations], ["3.13", "3.14"])

    def test_scoped_python_and_mode_cannot_form_a_hybrid_original_control_configuration(self):
        original = "https://pyright-play.net/?pythonVersion=3.13&typeCheckingMode=strict"
        comparison = "https://pyright-play.net/?pythonVersion=3.14&typeCheckingMode=basic"
        result = capture(original + "\n\n" + fence("x=1\n") + "\n" + comparison)
        python = reported_selection(result, original)
        mode_fact = next(
            item for item in result.declarations if item.setting == "typeCheckingMode" and item.value == "basic"
        )
        start = result.documents[0].text.index(comparison)
        mode = ReportedSettingSelection(
            setting="typeCheckingMode", declaration_ids=(mode_fact.id,),
            context=EvidenceSpan(document_id="issue", start=start, end=start + len(comparison), quote=comparison),
            reason="Comparison mode must not be borrowed for the original Python target",
        )
        with self.assertRaisesRegex(ValueError, "no hybrid"):
            materialize_setup(result, [associate(result)], reported_settings=[python, mode])
        mode_fact = next(
            item for item in result.declarations if item.setting == "typeCheckingMode" and item.value == "strict"
        )
        mode = mode.model_copy(update={
            "declaration_ids": (mode_fact.id,), "context": python.context,
            "reason": "The original URL supplies both settings together",
        })
        prepared = materialize_setup(result, [associate(result)], reported_settings=[python, mode])
        self.assertFalse(prepared.blockers)
        self.assertEqual(prepared.configuration, {"pythonVersion": "3.13", "typeCheckingMode": "strict"})
        self.assertEqual(len(reported_setting_qualifications(prepared)), 2)

    def test_invalid_scoped_ids_settings_context_and_unsupported_report_facts_are_rejected(self):
        quote = "Original pythonVersion: 3.13"
        result = capture(quote + "\n\nComparison pythonVersion: 3.14\n\n" + fence("x=1\n"))
        selection = reported_selection(result, quote)
        for changed in (
            selection.model_copy(update={"declaration_ids": ("unknown",)}),
            selection.model_copy(update={"declaration_ids": (*selection.declaration_ids, *selection.declaration_ids)}),
            selection.model_copy(update={"setting": "typeCheckingMode"}),
            selection.model_copy(update={"context": selection.context.model_copy(update={"quote": "Invented context"})}),
            selection.model_copy(update={"context": selection.context.model_copy(update={"start": 1})}),
        ):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                materialize_setup(result, [associate(result)], reported_settings=[changed])
        with self.assertRaisesRegex(ValueError, "unique and bounded"):
            materialize_setup(result, [associate(result)], reported_settings=[selection, selection])
        invalid = capture(quote + "\n\nComparison pythonVersion: unknown\n\n" + fence("x=1\n"))
        with self.assertRaisesRegex(ValueError, "cannot bypass unsupported"):
            materialize_setup(invalid, [associate(invalid)], reported_settings=[reported_selection(invalid, quote)])

    def test_scoped_runtime_patch_target_retains_derivation_and_does_not_invent_missing_python(self):
        quote = "Original Python 3.14.1"
        result = capture(quote + "\n\nComparison Python 3.14.2\n\ntypeCheckingMode: strict\n\n" + fence("x=1\n"))
        selection = reported_selection(result, quote, "3.14.1")
        prepared = materialize_setup(result, [associate(result)], reported_settings=[selection])
        self.assertFalse(prepared.blockers)
        self.assertEqual(prepared.configuration["pythonVersion"], "3.14")
        self.assertEqual(prepared.derivations[0].reported_values, ("3.14.1",))
        self.assertCountEqual([item.value for item in prepared.scoped_declarations], ["3.14.1", "3.14.2"])
        missing = capture(fence("# pyright: strict\nx = 1\n"))
        self.assertEqual(len(materialize_setup(missing, [associate(missing)]).blockers), 2)

    def test_explicit_report_settings_have_exact_separate_provenance(self):
        result = capture(
            SETTINGS + fence("x = 1\n") + "Pyright version 1.1.405; typing_extensions==4.12.2\n",
            ("--pythonversion=3.12",),
        )
        for declaration in result.declarations:
            verify_span(result, declaration.evidence)
        python = [item for item in result.declarations if item.setting == "pythonVersion"]
        self.assertCountEqual([item.value for item in python], ["3.13", "3.12"])
        prepared = materialize_setup(result, [associate(result)])
        self.assertTrue(any("Conflicting reported pythonVersion" in item for item in prepared.blockers))
        self.assertNotIn("pythonVersion", prepared.configuration)

    def test_duplicate_equal_facts_are_preserved_without_false_conflict(self):
        result = capture(SETTINGS + fence("x = 1\n"), (SETTINGS,))
        self.assertEqual(sum(item.setting == "pythonVersion" for item in result.declarations), 2)
        self.assertFalse(materialize_setup(result, [associate(result)]).blockers)

    def test_code_strings_and_output_are_not_report_configuration_facts(self):
        code = 'text = """\nPython version 3.10\npythonVersion: 3.9\ntypeCheckingMode: off\n"""\n'
        result = capture(fence(code) + fence("Python version 3.8\n", language="") + "Python code is interesting.\n")
        self.assertFalse(result.declarations)
        prepared = materialize_setup(result, [associate(result)])
        self.assertEqual(len(prepared.blockers), 2)
        self.assertFalse(prepared.configuration)

    def test_json_configuration_handles_duplicate_keys_raw_spans_and_string_metadata(self):
        config = (
            '{\n  "pythonVersion": "3.13",\n  "pythonVersion": "3.12",\n'
            '  "typeCheckingMode": "strict",\n  "note": "pythonVersion: 3.7"\n}\n'
        )
        result = capture(fence("x = 1\n") + fence(config, 2, language="json"))
        for declaration in result.declarations:
            verify_span(result, declaration.evidence)
        python = [item for item in result.declarations if item.setting == "pythonVersion"]
        self.assertEqual([item.value for item in python], ["3.13", "3.12"])
        prepared = materialize_setup(result, [associate(result)])
        self.assertTrue(any("Conflicting reported pythonVersion" in item for item in prepared.blockers))
        self.assertTrue(any("Unsupported or invalid reported note" in item for item in prepared.blockers))

    def test_unknown_invalid_path_configuration_and_nonstandard_json_block(self):
        for config in (
            '{"pythonVersion":"unknown","typeCheckingMode":"strict"}',
            '{"pythonVersion":"3.13","extraPaths":["../outside"]}',
            '{"pythonVersion":"3.13","enableExperimentalFeatures":NaN}',
            '{"pythonVersion":"3.13", // a comment\n}',
        ):
            with self.subTest(config=config):
                result = capture(fence("x=1\n") + fence(config + "\n", language="json"))
                self.assertTrue(materialize_setup(result, [associate(result)]).blockers)
        result = capture(fence("x=1\n") + fence('[tool.pyright]\npythonVersion = "3.13"\n', language="toml"))
        self.assertTrue(result.limitations)

    def test_bounded_assumptions_only_fill_missing_settings_and_never_become_facts(self):
        result = capture(fence("x=1\n"))
        choices = (
            SettingChoice(setting="pythonVersion", value="3.13", reason="Disclosed offline bounded experiment"),
            SettingChoice(setting="typeCheckingMode", value="strict", reason="Disclosed offline bounded experiment"),
        )
        prepared = materialize_setup(result, [associate(result)], choices)
        self.assertFalse(prepared.blockers)
        self.assertFalse(result.declarations)
        self.assertEqual(prepared.assumptions, choices)
        self.assertEqual(prepared.inferred_paths, ("sample.py",))
        self.assertFalse(prepared.configuration.get("reported"))
        for bad in (
            (choices[0], choices[0]),
            (choices[0].model_copy(update={"value": "3.99"}),),
        ):
            with self.assertRaises(ValueError):
                materialize_setup(result, [associate(result)], bad)
        reported = capture(SETTINGS + fence("x=1\n"))
        with self.assertRaisesRegex(ValueError, "replace or relabel"):
            materialize_setup(reported, [associate(reported)], choices)

    def test_invalid_report_setting_cannot_be_replaced_by_assumption(self):
        result = capture('pythonVersion: "unknown"\n' + fence("x=1\n"))
        with self.assertRaisesRegex(ValueError, "replace or relabel"):
            materialize_setup(result, [associate(result)], [
                SettingChoice(setting="pythonVersion", value="3.13", reason="Would mask missing facts"),
            ])

    def test_quoted_empty_or_whitespace_values_are_not_silently_truncated_to_supported_settings(self):
        for value in ('""', '"strict unexpected"', "'strict unexpected'", "`strict unexpected`"):
            with self.subTest(value=value):
                result = capture(f"typeCheckingMode: {value}\n" + fence("x=1\n"))
                declarations = [item for item in result.declarations if item.setting == "typeCheckingMode"]
                self.assertEqual(len(declarations), 1)
                self.assertFalse(declarations[0].supported)
                prepared = materialize_setup(result, [associate(result)])
                self.assertNotIn("typeCheckingMode", prepared.configuration)
                self.assertTrue(any("Unsupported or invalid" in item for item in prepared.blockers))

    def test_unlabeled_configuration_is_captured_as_facts_not_python_source(self):
        result = capture(fence("x=1\n") + fence('{"pythonVersion":"3.13","typeCheckingMode":"strict"}\n', language=""))
        self.assertEqual(result.blocks[1].source_kind, "configuration")
        self.assertFalse(materialize_setup(result, [associate(result)]).blockers)
        with self.assertRaisesRegex(ValueError, "Non-Python"):
            materialize_setup(result, [associate(result, 1)])

    def test_explicit_inline_diagnostic_settings_are_preserved_and_path_settings_blocked(self):
        result = capture(SETTINGS + 'reportUnknownVariableType: false\nextraPaths: ["../external"]\n' + fence("x=1\n"))
        prepared = materialize_setup(result, [associate(result)])
        self.assertIs(prepared.configuration["reportUnknownVariableType"], False)
        self.assertTrue(any("extraPaths" in item for item in prepared.blockers))
        self.assertNotIn("extraPaths", prepared.configuration)

    def test_conflicting_checker_and_package_versions_remain_blocked_without_selecting_one(self):
        result = capture(
            SETTINGS + "Pyright version 1.1.405\nPyright version 1.1.414\n"
            "typing_extensions==4.12.2\ntyping_extensions==4.13.0\n" + fence("x=1\n"),
        )
        prepared = materialize_setup(result, [associate(result)])
        self.assertTrue(any("Conflicting reported pyrightVersion" in item for item in prepared.blockers))
        self.assertTrue(any("Conflicting reported typing_extensions" in item for item in prepared.blockers))
        self.assertNotIn("pyrightVersion", prepared.configuration)
        self.assertNotIn("typing_extensions", prepared.configuration)

    def test_filename_quotes_must_belong_to_the_selected_source(self):
        result = capture(fence("x=1\n", language='python filename="real.py"'))
        prepared = materialize_setup(result, [SourceAssociation(source_id=result.blocks[0].id, path="real.py", filename_quote="real.py")])
        self.assertFalse(prepared.inferred_paths)
        with self.assertRaisesRegex(ValueError, "explicitly reported filename"):
            materialize_setup(result, [associate(result, path="other.py")])
        with self.assertRaisesRegex(ValueError, "Filename quote"):
            materialize_setup(result, [
                SourceAssociation(source_id=result.blocks[0].id, path="real.py", filename_quote="another.py"),
            ])
        unlabelled = capture(fence("x=1\n") + "Elsewhere: `real.py`")
        with self.assertRaisesRegex(ValueError, "Filename quote"):
            materialize_setup(unlabelled, [
                SourceAssociation(source_id=unlabelled.blocks[0].id, path="real.py", filename_quote="real.py"),
            ])

    def test_conflicting_explicit_filenames_are_retained_but_cannot_be_silently_selected(self):
        for body in (
            fence("x=1\n", language='python filename="first.py" title="second.py"'),
            "`first.py`:\n" + fence("x=1\n", language='python filename="second.py"'),
        ):
            with self.subTest(body=body):
                result = capture(body)
                self.assertEqual(result.blocks[0].content, "x=1\n")
                self.assertEqual(result.limitations[0].code, "ambiguous_filename")
                with self.assertRaisesRegex(ValueError, "Conflicting explicit filename"):
                    materialize_setup(result, [associate(result)])

    def test_path_escape_alias_duplicate_and_non_python_sources_are_rejected(self):
        result = capture(fence("x=1\n") + fence("y=2\n"))
        for path in ("..\\escape.py", "C:\\absolute.py", "\\\\host\\file.py", "/root.py", "a:b.py", "CON.py", "NUL\\a.py", "a?.py", "a\n.py", "folder.\\a.py", "config.json"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                materialize_setup(result, [associate(result, path=path)])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            materialize_setup(result, [associate(result), associate(result, 1, path="SAMPLE.py")])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            materialize_setup(result, [associate(result), associate(result, path="other.py")])

    def test_materialized_tampering_is_detected_even_if_nested_dicts_can_be_mutated(self):
        result = capture(SETTINGS + fence("x=1\n"))
        associations = [associate(result)]
        prepared = materialize_setup(result, associations)
        verify_materialized_setup(result, associations, (), MaterializedSetup.model_validate_json(prepared.model_dump_json()))
        prepared.files["sample.py"] = "x=2\n"
        with self.assertRaisesRegex(ValueError, "changed"):
            verify_materialized_setup(result, associations, (), prepared)
        prepared = materialize_setup(result, associations)
        prepared.configuration["pythonVersion"] = "3.12"
        with self.assertRaises(ValueError):
            verify_materialized_setup(result, associations, (), prepared)

    def test_unsupported_extra_source_remains_visible_without_blocking_independent_sources(self):
        result = capture(SETTINGS + fence("x=1\n") + fence("z=3\n", 6))
        prepared = materialize_setup(result, [associate(result)])
        self.assertFalse(prepared.blockers)
        self.assertEqual(prepared.limitations, result.limitations)
        self.assertEqual(prepared.limitations[0].code, "unsupported_container")

    def test_missing_original_source_is_a_persistent_blocked_setup_not_fabricated_code(self):
        result = capture(SETTINGS + "See attached screenshot; no source supplied.")
        prepared = materialize_setup(result, [])
        self.assertFalse(prepared.files)
        self.assertTrue(any("Missing original source" in item for item in prepared.blockers))
        verify_materialized_setup(result, [], (), prepared)
        self.assertEqual(MaterializedSetup.model_validate_json(prepared.model_dump_json()), prepared)


class RequirementsTests(unittest.TestCase):
    def inventory(self, code: str):
        result = capture(SETTINGS + fence(code))
        prepared = materialize_setup(result, [associate(result)])
        return inspect_requirements(result, prepared)

    def test_static_imports_not_package_runtime_imports_or_source_string_greps(self):
        self.assertFalse(self.inventory('text="import external_dependency"\nfrom typing import Any\n'))
        requirements = self.inventory("from typing_extensions import TypeIs\nimport numpy\n")
        self.assertEqual({(item.kind, item.name, item.feature) for item in requirements}, {
            ("static_stubs", "typing_extensions", None),
            ("static_feature", "typing_extensions", "TypeIs"),
            ("unsupported", "numpy", "external static dependency resolution"),
        })
        self.assertEqual(resolve_setup(requirements).status, "blocked")

    def test_dynamic_star_and_unparseable_import_inventory_abstain(self):
        for code in (
            "from typing_extensions import *\n",
            '__import__("other")\n',
            'import importlib\nimportlib.import_module("other")\n',
            "def invalid(\n",
        ):
            with self.subTest(code=code):
                self.assertIn("unsupported", {item.kind for item in self.inventory(code)})

    def test_qualified_extension_features_are_not_inferred_from_unrelated_name_mentions(self):
        requirements = self.inventory("import typing_extensions as te\nvalue = te.TypeIs\ntext='te.Never'\n")
        self.assertEqual({item.feature for item in requirements if item.kind == "static_feature"}, {"TypeIs"})

    def test_missing_relative_modules_remain_setup_requirements(self):
        requirements = self.inventory("from .missing import X\n")
        self.assertEqual(len(requirements), 1)
        self.assertEqual(requirements[0].kind, "unsupported")
        self.assertEqual(requirements[0].name, "missing")
        self.assertEqual(requirements[0].feature, "relative import source is not selected")

    def test_setup_inventory_bound_is_explicit_not_a_truncated_success(self):
        with self.assertRaisesRegex(ValueError, "bounded setup inventory"):
            self.inventory("\n".join(f"import external_package_{index}" for index in range(65)) + "\n")

    def test_local_modules_and_relative_imports_are_not_external_packages(self):
        result = capture(SETTINGS + "* `a.py`:\n" + fence("import b\nfrom . import b\n") + "* `b.py`:\n" + fence("x=1\n"))
        prepared = materialize_setup(result, [associate(result, path="a.py"), associate(result, 1, "b.py")])
        self.assertFalse(inspect_requirements(result, prepared))

    def test_requirements_are_bound_to_selected_source_subset_and_version_evidence(self):
        result = capture(SETTINGS + fence("x=1\n") + fence("import external_dependency\n") + "typing_extensions==4.12.2\n")
        first = materialize_setup(result, [associate(result)])
        second = materialize_setup(result, [associate(result, 1)])
        first_requirements, second_requirements = inspect_requirements(result, first), inspect_requirements(result, second)
        self.assertEqual({item.kind for item in first_requirements}, {"static_stubs"})
        self.assertEqual({item.kind for item in second_requirements}, {"static_stubs", "unsupported"})
        self.assertNotEqual(first_requirements[0].id, second_requirements[0].id)
        self.assertTrue(first_requirements[0].declaration_ids)


class IntakeV2Tests(unittest.TestCase):
    def test_actual_11876_target_and_version_are_reported_in_shell_fences_not_assumed(self):
        self.assertEqual(
            hashlib.sha256(UNPACK_REPORT_11876.encode()).hexdigest(),
            "dbc11c721ca7b2ec08db167a790fcca0254755c636417583c751912049286910",
        )
        result = capture(UNPACK_REPORT_11876, report_id="retained-11876")
        self.assertEqual(len(result.blocks), 3)
        self.assertEqual(
            result.blocks[0].canonical_sha256,
            "67bda77d1aa389459a511f5dae76030ed42a3627668015c0af44b5ce17f4841d",
        )
        declarations = {item.setting: item for item in result.declarations}
        self.assertEqual(declarations["pythonVersion"].value, "3.15")
        self.assertEqual(declarations["pythonVersion"].declaration_kind, "checker_cli")
        self.assertEqual(declarations["pythonVersion"].source_id, result.blocks[2].id)
        self.assertEqual(declarations["pythonVersion"].evidence.quote, "pyright --pythonversion 3.15 test.py")
        self.assertEqual(declarations["pyrightVersion"].value, "1.1.414")
        self.assertEqual(declarations["pyrightVersion"].source_id, result.blocks[1].id)
        for declaration in declarations.values():
            verify_span(result, declaration.evidence)
        missing_mode = materialize_setup(result, [associate(result, path="test.py")])
        self.assertEqual(missing_mode.blockers, (
            "Missing reported typeCheckingMode; no disclosed bounded experiment supplied",
        ))
        choices = (SettingChoice(
            setting="typeCheckingMode", value="standard", reason="Retained bounded experiment, not a report fact",
        ),)
        prepared = materialize_setup(result, [associate(result, path="test.py")], choices)
        self.assertFalse(prepared.blockers)
        self.assertEqual(prepared.configuration["pythonVersion"], "3.15")
        self.assertEqual(prepared.assumptions, choices)
        self.assertFalse(prepared.derivations)
        # Inventory only: no host AST, checker invocation, target-support verdict,
        # reproduction verdict or feature compatibility proof is implied.
        self.assertFalse(inspect_requirements(result, prepared))
        self.assertEqual(prepared.files["test.py"], "print([*range(x) for x in range(5)])\n")

    def test_prose_interpreter_versions_exclude_one_sentence_period_without_changing_provenance(self):
        for version in ("3.8", "3.13", "3.14.2"):
            for prefix in ("Python ", "Python version: ", "Python version = "):
                with self.subTest(version=version, prefix=prefix):
                    text = f"{prefix}{version}.\ntypeCheckingMode: standard\n" + fence("x=1\n")
                    result = capture(text)
                    self.assertEqual(result.documents[0].text, text)
                    verify_capture(result)
                    values = [item for item in result.declarations if item.setting == "pythonVersion"]
                    self.assertEqual(len(values), 1)
                    declaration = values[0]
                    self.assertEqual(declaration.value, version)
                    self.assertTrue(declaration.supported)
                    self.assertEqual(declaration.evidence.quote, prefix + version)
                    verify_span(result, declaration.evidence)
                    prepared = materialize_setup(result, [associate(result)])
                    self.assertEqual(prepared.configuration["pythonVersion"], ".".join(version.split(".")[:2]))
                    self.assertFalse(prepared.assumptions)
                    self.assertFalse(prepared.blockers)
                    verify_materialized_setup(result, prepared.associations, (), prepared)

    def test_sentence_period_handling_does_not_repair_quoted_literal_cli_or_malformed_versions(self):
        for text in (
            "Python `3.14.`", "Python version: `3.14.`", "Python 3.14..",
            "Python 3.14.bad", "Python 3.14.1.2.", "Python 3.14./not-a-version",
            "Python version: not-a-version.",
            "pythonVersion: 3.14.", "--pythonversion 3.14.",
        ):
            with self.subTest(text=text):
                result = capture(text + "\n" + fence("x=1\n"))
                values = [item for item in result.declarations if item.setting == "pythonVersion"]
                self.assertTrue(values)
                self.assertTrue(all(not item.supported for item in values))
                prepared = materialize_setup(result, [associate(result)])
                self.assertNotIn("pythonVersion", prepared.configuration)
                self.assertTrue(prepared.blockers)

    def test_interpreter_patch_version_is_preserved_with_explicit_major_minor_derivation(self):
        result = capture("Python 3.14.1\ntypeCheckingMode: standard\n" + fence("x: int = 1\n"))
        declaration = next(item for item in result.declarations if item.setting == "pythonVersion")
        self.assertEqual(declaration.value, "3.14.1")
        self.assertEqual(declaration.declaration_kind, "interpreter_version")
        self.assertEqual(declaration.evidence.quote, "Python 3.14.1")
        verify_span(result, declaration.evidence)
        prepared = materialize_setup(result, [associate(result)])
        self.assertFalse(prepared.blockers)
        self.assertFalse(prepared.assumptions)
        self.assertEqual(prepared.configuration["pythonVersion"], "3.14")
        self.assertEqual(len(prepared.derivations), 1)
        derived = prepared.derivations[0]
        self.assertEqual(derived.value, "3.14")
        self.assertEqual(derived.declaration_ids, (declaration.id,))
        self.assertEqual(derived.reported_values, ("3.14.1",))
        self.assertEqual(derived.transform, "interpreter_major_minor")
        verify_materialized_setup(result, prepared.associations, (), prepared)
        restored = MaterializedSetup.model_validate_json(prepared.model_dump_json())
        self.assertEqual(restored.derivations, prepared.derivations)
        with self.assertRaisesRegex(ValueError, "changed"):
            verify_materialized_setup(result, prepared.associations, (), prepared.model_copy(update={"derivations": ()}))

    def test_literal_checker_patch_setting_and_cli_patch_targets_are_not_runtime_versions(self):
        for body in (
            "pythonVersion: 3.14.1\n" + fence("x=1\n"),
            fence("x=1\n") + fence('{"pythonVersion":"3.14.1"}\n', language="json"),
            fence("x=1\n") + fence("pyright --pythonversion 3.14.1 test.py\n", language="sh"),
        ):
            with self.subTest(body=body):
                result = capture(body)
                prepared = materialize_setup(result, [associate(result)])
                self.assertNotIn("pythonVersion", prepared.configuration)
                self.assertTrue(any("Unsupported or invalid reported pythonVersion" in item for item in prepared.blockers))
                self.assertFalse(prepared.derivations)
                self.assertFalse(prepared.assumptions)

    def test_malformed_runtime_versions_are_not_partially_matched_or_assumed(self):
        for version in ("3.14.1bad", "3.14.1.2", "3.14..1", "3.14-dev"):
            result = capture(f"Python {version}\n" + fence("x=1\n"))
            declaration = next(item for item in result.declarations if item.setting == "pythonVersion")
            self.assertEqual(declaration.value, version)
            self.assertFalse(declaration.supported)
            prepared = materialize_setup(result, [associate(result)])
            self.assertNotIn("pythonVersion", prepared.configuration)
            self.assertTrue(prepared.blockers)
            with self.assertRaisesRegex(ValueError, "replace or relabel"):
                materialize_setup(result, [associate(result)], [
                    SettingChoice(setting="pythonVersion", value="3.14", reason="Cannot replace malformed reporter evidence"),
                ])

    def test_consistent_runtime_patch_and_explicit_target_agree_without_losing_either_fact(self):
        result = capture(
            "Python 3.14\nPython version 3.14.1\npythonVersion: 3.14\ntypeCheckingMode: standard\n" + fence("x=1\n"),
        )
        prepared = materialize_setup(result, [associate(result)])
        self.assertFalse(prepared.blockers)
        self.assertEqual(prepared.configuration["pythonVersion"], "3.14")
        self.assertEqual(len(prepared.derivations), 1)
        self.assertEqual(sum(item.setting == "pythonVersion" for item in result.declarations), 3)
        for extra in ("Python 3.14.2\n", "pythonVersion: 3.13\n"):
            conflicting = capture(
                "Python 3.14.1\npythonVersion: 3.14\ntypeCheckingMode: standard\n" + extra + fence("x=1\n"),
            )
            setup = materialize_setup(conflicting, [associate(conflicting)])
            self.assertNotIn("pythonVersion", setup.configuration)
            self.assertTrue(any("Conflicting reported pythonVersion" in item for item in setup.blockers))

    def test_shell_setting_spans_preserve_structural_indent_and_argument_quotes(self):
        result = capture(fence("x=1\n") + fence(
            '$ pyright --pythonversion="3.15" test.py\n', 2, language="sh",
        ))
        declaration = next(item for item in result.declarations if item.setting == "pythonVersion")
        self.assertEqual(declaration.value, "3.15")
        verify_span(result, declaration.evidence)
        self.assertEqual(declaration.source_id, result.blocks[1].id)
        self.assertEqual(declaration.evidence.quote, '$ pyright --pythonversion="3.15" test.py')

    def test_shell_unknown_conflicting_or_expanded_targets_remain_explicit(self):
        for shell in (
            "pyright --pythonversion\n",
            "pyright --pythonversion unknown test.py\n",
            "pyright --pythonversion 3.15 --pythonversion 3.14 test.py\n",
            "pyright --pythonversion $VERSION test.py\n",
            "pyright --pythonversion 3.15 test.py && other_command\n",
        ):
            result = capture(fence("x=1\n") + fence(shell, language="sh"))
            prepared = materialize_setup(result, [associate(result)])
            self.assertNotIn("pythonVersion", prepared.configuration)
            self.assertTrue(prepared.blockers)
            self.assertFalse(prepared.assumptions)
        python_string = capture(fence('text = "pyright --pythonversion 3.15 test.py"\n'))
        self.assertFalse(python_string.declarations)

    def test_future_syntax_never_hides_external_dynamic_or_extension_import_requirements(self):
        code = (
            "from typing_extensions import TypeIs\nimport external_dependency\n"
            'module = __import__("other_dependency")\nprint([*range(x) for x in range(5)])\n'
        )
        result = capture(SETTINGS + fence(code))
        prepared = materialize_setup(result, [associate(result)])
        requirements = inspect_requirements(result, prepared)
        self.assertEqual({(item.kind, item.name, item.feature) for item in requirements}, {
            ("static_stubs", "typing_extensions", None),
            ("static_feature", "typing_extensions", "TypeIs"),
            ("unsupported", "external_dependency", "external static dependency resolution"),
            ("unsupported", "sample.py", "dynamic import resolution"),
        })
        self.assertEqual(resolve_setup(requirements).status, "blocked")
        self.assertFalse(any("SyntaxError" in (item.feature or "") for item in requirements))

    def test_token_inventory_handles_grouped_relative_aliased_and_semicolon_imports(self):
        result = capture(
            SETTINGS + "* `pkg\\a.py`:\n" + fence(
                "from .b import Value\nfrom typing import (\n    Any as A,\n    Protocol,\n)\n"
                "import typing_extensions as te; import external_module as em\n"
                'value = te.TypeIs\ntext = "import fake_dependency"\nprint([*range(x) for x in range(5)])\n',
            ) + "* `pkg\\b.py`:\n" + fence("Value = int\n"),
        )
        prepared = materialize_setup(result, [
            associate(result, 0, "pkg\\a.py"), associate(result, 1, "pkg\\b.py"),
        ])
        requirements = inspect_requirements(result, prepared)
        self.assertEqual({(item.kind, item.name, item.feature) for item in requirements}, {
            ("static_stubs", "typing_extensions", None),
            ("static_feature", "typing_extensions", "TypeIs"),
            ("unsupported", "external_module", "external static dependency resolution"),
        })

    def test_lexical_uncertainty_is_not_a_claim_of_checker_grammar_support(self):
        result = capture(SETTINGS + fence("import external_module\ntext = '''unclosed\n"))
        prepared = materialize_setup(result, [associate(result)])
        requirements = inspect_requirements(result, prepared)
        self.assertTrue(any("lexical import inventory unavailable" in (item.feature or "") for item in requirements))
        self.assertTrue(any(item.name == "external_module" for item in requirements))
        self.assertEqual(resolve_setup(requirements).status, "blocked")
        self.assertEqual(prepared.files["sample.py"], "import external_module\ntext = '''unclosed\n")


class SetupCapabilityTests(unittest.TestCase):
    def test_missing_unknown_and_unsupported_setup_never_become_ready(self):
        requirement = SetupRequirement(id="te", kind="static_stubs", name="typing_extensions")
        resolution = resolve_setup([requirement])
        self.assertEqual(resolution.status, "blocked")
        self.assertEqual(resolution.capabilities[0].status, "unknown")
        self.assertTrue(resolution.blockers)
        self.assertEqual(resolve_setup([]).status, "ready")

    def test_real_verifier_hook_is_required_and_failure_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            target = fake_target(directory)
            requirement = SetupRequirement(id="target", kind="checker_target", name="pyright", version="1.1.414")
            checked = check_target_capability(requirement, target, verify_fake_target)
            self.assertEqual(checked.status, "available")
            self.assertTrue(checked.evidence)
            self.assertEqual(resolve_setup([requirement], [checked]).status, "ready")
            (directory / "index.js").write_text("// Tampered inert fake\n", encoding="utf-8")
            self.assertEqual(check_target_capability(requirement, target, verify_fake_target).status, "failed")

    def test_target_identity_version_mismatch_and_incomplete_target_are_not_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = fake_target(Path(temporary))
            for requirement in (
                SetupRequirement(id="target", kind="checker_target", name="pyright", version="1.1.405"),
                SetupRequirement(id="target", kind="checker_target", name="pyright", target_id="b" * 40),
            ):
                self.assertEqual(check_target_capability(requirement, target, verify_fake_target).status, "missing")
            incomplete = target.model_copy(update={"status": "selected"})
            requirement = SetupRequirement(id="target", kind="checker_target", name="pyright")
            self.assertEqual(check_target_capability(requirement, incomplete, verify_fake_target).status, "failed")

    def test_bundled_stub_availability_does_not_assert_runtime_version_or_feature(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            stub = directory / "dist" / "typeshed-fallback" / "stdlib" / "typing_extensions.pyi"
            stub.parent.mkdir(parents=True)
            # Inert availability fixture, deliberately not permissive semantic stubs.
            stub.write_text("# Offline stub availability fixture; no symbols or checker invocation\n", encoding="utf-8")
            target = fake_target(directory)
            requirement = SetupRequirement(id="stub", kind="static_stubs", name="typing_extensions")
            checked = check_bundled_stub_capability(requirement, target, verify_fake_target)
            self.assertEqual(checked.status, "available")
            self.assertIsNone(checked.observed_version)
            self.assertEqual(checked.provider, "bundled_stubs")
            self.assertIn("no runtime package version", checked.detail)
            versioned = requirement.model_copy(update={"version": "4.12.2"})
            featured = requirement.model_copy(update={"feature": "TypeIs"})
            self.assertEqual(check_bundled_stub_capability(versioned, target, verify_fake_target).status, "unknown")
            self.assertEqual(check_bundled_stub_capability(featured, target, verify_fake_target).status, "unknown")

    def test_stub_missing_is_distinct_from_failed_integrity(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            target = fake_target(directory)
            requirement = SetupRequirement(id="stub", kind="static_stubs", name="typing_extensions")
            self.assertEqual(check_bundled_stub_capability(requirement, target, verify_fake_target).status, "missing")
            (directory / "index.js").write_text("changed", encoding="utf-8")
            self.assertEqual(check_bundled_stub_capability(requirement, target, verify_fake_target).status, "failed")

    def test_approved_installed_metadata_is_read_without_importing_package_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            metadata = Path(temporary) / "METADATA"
            data = b"Metadata-Version: 2.1\nName: typing-extensions\nVersion: 4.12.2\n\n"
            metadata.write_bytes(data)
            requirement = SetupRequirement(id="runtime", kind="runtime_distribution", name="typing_extensions", version="4.12.2")
            checked = check_runtime_metadata(requirement, metadata, hashlib.sha256(data).hexdigest())
            self.assertEqual(checked.status, "available")
            self.assertEqual(checked.observed_version, "4.12.2")
            self.assertIn("not import resolution", checked.detail)
            mismatch = requirement.model_copy(update={"version": "4.11.0"})
            self.assertEqual(check_runtime_metadata(mismatch, metadata, hashlib.sha256(data).hexdigest()).status, "missing")
            self.assertEqual(check_runtime_metadata(requirement, metadata, "a" * 64).status, "failed")
            for content in (
                b"Name: typing-extensions\nVersion: 4.12.2\nVersion: 4.13.0\n\n",
                b"Name: other\nVersion: 4.12.2\n\n",
                b"Name: typing-extensions\n\n",
            ):
                metadata.write_bytes(content)
                self.assertEqual(check_runtime_metadata(requirement, metadata, hashlib.sha256(content).hexdigest()).status, "failed")

    def test_approved_feature_probe_receipts_bind_target_requirement_and_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            target = fake_target(directory)
            requirement = SetupRequirement(id="feature", kind="static_feature", name="typing_extensions", feature="TypeIs")
            receipt_path = directory.parent / (directory.name + "-offline-receipt.json")
            self.addCleanup(receipt_path.unlink, missing_ok=True)
            receipt = b'{"offline_fake":true,"not_a_checker_run":true}\n'
            receipt_path.write_bytes(receipt)
            def offline_probe(item, checker):
                return FeatureProbeResult(
                    requirement_hash=fingerprint(item.model_dump(mode="json")),
                    target_hash=fingerprint(checker.model_dump(mode="json")), status="available",
                    evidence=ArtifactEvidence(locator=str(receipt_path), sha256=hashlib.sha256(receipt).hexdigest()),
                    detail="Offline fake receipt for resolver contract only, not feature compatibility evidence",
                )
            checked = check_feature_capability(requirement, target, verify_fake_target, offline_probe)
            self.assertEqual(checked.status, "available")
            def mismatched(item, checker):
                return offline_probe(item, checker).model_copy(update={"target_hash": "d" * 64})
            self.assertEqual(check_feature_capability(requirement, target, verify_fake_target, mismatched).status, "failed")
            def failed(item, checker):
                raise TimeoutError("Offline fake timed out")
            self.assertEqual(check_feature_capability(requirement, target, verify_fake_target, failed).status, "failed")
            receipt_path.write_text('{"offline_fake":"tampered"}\n', encoding="utf-8")
            self.assertEqual(check_feature_capability(requirement, target, verify_fake_target, offline_probe).status, "failed")
            versioned = requirement.model_copy(update={"version": "4.12.2"})
            self.assertEqual(check_feature_capability(versioned, target, verify_fake_target, offline_probe).status, "unknown")

    def test_resolution_is_honest_partial_and_rejects_foreign_duplicate_or_tampered_capabilities(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = fake_target(Path(temporary))
            checker = SetupRequirement(id="target", kind="checker_target", name="pyright")
            dependency = SetupRequirement(id="stub", kind="static_stubs", name="typing_extensions")
            checked = check_target_capability(checker, target, verify_fake_target)
            resolution = resolve_setup([checker, dependency], [checked])
            self.assertEqual(resolution.status, "partial")
            self.assertEqual(len(resolution.blockers), 1)
            for requirements, capabilities in (
                ([dependency], [checked]),
                ([checker], [checked, checked]),
                ([checker, checker], [checked]),
                ([checker], [checked.model_copy(update={"observed_version": "1.1.1"})]),
            ):
                with self.assertRaises(ValueError):
                    resolve_setup(requirements, capabilities)


if __name__ == "__main__":
    unittest.main()
