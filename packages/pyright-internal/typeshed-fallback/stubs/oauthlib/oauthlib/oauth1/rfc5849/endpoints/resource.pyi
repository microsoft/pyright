from _typeshed import Incomplete
from logging import Logger

from .base import BaseEndpoint as BaseEndpoint

log: Logger

class ResourceEndpoint(BaseEndpoint):
    def validate_protected_resource_request(
        self,
        uri,
        http_method: str = "GET",
        body: Incomplete | None = None,
        headers: Incomplete | None = None,
        realms: Incomplete | None = None,
    ): ...
