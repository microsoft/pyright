# This sample tests the return type inference for a generator.

from typing import Awaitable, Generator, TypeVar

S = TypeVar("S")
T = TypeVar("T")


def func1() -> Generator[int, int, str]:
    yield 1
    return "done"


def func2() -> Generator[int, int, None]:
    # This should generate an error because yield is not allowed
    # from within a list comprehension.
    x = [(yield from func1()) for lel in range(5)]

    v1 = yield from func1()
    reveal_type(v1, expected_text="str")

    v2 = yield 4
    reveal_type(v2, expected_text="int")


def func3():
    [x for x in (yield [[[1]], [[2]], [[3]]]) for y in x]

    # This should generate an error.
    [x for x in [[[1]], [[2]], [[3]]] for y in (yield x)]


class ClassA[S, T](Awaitable[T]):
    def __init__(self, val: S) -> None:
        self.val = val

    def __await__(self) -> Generator[S, T, T]:
        z = yield self.val
        reveal_type(z, expected_text="T@ClassA")
        return z
