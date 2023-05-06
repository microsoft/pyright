import queue
from collections.abc import Mapping
from logging import Logger
from types import TracebackType
from typing import Any, ClassVar
from typing_extensions import Literal, Self, TypeAlias

from . import connection, exceptions, request, response
from .connection import BaseSSLError as BaseSSLError, ConnectionError as ConnectionError, HTTPException as HTTPException
from .util import Url, connection as _connection, queue as urllib3queue, retry, ssl_match_hostname, timeout, url

ClosedPoolError = exceptions.ClosedPoolError
ProtocolError = exceptions.ProtocolError
EmptyPoolError = exceptions.EmptyPoolError
HostChangedError = exceptions.HostChangedError
LocationValueError = exceptions.LocationValueError
MaxRetryError = exceptions.MaxRetryError
ProxyError = exceptions.ProxyError
ReadTimeoutError = exceptions.ReadTimeoutError
SSLError = exceptions.SSLError
TimeoutError = exceptions.TimeoutError
InsecureRequestWarning = exceptions.InsecureRequestWarning
CertificateError = ssl_match_hostname.CertificateError
port_by_scheme = connection.port_by_scheme
DummyConnection = connection.DummyConnection
HTTPConnection = connection.HTTPConnection
HTTPSConnection = connection.HTTPSConnection
VerifiedHTTPSConnection = connection.VerifiedHTTPSConnection
RequestMethods = request.RequestMethods
HTTPResponse = response.HTTPResponse
is_connection_dropped = _connection.is_connection_dropped
Retry = retry.Retry
Timeout = timeout.Timeout
get_host = url.get_host

_Timeout: TypeAlias = Timeout | float
_Retries: TypeAlias = Retry | bool | int

xrange: Any
log: Logger

class ConnectionPool:
    scheme: ClassVar[str | None]
    QueueCls: ClassVar[type[queue.Queue[Any]]]
    host: str
    port: int | None
    def __init__(self, host: str, port: int | None = None) -> None: ...
    def __enter__(self) -> Self: ...
    def __exit__(
        self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: TracebackType | None
    ) -> Literal[False]: ...
    def close(self) -> None: ...

class HTTPConnectionPool(ConnectionPool, RequestMethods):
    scheme: ClassVar[str]
    ConnectionCls: ClassVar[type[HTTPConnection | HTTPSConnection]]
    ResponseCls: ClassVar[type[HTTPResponse]]
    strict: bool
    timeout: _Timeout
    retries: _Retries | None
    pool: urllib3queue.LifoQueue | None
    block: bool
    proxy: Url | None
    proxy_headers: Mapping[str, str]
    num_connections: int
    num_requests: int
    conn_kw: Any
    def __init__(
        self,
        host: str,
        port: int | None = None,
        strict: bool = False,
        timeout: _Timeout = ...,
        maxsize: int = 1,
        block: bool = False,
        headers: Mapping[str, str] | None = None,
        retries: _Retries | None = None,
        _proxy: Url | None = None,
        _proxy_headers: Mapping[str, str] | None = None,
        **conn_kw,
    ) -> None: ...
    def close(self) -> None: ...
    def is_same_host(self, url: str) -> bool: ...
    def urlopen(
        self,
        method,
        url,
        body=None,
        headers=None,
        retries=None,
        redirect=True,
        assert_same_host=True,
        timeout=...,
        pool_timeout=None,
        release_conn=None,
        **response_kw,
    ): ...

class HTTPSConnectionPool(HTTPConnectionPool):
    key_file: str | None
    cert_file: str | None
    cert_reqs: int | str | None
    ca_certs: str | None
    ssl_version: int | str | None
    assert_hostname: str | Literal[False] | None
    assert_fingerprint: str | None
    def __init__(
        self,
        host: str,
        port: int | None = None,
        strict: bool = False,
        timeout: _Timeout = ...,
        maxsize: int = 1,
        block: bool = False,
        headers: Mapping[str, str] | None = None,
        retries: _Retries | None = None,
        _proxy: Url | None = None,
        _proxy_headers: Mapping[str, str] | None = None,
        key_file: str | None = None,
        cert_file: str | None = None,
        cert_reqs: int | str | None = None,
        ca_certs: str | None = None,
        ssl_version: int | str | None = None,
        assert_hostname: str | Literal[False] | None = None,
        assert_fingerprint: str | None = None,
        **conn_kw,
    ) -> None: ...

def connection_from_url(url: str, **kw) -> HTTPConnectionPool: ...
