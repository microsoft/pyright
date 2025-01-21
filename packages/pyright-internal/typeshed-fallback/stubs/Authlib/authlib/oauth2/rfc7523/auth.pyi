from _typeshed import Incomplete

class ClientSecretJWT:
    name: str
    alg: str
    token_endpoint: Incomplete
    claims: Incomplete
    headers: Incomplete
    def __init__(
        self,
        token_endpoint: Incomplete | None = None,
        claims: Incomplete | None = None,
        headers: Incomplete | None = None,
        alg: Incomplete | None = None,
    ) -> None: ...
    def sign(self, auth, token_endpoint): ...
    def __call__(self, auth, method, uri, headers, body): ...

class PrivateKeyJWT(ClientSecretJWT):
    name: str
    alg: str
    def sign(self, auth, token_endpoint): ...
