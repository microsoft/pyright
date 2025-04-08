from _typeshed import Incomplete
from typing import ClassVar

from auth0.exceptions import TokenValidationError as TokenValidationError

class SignatureVerifier:
    DISABLE_JWT_CHECKS: ClassVar[dict[str, bool]]
    def __init__(self, algorithm: str) -> None: ...
    async def verify_signature(self, token: str) -> dict[str, Incomplete]: ...

class SymmetricSignatureVerifier(SignatureVerifier):
    def __init__(self, shared_secret: str, algorithm: str = "HS256") -> None: ...

class JwksFetcher:
    CACHE_TTL: ClassVar[int]
    def __init__(self, jwks_url: str, cache_ttl: int = ...) -> None: ...
    def get_key(self, key_id: str): ...

class AsymmetricSignatureVerifier(SignatureVerifier):
    def __init__(self, jwks_url: str, algorithm: str = "RS256", cache_ttl: int = ...) -> None: ...

class TokenVerifier:
    iss: Incomplete
    aud: Incomplete
    leeway: Incomplete
    def __init__(self, signature_verifier: SignatureVerifier, issuer: str, audience: str, leeway: int = 0) -> None: ...
    def verify(
        self, token: str, nonce: str | None = None, max_age: int | None = None, organization: str | None = None
    ) -> dict[str, Incomplete]: ...
