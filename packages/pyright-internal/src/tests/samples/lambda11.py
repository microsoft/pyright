# This sample tests the case where a lambda's expected type includes
# a ParamSpec.

from typing import Callable, Generic, TypeVar, Concatenate, ParamSpec

T = TypeVar("T")
P = ParamSpec("P")


class Callback(Generic[T]):
    def __init__(
        self,
        func: Callable[Concatenate[T, P], object],
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> None: ...


v1: Callback[tuple[int, int]] = Callback(lambda p: (p[1], p[0]))


def func1(
    func: Callable[Concatenate[int, P], T], *args: P.args, **kwargs: P.kwargs
) -> T: ...


v2 = func1(lambda p: p)
reveal_type(v2, expected_text="int")
