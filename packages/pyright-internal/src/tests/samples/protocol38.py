# This sample tests the case where a protocol is specialized with
# a literal type.

from typing import Literal, Protocol, Self


class Negatable(Protocol):
    def __neg__(self) -> Self:
        ...


def func1(x: Negatable) -> None:
    ...


func1(0)


def func2(val: Literal[0, 1]):
    func1(val)
