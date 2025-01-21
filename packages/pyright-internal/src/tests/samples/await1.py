# This sample validates that the await keyword participates in
# bidirectional type inference.

from typing import (
    Any,
    AsyncIterator,
    Callable,
    Iterable,
    Literal,
    TypeVar,
    Generic,
    overload,
)

T = TypeVar("T")
AnyMsg = TypeVar("AnyMsg", bound="Msg")


class Msg(Generic[T]):
    body: T


class Request:
    id: int


async def func1(check: "Callable[[AnyMsg], bool]") -> AnyMsg: ...


async def func2():
    _: Msg[Request] = await func1(check=lambda msg: (msg.body.id == 12345))


async def func3() -> AsyncIterator[int]:
    yield 1


async def func4() -> int:
    return await anext(func3())


async def func5(__fn: Callable[..., T]) -> T: ...


@overload
def sum(__iterable: Iterable[Literal[0]]) -> int: ...


@overload
def sum(__iterable: Iterable[T]) -> T: ...


def sum(__iterable: Iterable[Any]) -> Any: ...


async def func6(f: Callable[[], list[int]]):
    sum(await func5(f))
