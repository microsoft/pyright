# This sample tests ParameterSpecification (PEP 612) behavior.

from asyncio import Future
from typing import Awaitable, Callable, ParameterSpecification, TypeVar

TParams = ParameterSpecification("TParams")
TReturn = TypeVar("TReturn")


def awaitable_wrapper(
    a: Callable[TParams, TReturn]
) -> Callable[TParams, Awaitable[TReturn]]:
    def foo_internal(args: TParams.args, kwargs: TParams.kwargs) -> Awaitable[TReturn]:
        ft: Future[TReturn] = Future()
        ft.set_result(a(*args, **kwargs))
        return ft

    return foo_internal


@awaitable_wrapper
def bar(a: int, b: str) -> float:
    return 2.3


async def bbb() -> float:
    return await bar(2, "3")
