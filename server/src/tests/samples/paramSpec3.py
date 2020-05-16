# This sample tests ParameterSpecification (PEP 612) behavior.

from typing import Awaitable, Callable, ParameterSpecification, TypeVar

Ps = ParameterSpecification("Ps")
R = TypeVar("R")

async def log_to_database(): ...

def add_logging(f: Callable[Ps, R]) -> Callable[Ps, Awaitable[R]]:
    async def inner(*args: Ps.args, **kwargs: Ps.kwargs) -> R:
        await log_to_database()
        return f(*args, **kwargs)

    return inner

@add_logging
def foo(x: int, y: str) -> int:
    return x + 7

async def my_async_function():
    await foo(1, "A")

    # This should generate an error because
    # the first parameter is not an int.
    await foo("B", "2")
