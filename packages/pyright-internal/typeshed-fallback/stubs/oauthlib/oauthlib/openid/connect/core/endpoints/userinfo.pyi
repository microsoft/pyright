from _typeshed import Incomplete
from logging import Logger
from typing import Any

from oauthlib.oauth2.rfc6749.endpoints.base import BaseEndpoint as BaseEndpoint

log: Logger

class UserInfoEndpoint(BaseEndpoint):
    bearer: Any
    request_validator: Any
    def __init__(self, request_validator) -> None: ...
    def create_userinfo_response(
        self, uri, http_method: str = "GET", body: Incomplete | None = None, headers: Incomplete | None = None
    ): ...
    def validate_userinfo_request(self, request) -> None: ...
