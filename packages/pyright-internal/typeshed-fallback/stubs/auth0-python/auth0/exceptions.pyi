from _typeshed import Incomplete

class Auth0Error(Exception):
    status_code: Incomplete
    error_code: Incomplete
    message: Incomplete
    content: Incomplete
    def __init__(self, status_code: int, error_code: str, message: str, content: Incomplete | None = None) -> None: ...

class RateLimitError(Auth0Error):
    reset_at: Incomplete
    def __init__(self, error_code: str, message: str, reset_at: int) -> None: ...

class TokenValidationError(Exception): ...
