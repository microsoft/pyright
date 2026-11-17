from collections.abc import Generator
from contextlib import _AsyncGeneratorContextManager
from typing import ClassVar
from typing_extensions import Never, Self

import httpx2
from authlib.oauth2.auth import ClientAuth, TokenAuth
from authlib.oauth2.client import OAuth2Client as _OAuth2Client

from ..base_client import OAuthError

USE_CLIENT_DEFAULT = httpx2.USE_CLIENT_DEFAULT
Auth = httpx2.Auth
Request = httpx2.Request
Response = httpx2.Response

__all__ = ["OAuth2Auth", "OAuth2ClientAuth", "AsyncOAuth2Client", "OAuth2Client"]

class OAuth2Auth(Auth, TokenAuth):
    requires_request_body: bool
    def auth_flow(self, request: Request) -> Generator[Request, Response]: ...

class OAuth2ClientAuth(Auth, ClientAuth):
    requires_request_body: bool
    def auth_flow(self, request: Request) -> Generator[Request, Response]: ...

class AsyncOAuth2Client(_OAuth2Client, httpx2.AsyncClient):
    SESSION_REQUEST_PARAMS: ClassVar[list[str]]
    client_auth_class: ClassVar[type[OAuth2ClientAuth]]
    token_auth_class: ClassVar[type[OAuth2Auth]]
    oauth_error_class: ClassVar[type[OAuthError]]
    def __init__(
        self,
        client_id=None,
        client_secret=None,
        token_endpoint_auth_method=None,
        revocation_endpoint_auth_method=None,
        scope=None,
        redirect_uri=None,
        token=None,
        token_placement="header",
        update_token=None,
        leeway=60,
        **kwargs,
    ) -> None: ...
    async def __aenter__(self) -> Self: ...
    async def request(self, method, url, withhold_token: bool = False, auth=..., **kwargs): ...
    def stream(
        self, method, url, withhold_token: bool = False, auth=..., **kwargs
    ) -> _AsyncGeneratorContextManager[Response]: ...
    async def ensure_active_token(self, token): ...  # type: ignore[override]

class OAuth2Client(_OAuth2Client, httpx2.Client):
    SESSION_REQUEST_PARAMS: ClassVar[list[str]]
    client_auth_class: ClassVar[type[OAuth2ClientAuth]]
    token_auth_class: ClassVar[type[OAuth2Auth]]
    oauth_error_class: ClassVar[type[OAuthError]]
    def __init__(
        self,
        client_id=None,
        client_secret=None,
        token_endpoint_auth_method=None,
        revocation_endpoint_auth_method=None,
        scope=None,
        redirect_uri=None,
        token=None,
        token_placement="header",
        update_token=None,
        **kwargs,
    ) -> None: ...
    @staticmethod
    def handle_error(error_type: str | None, error_description: str | None) -> Never: ...
    def request(self, method, url, withhold_token: bool = False, auth=..., **kwargs): ...
    def stream(self, method, url, withhold_token: bool = False, auth=..., **kwargs): ...
