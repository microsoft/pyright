# This sample tests type narrowing for assignments
# where the source contains Unknown or Any type
# arguments.

from typing import Any, Generic, TypeVar


def func1(struct: dict[Any, Any]):
    a1: dict[str, Any] = struct
    reveal_type(a1, expected_text="dict[str, Any]")


def func2(struct: Any):
    a1: dict[Any, str] = struct
    reveal_type(a1, expected_text="dict[Any, str]")

    if isinstance(struct, dict):
        a2: dict[str, Any] = struct
        reveal_type(a2, expected_text="dict[str, Any]")


T = TypeVar("T")


class A(Generic[T]): ...


def func3(val: A[Any]):
    x: A[int] = val
    reveal_type(x, expected_text="A[int]")


def func4(val: A[list[Any]]):
    x: A[list[int]] = val
    reveal_type(x, expected_text="A[list[int]]")
