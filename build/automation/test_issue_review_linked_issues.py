# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from copilot import ToolInvocation
from copilot.generated.rpc import PermissionDecisionReject
from copilot.generated.session_events import PermissionRequestUrl
from pydantic import JsonValue, ValidationError

from issue_review_safety import ScreeningBlocked
from review_issues import (
    LINKED_ISSUE_REQUESTS,
    LINKED_ISSUE_RESPONSE_BYTES,
    LINKED_ISSUE_TOTAL_BYTES,
    ROOT,
    AutomationError,
    GitHub,
    GitHubRead,
    InvestigationTools,
    canonical_linked_issue,
    linked_issue_sources,
)
from test_review_issues import FakeGitHub, issue

URL = "https://github.com/microsoft/pylance-release/issues/8252"
REPOSITORY = "microsoft/pylance-release"


class LinkedIssueTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.github = FakeGitHub()
        self.screen = AsyncMock()
        self.github.screen = self.screen
        self.metadata: dict[str, JsonValue] = {"full_name": REPOSITORY, "private": False}
        self.document: dict[str, JsonValue] = {"html_url": URL, "number": 8252, "body": "Original linked report"}
        self.discussion: list[JsonValue] = [{"html_url": URL + "#issuecomment-1", "body": "Accepted explanation"}]

        async def api(method, endpoint, **options):
            self.assertEqual(method, "GET")
            self.assertFalse(options)
            if endpoint == f"repos/{REPOSITORY}":
                return self.metadata
            if "/comments?" in endpoint:
                return self.discussion
            self.assertEqual(endpoint, f"repos/{REPOSITORY}/issues/8252")
            return self.document

        self.api = AsyncMock(side_effect=api)
        self.github.api = self.api
        self.tools = InvestigationTools(
            self.github, self.directory, ROOT / "packages" / "pyright" / "index.js", {},
            linked_issues={URL: [issue().html_url]},
        )

    async def read(self, operation="linked_issue", url=URL, **options: JsonValue):
        return await self.tools.github_read(ToolInvocation(
            session_id="test", tool_call_id="linked", tool_name="github_read",
            arguments={"operation": operation, "url": url, **options},
        ))

    def test_only_canonical_external_issue_links_in_body_and_comments_seed_scope(self):
        target = issue()
        target.title = "https://github.com/untrusted/title/issues/1"
        target.body = f"[related]({URL}#issuecomment-123), plus {URL}/."
        comments: list[JsonValue] = [
            {"body": f"<{URL}>"},
            {"body": "https://github.com/Microsoft/Other/issues/12"},
            {"html_url": "https://github.com/untrusted/metadata/issues/1", "body": 1},
            {"body": "https://github.com/microsoft/pyright/issues/456"},
            {"body": "https://github.com/untrusted/repo/pull/1"},
            {"body": "https://github.com/untrusted/repo/issues/1?next=ignored"},
            {"body": "https://evil.invalid/?next=https://github.com/untrusted/repo/issues/1"},
        ]
        sources = linked_issue_sources(target, comments)
        self.assertEqual(set(sources), {URL, "https://github.com/microsoft/other/issues/12"})
        self.assertEqual(sources[URL], [target.html_url, f"{target.html_url} (comment index 0)"])

    async def test_unadvertised_malformed_or_ambiguous_urls_never_fetch(self):
        for url in (
            URL + "?page=2", URL.replace("https:", "http:"), URL.replace("github.com", "github.com.evil"),
            URL.replace("github.com", "user@github.com"), URL.replace("github.com", "github.com:443"),
            URL.replace("/issues/", "/pull/"), URL.replace("/8252", "/08252"), URL.replace("8252", "%38%32%35%32"),
            URL + "/../../other", URL.replace("/issues/", "\\issues\\"), URL + "#unknown",
            "https://api.github.com/repos/microsoft/pylance-release/issues/8252",
            "https://github.com/microsoft/other/issues/8252",
        ):
            with self.subTest(url=url):
                result = await self.read(url=url)
                self.assertEqual(result.result_type, "failure")
        for options in ({"number": 8252}, {"query": "ordinary"}, {"page": 2}):
            result = await self.tools.github_read(ToolInvocation(
                session_id="test", tool_call_id="linked", tool_name="github_read",
                arguments={"operation": "linked_issue", "url": URL, **options},
            ))
            self.assertEqual(result.result_type, "failure")
        self.assertEqual((await self.read("search", query="is:issue")).result_type, "failure")
        self.api.assert_not_awaited()
        self.screen.assert_not_awaited()
        with self.assertRaises(ValidationError):
            GitHubRead(operation="linked_comments", url=URL, page=5)

    async def test_public_issue_and_discussion_are_screened_and_logged_with_provenance(self):
        result = await self.read(url=URL + "#issuecomment-1")
        self.assertEqual(result.result_type, "success")
        payload = json.loads(result.text_result_for_llm or "")
        self.assertEqual(payload["content"], self.document)
        self.assertEqual(payload["originating_sources"], [issue().html_url])
        self.assertEqual(payload["requests_used"], 2)
        assert self.screen.await_args is not None
        self.assertEqual(self.screen.await_args.args[0], payload)
        self.assertTrue(self.screen.await_args.args[2].startswith("linked-issue:linked_issue:"))
        result = await self.read("linked_comments")
        payload = json.loads(result.text_result_for_llm or "")
        self.assertEqual(payload["content"], self.discussion)
        self.assertTrue(payload["complete"])
        self.assertIsNone(payload["next_page"])
        self.assertEqual(self.api.await_count, 3)
        self.assertEqual(self.screen.await_count, 2)
        ledger = [json.loads(line) for line in (self.directory / "checks.jsonl").read_text().splitlines()]
        delivered = [row for row in ledger if row.get("result") is not None]
        self.assertEqual(len(delivered), 2)
        self.assertTrue(all(row["screening"] == "screened_linked_issue" for row in delivered))
        self.assertEqual(self.github.mutations, [])

    async def test_scope_is_frozen_and_newly_read_links_do_not_expand_it(self):
        other = "https://github.com/microsoft/other/issues/1"
        self.document["body"] = f"Follow {other} next"
        self.assertEqual((await self.read()).result_type, "success")
        self.assertEqual((await self.read(url=other)).result_type, "failure")
        self.assertEqual(self.api.await_count, 2)

    async def test_private_unidentified_or_redirected_repositories_fail_closed(self):
        for metadata in (
            {"full_name": REPOSITORY, "private": True}, {"full_name": REPOSITORY},
            {"full_name": "microsoft/other", "private": False}, [], None,
        ):
            self.api.return_value = metadata
            self.api.side_effect = None
            self.api.reset_mock()
            result = await self.read()
            self.assertEqual(result.result_type, "failure")
            self.api.assert_awaited_once()
        self.screen.assert_not_awaited()

    async def test_wrong_issue_or_pull_request_identity_is_rejected(self):
        for document in (
            {**self.document, "number": 1}, {**self.document, "pull_request": {}},
            {**self.document, "html_url": URL.replace("8252", "8253")}, [],
        ):
            self.api.side_effect = [self.metadata, document] if not self.tools._linked_public_repositories else [document]
            self.assertEqual((await self.read()).result_type, "failure")
        self.screen.assert_not_awaited()

    async def test_verified_issue_rejects_malformed_or_foreign_comments(self):
        self.assertEqual((await self.read()).result_type, "success")
        self.screen.reset_mock()
        for discussion in ({"body": "wrong shape"}, [None], [{"html_url": URL + "3#issuecomment-1"}]):
            self.api.side_effect = [discussion]
            result = await self.read("linked_comments")
            self.assertEqual(result.result_type, "failure")
            self.assertIn("unexpected shape or refer to another issue", result.text_result_for_llm or "")
        self.screen.assert_not_awaited()

    async def test_pagination_never_claims_an_unread_discussion_is_complete(self):
        self.discussion[:] = [{"html_url": URL + f"#issuecomment-{index}", "body": "Comment"} for index in range(1, 31)]
        first = json.loads((await self.read("linked_comments")).text_result_for_llm or "")
        self.assertFalse(first["complete"])
        self.assertEqual(first["next_page"], 2)
        final = json.loads((await self.read("linked_comments", page=4)).text_result_for_llm or "")
        self.assertFalse(final["complete"])
        self.assertTrue(final["limit_reached"])
        self.assertIsNone(final["next_page"])
        assert self.api.await_args is not None
        self.assertEqual(self.api.await_args.args[1], f"repos/{REPOSITORY}/issues/8252/comments?per_page=30&page=4")

    async def test_reading_a_terminal_page_does_not_hide_skipped_prior_pages(self):
        terminal = json.loads((await self.read("linked_comments", page=2)).text_result_for_llm or "")
        self.assertFalse(terminal["complete"])
        self.assertEqual(terminal["missing_prior_pages"], [1])
        self.assertIsNone(terminal["next_page"])
        await self.read("linked_comments", page=1)
        terminal = json.loads((await self.read("linked_comments", page=2)).text_result_for_llm or "")
        self.assertTrue(terminal["complete"])
        self.assertEqual(terminal["missing_prior_pages"], [])

    async def test_failed_http_reads_consume_the_shared_allowance(self):
        self.api.side_effect = AutomationError("HTTP unavailable")
        for _ in range(LINKED_ISSUE_REQUESTS):
            self.assertEqual((await self.read()).result_type, "failure")
        self.assertEqual(self.api.await_count, LINKED_ISSUE_REQUESTS)
        result = await self.read("linked_comments")
        self.assertEqual(result.result_type, "failure")
        self.assertIn("allowance exhausted", result.text_result_for_llm or "")
        self.assertEqual(self.api.await_count, LINKED_ISSUE_REQUESTS)

    async def test_comment_only_access_still_verifies_that_the_link_is_an_issue(self):
        self.document["pull_request"] = {}
        self.assertEqual((await self.read("linked_comments")).result_type, "failure")
        self.assertEqual(self.api.await_count, 2)
        self.assertFalse(any("/comments?" in call.args[1] for call in self.api.await_args_list))
        self.screen.assert_not_awaited()

    async def test_single_response_and_aggregate_byte_boundaries_never_truncate(self):
        overhead = len(json.dumps(self.document, ensure_ascii=True).encode("utf-8")) - len("Original linked report")
        self.document["body"] = "x" * (LINKED_ISSUE_RESPONSE_BYTES - overhead)
        for _ in range(3):
            result = await self.read()
            self.assertEqual(result.result_type, "success")
            self.assertEqual(json.loads(result.text_result_for_llm or "")["content"], self.document)
        result = await self.read()
        self.assertEqual(result.result_type, "failure")
        self.assertIn("not truncated or delivered", result.text_result_for_llm or "")
        calls = self.api.await_count
        self.assertEqual((await self.read()).result_type, "failure")
        self.assertEqual(self.api.await_count, calls)

    async def test_oversized_individual_response_is_not_screened_or_delivered(self):
        self.document["body"] = "x" * LINKED_ISSUE_RESPONSE_BYTES
        result = await self.read()
        self.assertEqual(result.result_type, "failure")
        self.assertNotIn("x" * 100, result.text_result_for_llm or "")
        self.screen.assert_not_awaited()

    async def test_exact_aggregate_byte_allowance_succeeds_then_prevents_more_http(self):
        overhead = len(json.dumps(self.document, ensure_ascii=True).encode("utf-8")) - len("Original linked report")
        metadata_bytes = len(json.dumps(self.metadata, ensure_ascii=True).encode("utf-8"))
        self.document["body"] = "x" * (LINKED_ISSUE_RESPONSE_BYTES - overhead - metadata_bytes)
        self.assertEqual((await self.read()).result_type, "success")
        self.document["body"] = "x" * (LINKED_ISSUE_RESPONSE_BYTES - overhead)
        for _ in range(3):
            self.assertEqual((await self.read()).result_type, "success")
        self.assertEqual(self.tools._linked_bytes, LINKED_ISSUE_TOTAL_BYTES)
        calls = self.api.await_count
        result = await self.read()
        self.assertEqual(result.result_type, "failure")
        self.assertIn("allowance exhausted", result.text_result_for_llm or "")
        self.assertEqual(self.api.await_count, calls)

    async def test_unconfigured_screening_cannot_deliver_linked_evidence(self):
        github = GitHub()
        github.api = self.api
        self.tools.github = github
        result = await self.read()
        self.assertEqual(result.result_type, "failure")
        self.assertIn("screening is not configured", result.text_result_for_llm or "")
        self.assertIsNotNone(self.tools.screening_error)
        self.assertNotIn("Original linked report", result.text_result_for_llm or "")
        self.assertNotIn("Original linked report", (self.directory / "checks.jsonl").read_text())

    async def test_screening_failure_blocks_the_role_and_never_delivers_content(self):
        self.document["body"] = "blocked-content-marker"
        self.screen.side_effect = ScreeningBlocked("Classifier rejected linked evidence")
        result = await self.read()
        self.assertEqual(result.result_type, "failure")
        self.assertIsNotNone(self.tools.screening_error)
        self.assertNotIn("blocked-content-marker", result.text_result_for_llm or "")
        self.assertNotIn("blocked-content-marker", (self.directory / "checks.jsonl").read_text())
        self.assertEqual((await self.read("linked_comments")).result_type, "failure")
        self.assertEqual(self.api.await_count, 2)
        self.assertEqual(self.github.mutations, [])

    async def test_stop_during_http_does_not_deliver_or_fetch_followup_data(self):
        entered, finish = asyncio.Event(), asyncio.Event()

        async def delayed(*_args):
            entered.set()
            await finish.wait()
            return self.metadata

        self.api.side_effect = delayed
        pending = asyncio.create_task(self.read())
        await entered.wait()
        await self.tools.stop_screening()
        finish.set()
        result = await pending
        self.assertEqual(result.result_type, "failure")
        self.api.assert_awaited_once()
        self.screen.assert_not_awaited()

    def test_github_web_fetch_remains_denied_even_for_an_advertised_issue(self):
        request = PermissionRequestUrl(url=URL, intention="Read the linked issue")
        self.assertIsInstance(self.tools.permission(request, {"session_id": "test"}), PermissionDecisionReject)


if __name__ == "__main__":
    unittest.main()
