from _typeshed import Incomplete

from authlib.common.errors import AuthlibHTTPError

class OAuth2Error(AuthlibHTTPError):
    state: Incomplete
    redirect_uri: Incomplete
    redirect_fragment: Incomplete
    def __init__(
        self,
        description: Incomplete | None = None,
        uri: Incomplete | None = None,
        status_code: Incomplete | None = None,
        state: Incomplete | None = None,
        redirect_uri: Incomplete | None = None,
        redirect_fragment: bool = False,
        error: Incomplete | None = None,
    ) -> None: ...
    def get_body(self): ...
    def __call__(self, uri: Incomplete | None = None): ...
