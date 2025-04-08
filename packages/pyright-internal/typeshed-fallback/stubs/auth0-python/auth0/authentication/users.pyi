from _typeshed import Incomplete

from auth0.rest import RestClient as RestClient, RestClientOptions as RestClientOptions
from auth0.types import TimeoutType as TimeoutType

class Users:
    domain: Incomplete
    protocol: Incomplete
    client: Incomplete
    def __init__(self, domain: str, telemetry: bool = True, timeout: TimeoutType = 5.0, protocol: str = "https") -> None: ...
    def userinfo(self, access_token: str) -> dict[str, Incomplete]: ...
