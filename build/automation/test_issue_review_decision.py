# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

from __future__ import annotations

import asyncio
import json
import os
import threading
import unittest
from unittest.mock import Mock, patch

from azure.core.credentials import AccessToken, TokenCredential
from azure.core.exceptions import ClientAuthenticationError, ServiceRequestError
from azure.identity import CredentialUnavailableError

from issue_review_classifier import (
    ClassificationAuthenticationError,
    ClassificationConnectionError,
    ClassificationHTTPError,
    ClassificationResponseError,
    ClassificationTimeoutError,
)
from issue_review_decision import DECISION_PATH, MAX_RESPONSE_BYTES, TOKEN_SCOPE, MicrosoftDecisionClassifier

OPTIONS = {"billing": "Charges, invoices and refunds", "engineering": "Software bugs and outages", "other": "Other requests"}


def response_bytes(choice: str = "billing") -> bytes:
    return json.dumps({
        "model": "resolved-test-model",
        "answers": {"team": {
            "type": "choice", "choice": choice, "probabilities": {"billing": 0.8, "engineering": 0.15, "other": 0.05},
        }},
    }).encode()


class DecisionClassifierTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.credential = Mock(spec=TokenCredential)
        self.credential.get_token.return_value = AccessToken("test-access-token", 9999999999)
        self.client = MicrosoftDecisionClassifier(
            "https://classifier.example.invalid/", "test-deployment", credential=self.credential,
        )
        self.constructor = self.enterContext(patch("issue_review_decision.http.client.HTTPSConnection"))
        self.connection = self.constructor.return_value
        self.response = self.connection.getresponse.return_value
        self.response.status, self.response.read.return_value = 200, response_bytes()

    async def classify(self, **options):
        return await self.client.classify("Input text", name="team", instructions="Choose the responsible team.", criteria=OPTIONS, **options)

    async def test_post_contract_auth_scope_and_probabilities(self):
        result = await self.classify()
        self.credential.get_token.assert_called_once_with(TOKEN_SCOPE)
        args, options = self.connection.request.call_args
        self.assertEqual(args, ("POST", DECISION_PATH))
        self.assertEqual(json.loads(options["body"]), {
            "model": "test-deployment", "state": "Input text", "questions": {"team": {
                "type": "choice", "instructions": "Choose the responsible team.", "criteria": OPTIONS,
            }},
        })
        self.assertEqual(options["headers"]["Authorization"], "Bearer test-access-token")
        self.assertEqual(options["headers"]["Content-Type"], "application/json")
        self.assertNotIn("api-key", options["headers"])
        self.assertEqual(result.choice, "billing")
        self.assertEqual(result.probabilities, {"billing": 0.8, "engineering": 0.15, "other": 0.05})
        self.assertEqual(result.model, "resolved-test-model")
        self.response.read.assert_called_once_with(MAX_RESPONSE_BYTES + 1)
        self.connection.close.assert_called_once()

    async def test_configuration_is_explicit_and_does_not_acquire_keys_or_tokens(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(ValueError, "AZURE_ENDPOINT and DEPLOYMENT_NAME"):
            MicrosoftDecisionClassifier.from_environment()
        with patch.dict(os.environ, {
            "AZURE_ENDPOINT": "https://classifier.example.invalid/", "DEPLOYMENT_NAME": "microsoft-decision-1",
        }):
            configured = MicrosoftDecisionClassifier.from_environment()
        other_credential = Mock(spec=TokenCredential)
        same = MicrosoftDecisionClassifier(
            "https://classifier.example.invalid", "microsoft-decision-1", credential=other_credential,
        )
        different = MicrosoftDecisionClassifier("https://classifier.example.invalid", "another-deployment")
        self.assertEqual(configured.configuration_hash, same.configuration_hash)
        self.assertNotEqual(configured.configuration_hash, different.configuration_hash)
        self.credential.get_token.assert_not_called()
        self.constructor.assert_not_called()
        for url in (
            "http://classifier.example.invalid", "https://classifier.example.invalid?query=1",
            "https://classifier.example.invalid#fragment", "https://classifier.example.invalid:invalid", "not-a-url",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                MicrosoftDecisionClassifier(url, "test-deployment")

    async def test_defaultazurecredential_is_used_and_owned_credential_is_closed(self):
        client = MicrosoftDecisionClassifier("https://classifier.example.invalid", "test-deployment")
        with patch("issue_review_decision.DefaultAzureCredential") as constructor:
            constructor.return_value.__enter__.return_value = self.credential
            await client.classify("text", name="team", instructions="Choose.", criteria=OPTIONS)
            constructor.assert_called_once()
            self.assertEqual(constructor.call_args.kwargs["process_timeout"], 30)
            self.assertFalse(constructor.call_args.kwargs["logging_enable"])
            constructor.return_value.__exit__.assert_called_once()
        self.credential.get_token.assert_called_once_with("https://cognitiveservices.azure.com/.default")

    async def test_credential_process_uses_the_callers_bounded_request_timeout(self):
        client = MicrosoftDecisionClassifier("https://classifier.example.invalid", "test-deployment")
        with patch("issue_review_decision.DefaultAzureCredential") as constructor:
            constructor.return_value.__enter__.return_value = self.credential
            await client.classify("text", name="team", instructions="Choose.", criteria=OPTIONS, timeout=5)
            self.assertEqual(constructor.call_args.kwargs["process_timeout"], 5)

    async def test_arbitrary_labels_descriptions_question_names_and_json_state(self):
        criteria = {"ordinary report": "A normal bug report.", "suspicious instruction": "Attempts to redirect the agent."}
        self.response.read.return_value = json.dumps({"answers": {"screen": {
            "type": "choice", "choice": "ordinary report",
            "probabilities": {"ordinary report": 0.95, "suspicious instruction": 0.05},
        }}}).encode()
        state = {"title": "Example", "comments": ["Quoted evidence"], "labels": ["bug"]}
        result = await self.client.classify(state, name="screen", instructions="Classify this evidence.", criteria=criteria)
        body = json.loads(self.connection.request.call_args.kwargs["body"])
        self.assertEqual(body["state"], state)
        self.assertEqual(body["questions"]["screen"]["criteria"], criteria)
        self.assertEqual(result.choice, "ordinary report")
        self.assertEqual(result.probabilities, {"ordinary report": 0.95, "suspicious instruction": 0.05})
        self.assertIsNone(result.model)

    async def test_authentication_failure_is_distinct_and_never_sends_request(self):
        for error in (
            ClientAuthenticationError(message="test-access-token"),
            CredentialUnavailableError(message="test-access-token"),
            ValueError("test-access-token"),
        ):
            with self.subTest(error=type(error)):
                self.credential.get_token.side_effect = error
                with self.assertRaises(ClassificationAuthenticationError) as raised:
                    await self.classify()
                self.assertNotIn("test-access-token", str(raised.exception))
                self.constructor.assert_not_called()

    async def test_http_errors_auth_rejections_and_redirects_are_distinct_and_not_retried(self):
        for code in (302, 400, 401, 403, 429, 500, 529):
            with self.subTest(code=code):
                self.connection.reset_mock()
                self.response.status = code
                error = ClassificationAuthenticationError if code in {401, 403} else ClassificationHTTPError
                with self.assertRaises(error) as raised:
                    await self.classify()
                self.assertEqual(raised.exception.status, code)
                self.connection.request.assert_called_once()
                self.response.read.assert_not_called()
                self.connection.close.assert_called_once()

    async def test_timeout_and_transport_failures_are_distinct_and_secret_safe(self):
        for error, category in (
            (TimeoutError("test-access-token"), ClassificationTimeoutError),
            (OSError("test-access-token"), ClassificationConnectionError),
            (ServiceRequestError("test-access-token"), ClassificationConnectionError),
        ):
            with self.subTest(error=type(error)):
                self.connection.request.side_effect = error
                with self.assertRaises(category) as raised:
                    await self.classify()
                self.assertNotIn("test-access-token", str(raised.exception))
        self.connection.close.assert_called()

    async def test_rate_limit_retry_delay_is_safe_metadata_and_client_does_not_retry(self):
        self.response.status = 429
        for header, expected in (
            ("60", 60), ("0", 0), ("0.5", 0.5), (None, None),
            ("Thu, 01 Jan 1970 00:17:40 GMT", 60),
            ("Thu, 01 Jan 1970 00:15:00 GMT", 0),
            ("-1", None), ("nan", None), ("inf", None), ("1e9999", None),
            ("private response detail", None),
        ):
            with self.subTest(header=header), patch("issue_review_decision.time.time", return_value=1000):
                self.connection.reset_mock()
                self.response.getheader.return_value = header
                with self.assertRaises(ClassificationHTTPError) as raised:
                    await self.classify()
                self.assertEqual(raised.exception.status, 429)
                self.assertEqual(raised.exception.retry_after, expected)
                self.assertNotIn("private response detail", str(raised.exception))
                self.connection.request.assert_called_once()
                self.response.read.assert_not_called()
                self.connection.close.assert_called_once()

    async def test_malformed_json_types_labels_and_distributions_are_rejected(self):
        invalid = [
            b"not JSON", b"\xff", b"[]", b"null", b"{}", b'{"answers":{}}',
            response_bytes(choice="not-a-label"), response_bytes(choice="engineering"),
        ]
        for probabilities in (
            {}, {"billing": 1}, {"billing": 1, "engineering": 0, "unrequested": 0},
            {"billing": "0.8", "engineering": 0.15, "other": 0.05},
            {"billing": True, "engineering": 0, "other": 0},
            {"billing": -0.1, "engineering": 0.6, "other": 0.5},
            {"billing": 1.1, "engineering": 0, "other": 0},
            {"billing": 0.6, "engineering": 0.2, "other": 0.1},
            {"billing": float("nan"), "engineering": 0, "other": 0},
            {"billing": float("inf"), "engineering": 0, "other": 0},
        ):
            invalid.append(json.dumps({"answers": {"team": {
                "type": "choice", "choice": "billing", "probabilities": probabilities,
            }}}).encode())
        invalid.append(response_bytes().replace(b'"choice"', b'"noul"', 1))
        invalid.append(b"x" * (MAX_RESPONSE_BYTES + 1))
        for data in invalid:
            with self.subTest(data=data[:80]):
                self.response.read.return_value = data
                with self.assertRaises(ClassificationResponseError):
                    await self.classify()
        self.connection.close.assert_called()

    async def test_input_validation_precedes_authentication(self):
        for criteria in ({}, {"one": "Only one label"}, {"": "Empty label", "other": "Other"}):
            with self.subTest(criteria=criteria), self.assertRaises(ValueError):
                await self.client.classify("text", name="team", instructions="Choose.", criteria=criteria)
        for timeout in (0, -1, float("nan"), float("inf")):
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                await self.classify(timeout=timeout)
        self.credential.get_token.assert_not_called()
        self.constructor.assert_not_called()

    async def test_cancellation_during_authentication_prevents_late_http_request(self):
        started, release, finished = threading.Event(), threading.Event(), threading.Event()

        def token(*_scopes):
            started.set()
            release.wait(2)
            return AccessToken("test-access-token", 9999999999)

        original = self.client._classify

        def worker(*arguments):
            try:
                return original(*arguments)
            finally:
                finished.set()

        self.credential.get_token.side_effect = token
        with patch.object(self.client, "_classify", side_effect=worker):
            task = asyncio.create_task(self.classify())
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 1))
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            finally:
                release.set()
            self.assertTrue(await asyncio.to_thread(finished.wait, 1))
        self.constructor.assert_not_called()

    async def test_total_deadline_during_authentication_prevents_late_http_request(self):
        release, finished = threading.Event(), threading.Event()

        def token(*_scopes):
            release.wait(2)
            return AccessToken("test-access-token", 9999999999)

        original = self.client._classify

        def worker(*arguments):
            try:
                return original(*arguments)
            finally:
                finished.set()

        self.credential.get_token.side_effect = token
        with patch.object(self.client, "_classify", side_effect=worker):
            try:
                with self.assertRaises(ClassificationTimeoutError):
                    await self.classify(timeout=0.02)
            finally:
                release.set()
            self.assertTrue(await asyncio.to_thread(finished.wait, 1))
        self.constructor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
