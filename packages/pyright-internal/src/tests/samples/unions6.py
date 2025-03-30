# This sample tests that union type compatibility does not depend on
# the order of the elements in the union.

from __future__ import annotations

from typing import (
    Awaitable,
    Callable,
    MutableSequence,
    Protocol,
    SupportsIndex,
    TypeGuard,
    TypeVar,
    overload,
)

T_co = TypeVar("T_co", covariant=True)
_T = TypeVar("_T")


class MyList(MutableSequence[_T]):
    @overload
    def __getitem__(self, index: SupportsIndex) -> _T:  # type: ignore
        ...

    @overload
    def __getitem__(self, index: slice) -> MyList[_T]: ...


class NestedSequence(Protocol[T_co]):
    @overload
    def __getitem__(self, index: int, /) -> T_co | NestedSequence[T_co]: ...

    @overload
    def __getitem__(self, index: slice, /) -> NestedSequence[T_co]: ...


def func1(b: MyList[int | MyList[int]]):
    _: NestedSequence[int] = b


def func2(c: MyList[MyList[int] | int]):
    _: NestedSequence[int] = c


def is_async_callable(
    obj: Callable[..., _T] | Callable[..., Awaitable[_T]],
) -> TypeGuard[Callable[..., Awaitable[_T]]]: ...


async def func3(fn: Callable[[], _T] | Callable[[], Awaitable[_T]]):
    if is_async_callable(fn):
        return await fn()


async def func4(fn: Callable[[], Awaitable[_T]] | Callable[[], _T]):
    if is_async_callable(fn):
        return await fn()
