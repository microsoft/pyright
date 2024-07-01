# This sample tests the case where an expected type contains a union,
# as in the case where the list.__add__ method returns the type
# list[_T | _S].

from typing import Generic, Iterable, TypeVar

T = TypeVar("T")


class A(Generic[T]):
    def __init__(self, i: Iterable[T]): ...


def func1(i: Iterable[T]) -> T: ...


reveal_type(func1([0] + [""]), expected_text="str | int")
reveal_type(A([0] + [""]), expected_text="A[str | int]")
