from types import TracebackType
from typing_extensions import Self

from auth0.rest import RestClientOptions as RestClientOptions

from ..asyncify import asyncify as asyncify
from .auth0 import Auth0 as Auth0

class AsyncAuth0:
    def __init__(self, domain: str, token: str, rest_options: RestClientOptions | None = None) -> None: ...
    def set_session(self, session) -> None: ...
    async def __aenter__(self) -> Self: ...
    async def __aexit__(
        self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: TracebackType | None
    ) -> None: ...
