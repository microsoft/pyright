# This sample tests whether a decorator that contains an unknown
# type is ignored and treated as though it wasn't applied.

# pyright: reportMissingImports=false

from typing import Literal
import my_module


class Class2:
    pass


def my_decorator(fn):
    # This decorator returns a value that is
    # inferred to be a union containing an Unknown type.
    if fn:
        return my_module.unknown
    return Class2


@my_decorator
class Class1:
    def __init__(self, a, b, c):
        pass


v1 = Class1(1, 2, 3)
t1: Literal["Class1"] = reveal_type(v1)


@my_decorator
def func1() -> int:
    return 3


v2 = func1()
t2: Literal["int"] = reveal_type(v2)
