from typing import TypeVar, overload

from starlette.config import Config

from ..base_client import BaseApp, BaseOAuth, OAuthError as OAuthError
from .apps import StarletteOAuth1App as StarletteOAuth1App, StarletteOAuth2App as StarletteOAuth2App
from .integration import StarletteIntegration as StarletteIntegration

_AppT = TypeVar("_AppT", bound=BaseApp)

class OAuth(BaseOAuth):
    oauth1_client_cls = StarletteOAuth1App
    oauth2_client_cls = StarletteOAuth2App
    framework_integration_cls = StarletteIntegration
    config: Config | None
    def __init__(self, config: Config | None = None, cache=None, fetch_token=None, update_token=None) -> None: ...

    @overload
    def register(self, name: str, overwrite: bool = False, *, client_cls: type[_AppT], **kwargs) -> _AppT: ...
    @overload
    def register(self, name: str, overwrite: bool = False, **kwargs): ...

__all__ = ["OAuth", "OAuthError", "StarletteIntegration", "StarletteOAuth1App", "StarletteOAuth2App"]
