from _typeshed import Incomplete

def sign_jwt_bearer_assertion(
    key,
    issuer,
    audience,
    subject: Incomplete | None = None,
    issued_at: Incomplete | None = None,
    expires_at: Incomplete | None = None,
    claims: Incomplete | None = None,
    header: Incomplete | None = None,
    **kwargs,
): ...
def client_secret_jwt_sign(
    client_secret, client_id, token_endpoint, alg: str = "HS256", claims: Incomplete | None = None, **kwargs
): ...
def private_key_jwt_sign(
    private_key, client_id, token_endpoint, alg: str = "RS256", claims: Incomplete | None = None, **kwargs
): ...
