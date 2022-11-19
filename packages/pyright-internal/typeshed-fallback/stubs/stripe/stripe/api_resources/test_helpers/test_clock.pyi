from _typeshed import Self
from typing import Any
from typing_extensions import Literal

from stripe.api_resources.abstract import CreateableAPIResource, DeletableAPIResource, ListableAPIResource

class TestClock(CreateableAPIResource, DeletableAPIResource, ListableAPIResource):
    OBJECT_NAME: Literal["test_helpers.test_clock"]

    @classmethod
    def advance(cls: type[Self], idempotency_key: str | None = ..., **params: Any) -> Self: ...
