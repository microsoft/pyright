# This sample tests the case where a protocol includes a callable
# attribute that is an instance variable. It shouldn't be bound
# to the concrete class in this case.

from typing import Callable, Protocol


class A:
    def __init__(self, *, p1: int, p2: str) -> None: ...


class ProtoB[**P, T](Protocol):
    x: Callable[P, T]


class B:
    x: type[A]


def func1[**P, T](v: ProtoB[P, T]) -> Callable[P, T]: ...


x1 = func1(B())
reveal_type(x1, expected_text="(*, p1: int, p2: str) -> A")
