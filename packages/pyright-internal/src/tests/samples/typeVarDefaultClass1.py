# This sample tests support for PEP 696 -- default types for TypeVars.
# In particular, it tests the handling of default TypeVar types for
# generic classes.

from typing import Generic, Self, assert_type

from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    ParamSpec,
    TypeVar,
    TypeVarTuple,
    Unpack,
)

T1 = TypeVar("T1")
T2 = TypeVar("T2", default=int)
T3 = TypeVar("T3", default=str)


class ClassA1(Generic[T2, T3]):
    def method1(self) -> Self:
        return self


reveal_type(
    ClassA1.method1, expected_text="(self: ClassA1[int, str]) -> ClassA1[int, str]"
)


def func_a1(a: ClassA1, b: ClassA1[float], c: ClassA1[float, float], d: ClassA1[()]):
    reveal_type(a, expected_text="ClassA1[int, str]")
    reveal_type(b, expected_text="ClassA1[float, str]")
    reveal_type(c, expected_text="ClassA1[float, float]")
    reveal_type(d, expected_text="ClassA1[int, str]")


class ClassA2(Generic[T1, T2, T3]):
    def method1(self) -> Self:
        return self


reveal_type(
    ClassA2[int].method1,
    expected_text="(self: ClassA2[int, int, str]) -> ClassA2[int, int, str]",
)


def func_a2(
    a: ClassA2,
    b: ClassA2[float],
    c: ClassA2[float, float],
    d: ClassA2[float, float, float],
):
    reveal_type(a, expected_text="ClassA2[Unknown, int, str]")
    reveal_type(b, expected_text="ClassA2[float, int, str]")
    reveal_type(c, expected_text="ClassA2[float, float, str]")
    reveal_type(d, expected_text="ClassA2[float, float, float]")


P1 = ParamSpec("P1")
P2 = ParamSpec("P2", default=[int, str])
P3 = ParamSpec("P3", default=...)


class ClassB1(Generic[P2, P3]): ...


def func_b1(a: ClassB1, b: ClassB1[[float]], c: ClassB1[[float], [float]]):
    reveal_type(a, expected_text="ClassB1[(int, str), ...]")
    reveal_type(b, expected_text="ClassB1[(float), ...]")
    reveal_type(c, expected_text="ClassB1[(float), (float)]")


Ts1 = TypeVarTuple("Ts1")
Ts2 = TypeVarTuple("Ts2", default=Unpack[tuple[int, str]])
Ts3 = TypeVarTuple("Ts3", default=Unpack[tuple[float, ...]])
Ts4 = TypeVarTuple("Ts4", default=Unpack[tuple[()]])


class ClassC1(Generic[*Ts2]): ...


class ClassC2(Generic[T3, *Ts3]): ...


class ClassC3(Generic[T3, *Ts4]): ...


def func_c1(a: ClassC1, b: ClassC1[*tuple[float]]):
    reveal_type(a, expected_text="ClassC1[int, str]")
    reveal_type(b, expected_text="ClassC1[float]")


def func_c2(a: ClassC2, b: ClassC2[int], c: ClassC2[int, *tuple[()]]):
    reveal_type(a, expected_text="ClassC2[str, *tuple[float, ...]]")
    reveal_type(b, expected_text="ClassC2[int, *tuple[float, ...]]")
    reveal_type(c, expected_text="ClassC2[int]")


def func_c3(a: ClassC3, b: ClassC3[int], c: ClassC3[int, *tuple[float]]):
    reveal_type(a, expected_text="ClassC3[str]")
    reveal_type(b, expected_text="ClassC3[int]")
    reveal_type(c, expected_text="ClassC3[int, float]")


P4 = ParamSpec("P4", default=[float, bool])
P5 = ParamSpec("P5", default=[bool])
Ts5 = TypeVarTuple("Ts5")


class ClassD(Generic[*Ts5, P4, P5]): ...  # OK


reveal_type(
    ClassD[int, str, complex],
    expected_text="type[ClassD[int, str, complex, (float, bool), (bool)]]",
)
reveal_type(
    ClassD[int, str, [str, complex]],
    expected_text="type[ClassD[int, str, (str, complex), (bool)]]",
)

P6 = ParamSpec("P6", default=[str, int])


class ClassE(Generic[P6]): ...


assert_type(ClassE, type[ClassE[str, int]])
assert_type(ClassE(), ClassE[str, int])
assert_type(ClassE[[bool, bool]](), ClassE[bool, bool])
