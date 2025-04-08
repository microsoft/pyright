from _typeshed import Incomplete
from logging import Logger
from typing import Any

from oauthlib.common import Request, _HTTPMethod

from .base import BaseEndpoint

log: Logger

class IntrospectEndpoint(BaseEndpoint):
    valid_token_types: Any
    valid_request_methods: Any
    request_validator: Any
    supported_token_types: Any
    def __init__(self, request_validator, supported_token_types: Incomplete | None = None) -> None: ...
    def create_introspect_response(
        self, uri: str, http_method: _HTTPMethod = "POST", body: str | None = None, headers: dict[str, str] | None = None
    ): ...
    def validate_introspect_request(self, request: Request) -> None: ...
