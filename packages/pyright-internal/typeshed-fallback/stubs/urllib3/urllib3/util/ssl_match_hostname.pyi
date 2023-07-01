from ssl import _PeerCertRetDictType
from typing_extensions import Final

__version__: Final[str]

class CertificateError(ValueError): ...

def match_hostname(cert: _PeerCertRetDictType, hostname: str) -> None: ...
