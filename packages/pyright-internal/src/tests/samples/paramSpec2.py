# This sample tests ParamSpec (PEP 612) behavior.

from asyncio import Future
from typing import Awaitable, Callable, ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


def awaitable_wrapper(a: Callable[P, R]) -> Callable[P, Awaitable[R]]:
    def foo_internal(*args: P.args, **kwargs: P.kwargs) -> Awaitable[R]:
        ft: "Future[R]" = Future()
        ft.set_result(a(*args, **kwargs))
        return ft

    return foo_internal


@awaitable_wrapper
def bar(a: int, b: str) -> float:
    return 2.3


async def bbb() -> float:
    return await bar(2, "3")
