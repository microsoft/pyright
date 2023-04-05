from typing import NamedTuple

from .. import exceptions

LocationParseError = exceptions.LocationParseError

url_attrs: list[str]

class _UrlBase(NamedTuple):
    auth: str | None
    fragment: str | None
    host: str | None
    path: str | None
    port: int | None
    query: str | None
    scheme: str | None

class Url(_UrlBase):
    def __new__(
        cls,
        scheme: str | None = None,
        auth: str | None = None,
        host: str | None = None,
        port: int | None = None,
        path: str | None = None,
        query: str | None = None,
        fragment: str | None = None,
    ): ...
    @property
    def hostname(self) -> str | None: ...
    @property
    def request_uri(self) -> str: ...
    @property
    def netloc(self) -> str | None: ...
    @property
    def url(self) -> str: ...

def split_first(s: str, delims: str) -> tuple[str, str, str | None]: ...
def parse_url(url: str) -> Url: ...
def get_host(url: str) -> tuple[str, str | None, str | None]: ...
