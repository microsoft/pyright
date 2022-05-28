from typing import Any
from typing_extensions import TypedDict

DEFAULT_ENV: str
SCHEMES: dict[str, str]

class _DBConfigBase(TypedDict):
    NAME: str

class _DBConfig(_DBConfigBase, total=False):
    USER: str
    PASSWORD: str
    HOST: str
    PORT: str
    CONN_MAX_AGE: int
    OPTIONS: dict[str, Any]
    ENGINE: str

def parse(url: str, engine: str | None = ..., conn_max_age: int = ..., ssl_require: bool = ...) -> _DBConfig: ...
def config(
    env: str = ..., default: str | None = ..., engine: str | None = ..., conn_max_age: int = ..., ssl_require: bool = ...
) -> _DBConfig: ...
