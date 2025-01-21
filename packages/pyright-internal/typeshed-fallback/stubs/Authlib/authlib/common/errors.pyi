from _typeshed import Incomplete

class AuthlibBaseError(Exception):
    error: Incomplete
    description: str
    uri: Incomplete
    def __init__(
        self, error: Incomplete | None = None, description: Incomplete | None = None, uri: Incomplete | None = None
    ) -> None: ...

class AuthlibHTTPError(AuthlibBaseError):
    status_code: int
    def __init__(
        self,
        error: Incomplete | None = None,
        description: Incomplete | None = None,
        uri: Incomplete | None = None,
        status_code: Incomplete | None = None,
    ) -> None: ...
    def get_error_description(self): ...
    def get_body(self): ...
    def get_headers(self): ...
    uri: Incomplete
    def __call__(self, uri: Incomplete | None = None): ...

class ContinueIteration(AuthlibBaseError): ...
