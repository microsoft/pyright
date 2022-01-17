# This sample tests the case where a generic class parameterized by a
# ParamSpec is specialized using a Concatenate[] type argument.

from typing import ParamSpec, Concatenate, Generic, Callable, Any

P = ParamSpec("P")


class A(Generic[P]):
    def __init__(self, func: Callable[P, Any]) -> None:
        ...


def func1(baz: A[Concatenate[int, P]]) -> A[P]:
    ...


def test(a: int, b: str) -> str:
    ...


val1 = A(test)
reveal_type(val1, expected_text="A[(a: int, b: str)]")
val2 = func1(val1)
reveal_type(val2, expected_text="A[(b: str)]")
