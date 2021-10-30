# This sample tests the case where a callback protocol uses position-only
# parameters.

from typing import Any, Protocol


def f1(x: int, /, y: str, z: None = None) -> Any:
    ...


class X(Protocol):
    def __call__(self, x: int, /, y: str) -> Any:
        ...


x: X = f1
