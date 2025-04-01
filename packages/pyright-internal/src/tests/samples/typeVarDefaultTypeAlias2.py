# This sample tests support for PEP 696 (default types for TypeVars).
# In particular, it tests the handling of default TypeVar types for
# generic type aliases when one TypeVar default expression refers
# to another.

from typing import Callable, Generic, Unpack
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    ParamSpec,
    TypeVar,
    TypeVarTuple,
)

T1 = TypeVar("T1", default=str)
T2 = TypeVar("T2", default=T1)
T3 = TypeVar("T3", default=list[T2])
T4 = TypeVar("T4", default=dict[T1, T2])

# This should generate an error because of the recursive definition.
T5 = TypeVar("T5", default="T5")

TA_A = dict[T1, T2]


def func1(a1: TA_A[int], a2: TA_A):
    reveal_type(a1, expected_text="dict[int, int]")
    reveal_type(a2, expected_text="dict[str, str]")


# This should generate an error because T2 depends on T1.
TA_B = dict[T2, T1]

# This should generate an error because T5 refers to itself.
TA_C = list[T5]

TA_D = tuple[T1, T2, T3]


def func2(d1: TA_D, d2: TA_D[int], d3: TA_D[int, float]):
    reveal_type(d1, expected_text="tuple[str, str, list[str]]")
    reveal_type(d2, expected_text="tuple[int, int, list[int]]")
    reveal_type(d3, expected_text="tuple[int, float, list[float]]")


# This should generate an error because T2 depends on T1.
TA_E = list[T2]

# This should generate an error because T4 depends on T2.
TA_F = dict[T2, T4]


class ClassK(Generic[T1]):
    # This should generate an error because T2 depends on T1, which
    # is defined in an outer scope.
    TA_G = list[T2]


P1 = ParamSpec("P1", default=...)
P2 = ParamSpec("P2", default=P1)
P3 = ParamSpec("P3", default=P2)
P4 = ParamSpec("P4", default=[int, T1])

TA_PA = tuple[Callable[P1, None], Callable[P2, None], Callable[P3, None]]


def func3(
    pa1: TA_PA,
    pa2: TA_PA[[str]],
    pa3: TA_PA[..., [float]],
    pa4: TA_PA[..., [int, int], [float]],
):
    reveal_type(pa1, expected_text="tuple[(...) -> None, (...) -> None, (...) -> None]")
    reveal_type(pa2, expected_text="tuple[(str) -> None, (str) -> None, (str) -> None]")
    reveal_type(
        pa3, expected_text="tuple[(...) -> None, (float) -> None, (float) -> None]"
    )
    reveal_type(
        pa4, expected_text="tuple[(...) -> None, (int, int) -> None, (float) -> None]"
    )


# This should generate an error because P1 depends on P2.
TA_PB = tuple[Callable[P2, None], Callable[P1, None]]

TA_PC = T1 | Callable[P4, T1]


def func4(pc1: TA_PC, pc2: TA_PC[float], pc3: TA_PC[float, ...]):
    reveal_type(pc1, expected_text="str | ((int, str) -> str)")
    reveal_type(pc2, expected_text="float | ((int, float) -> float)")
    reveal_type(pc3, expected_text="float | ((...) -> float)")


# This should generate an error because P4 depends on T1.
TA_PD = Callable[P4, T1]


Ts1 = TypeVarTuple("Ts1", default=Unpack[tuple[T1, T2]])
Ts2 = TypeVarTuple("Ts2", default=Unpack[tuple[T1, ...]])


class ClassTA(Generic[T1, T2, *Ts1]): ...


TA_TA = ClassTA[T1, T2, *Ts1]


def func5(
    ta1: TA_TA,
    ta2: TA_TA[int],
    ta3: TA_TA[int, float],
    ta4: TA_TA[int, float, *tuple[None, ...]],
):
    reveal_type(ta1, expected_text="ClassTA[str, str, str, str]")
    reveal_type(ta2, expected_text="ClassTA[int, int, int, int]")
    reveal_type(ta3, expected_text="ClassTA[int, float, int, float]")
    reveal_type(ta4, expected_text="ClassTA[int, float, *tuple[None, ...]]")


# This should generate an error because Ts1 depends on T2.
# It should also generate a second error because T2 follows a TypeVarTuple.
TA_TB = tuple[T1, *Ts1, T2]


class ClassTC(Generic[T1, *Ts2]): ...


TA_TC = ClassTC[T1, *Ts2]


def func6(
    tc1: TA_TC,
    tc2: TA_TC[int],
    tc3: TA_TC[int, *tuple[()]],
    tc4: TA_TC[int, *tuple[None]],
):
    reveal_type(tc1, expected_text="ClassTC[str, *tuple[str, ...]]")
    reveal_type(tc2, expected_text="ClassTC[int, *tuple[int, ...]]")
    reveal_type(tc3, expected_text="ClassTC[int]")
    reveal_type(tc4, expected_text="ClassTC[int, None]")
