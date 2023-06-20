# This sample tests that an error when attempting to access
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
    # Previously (prior to pyright 1.1.315), this generated an error
    # because x was not explicitly declared as a ClassVar. This was changed
    # to match mypy, which treats this as a normal class variable -- one that
    # can be accessed as both a class an instance variable.
    x: int = Class.x

    # Same as above.
    y: int = Class.y

    z: int = Class.z

    Class.meth1
    Class.meth2
