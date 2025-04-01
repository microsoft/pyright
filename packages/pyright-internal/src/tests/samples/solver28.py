# This sample tests the case where a TypeVar has a bound of `type` and
# is assigned to a `type[T]`.

from typing import TypeVar

T = TypeVar("T")
S = TypeVar("S", bound=type)


def func1(x: type[T]) -> type[T]:
    return x


def func2(x: S) -> S:
    v1 = func1(x)
    reveal_type(v1, expected_text="Unknown")
    return v1


def func3[R: int](num: type[R]) -> None: ...


class A[T: type[int]](tuple[T]): ...


func3(*A[type[int]]())
