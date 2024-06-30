# This sample tests the case where a protocol is specialized with
# a literal type.

from typing import Any, Literal, Protocol, TypeVar


class Negatable(Protocol):
    def __neg__(self) -> "Negatable": ...


def func1(x: Negatable) -> None: ...


func1(0)


def func2(val: Literal[0, 1]):
    func1(val)


T = TypeVar("T", covariant=True)


class SupportsGetItem(Protocol[T]):
    def __getitem__(self, __k: int) -> T: ...


def func3(a: tuple[Any, ...]):
    x: SupportsGetItem[Literal["a"]] = a


def func4(x: SupportsGetItem[T]) -> T:
    return x[0]


def func5(x: list[int] | list[str]) -> None:
    y = func4(x)
    reveal_type(y, expected_text="int | str")
