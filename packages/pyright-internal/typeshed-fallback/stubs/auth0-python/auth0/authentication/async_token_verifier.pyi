from _typeshed import Incomplete

from .. import TokenValidationError as TokenValidationError
from ..rest_async import AsyncRestClient as AsyncRestClient
from .token_verifier import (
    AsymmetricSignatureVerifier as AsymmetricSignatureVerifier,
    JwksFetcher as JwksFetcher,
    TokenVerifier as TokenVerifier,
)

class AsyncAsymmetricSignatureVerifier(AsymmetricSignatureVerifier):
    def __init__(self, jwks_url: str, algorithm: str = "RS256") -> None: ...
    def set_session(self, session) -> None: ...

class AsyncJwksFetcher(JwksFetcher):
    def __init__(self, *args, **kwargs) -> None: ...
    def set_session(self, session) -> None: ...
    async def get_key(self, key_id: str): ...

class AsyncTokenVerifier(TokenVerifier):
    iss: Incomplete
    aud: Incomplete
    leeway: Incomplete
    def __init__(
        self, signature_verifier: AsyncAsymmetricSignatureVerifier, issuer: str, audience: str, leeway: int = 0
    ) -> None: ...
    def set_session(self, session) -> None: ...
