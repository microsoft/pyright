from _typeshed import Incomplete
from typing import Any
from typing_extensions import TypedDict

DEFAULT_ENV: str
SCHEMES: dict[str, str]

# From https://docs.djangoproject.com/en/4.0/ref/settings/#databases
class DBConfig(TypedDict, total=False):
    ATOMIC_REQUESTS: bool
    AUTOCOMMIT: bool
    CONN_MAX_AGE: int | None
    DISABLE_SERVER_SIDE_CURSORS: bool
    ENGINE: str
    HOST: str
    NAME: str
    OPTIONS: dict[str, Any] | None
    PASSWORD: str
    PORT: str
    TEST: dict[str, Any]
    TIME_ZONE: str
    USER: str

def parse(
    url: str,
    engine: str | None = ...,
    conn_max_age: int = ...,
    conn_health_checks: bool = ...,
    ssl_require: bool = ...,
    test_options: dict[Incomplete, Incomplete] | None = ...,
) -> DBConfig: ...
def config(
    env: str = ...,
    default: str | None = ...,
    engine: str | None = ...,
    conn_max_age: int | None = ...,
    conn_health_checks: bool = ...,
    ssl_require: bool = ...,
    test_options: dict[Incomplete, Incomplete] | None = ...,
) -> DBConfig: ...
