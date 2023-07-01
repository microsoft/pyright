# This sample tests the case where a source type includes a ParamSpec
# and a dest type includes an *args: Any and **kwargs: Any.

from typing import Any, Callable, Protocol, TypeVar, ParamSpec

P = ParamSpec("P")
R = TypeVar("R")


class ClassA(Protocol[R]):
    def __call__(self, n: int, /, *args: Any, **kwargs: Any) -> list[R]:
        ...


def func1(maker: Callable[P, R]) -> ClassA[R]:
    def inner(n: int, /, *args: P.args, **kwargs: P.kwargs) -> list[R]:
        return [maker(*args, **kwargs) for _ in range(n)]

    return inner
