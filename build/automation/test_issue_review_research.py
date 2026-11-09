# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import unittest
from typing import Literal

from pydantic import JsonValue

from issue_review_models import DuplicateCandidate, DuplicateEvidence, DuplicateReport
from review_issues import (
    JSON,
    AutomationError,
    policy_history_leads,
    require_candidate_reads,
    require_history_lead_attempts,
    research_read_coverage,
    validate_duplicate_execution,
)
from test_review_issues import issue, no_duplicates, search_record


def read_record(number: int, operation: str, result: object, *, investigator="duplicates") -> dict[str, JsonValue]:
    return {
        "tool": "github_read", "investigator": investigator,
        "request": {"operation": operation, "number": number}, "result": JSON.validate_python(result),
    }


def issue_record(number: int, *, investigator="duplicates") -> dict[str, JsonValue]:
    snapshot = issue().model_copy(update={
        "number": number, "html_url": f"https://github.com/microsoft/pyright/issues/{number}",
    })
    return read_record(number, "issue", snapshot.model_dump(mode="json"), investigator=investigator)


def duplicate_report(
    *, complete=True, relation: Literal["duplicate", "related", "not_duplicate", "inconclusive"] = "duplicate",
    canonical=456,
) -> DuplicateReport:
    report = no_duplicates()
    report.search_complete = complete
    report.candidates = [DuplicateCandidate(
        issue_number=456, relation=relation, confidence="high", shared_cause="The same constructor contract",
        differences="Different names", canonical_reason="The stronger discussion",
        canonical_issue_number=canonical if relation == "duplicate" else None,
        evidence=[DuplicateEvidence(
            url="https://github.com/microsoft/pyright/issues/456", finding="The inspected contract",
        )],
    )]
    return report


