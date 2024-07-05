# This sample tests support for PEP 696 -- default types for TypeVars.
# In particular, it tests the handling of default TypeVar types for
# generic type aliases.

from collections.abc import Callable
from typing import Any, TypeAlias
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVar,
    ParamSpec,
    TypeVarTuple,
    Unpack,
)


T1 = TypeVar("T1")
T2 = TypeVar("T2", default=int)
T3 = TypeVar("T3", default=str)

TA1: TypeAlias = dict[T2, T3]


def func_a1(a: TA1, b: TA1[float], c: TA1[float, float]):
    reveal_type(a, expected_text="dict[int, str]")
    reveal_type(b, expected_text="dict[float, str]")
    reveal_type(c, expected_text="dict[float, float]")


TA2: TypeAlias = dict[T1, T2] | list[T3]


def func_a2(a: TA2, b: TA2[float], c: TA2[float, float], d: TA2[float, float, float]):
    reveal_type(a, expected_text="dict[Unknown, int] | list[str]")
    reveal_type(b, expected_text="dict[float, int] | list[str]")
    reveal_type(c, expected_text="dict[float, float] | list[str]")
    reveal_type(d, expected_text="dict[float, float] | list[float]")


P1 = ParamSpec("P1")
P2 = ParamSpec("P2", default=[int, str])
P3 = ParamSpec("P3", default=...)

TA3: TypeAlias = Callable[P2, Any] | Callable[P3, Any]


def func_b1(a: TA3, b: TA3[[float]], c: TA3[[float], [list[float]]]):
    reveal_type(a, expected_text="((int, str) -> Any) | ((...) -> Any)")
    reveal_type(b, expected_text="((float) -> Any) | ((...) -> Any)")
    reveal_type(c, expected_text="((float) -> Any) | ((list[float]) -> Any)")


Ts1 = TypeVarTuple("Ts1")
Ts2 = TypeVarTuple("Ts2", default=Unpack[tuple[int, str]])
Ts3 = TypeVarTuple("Ts3", default=Unpack[tuple[float, ...]])
Ts4 = TypeVarTuple("Ts4", default=Unpack[tuple[()]])

TA4: TypeAlias = tuple[*Ts2]

TA5: TypeAlias = tuple[T3, *Ts3]

TA6: TypeAlias = tuple[T3, *Ts4]


def func_c1(a: TA4, b: TA4[*tuple[float]]):
    reveal_type(a, expected_text="tuple[int, str]")
    reveal_type(b, expected_text="tuple[float]")


def func_c2(a: TA5, b: TA5[int], c: TA5[int, *tuple[()]]):
    reveal_type(a, expected_text="tuple[str, *tuple[float, ...]]")
    reveal_type(b, expected_text="tuple[int, *tuple[float, ...]]")
    reveal_type(c, expected_text="tuple[int]")


def func_c3(a: TA6, b: TA6[int], c: TA6[int, *tuple[float]]):
    reveal_type(a, expected_text="tuple[str]")
    reveal_type(b, expected_text="tuple[int]")
    reveal_type(c, expected_text="tuple[int, float]")


P4 = ParamSpec("P4", default=[float, bool])
P5 = ParamSpec("P5", default=[bool])
Ts5 = TypeVarTuple("Ts5")

TA7 = tuple[*Ts5] | Callable[P4, Any] | Callable[P5, Any]


def func_d1(x: TA7[int, str, complex]):
    reveal_type(
        x,
        expected_text="tuple[int, str, complex] | ((float, bool) -> Any) | ((bool) -> Any)",
    )


def func_d2(x: TA7[int, str, [str, complex]]):
    reveal_type(
        x,
        expected_text="tuple[int, str] | ((str, complex) -> Any) | ((bool) -> Any)",
    )
