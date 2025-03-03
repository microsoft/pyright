from _typeshed import Incomplete
from typing import TypedDict

from braintree.util.http import Http

class _ValidationErrors(TypedDict):
    errors: Incomplete

class GraphQLClient(Http):
    @staticmethod
    def raise_exception_for_graphql_error(response) -> None: ...
    graphql_headers: dict[str, str]
    def __init__(self, config: Incomplete | None = None, environment: Incomplete | None = None) -> None: ...
    def query(self, definition, variables: Incomplete | None = None, operation_name: Incomplete | None = None): ...
    @staticmethod
    def get_validation_errors(response) -> _ValidationErrors | None: ...
    @staticmethod
    def get_validation_error_code(error) -> Incomplete | None: ...
