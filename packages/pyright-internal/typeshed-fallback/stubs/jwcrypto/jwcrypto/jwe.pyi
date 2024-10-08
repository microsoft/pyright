from _typeshed import Incomplete
from collections.abc import Mapping, Sequence

from jwcrypto import common
from jwcrypto.common import JWException, JWSEHeaderParameter
from jwcrypto.jwk import JWK, JWKSet

default_max_compressed_size: int
JWEHeaderRegistry: Mapping[str, JWSEHeaderParameter]
default_allowed_algs: Sequence[str]

class InvalidJWEData(JWException):
    def __init__(self, message: str | None = None, exception: BaseException | None = None) -> None: ...

InvalidCEKeyLength = common.InvalidCEKeyLength
InvalidJWEKeyLength = common.InvalidJWEKeyLength
InvalidJWEKeyType = common.InvalidJWEKeyType
InvalidJWEOperation = common.InvalidJWEOperation

class JWE:
    objects: Incomplete
    plaintext: Incomplete
    header_registry: Incomplete
    cek: Incomplete
    decryptlog: Incomplete
    def __init__(
        self,
        plaintext: bytes | None = None,
        protected: str | None = None,
        unprotected: str | None = None,
        aad: bytes | None = None,
        algs: Incomplete | None = None,
        recipient: str | None = None,
        header: Incomplete | None = None,
        header_registry: Incomplete | None = None,
    ) -> None: ...
    @property
    def allowed_algs(self): ...
    @allowed_algs.setter
    def allowed_algs(self, algs) -> None: ...
    def add_recipient(self, key, header: Incomplete | None = None) -> None: ...
    def serialize(self, compact: bool = False): ...
    def decrypt(self, key: JWK | JWKSet) -> None: ...
    def deserialize(self, raw_jwe: str | bytes, key: JWK | JWKSet | None = None) -> None: ...
    @property
    def payload(self): ...
    @property
    def jose_header(self) -> dict[Incomplete, Incomplete]: ...
    @classmethod
    def from_jose_token(cls, token: str | bytes) -> JWE: ...
    def __eq__(self, other: object) -> bool: ...
