# This sample tests the case where a lambda's expected type is a callable
# that accepts another generic callable as a parameter.

from typing import Callable, Generic, TypeVar

T = TypeVar("T")


def func1(callable: Callable[[Callable[[T], T]], T]) -> T:
    return callable(lambda x: x)


v1 = func1(lambda a: a(0))
reveal_type(v1, expected_text="int")

v2 = func1(lambda a: a(""))
reveal_type(v2, expected_text="str")


def test1(untyped):
    v1 = func1(lambda a: a(untyped))
    reveal_type(v1, expected_text="Unknown")


class A(Generic[T]):
    def __init__(self, value: T) -> None:
        self.value = value


def func2(callable: Callable[[type[A[T]]], A[T]]) -> T:
    return callable(A).value


v3 = func2(lambda A: A(0))
reveal_type(v3, expected_text="int")

v4 = func2(lambda A: A(""))
reveal_type(v4, expected_text="str")


def test2(untyped):
    v1 = func2(lambda A: A(untyped))
    reveal_type(v1, expected_text="Unknown")
