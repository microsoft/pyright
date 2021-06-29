# This sample tests type aliases that are unions that include
# TypeVars.

from datetime import datetime
from typing import IO, List, Type, TypeVar, Union

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")

MyUnion1 = Union[int, _T1, str, _T2, List[_T1]]

MyUnion2 = Union[float, datetime]

MyUnion3 = MyUnion1[MyUnion2]

MyUnion4 = MyUnion1[MyUnion2, IO]

# This should generate an error because only two type
# arguments are expected.
MyUnion5 = MyUnion1[MyUnion2, IO, str]


class Foo:
    def __int__(self) -> int:
        return 0


FooT = TypeVar("FooT", bound=Foo)
FooIsh = Union[int, FooT]


class Bar(Foo):
    def __int__(self) -> int:
        return super().__int__() + 1


v1: FooIsh[Bar] = 42
v2: FooIsh[Bar] = Bar()

# This should generate an error.
v3: FooIsh[Type[Bar]] = 42
