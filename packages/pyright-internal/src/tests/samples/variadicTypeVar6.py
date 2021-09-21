# This sample tests the handling of generic type aliases with
# variadic type variables.

# pyright: reportMissingModuleSource=false, reportMissingTypeArgument=true

from typing import Dict, Generic, Literal, Optional, Tuple, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack

_Xs = TypeVarTuple("_Xs")
_T = TypeVar("_T")


class Array(Generic[Unpack[_Xs]]):
    def __init__(self, *args: Unpack[_Xs]):
        ...


Alias1 = Array[Unpack[_Xs]]

# This should generate an error
Alias2 = Array[_Xs]

# This should generate an error
Alias3 = Array[_T, int, _Xs]

# This should generate an error if reportMissingTypeArgument is enabled.
x1: Optional[Alias1] = None

x2: Alias1[int] = Array(3)

# This should generate an error.
x3: Alias1[int, str] = Array(3)

x4: Alias1[int, Dict[str, str]] = Array(3, {})

# This should generate an error.
x5: Alias1[()] = Array(3)

x6 = Alias1[int, int, str](3, 4, "")

x7: Alias1[int, float, str] = Array(3, 4, "")

Alias4 = Array[_T, int, Unpack[_Xs]]

Alias5 = Array[Unpack[_Xs]]

y1: Alias4[float, str, str] = Array(3.4, 2, "hi", "hi")

# This should generate an error.
y2: Alias4[float, str, str] = Array("3.4", 2, "hi", "hi")

y3 = Alias4[float, str, str](3, 2, "hi", "hi")


def func1(a: Alias4[_T, Unpack[_Xs]]) -> Union[_T, Unpack[_Xs]]:
    ...


z1 = func1(Array(3, 4, "hi", 3j))
t_z1: Literal["int | str | complex"] = reveal_type(z1)

# This should generate an error.
z2 = func1(Array(3, 4.3, "hi", 3j))

z3 = func1(Array(3.5, 4))
t_z3: Literal["float"] = reveal_type(z3)

Alias6 = Tuple[int, Unpack[_Xs]]


# The type annotation for y will generate an error if
# reportMissingTypeArgument is enabled.
def func2(x: Alias6[float, bool], y: Alias6, z: Alias6[()]):
    t_x: Literal["Tuple[int, float, bool]"] = reveal_type(x)

    t_y: Literal["Tuple[int, *_Xs@Alias6]"] = reveal_type(y)

    t_z: Literal["Tuple[int]"] = reveal_type(z)
