# This sample tests whether a decorator that contains an unknown
# type is ignored and treated as though it wasn't applied.

# pyright: reportMissingImports=false

import my_module


class Class2:
    pass


def decorator1(fn):
    # This decorator returns a value that is
    # inferred to be a union containing an Unknown type.
    if fn:
        return my_module.unknown
    return Class2


@decorator1
class ClassA:
    def __init__(self, a, b, c):
        pass


v1 = ClassA(1, 2, 3)
reveal_type(v1, expected_text="ClassA")


@decorator1
def func1() -> int:
    return 3


v2 = func1()
reveal_type(v2, expected_text="int")
