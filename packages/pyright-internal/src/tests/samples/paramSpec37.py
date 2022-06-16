# This sample tests the case where a source type includes a ParamSpec
# and a dest type includes an *args: Any and **kwargs: Any.

from typing import Any, Callable, List, Protocol, TypeVar, ParamSpec

T = TypeVar("T")
P = ParamSpec("P")


class BulkFactory(Protocol[T]):
    def __call__(
        self,
        n: int,
        /,
        *args: Any,
        **kwargs: Any,
    ) -> List[T]:
        ...


def make_n(maker: Callable[P, T]) -> BulkFactory[T]:
    def inner(n: int, /, *args: P.args, **kwargs: P.kwargs) -> List[T]:
        return [maker(*args, **kwargs) for _ in range(n)]

    return inner
