# This sample tests the case where a TypeVar is bound to a
# protocol class.

from typing import Protocol, TypeVar


class ClsProtocol(Protocol):
    def __init__(self): ...


T1 = TypeVar("T1", bound="ClsProtocol")


class Sample:
    @classmethod
    def test(cls: type[T1]) -> T1:
        return cls()


reveal_type(Sample.test(), expected_text="Sample")
reveal_type(Sample().test(), expected_text="Sample")
