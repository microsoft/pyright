import ssl
from typing import Any

from .. import exceptions

SSLError = exceptions.SSLError
InsecurePlatformWarning = exceptions.InsecurePlatformWarning
SSLContext = ssl.SSLContext

HAS_SNI: Any
create_default_context: Any
OP_NO_SSLv2: Any
OP_NO_SSLv3: Any
OP_NO_COMPRESSION: Any
DEFAULT_CIPHERS: str

def assert_fingerprint(cert, fingerprint): ...
def resolve_cert_reqs(candidate): ...
def resolve_ssl_version(candidate): ...
def create_urllib3_context(ssl_version=None, cert_reqs=None, options=None, ciphers=None): ...
def ssl_wrap_socket(
    sock,
    keyfile=None,
    certfile=None,
    cert_reqs=None,
    ca_certs=None,
    server_hostname=None,
    ssl_version=None,
    ciphers=None,
    ssl_context=None,
): ...
