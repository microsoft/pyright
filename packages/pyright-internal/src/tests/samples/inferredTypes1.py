# This sample tests the analyzer's ability to infer types
# across execution contexts.

from typing import Callable


def perform_request(build_req: Callable[[], str]) -> str:
    return "purr"


def make_api_request(auth: str) -> str:
    return "meow"


def func1() -> None:
    resp = open("test")
    auth = resp.read()

    def build_req():
        # "auth" is declared in a different execution context
        # and included here in the closure. Make sure its type
        # is properly inferred.
        return make_api_request(auth)

    resp = perform_request(build_req)
