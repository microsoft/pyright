from _typeshed import Incomplete
from logging import Logger

from .base import BaseEndpoint as BaseEndpoint

log: Logger

class SignatureOnlyEndpoint(BaseEndpoint):
    def validate_request(
        self, uri, http_method: str = "GET", body: Incomplete | None = None, headers: Incomplete | None = None
    ): ...
