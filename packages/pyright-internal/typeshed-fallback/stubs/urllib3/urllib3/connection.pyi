import ssl
from builtins import ConnectionError as ConnectionError
from http.client import HTTPConnection as _HTTPConnection, HTTPException as HTTPException
from typing import Any

from . import exceptions, util
from .util import ssl_, ssl_match_hostname

class DummyConnection: ...

BaseSSLError = ssl.SSLError

ConnectTimeoutError = exceptions.ConnectTimeoutError
SystemTimeWarning = exceptions.SystemTimeWarning
match_hostname = ssl_match_hostname.match_hostname
resolve_cert_reqs = ssl_.resolve_cert_reqs
resolve_ssl_version = ssl_.resolve_ssl_version
ssl_wrap_socket = ssl_.ssl_wrap_socket
assert_fingerprint = ssl_.assert_fingerprint
connection = util.connection

port_by_scheme: Any
RECENT_DATE: Any

class HTTPConnection(_HTTPConnection):
    default_port: Any
    default_socket_options: Any
    is_verified: Any
    source_address: Any
    socket_options: Any
    def __init__(self, *args, **kw) -> None: ...
    def connect(self): ...

class HTTPSConnection(HTTPConnection):
    default_port: Any
    key_file: Any
    cert_file: Any
    def __init__(self, host, port=None, key_file=None, cert_file=None, strict=None, timeout=..., **kw) -> None: ...
    sock: Any
    def connect(self): ...

class VerifiedHTTPSConnection(HTTPSConnection):
    cert_reqs: Any
    ca_certs: Any
    ssl_version: Any
    assert_fingerprint: Any
    key_file: Any
    cert_file: Any
    assert_hostname: Any
    def set_cert(
        self, key_file=None, cert_file=None, cert_reqs=None, ca_certs=None, assert_hostname=None, assert_fingerprint=None
    ): ...
    sock: Any
    auto_open: Any
    is_verified: Any
    def connect(self): ...
