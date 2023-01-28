from _typeshed import Incomplete, Self

from stripe import api_requestor as api_requestor
from stripe.api_resources.abstract.api_resource import APIResource as APIResource

class CreateableAPIResource(APIResource):
    @classmethod
    def create(
        cls: type[Self],
        api_key: Incomplete | None = ...,
        idempotency_key: str | None = ...,
        stripe_version: Incomplete | None = ...,
        stripe_account: Incomplete | None = ...,
        **params,
    ) -> Self: ...
