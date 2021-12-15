# This sample tests the case where a generic class parameterized by a
# ParamSpec is specialized using a Concatenate[] type argument.

from typing import Literal, ParamSpec, Concatenate, Generic, Callable, Any

P = ParamSpec("P")


class A(Generic[P]):
    def __init__(self, func: Callable[P, Any]) -> None:
        ...


def func1(baz: A[Concatenate[int, P]]) -> A[P]:
    ...


def test(a: int, b: str) -> str:
    ...


val1 = A(test)
t1: Literal["A[(a: int, b: str)]"] = reveal_type(val1)
val2 = func1(val1)
t2: Literal["A[(b: str)]"] = reveal_type(val2)
