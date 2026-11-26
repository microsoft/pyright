from _typeshed import ReadableBuffer
from collections.abc import Callable
from hashlib import _Hash
from typing import ClassVar, Final

from cryptography.hazmat.primitives.asymmetric.mlkem import MLKEM768PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from paramiko.message import Message
from paramiko.transport import Transport

c_MSG_KEX_HYBRID_INIT: Final = b"\x1e"
c_MSG_KEX_HYBRID_REPLY: Final = b"\x1f"

class KexMLKEM768X25519:
    name: Final = "mlkem768x25519-sha256"
    hash_algo: ClassVar[Callable[[ReadableBuffer], _Hash]]
    transport: Transport
    mlkem_key: MLKEM768PrivateKey | None
    x25519_key: X25519PrivateKey | None
    def __init__(self, transport: Transport) -> None: ...
    @classmethod
    def is_available(cls) -> bool: ...
    def start_kex(self) -> None: ...
    def parse_next(self, ptype: int, m: Message) -> None: ...
