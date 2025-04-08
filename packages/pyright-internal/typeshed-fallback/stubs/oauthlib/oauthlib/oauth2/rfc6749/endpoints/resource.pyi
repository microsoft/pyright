from _typeshed import Incomplete
from logging import Logger

from oauthlib.common import Request, _HTTPMethod

from .base import BaseEndpoint

log: Logger

class ResourceEndpoint(BaseEndpoint):
    def __init__(self, default_token, token_types) -> None: ...
    @property
    def default_token(self): ...
    @property
    def default_token_type_handler(self): ...
    @property
    def tokens(self): ...
    def verify_request(
        self,
        uri,
        http_method: _HTTPMethod = "GET",
        body: str | None = None,
        headers: dict[str, str] | None = None,
        scopes: Incomplete | None = None,
    ): ...
    def find_token_type(self, request: Request): ...
