# This sample tests the handling of a ParamSpec within a callback protocol.

from typing import Callable, Concatenate, Literal, ParamSpec, Protocol


P = ParamSpec("P")


def callback(a: int, b: str, c: str) -> int:
    ...


FooCallableWithConcatenate = Callable[Concatenate[int, P], int]


def func_with_callable(cb: FooCallableWithConcatenate[P]) -> Callable[P, bool]:
    ...


x1 = func_with_callable(callback)
t1: Literal["(b: str, c: str) -> bool"] = reveal_type(x1)


class FooWithConcatenate(Protocol[P]):
    def __call__(self, x: int, /, *args: P.args, **kwargs: P.kwargs) -> int:
        ...


def func_with_protocol(cb: FooWithConcatenate[P]) -> Callable[P, bool]:
    ...


x2 = func_with_protocol(callback)
t2: Literal["(b: str, c: str) -> bool"] = reveal_type(x2)
