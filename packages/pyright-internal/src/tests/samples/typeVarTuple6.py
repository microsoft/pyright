# This sample tests the handling of generic type aliases with
# variadic type variables.

# pyright: reportMissingTypeArgument=true, reportMissingModuleSource=false

from typing import Callable, Generic, TypeVar

from typing_extensions import TypeVarTuple, Unpack

_Xs = TypeVarTuple("_Xs")
_T = TypeVar("_T")


class Array(Generic[Unpack[_Xs]]):
    def __init__(self, *args: Unpack[_Xs]): ...


Alias1 = Array[Unpack[_Xs]]

# This should generate an error.
Alias2 = Array[_Xs]

# This should generate an error.
Alias3 = Array[_T, int, _Xs]

# This should generate an error if reportMissingTypeArgument is enabled.
x1: Alias1 | None = None

x2: Alias1[int] = Array(3)

# This should generate an error.
x3: Alias1[int, str] = Array(3)

x4: Alias1[int, dict[str, str]] = Array(3, {})

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


def func1(a: Alias4[_T, Unpack[_Xs]]) -> tuple[_T, Unpack[_Xs]]: ...


z1 = func1(Array(3, 4, "hi", 3j))
reveal_type(z1, expected_text="tuple[int, str, complex]")

# This should generate an error.
z2 = func1(Array(3, 4.3, "hi", 3j))

z3 = func1(Array(3.5, 4))
reveal_type(z3, expected_text="tuple[float]")

Alias6 = tuple[int, Unpack[_Xs]]


# The type annotation for y will generate an error if
# reportMissingTypeArgument is enabled.
def func2(x: Alias6[float, bool], y: Alias6, z: Alias6[()]):
    reveal_type(x, expected_text="tuple[int, float, bool]")

    reveal_type(y, expected_text="tuple[int, *tuple[Unknown, ...]]")

    reveal_type(z, expected_text="tuple[int]")


Alias7 = Callable[[Unpack[_Xs]], None]


def func3(cb: Alias7[int, Unpack[_Xs]]) -> tuple[Unpack[_Xs]]: ...


def func4(a: int, b: str) -> None: ...


reveal_type(func3(func4), expected_text="tuple[str]")


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")

Alias8 = tuple[*_Xs, _T1, _T2]

# This should generate an error because there are
# enough type arguments.
a8_1: Alias8[int]

a8_2: Alias8[int, int]


class ClassA9(Generic[_T1]):
    pass


# This should generate an error.
a9_1: ClassA9[*tuple[int]]
