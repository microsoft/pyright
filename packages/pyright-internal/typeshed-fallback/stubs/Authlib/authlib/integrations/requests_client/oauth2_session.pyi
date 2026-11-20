from collections.abc import Callable
from http.cookiejar import CookieJar
from typing import Any, ClassVar, TypeVar

from authlib.oauth2.auth import ClientAuth, TokenAuth
from authlib.oauth2.client import OAuth2Client
from oauthlib.oauth2 import OAuth2Token
from requests import PreparedRequest, Response, Session
from requests._types import (
    AuthType,
    CertType,
    DataType,
    FilesType,
    HeadersType,
    HooksInputType,
    JsonType,
    ParamsType,
    TimeoutType,
    UriType,
    VerifyType,
)
from requests.auth import AuthBase
from requests.cookies import RequestsCookieJar

from ..base_client import OAuthError

__all__ = ["OAuth2Session", "OAuth2Auth"]

_PR = TypeVar("_PR", bound=PreparedRequest)

class OAuth2Auth(AuthBase, TokenAuth):
    def ensure_active_token(self) -> None: ...
    def __call__(self, req: _PR) -> _PR: ...

class OAuth2ClientAuth(AuthBase, ClientAuth):
    def __call__(self, req: _PR) -> _PR: ...

class OAuth2Session(OAuth2Client, Session):
    client_auth_class: ClassVar[type[OAuth2ClientAuth]]
    token_auth_class: ClassVar[type[OAuth2Auth]]
    oauth_error_class: ClassVar[type[OAuthError]]
    SESSION_REQUEST_PARAMS: ClassVar[tuple[str, ...]]
    default_timeout: float | tuple[float | None, float | None] | None
    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        token_endpoint_auth_method: str | None = None,
        revocation_endpoint_auth_method: str | None = None,
        scope: str | None = None,
        state: str | None = None,
        redirect_uri: str | None = None,
        token: dict[str, Any] | None = None,
        token_placement: str = ...,
        update_token: Callable[[OAuth2Token], None] | None = None,
        leeway: int = 60,
        default_timeout: float | tuple[float | None, float | None] | None = None,
        **kwargs,
    ) -> None: ...
    def fetch_access_token(self, url: str | None = None, **kwargs) -> OAuth2Token: ...
    def request(  # type: ignore[override]
        self,
        method: str,
        url: UriType,
        withhold_token: bool = False,
        auth: AuthType = None,
        *,
        params: ParamsType = None,
        data: DataType = None,
        headers: HeadersType = None,
        cookies: RequestsCookieJar | CookieJar | dict[str, str] | None = None,
        files: FilesType = None,
        timeout: TimeoutType = None,
        allow_redirects: bool = True,
        proxies: dict[str, str] | None = None,
        hooks: HooksInputType | None = None,
        stream: bool | None = None,
        verify: VerifyType | None = None,
        cert: CertType = None,
        json: JsonType = None,
    ) -> Response: ...
