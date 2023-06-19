# This sample tests assignment of dataclass fields that use
# the coverter parameter described in PEP 712.

from dataclasses import dataclass, field
from typing import Generic, TypeVar


def converter_simple(s: str) -> int:
    return int(s)


@dataclass
class Foo:
    # This should generate an error because "converter" is not an official property yet.
    field0: int = field(converter=converter_simple)

foo = Foo("1")
reveal_type(foo.field0, expected_text="int")
foo.field0 = "2"

# This should generate an error because only strs can be assigned to field0.
foo.field0 = 2


_T = TypeVar("_T", bound=float)

@dataclass
class GenericFoo(Generic[_T]):
    @staticmethod
    def getT() -> _T: ...

    @staticmethod
    def convertFromT(x: _T | None) -> str:
        return str(x)

    @staticmethod
    def passThru(x: _T) -> _T:
        return x

    @staticmethod
    def convertToT(x: str) -> _T:
        return x

    # This should generate an error because "converter" is not an official property yet.
    field0: str = field(converter=convertFromT)
    # This should generate an error because "converter" is not an official property yet.
    field1: _T = field(converter=passThru)
    # This should generate an error because "converter" is not an official property yet.
    field2: _T = field(converter=convertToT)

g = GenericFoo[float](1, 1, 1)

reveal_type(g.field0, expected_text="str")
g.field0 = 1.0

reveal_type(g.field1, expected_text="float")
g.field1 = 1.0

reveal_type(g.field2, expected_text="float")
g.field2 = "1"
