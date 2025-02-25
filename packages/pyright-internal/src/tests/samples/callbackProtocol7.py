# This sample tests the case where a callback protocol uses position-only
# parameters.

from typing import Any, Protocol


class P0(Protocol):
    def __call__(self, x: int, /, y: str) -> Any: ...


def test1(x: int, /, y: str, z: None = None) -> Any: ...


x: P0 = test1


class P1(Protocol):
    def __call__(self, *args: *tuple[int, int]): ...


class P2(Protocol):
    def __call__(self, x: int, y: int, /): ...


class P3(Protocol):
    def __call__(self, x: int, /, *args: *tuple[int]): ...


class P4(Protocol):
    def __call__(self, x: int, y: int = 2, /): ...


def test2(p1: P1, p2: P2, p3: P3, p4: P4):
    x1: P1 = p2
    x2: P1 = p3
    x3: P1 = p4
