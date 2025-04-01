# This sample is used in conjunction with protocolModule4.py.

from typing import Protocol, TypeVar

Y = TypeVar("Y", contravariant=True)


class Fn(Protocol[Y]):
    def __call__(self, y: Y) -> None: ...


def x(x: Fn[int]) -> None:
    print(x)
