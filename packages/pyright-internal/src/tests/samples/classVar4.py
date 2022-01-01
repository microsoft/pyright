# This sample tests that pyright emits an error when attempting to access
# a non-ClassVar protocol attribute from a protocol class.

from typing import ClassVar, Protocol


class SomeProtocol(Protocol):
    x: int = 3
    y: int
    z: ClassVar[int]


class Class(SomeProtocol):
    pass


def func1() -> None:
    # This should generate an error because y is not a ClassVar.
    x: int = Class.x

    # This should generate an error because y is not a ClassVar.
    y: int = Class.y

    z: int = Class.z
