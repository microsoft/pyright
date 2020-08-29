# This sample tests type aliases that are unions that include
# TypeVars.

from datetime import datetime
from typing import IO, List, TypeVar, Union

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")

MyUnion1 = Union[int, _T1, str, _T2, List[_T1]]

MyUnion2 = Union[float, datetime]

MyUnion3 = MyUnion1[MyUnion2]

MyUnion4 = MyUnion1[MyUnion2, IO]

# This should generate an error because only two type
# arguments are expected.
MyUnion5 = MyUnion1[MyUnion2, IO, str]
