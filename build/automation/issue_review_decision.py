# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Microsoft-Decision-1 REST adapter using Microsoft Entra ID, never API keys."""

from __future__ import annotations

import asyncio
import hashlib
import http.client
import json
import math
import os
import threading
import time
from collections.abc import Mapping
from email.utils import parsedate_to_datetime
from typing import Literal
from urllib.parse import urlparse

from azure.core.credentials import TokenCredential
from azure.core.exceptions import ClientAuthenticationError, ServiceRequestError, ServiceResponseError
from azure.identity import DefaultAzureCredential
from pydantic import BaseModel, JsonValue, ValidationError

from issue_review_classifier import (
    ChoiceClassification,
    ClassificationAuthenticationError,
    ClassificationConnectionError,
    ClassificationHTTPError,
    ClassificationResponseError,
    ClassificationTimeoutError,
)

ENVIRONMENT = {"AZURE_ENDPOINT", "DEPLOYMENT_NAME"}
TOKEN_SCOPE = "https://cognitiveservices.azure.com/.default"
DECISION_PATH = "/providers/microsoft/v1/systemone"
MAX_RESPONSE_BYTES = 1024 * 1024


def _retry_after(value: str | None) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        seconds = float(value)
    except ValueError:
        try:
            when = parsedate_to_datetime(value)
            if when.tzinfo is None:
                return None
            seconds = max(0, when.timestamp() - time.time())
        except (ValueError, TypeError, OverflowError, OSError):
            return None
    return seconds if math.isfinite(seconds) and seconds >= 0 else None


class _ChoiceAnswer(ChoiceClassification):
    type: Literal["choice"]


class _DecisionResponse(BaseModel):
    answers: dict[str, _ChoiceAnswer]
    model: str | None = None


class MicrosoftDecisionClassifier:
    def __init__(self, endpoint: str, deployment: str, *, credential: TokenCredential | None = None):
        try:
            parsed = urlparse(endpoint)
            port = parsed.port
        except ValueError:
            raise ValueError("AZURE_ENDPOINT must be a valid HTTPS resource endpoint") from None
        if (
            parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or any(character.isspace() for character in endpoint)
        ):
            raise ValueError("AZURE_ENDPOINT must be an explicit HTTPS resource endpoint without credentials or queries")
        if not deployment.strip():
            raise ValueError("DEPLOYMENT_NAME must specify the existing model deployment")
        self._host, self._port = parsed.hostname, port
        self._path = parsed.path.rstrip("/") + DECISION_PATH
        self._deployment, self._credential = deployment.strip(), credential
        self._configuration_hash = hashlib.sha256(json.dumps({
            "provider": "microsoft-decision-1", "endpoint": endpoint.rstrip("/"),
            "deployment": self._deployment, "scope": TOKEN_SCOPE, "path": DECISION_PATH,
        }, sort_keys=True).encode()).hexdigest()

    @property
    def configuration_hash(self) -> str:
        return self._configuration_hash

    @classmethod
    def from_environment(cls) -> MicrosoftDecisionClassifier:
        endpoint, deployment = (os.environ.get(key, "").strip() for key in ("AZURE_ENDPOINT", "DEPLOYMENT_NAME"))
        if not endpoint or not deployment:
            raise ValueError(
                "Issue screening is required. Configure AZURE_ENDPOINT and DEPLOYMENT_NAME and authenticate "
                "with Microsoft Entra ID; analysis is disabled."
            )
        return cls(endpoint, deployment)

    async def classify(
        self, state: JsonValue, *, name: str, instructions: str, criteria: Mapping[str, str],
        timeout: float = 30,
    ) -> ChoiceClassification:
        if not name.strip() or not instructions.strip() or not 2 <= len(criteria) <= 255:
            raise ValueError("Choice classification requires a name, instructions and 2-255 labels")
        if any(not label.strip() or not isinstance(description, str) for label, description in criteria.items()):
            raise ValueError("Choice labels must be nonempty strings with string descriptions")
        if not isinstance(state, (str, dict, list)):
            raise ValueError("Classifier state must be input text, a JSON object or a JSON array")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Classifier timeout must be positive and finite")
        body = json.dumps({
            "model": self._deployment, "state": state,
            "questions": {name: {"type": "choice", "instructions": instructions, "criteria": dict(criteria)}},
        }, ensure_ascii=True, allow_nan=False).encode("utf-8")
        deadline = time.monotonic() + timeout
        cancelled = threading.Event()
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._classify, body, name, criteria, timeout, deadline, cancelled),
                timeout=timeout,
            )
        except (ClientAuthenticationError, ValueError):
            raise ClassificationAuthenticationError() from None
        except (asyncio.TimeoutError, TimeoutError):
            raise ClassificationTimeoutError("Classifier authentication or request timed out") from None
        except (ServiceRequestError, ServiceResponseError, OSError, http.client.HTTPException):
            raise ClassificationConnectionError("Classifier authentication or HTTPS connection failed") from None
        finally:
            cancelled.set()

    def _classify(
        self, body: bytes, name: str, criteria: Mapping[str, str], timeout: float,
        deadline: float, cancelled: threading.Event,
    ) -> ChoiceClassification:
        if self._credential is not None:
            return self._request(self._credential, body, name, criteria, deadline, cancelled)
        with DefaultAzureCredential(
            process_timeout=timeout, connection_timeout=timeout, read_timeout=timeout,
            retry_total=0, logging_enable=False,
        ) as credential:
            return self._request(credential, body, name, criteria, deadline, cancelled)

    def _request(
        self, credential: TokenCredential, body: bytes, name: str, criteria: Mapping[str, str],
        deadline: float, cancelled: threading.Event,
    ) -> ChoiceClassification:
        access_token = credential.get_token(TOKEN_SCOPE).token
        if not access_token or any(character.isspace() or ord(character) < 32 for character in access_token):
            raise ClassificationAuthenticationError()
        remaining = deadline - time.monotonic()
        # Synchronous identity providers may finish after cancellation; never send a late request.
        if remaining <= 0 or cancelled.is_set():
            raise ClassificationTimeoutError("Classifier authentication exceeded the request deadline")
        connection = http.client.HTTPSConnection(self._host, port=self._port, timeout=remaining)
        try:
            connection.request("POST", self._path, body=body, headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json", "Accept": "application/json",
            })
            response = connection.getresponse()
            if response.status in {401, 403}:
                raise ClassificationAuthenticationError(response.status)
            if not 200 <= response.status < 300:
                raise ClassificationHTTPError(
                    response.status,
                    retry_after=_retry_after(response.getheader("Retry-After")) if response.status == 429 else None,
                )
            data = response.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                raise ClassificationResponseError("Classifier response exceeds the size limit")
        finally:
            connection.close()
        if time.monotonic() >= deadline:
            raise ClassificationTimeoutError("Classifier request exceeded its deadline")
        try:
            result = _DecisionResponse.model_validate_json(data)
            if set(result.answers) != {name}:
                raise ValueError("Unexpected classification answers")
            answer = result.answers[name]
            if set(answer.probabilities) != set(criteria):
                raise ValueError("Probabilities do not match the requested labels")
            return ChoiceClassification(
                choice=answer.choice, probabilities=answer.probabilities, model=result.model,
            )
        except (ValidationError, ValueError):
            raise ClassificationResponseError("Classifier returned malformed Choice JSON or probabilities") from None
