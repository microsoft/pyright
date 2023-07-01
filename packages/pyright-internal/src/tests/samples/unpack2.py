# This sample tests the creation of tuples from unpacked values.

from typing import Any


def foo() -> tuple[int, int, int]:
    rest = (2, 3)
    t = 1, *rest
    return t


def foo2() -> tuple[int, int, int]:
    rest = (3, 4)
    t = 1, 2, *rest
    # This should generate an error
    return t


def foo3() -> tuple[Any, ...]:
    rest = [1, 2, 3]
    t = 1, 2, 3, *rest
    requires_list(rest)
    return t


def requires_list(a: list[int]):
    return None
