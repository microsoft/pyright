# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import hashlib
import json
import unittest

from pydantic import JsonValue

from issue_review_evidence import MAX_RESPONSE_BYTES, PAGE_CHARS, evidence_json, evidence_page, evidence_response


class EvidenceTests(unittest.TestCase):
    def read_all(self, record: dict[str, JsonValue], pointer: str = "", *, max_chars: int = PAGE_CHARS):
        offset, parts = 0, []
        expected_hash = None
        while True:
            raw = evidence_page(record, pointer, offset=offset, max_chars=max_chars)
            self.assertLessEqual(len(raw.encode("utf-8")), MAX_RESPONSE_BYTES)
            page = json.loads(raw)
            self.assertEqual(page["offset"], offset)
            self.assertEqual(page["pointer"], pointer)
            self.assertEqual(page["record_sha256"], hashlib.sha256(evidence_json(record).encode("ascii")).hexdigest())
            if expected_hash is None:
                expected_hash = page["value_sha256"]
            self.assertEqual(page["value_sha256"], expected_hash)
            parts.append(page["content"])
            if page["next_offset"] is None:
                break
            self.assertGreater(page["next_offset"], offset)
            offset = page["next_offset"]
        text = "".join(parts)
        self.assertEqual(len(text), page["total_chars"])
        self.assertEqual(hashlib.sha256(text.encode("ascii")).hexdigest(), expected_hash)
        return json.loads(text)

    def test_small_receipts_are_returned_without_an_envelope(self):
        record: dict[str, JsonValue] = {"id": "small", "kind": "debugger", "value": [None, False, 3, "text"]}
        self.assertEqual(json.loads(evidence_response(record)), record)

    def test_exact_response_budget_boundary(self):
        record: dict[str, JsonValue] = {"id": "boundary", "content": ""}
        content = "x" * (MAX_RESPONSE_BYTES - len(evidence_json(record)))
        record["content"] = content
        self.assertEqual(len(evidence_response(record).encode("utf-8")), MAX_RESPONSE_BYTES)
        self.assertEqual(json.loads(evidence_response(record)), record)
        record["content"] = content + "x"
        index = json.loads(evidence_response(record))
        self.assertEqual(index["view"], "evidence_index")
        self.assertFalse(index["complete"])
        self.assertLessEqual(len(evidence_response(record)), MAX_RESPONSE_BYTES)

    def test_unicode_and_escaped_json_round_trip_exactly(self):
        record: dict[str, JsonValue] = {
            "id": "unicode", "content": ('"\n\\\u03a9\U0001f600\ud800' * 2500),
            "nested": {"null": None, "boolean": True, "array": [1, 2.5, "tail"]},
        }
        self.assertEqual(self.read_all(record), record)
        self.assertEqual(self.read_all(record, "/content"), record["content"])
        self.assertEqual(self.read_all(record, "/nested"), record["nested"])

    def test_single_character_pages_make_progress_even_through_json_escapes(self):
        record: dict[str, JsonValue] = {"id": "tiny", "value": "\u03a9\n\\"}
        self.assertEqual(self.read_all(record, "/value", max_chars=1), record["value"])

    def test_pointer_escaping_and_numeric_dictionary_keys(self):
        record: dict[str, JsonValue] = {
            "id": "pointers", "a/b": {"~key": [None, {"": False}]}, "0": "dictionary", "~1": 3,
        }
        self.assertIs(self.read_all(record, "/a~1b/~0key/1/"), False)
        self.assertEqual(self.read_all(record, "/0"), "dictionary")
        self.assertEqual(self.read_all(record, "/~01"), 3)
        self.assertEqual(self.read_all(record), record)

    def test_invalid_or_missing_pointers_fail_explicitly(self):
        record: dict[str, JsonValue] = {"id": "bad-pointer", "array": [0]}
        for pointer in ("array", "#/array", "/~", "/~2", "/missing", "/array/-", "/array/-1", "/array/00", "/array/1", "/array/\u0660"):
            with self.subTest(pointer=pointer), self.assertRaises(ValueError):
                evidence_page(record, pointer)

    def test_invalid_page_ranges_fail_explicitly(self):
        record: dict[str, JsonValue] = {"id": "ranges"}
        for options in ({"offset": -1}, {"offset": 1000}, {"max_chars": 0}, {"max_chars": PAGE_CHARS + 1}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                evidence_page(record, "", **options)

    def test_last_empty_page_is_explicitly_not_a_complete_value(self):
        record: dict[str, JsonValue] = {"id": "empty-page"}
        page = json.loads(evidence_page(record, "", offset=len(evidence_json(record))))
        self.assertEqual(page["content"], "")
        self.assertIsNone(page["next_offset"])
        self.assertFalse(page["value_complete"])

    def test_a_complete_page_does_not_hide_capture_truncation(self):
        record: dict[str, JsonValue] = {"id": "partial-source", "truncated": True, "content": "captured prefix"}
        page = json.loads(evidence_page(record, "/content"))
        self.assertTrue(page["value_complete"])
        self.assertTrue(page["capture_truncated"])
        self.assertEqual(json.loads(page["content"]), record["content"])

    def test_huge_metadata_fails_instead_of_returning_oversized_or_empty_looping_pages(self):
        key = "\U0001f600" * 1100
        record: dict[str, JsonValue] = {"id": "metadata", key: "value"}
        with self.assertRaisesRegex(ValueError, "metadata exceeds"):
            evidence_page(record, "/" + key)
        index = json.loads(evidence_response(record))
        self.assertLess(len(index["fields"]), index["fields_total"])
        self.assertEqual(self.read_all(record), record)

    def test_index_preserves_failed_missing_and_successful_observation_distinctions(self):
        record: dict[str, JsonValue] = {
            "id": "failures", "kind": "debugger",
            "debug": {"errors": ["A failed breakpoint condition"], "hits": [{
                "file": r"analyzer\typeEvaluator.ts", "actual_source": {"line": 42},
                "evaluations": [
                    {"expression": "value", "error": None, "result": {"result": {"type": "number", "value": 7}}},
                    {"expression": "printer()", "error": None, "result": {
                        "result": {"type": "number", "value": 9},
                        "exceptionDetails": {"text": "Uncaught", "exception": {"description": "EvalError: rejected\n" + "frame\n" * 10000}},
                    }},
                    {"expression": "deepObject", "error": "Object reference chain is too long", "result": None},
                    {"expression": "not returned", "error": None, "result": None},
                ],
            }]},
        }
        before = evidence_json(record)
        index = json.loads(evidence_response(record))
        self.assertEqual(index["debugger_errors"], 1)
        self.assertEqual(index["failed_evaluations"], 2)
        self.assertEqual(index["unavailable_evaluations"], 1)
        self.assertEqual([row["status"] for row in index["observations"]], ["observed", "failed", "failed", "unavailable"])
        self.assertEqual(index["observations"][0]["value"], 7)
        self.assertEqual(index["observations"][0]["actual_line"], 42)
        self.assertNotIn("value", index["observations"][1])
        self.assertNotIn("value", index["observations"][2])
        for row in index["observations"]:
            self.assertIsInstance(self.read_all(record, row["pointer"]), dict)
        self.assertEqual(self.read_all(record), record)
        self.assertEqual(evidence_json(record), before)

    def test_large_observation_indexes_explicitly_count_unshown_entries(self):
        evaluations: list[JsonValue] = [{
            "expression": "\U0001f600" * 2000, "error": "failure " * 4000, "result": None,
        } for _ in range(120)]
        record: dict[str, JsonValue] = {
            "id": "many", "debug": {"errors": [], "hits": [{"evaluations": evaluations}]},
        }
        index = json.loads(evidence_response(record))
        self.assertEqual(index["observations_total"], 120)
        self.assertEqual(index["failed_evaluations"], 120)
        self.assertLess(len(index["observations"]), index["observations_total"])
        self.assertLessEqual(len(evidence_response(record).encode("utf-8")), MAX_RESPONSE_BYTES)
        self.assertEqual(self.read_all(record, "/debug/hits/0/evaluations/119"), evaluations[119])

    def test_editor_observations_use_their_original_case_pointers(self):
        record: dict[str, JsonValue] = {
            "id": "editor", "stdout": "output" * 5000,
            "cases": [{"observation": {"errors": [], "hits": [{
                "file": "extension.ts", "actual_source": {"line": 12},
                "evaluations": [{"expression": "value", "error": None, "result": {"result": {"type": "undefined"}}}],
            }]}}],
        }
        index = json.loads(evidence_response(record))
        row = index["observations"][0]
        self.assertEqual(row["pointer"], "/cases/0/observation/hits/0/evaluations/0")
        self.assertEqual(row["status"], "observed")
        self.assertEqual(row["result_type_preview"], "undefined")
        self.assertIsInstance(self.read_all(record, row["pointer"]), dict)

    def test_large_receipts_without_a_controller_identity_are_not_made_up(self):
        records: list[dict[str, JsonValue]] = [
            {"content": "x" * 20000}, {"id": "x" * 129, "content": "x" * 20000},
        ]
        for record in records:
            with self.assertRaisesRegex(ValueError, "controller ID"):
                evidence_response(record)
