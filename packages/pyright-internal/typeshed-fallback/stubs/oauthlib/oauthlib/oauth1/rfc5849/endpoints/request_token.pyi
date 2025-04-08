from _typeshed import Incomplete
from logging import Logger

from .base import BaseEndpoint as BaseEndpoint

log: Logger

class RequestTokenEndpoint(BaseEndpoint):
    def create_request_token(self, request, credentials): ...
    def create_request_token_response(
        self,
        uri,
        http_method: str = "GET",
        body: Incomplete | None = None,
        headers: Incomplete | None = None,
        credentials: Incomplete | None = None,
    ): ...
    def validate_request_token_request(self, request): ...
