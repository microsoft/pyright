# This sample tests the handling of a constructor for a generic
# class where the type arguments need to be inferred using
# bidirectional type inference and the expected type is a
# union of other types.

from typing import Generic, TypeVar, Final

T = TypeVar("T")
S = TypeVar("S")


class A(Generic[T]):
    def __init__(self, value: T) -> None:
        self._value: Final = value


class B(Generic[S]):
    def __init__(self, value: S) -> None:
        self._value: Final = value


Result = A[T] | B[S]


def return_ok_none() -> Result[int | None, Exception]:
    return A(None)


def return_ok_one() -> Result[int | None, Exception]:
    return A(1)


class C(Generic[T]):
    pass


c1: C[bool] | None = C()
reveal_type(c1, expected_type="C[bool]")

c2: A[int] | C[int] = C()
reveal_type(c2, expected_type="C[int]")
