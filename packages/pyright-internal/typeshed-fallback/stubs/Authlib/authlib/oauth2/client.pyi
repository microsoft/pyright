from _typeshed import Incomplete

from authlib.oauth2 import ClientAuth, OAuth2Error, TokenAuth

DEFAULT_HEADERS: Incomplete

class OAuth2Client:
    client_auth_class = ClientAuth
    token_auth_class = TokenAuth
    oauth_error_class = OAuth2Error
    EXTRA_AUTHORIZE_PARAMS: Incomplete
    SESSION_REQUEST_PARAMS: Incomplete
    session: Incomplete
    client_id: Incomplete
    client_secret: Incomplete
    state: Incomplete
    token_endpoint_auth_method: Incomplete
    revocation_endpoint_auth_method: Incomplete
    scope: Incomplete
    redirect_uri: Incomplete
    code_challenge_method: Incomplete
    token_auth: Incomplete
    update_token: Incomplete
    metadata: Incomplete
    compliance_hook: Incomplete
    leeway: Incomplete
    def __init__(
        self,
        session,
        client_id: Incomplete | None = None,
        client_secret: Incomplete | None = None,
        token_endpoint_auth_method: Incomplete | None = None,
        revocation_endpoint_auth_method: Incomplete | None = None,
        scope: Incomplete | None = None,
        state: Incomplete | None = None,
        redirect_uri: Incomplete | None = None,
        code_challenge_method: Incomplete | None = None,
        token: Incomplete | None = None,
        token_placement: str = "header",
        update_token: Incomplete | None = None,
        leeway: int = 60,
        **metadata,
    ) -> None: ...
    def register_client_auth_method(self, auth) -> None: ...
    def client_auth(self, auth_method): ...
    @property
    def token(self): ...
    @token.setter
    def token(self, token) -> None: ...
    def create_authorization_url(
        self, url, state: Incomplete | None = None, code_verifier: Incomplete | None = None, **kwargs
    ): ...
    def fetch_token(
        self,
        url: Incomplete | None = None,
        body: str = "",
        method: str = "POST",
        headers: Incomplete | None = None,
        auth: Incomplete | None = None,
        grant_type: Incomplete | None = None,
        state: Incomplete | None = None,
        **kwargs,
    ): ...
    def token_from_fragment(self, authorization_response, state: Incomplete | None = None): ...
    def refresh_token(
        self,
        url: Incomplete | None = None,
        refresh_token: Incomplete | None = None,
        body: str = "",
        auth: Incomplete | None = None,
        headers: Incomplete | None = None,
        **kwargs,
    ): ...
    def ensure_active_token(self, token: Incomplete | None = None): ...
    def revoke_token(
        self,
        url,
        token: Incomplete | None = None,
        token_type_hint: Incomplete | None = None,
        body: Incomplete | None = None,
        auth: Incomplete | None = None,
        headers: Incomplete | None = None,
        **kwargs,
    ): ...
    def introspect_token(
        self,
        url,
        token: Incomplete | None = None,
        token_type_hint: Incomplete | None = None,
        body: Incomplete | None = None,
        auth: Incomplete | None = None,
        headers: Incomplete | None = None,
        **kwargs,
    ): ...
    def register_compliance_hook(self, hook_type, hook) -> None: ...
    def parse_response_token(self, resp): ...
