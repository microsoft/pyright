# This sample tests the case where a higher-order function involves a ParamSpec.

from typing import TypeVar, Callable, Protocol, ParamSpec

P = ParamSpec("P")
R = TypeVar("R", covariant=True)
T = TypeVar("T")


class Proto1(Protocol[P, R]):
    @classmethod
    def collect(cls, *args: P.args, **kwargs: P.kwargs) -> R: ...


class Class1:
    @classmethod
    def collect(cls, n: type[T]) -> Callable[[Callable[[T], int]], None]: ...


def func1(a: Proto1[P, R], *args: P.args, **kwargs: P.kwargs) -> R: ...


reveal_type(func1(Class1, float), expected_text="((float) -> int) -> None")
reveal_type(func1(Class1, int), expected_text="((int) -> int) -> None")
