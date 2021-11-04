# This sample tests ParamSpec (PEP 612) behavior.

from typing import (
    Awaitable,
    Callable,
    Generic,
    Optional,
    ParamSpec,
    TypeVar,
    Union,
    overload,
)

Ps = ParamSpec("Ps")
R = TypeVar("R")


async def log_to_database():
    ...


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


@overload
def bar(x: int) -> None:
    ...


@overload
def bar(x: str) -> str:
    ...


def bar(x: Union[int, str]) -> Optional[str]:
    if isinstance(x, int):
        return None
    else:
        return x


# This should generate an error because ParamSpec cannot
# be used with an overloaded function.
x = add_logging(bar)


class Foo(Generic[Ps, R]):
    def __init__(self, func: Callable[Ps, R]):
        self.func = func


def transform_foo(f: Callable[Ps, R]) -> Foo[Ps, R]:
    return Foo(f)
