from typing import Any, Final, Generic, TypeVar

from hvac.adapters import Adapter
from hvac.api.vault_api_base import VaultApiBase
from requests import Response

DEFAULT_MOUNT_POINT: Final = "consul"

_R = TypeVar("_R", default=Response | dict[Any, Any])

# TODO: Make `hvac.api.vault_api_base.VaultApiBase` generic, and eventually propagate all the way from:
#  - `hvac.api.secrets_engines.SecretsEngines`
#  - `hvac.v1.Client`
class Consul(VaultApiBase, Generic[_R]):
    def __init__(self, adapter: Adapter[_R]) -> None: ...
    def configure_access(self, address: str, token: str, scheme: str | None = None, mount_point: str = "consul") -> _R: ...
    def create_or_update_role(
        self,
        name: str,
        policy: str | None = None,
        policies: list[str] | None = None,
        token_type: str | None = None,
        local: bool | None = None,
        ttl: str | None = None,
        max_ttl: str | None = None,
        mount_point: str = "consul",
    ) -> _R: ...
    def read_role(self, name: str, mount_point: str = "consul") -> _R: ...
    def list_roles(self, mount_point: str = "consul") -> _R: ...
    def delete_role(self, name: str, mount_point: str = "consul") -> _R: ...
    def generate_credentials(self, name: str, mount_point: str = "consul") -> _R: ...
