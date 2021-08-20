# This sample tests the case where a TypeVar is bound to a
# protocol class.

from typing import Literal, Protocol, Type, TypeVar


class ClsProtocol(Protocol):
    def __init__(self):
        ...


T1 = TypeVar("T1", bound="ClsProtocol")


class Sample:
    @classmethod
    def test(cls: Type[T1]) -> T1:
        return cls()


t1: Literal["Sample"] = reveal_type(Sample.test())
t2: Literal["Sample"] = reveal_type(Sample().test())
