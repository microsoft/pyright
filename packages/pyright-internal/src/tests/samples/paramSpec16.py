# This sample tests the matching of nested callables that each use
# ParamSpec.

from typing import Callable, Generic, TypeVar
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Concatenate,
    ParamSpec,
)

P = ParamSpec("P")
Q = ParamSpec("Q")

T = TypeVar("T")
U = TypeVar("U")


class ClassA(Generic[P, T, Q, U]): ...


def decorator1(
    func: Callable[Concatenate[Callable[P, T], Q], U],
) -> ClassA[P, T, Q, U]: ...


@decorator1
def func1(func: Callable[[int], float], a: str) -> bool: ...


reveal_type(func1, expected_text="ClassA[(int), float, (a: str), bool]")
