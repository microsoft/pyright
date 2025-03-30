# This sample tests the handling of a specialized function
# used as an argument to a ParamSpec.

from typing import Callable, Generic, ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


def func1(f: Callable[P, R]) -> Callable[P, R]: ...


class ClassA(Generic[R]):
    def method1(self, v: R) -> None: ...


v1: ClassA[int] = ClassA()

reveal_type(v1.method1, expected_text="(v: int) -> None")
reveal_type(func1(v1.method1), expected_text="(v: int) -> None")
