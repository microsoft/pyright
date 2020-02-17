# This sample tests nested protocol definitions.

from typing import List, Literal, Protocol, TypeVar

_T1 = TypeVar('_T1')
_T2 = TypeVar('_T2')
_T3 = TypeVar('_T3')

class Animal(Protocol[_T1]):
    species: str
    attributes: List[_T1]

class Mammal(Protocol, Animal[_T2]):
    pass

class Ungulate(Protocol, Mammal[_T3]):
    type_of_hooves: _T3

class CamelLike(Protocol, Ungulate[bytes]):
    species: Literal['camel']




class Sloth:
    species: str
    attributes: List[str]

class Armadillo:
    species: str
    attributes: List[bytes]

class Tapir:
    species: str

class Camel:
    species: Literal['camel']
    attributes: List[bytes]
    type_of_hooves: bytes

class Cow:
    species: str
    attributes: List[str]
    type_of_hooves: str


a: Mammal[str] = Sloth()

# This should generage an error because Armadillo
# uses bytes for its attributes, not str.
b: Mammal[str] = Armadillo()

# This should generate an error because Tapir
# doesn't provide an attributes.
c: Mammal[str] = Tapir()

d: Ungulate[bytes] = Camel()
e: Ungulate[str] = Cow()
f: CamelLike = Camel()
