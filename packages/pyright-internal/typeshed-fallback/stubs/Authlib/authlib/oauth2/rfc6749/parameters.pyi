from _typeshed import Incomplete

def prepare_grant_uri(
    uri,
    client_id,
    response_type,
    redirect_uri: Incomplete | None = None,
    scope: Incomplete | None = None,
    state: Incomplete | None = None,
    **kwargs,
): ...
def prepare_token_request(grant_type, body: str = "", redirect_uri: Incomplete | None = None, **kwargs): ...
def parse_authorization_code_response(uri, state: Incomplete | None = None): ...
def parse_implicit_response(uri, state: Incomplete | None = None): ...