class ResearchTests(unittest.TestCase):
    def test_descriptor_lead_uses_topic_not_issue_identity_or_expected_verdict(self):
        snapshot = issue().model_copy(update={"title": "Custom classmethod receiver", "body": "A descriptor"})
        leads = policy_history_leads(snapshot)
        self.assertEqual(leads, [{
            "topic": "custom method receivers",
            "issues": [{"number": 5865, "url": "https://github.com/microsoft/pyright/issues/5865"}],
        }])
        self.assertEqual(policy_history_leads(snapshot.model_copy(update={"number": 789})), leads)
        self.assertEqual(policy_history_leads(snapshot.model_copy(update={"number": 5865})), [])

    def test_topic_matching_is_case_insensitive_bounded_and_has_identifier_boundaries(self):
        snapshot = issue().model_copy(update={"title": "DATACLASSES and ItemsView", "body": "A custom __get__"})
        self.assertEqual(len(policy_history_leads(snapshot)), 3)
        unrelated = snapshot.model_copy(update={"title": "misdescriptorlike and MappingFactory", "body": ""})
        self.assertEqual(policy_history_leads(unrelated), [])

    def test_duplicate_requires_own_issue_and_discussion_not_a_search_snippet(self):
        records = [search_record(), read_record(456, "comments", [])]
        with self.assertRaisesRegex(AutomationError, "actual canonical issue and discussion reads"):
            validate_duplicate_execution(duplicate_report(), records, [])
        records.append(issue_record(456, investigator="review"))
        with self.assertRaises(AutomationError):
            validate_duplicate_execution(duplicate_report(), records, [])
        records.append(issue_record(456))
        validate_duplicate_execution(duplicate_report(), records, [])

    def test_keep_current_still_requires_inspecting_the_other_report(self):
        with self.assertRaises(AutomationError):
            validate_duplicate_execution(duplicate_report(canonical=123), [search_record()], [])
        validate_duplicate_execution(
            duplicate_report(canonical=123),
            [search_record(), issue_record(456), read_record(456, "comments", [])], [],
        )

    def test_malformed_foreign_and_failed_issue_captures_do_not_verify_a_read(self):
        for result in ({}, issue().model_dump(mode="json"), "not an issue"):
            with self.subTest(result=result):
                records = [read_record(456, "issue", result), read_record(456, "comments", [])]
                with self.assertRaises(AutomationError):
                    require_candidate_reads(456, records, "duplicates")
        failed = issue_record(456)
        failed["error"] = "GitHub unavailable"
        with self.assertRaises(AutomationError):
            require_candidate_reads(456, [failed, read_record(456, "comments", [])], "duplicates")

    def test_comments_must_be_a_complete_collection_bound_to_the_requested_issue(self):
        valid = {
            "issue_url": "https://api.github.com/repos/microsoft/pyright/issues/456",
            "html_url": "https://github.com/microsoft/pyright/issues/456#issuecomment-1",
            "body": "Accepted explanation",
        }
        require_candidate_reads(456, [issue_record(456), read_record(456, "comments", [valid])], "duplicates")
        for invalid in (
            {}, "truncated", [None], [dict(valid, issue_url=valid["issue_url"] + "7")],
            [dict(valid, html_url=valid["html_url"].replace("/456#", "/789#"))],
        ):
            with self.subTest(invalid=invalid), self.assertRaises(AutomationError):
                require_candidate_reads(456, [issue_record(456), read_record(456, "comments", invalid)], "duplicates")

    def test_read_metadata_is_explicitly_separate_from_shared_cause(self):
        self.assertEqual(research_read_coverage(456, [issue_record(456)], "duplicates"), {
            "issue_number": 456, "issue_read_verified": True, "discussion_read_verified": False,
        })

    def test_partial_discussion_cannot_satisfy_the_issue_snapshot_comment_count(self):
        captured = issue_record(456)
        snapshot = captured["result"]
        assert isinstance(snapshot, dict)
        snapshot["comments"] = 2
        first = {
            "issue_url": "https://api.github.com/repos/microsoft/pyright/issues/456",
            "html_url": "https://github.com/microsoft/pyright/issues/456#issuecomment-1",
        }
        records = [captured, read_record(456, "comments", [first])]
        with self.assertRaises(AutomationError):
            require_candidate_reads(456, records, "duplicates")
        with self.assertRaises(AutomationError):
            require_candidate_reads(456, [captured, read_record(456, "comments", [first, first])], "duplicates")
        records.append(read_record(456, "comments", [first, dict(first, html_url=first["html_url"][:-1] + "2")]))
        require_candidate_reads(456, records, "duplicates")

    def test_incomplete_or_failed_search_cannot_be_declared_complete(self):
        for records in ([], [dict(search_record(), error="Unavailable")], [
            dict(search_record(), result={"incomplete_results": True, "items": []}),
        ]):
            with self.subTest(records=records), self.assertRaisesRegex(AutomationError, "non-incomplete"):
                validate_duplicate_execution(no_duplicates(), records, [])

    def test_inconclusive_candidate_and_incomplete_search_preserve_missing_reads(self):
        report = duplicate_report(complete=False, relation="inconclusive")
        validate_duplicate_execution(report, [], [])
        self.assertEqual(report.candidates[0].relation, "inconclusive")
        self.assertFalse(report.search_complete)

    def test_policy_lead_attempts_do_not_invent_authority_when_access_fails(self):
        leads = policy_history_leads(issue().model_copy(update={"title": "A custom descriptor"}))
        with self.assertRaisesRegex(AutomationError, "supplied lead #5865"):
            require_history_lead_attempts(leads, [], "review")
        failed = [
            {
                "tool": "github_read", "investigator": "review",
                "request": {"operation": operation, "number": 5865}, "error": "Unavailable",
            }
            for operation in ("issue", "comments")
        ]
        require_history_lead_attempts(leads, failed, "review")
        self.assertFalse(research_read_coverage(5865, failed, "review")["issue_read_verified"])

    def test_completed_duplicate_search_must_inspect_supplied_history_leads(self):
        leads = policy_history_leads(issue().model_copy(update={"title": "A custom descriptor"}))
        with self.assertRaisesRegex(AutomationError, "supplied lead #5865"):
            validate_duplicate_execution(no_duplicates(), [search_record()], leads)
        records = [search_record(), issue_record(5865), read_record(5865, "comments", [])]
        validate_duplicate_execution(no_duplicates(), records, leads)
        records[-1]["error"] = "Comments unavailable"
        with self.assertRaisesRegex(AutomationError, "search_complete=false"):
            validate_duplicate_execution(no_duplicates(), records, leads)
        report = no_duplicates()
        report.search_complete = False
        validate_duplicate_execution(report, records, leads)


if __name__ == "__main__":
    unittest.main()
