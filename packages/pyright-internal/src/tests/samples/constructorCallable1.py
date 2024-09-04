# This sample verifies that a class can be assigned to a Callable
# type if its constructor conforms to that type.

from dataclasses import dataclass
from typing import (
    Any,
    Callable,
    Generic,
    Literal,
    ParamSpec,
    Sized,
    TypeVar,
    Union,
    overload,
)

T1 = TypeVar("T1")
T2 = TypeVar("T2")
P = ParamSpec("P")
R = TypeVar("R")


def func1(callback: Callable[[T1], T2], val: T1) -> T2: ...


class A(Generic[T1]):
    def __new__(cls, x: T1) -> "A[T1]": ...


a1 = func1(A[float], 3.4)
reveal_type(a1, expected_text="A[float]")

# This should generate an error.
a2 = func1(A[int], 3.4)

a3 = func1(A[int], 3)
reveal_type(a3, expected_text="A[int]")


class B(Generic[T1]):
    @overload
    def __new__(cls, x: int, y: Literal[True]) -> "B[None]": ...

    @overload
    def __new__(cls, x: T1, y: bool = ...) -> "B[T1]": ...

    def __new__(cls, x: Union[T1, int], y: bool = False) -> "B[Any]": ...


b1 = func1(B[int], 3)
reveal_type(b1, expected_text="B[int]")

# This should generate an error.
b2 = func1(B[None], 3.5)

b3 = func1(B[float], 3.5)
reveal_type(b3, expected_text="B[float]")

b4 = func1(B[Union[int, str]], 3)
reveal_type(b4, expected_text="B[int | str]")

b5 = func1(B[Union[int, str]], "3")
reveal_type(b5, expected_text="B[int | str]")


class C(Generic[T1]):
    def __init__(self, x: T1) -> None: ...


c1 = func1(C[float], 3.4)
reveal_type(c1, expected_text="C[float]")

# This should generate an error.
c2 = func1(C[int], 3.4)

c3 = func1(C[int], 3)
reveal_type(c3, expected_text="C[int]")


class D(Generic[T1]):
    @overload
    def __init__(self: "D[None]", x: int, y: Literal[True]) -> None: ...

    @overload
    def __init__(self, x: T1, y: bool = ...) -> None: ...

    def __init__(self, x: Any, y: bool = False) -> None: ...


d1 = func1(D[int], 3)
reveal_type(d1, expected_text="D[int]")

# This should generate an error.
d2 = func1(D[None], 3.5)

d3 = func1(D[float], 3.5)
reveal_type(d3, expected_text="D[float]")

d4 = func1(D[Union[int, str]], 3)
reveal_type(d4, expected_text="D[int | str]")

d5 = func1(D[Union[int, str]], "3")
reveal_type(d5, expected_text="D[int | str]")


@dataclass(frozen=True, slots=True)
class E(Generic[T1]):
    x: T1


e1: Callable[[int], E[int]] = E


def func2(x: T1) -> E[T1]: ...


e2: Callable[[int], E[int]] = func2


def cast_to_callable(cls: Callable[P, T1]) -> Callable[P, T1]:
    return cls


class F:
    pass


reveal_type(cast_to_callable(F), expected_text="() -> F")
reveal_type(
    cast_to_callable(Sized), expected_text="(*args: Any, **kwargs: Any) -> Sized"
)


def func3(t: type[object]):
    reveal_type(
        cast_to_callable(t), expected_text="(*args: Any, **kwargs: Any) -> object"
    )


@dataclass
class G:
    value: int


def func4(c: Callable[[T1], T2]) -> Callable[[T1], T2]:
    return c


reveal_type(func4(G), expected_text="(int) -> G")


# Test the conversion of a complex constructor that involves
# a bunch of type variables, a default __new__ (that comes
# from object), and an __init__ that involves custom self
# types. This is meant to test a class like defaultdict.
KT = TypeVar("KT")
VT = TypeVar("VT")


class DDict(dict[KT, VT]):
    @overload
    def __init__(self) -> None: ...
    @overload
    def __init__(self: "DDict[str, T1]", **kwargs: T1) -> None: ...
    @overload
    def __init__(self, default_factory: Callable[[], VT] | None, /) -> None: ...
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...


dd1 = cast_to_callable(DDict)
reveal_type(
    dd1,
    expected_text="Overload[() -> DDict[Unknown, Unknown], (**kwargs: T1@__init__) -> DDict[str, T1@__init__], (default_factory: (() -> VT@DDict) | None, /) -> DDict[Unknown, VT@DDict]]",
)
