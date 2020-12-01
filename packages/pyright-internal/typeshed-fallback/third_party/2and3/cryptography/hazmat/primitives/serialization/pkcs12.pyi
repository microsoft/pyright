from typing import Any, List, Optional, Tuple

from cryptography.x509 import Certificate

def load_key_and_certificates(
    data: bytes, password: Optional[bytes], backend: Optional[Any] = ...
) -> Tuple[Optional[Any], Optional[Certificate], List[Certificate]]: ...
