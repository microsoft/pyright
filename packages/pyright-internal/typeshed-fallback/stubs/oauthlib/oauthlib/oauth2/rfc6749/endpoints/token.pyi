from _typeshed import Incomplete
from logging import Logger

from oauthlib.common import Request, _HTTPMethod

from .base import BaseEndpoint

log: Logger

class TokenEndpoint(BaseEndpoint):
    valid_request_methods: tuple[str]
    def __init__(self, default_grant_type, default_token_type, grant_types) -> None: ...
    @property
    def grant_types(self): ...
    @property
    def default_grant_type(self): ...
    @property
    def default_grant_type_handler(self): ...
    @property
    def default_token_type(self): ...
    def create_token_response(
        self,
        uri: str,
        http_method: _HTTPMethod = "POST",
        body: str | None = None,
        headers: dict[str, str] | None = None,
        credentials: Incomplete | None = None,
        grant_type_for_scope: Incomplete | None = None,
        claims: Incomplete | None = None,
    ): ...
    def validate_token_request(self, request: Request) -> None: ...
