# This sample tests the case where a protocol is specialized with
# a literal type.

from typing import Any, Literal, Protocol, Self, TypeVar


class Negatable(Protocol):
    def __neg__(self) -> Self:
        ...


def func1(x: Negatable) -> None:
    ...


func1(0)


def func2(val: Literal[0, 1]):
    func1(val)


T = TypeVar("T", covariant=True)


class SupportsGetItem(Protocol[T]):
    def __getitem__(self, __k: int) -> T:
        ...


def func3(a: tuple[Any, ...]):
    x: SupportsGetItem[Literal["a"]] = a
