from _typeshed import Incomplete
from logging import Logger

from .base import GrantTypeBase

log: Logger

class RefreshTokenGrant(GrantTypeBase):
    proxy_target: Incomplete
    def __init__(self, request_validator: Incomplete | None = None, **kwargs) -> None: ...
    def add_id_token(self, token, token_handler, request): ...  # type: ignore[override]
