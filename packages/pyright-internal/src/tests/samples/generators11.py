# This sample tests the return type inference for a generator.

from typing import Generator, Literal


def func1() -> Generator[int, None, str]:
    yield 1
    return "done"


def func2() -> Generator[int, int, None]:
    # This should generate an error because yield is not allowed
    # from within a list comprehension.
    x = [(yield from func1()) for lel in range(5)]

    v1 = yield from func1()
    t_v1: Literal["str"] = reveal_type(v1)

    v2 = yield 4
    t_v2: Literal["int"] = reveal_type(v2)
