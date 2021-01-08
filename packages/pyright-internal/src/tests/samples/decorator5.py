# This sample tests the logic that determines whether
# an unannotated decorator should allow the decorated
# function type (and docstring) to pass through unmodified.

from typing import Literal


def simple_decorator(method):
    def wrapper(*args, **kw):
        result = method(*args, **kw)
        return result

    return wrapper


@simple_decorator
def function(var: str, kvar: str):
    return


t1: Literal["(var: str, kvar: str) -> None"] = reveal_type(function)


class Foo:
    @simple_decorator
    def method(self, var: str, kvar: str):
        return


t2: Literal["(var: str, kvar: str) -> None"] = reveal_type(Foo().method)
t3: Literal["(self: Foo, var: str, kvar: str) -> None"] = reveal_type(Foo.method)
