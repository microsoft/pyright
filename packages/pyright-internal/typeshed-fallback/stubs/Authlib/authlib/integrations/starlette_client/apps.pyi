from typing import Any

from starlette.datastructures import URL
from starlette.requests import Request
from starlette.responses import RedirectResponse

from ...oauth2.rfc6749.wrappers import OAuth2Token
from ..base_client import BaseApp
from ..base_client.async_app import AsyncOAuth1Mixin, AsyncOAuth2Mixin
from ..base_client.async_openid import AsyncOpenIDMixin
from ..httpx_client import AsyncOAuth1Client, AsyncOAuth2Client

class StarletteAppMixin:
    async def save_authorize_data(self, request: Request, **kwargs) -> None: ...
    async def authorize_redirect(self, request: Request, redirect_uri: str | URL | None = None, **kwargs) -> RedirectResponse: ...

class StarletteOAuth1App(StarletteAppMixin, AsyncOAuth1Mixin, BaseApp):
    client_cls = AsyncOAuth1Client
    async def authorize_access_token(self, request: Request, **kwargs) -> dict[str, Any]: ...

class StarletteOAuth2App(StarletteAppMixin, AsyncOAuth2Mixin, AsyncOpenIDMixin, BaseApp):
    client_cls = AsyncOAuth2Client
    async def logout_redirect(
        self,
        request: Request,
        post_logout_redirect_uri: str | URL | None = None,
        id_token_hint: str | None = None,
        *,
        state: str | None = None,
        client_id: str | None = None,
        logout_hint: str | None = None,
        ui_locales: str | None = None,
    ) -> RedirectResponse: ...
    async def validate_logout_response(self, request: Request) -> dict[str, Any]: ...
    async def authorize_access_token(self, request: Request, **kwargs) -> OAuth2Token: ...
