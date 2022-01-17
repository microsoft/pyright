# This sample tests that pyright emits an error when attempting to access
# a non-ClassVar protocol attribute from a protocol class.

from typing import ClassVar, Protocol


class SomeProtocol(Protocol):
    x: int = 3
    y: int
    z: ClassVar[int]

    @classmethod
    def meth1(cls) -> None:
        return None

    @staticmethod
    def meth2() -> None:
        return None


class Class(SomeProtocol):
    y = 0
    z = 0


def func1() -> None:
    # This should generate an error because y is not a ClassVar.
    x: int = Class.x

    # This should generate an error because y is not a ClassVar.
    y: int = Class.y

    z: int = Class.z

    Class.meth1
    Class.meth2
