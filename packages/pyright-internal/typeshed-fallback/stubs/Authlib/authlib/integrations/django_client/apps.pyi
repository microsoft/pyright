from _typeshed import Incomplete

from django.http import HttpRequest, HttpResponseRedirect

from ..base_client import BaseApp, OAuth1Mixin, OAuth2Mixin, OpenIDMixin
from ..requests_client import OAuth1Session, OAuth2Session

class DjangoAppMixin:
    def save_authorize_data(self, request: HttpRequest, **kwargs) -> None: ...
    def authorize_redirect(self, request: HttpRequest, redirect_uri=None, **kwargs) -> HttpResponseRedirect: ...

class DjangoOAuth1App(DjangoAppMixin, OAuth1Mixin, BaseApp):
    client_cls = OAuth1Session
    def authorize_access_token(self, request: HttpRequest, **kwargs): ...

class DjangoOAuth2App(DjangoAppMixin, OAuth2Mixin, OpenIDMixin, BaseApp):
    client_cls = OAuth2Session
    def logout_redirect(
        self,
        request: HttpRequest,
        post_logout_redirect_uri=None,
        id_token_hint=None,
        *,
        state=None,
        client_id=None,
        logout_hint=None,
        ui_locales=None,
    ) -> HttpResponseRedirect: ...
    def validate_logout_response(self, request: HttpRequest): ...
    def authorize_access_token(self, request: HttpRequest, **kwargs) -> dict[Incomplete, Incomplete]: ...
