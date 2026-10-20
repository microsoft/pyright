# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Provider-independent Choice classification; compatible with Python 3.10+."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Annotated, Protocol

from pydantic import BaseModel, Field, JsonValue, model_validator

Probability = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]


class ClassificationError(Exception):
    pass


class ClassificationAuthenticationError(ClassificationError):
    def __init__(self, status: int | None = None):
        self.status = status
        super().__init__(
            f"Classifier authentication/authorization failed (HTTP {status})" if status is not None
            else "Classifier authentication failed; configure an identity with inference access"
        )


class ClassificationHTTPError(ClassificationError):
    def __init__(self, status: int, *, retry_after: float | None = None):
        if retry_after is not None and (not math.isfinite(retry_after) or retry_after < 0):
            raise ValueError("Retry delay must be finite and nonnegative")
        self.status, self.retry_after = status, retry_after
        super().__init__(f"Classifier returned HTTP {status}")


class ClassificationResponseError(ClassificationError):
    pass


class ClassificationTimeoutError(ClassificationError):
    pass


class ClassificationConnectionError(ClassificationError):
    pass


class ChoiceClassification(BaseModel):
    choice: str = Field(strict=True, min_length=1)
    probabilities: dict[str, Probability] = Field(min_length=2)
    model: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_distribution(self) -> ChoiceClassification:
        if (
            self.choice not in self.probabilities
            or not math.isclose(sum(self.probabilities.values()), 1, rel_tol=0, abs_tol=1e-6)
            or self.probabilities[self.choice] < max(self.probabilities.values())
        ):
            raise ValueError("Choice must be a highest-probability label in a normalized distribution")
        return self


class ChoiceClassifier(Protocol):
    @property
    def configuration_hash(self) -> str: ...

    async def classify(
        self, state: JsonValue, *, name: str, instructions: str, criteria: Mapping[str, str],
        timeout: float = 30,
    ) -> ChoiceClassification: ...
