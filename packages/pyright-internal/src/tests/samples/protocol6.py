# This sample tests nested protocol definitions.

from typing import Literal, Protocol, TypeVar

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")
_T3 = TypeVar("_T3")


class Animal(Protocol[_T1]):
    species: str
    attributes: list[_T1]


class Mammal(Animal[_T2], Protocol):
    pass


class Ungulate(Mammal[_T3], Protocol):
    type_of_hooves: _T3


class CamelLike(Ungulate[bytes], Protocol):
    species: Literal["camel"]  # pyright: ignore[reportIncompatibleVariableOverride]


class Sloth:
    species: str
    attributes: list[str]


class Armadillo:
    species: str
    attributes: list[bytes]


class Tapir:
    species: str


class Camel:
    species: Literal["camel"]
    attributes: list[bytes]
    type_of_hooves: bytes


class Cow:
    species: str
    attributes: list[str]
    type_of_hooves: str


a: Mammal[str] = Sloth()

# This should generate an error because Armadillo
# uses bytes for its attributes, not str.
b: Mammal[str] = Armadillo()

# This should generate an error because Tapir
# doesn't provide an attributes.
c: Mammal[str] = Tapir()

# This should generate an error because "species"
# is incompatible.
d: Ungulate[bytes] = Camel()

e: Ungulate[str] = Cow()
f: CamelLike = Camel()


class CallTreeProto(Protocol):
    subcalls: list["CallTreeProto"]


class MyCallTree:
    subcalls: list["MyCallTree"]


class OtherCallTree:
    subcalls: list["CallTreeProto"]


# This should generate an error.
x1: CallTreeProto = MyCallTree()

x2: CallTreeProto = OtherCallTree()
