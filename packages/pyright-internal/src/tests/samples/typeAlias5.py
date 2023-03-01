# This sample tests type aliases that are unions that include
# TypeVars.

from datetime import datetime
from typing import IO, Dict, Generic, List, Literal, Type, TypeVar, Union

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")

MyUnion1 = Union[int, _T1, str, _T2, List[_T1]]

MyUnion2 = Union[float, datetime]

# This should generate an error because two type arguements are
# expected, but only one was provided.
MyUnion3 = MyUnion1[MyUnion2]

MyUnion4 = MyUnion1[MyUnion2, IO]

# This should generate an error because only two type
# arguments are expected.
MyUnion5 = MyUnion1[MyUnion2, IO, str]

MyUnion6 = MyUnion1[Literal[0], Literal["a"]]
reveal_type(
    MyUnion6,
    expected_text="Type[int] | Type[str] | Type[List[Literal[0]]] | Type[Literal[0, 'a']]",
)


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


MyTypeAlias = Dict[_T1, _T2]


class MyClass1(Generic[_T1, _T2]):
    # This should generate an error because S and T are bound
    # type variables.
    MyTypeAlias = Dict[_T1, _T2]
