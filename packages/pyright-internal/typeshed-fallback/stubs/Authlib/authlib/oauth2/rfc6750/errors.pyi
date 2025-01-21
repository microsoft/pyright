from _typeshed import Incomplete

from authlib.oauth2 import OAuth2Error

__all__ = ["InvalidTokenError", "InsufficientScopeError"]

class InvalidTokenError(OAuth2Error):
    error: str
    description: str
    status_code: int
    realm: Incomplete
    extra_attributes: Incomplete
    def __init__(
        self,
        description: Incomplete | None = None,
        uri: Incomplete | None = None,
        status_code: Incomplete | None = None,
        state: Incomplete | None = None,
        realm: Incomplete | None = None,
        **extra_attributes,
    ) -> None: ...
    def get_headers(self): ...

class InsufficientScopeError(OAuth2Error):
    error: str
    description: str
    status_code: int
