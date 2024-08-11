# This sample tests the case where a generic type alias with a TypeVarTuple
# also contains other TypeVars, and it is specialized with an unpacked tuple.

from typing import TypeVar, TypeVarTuple

Ts = TypeVarTuple("Ts")
T1 = TypeVar("T1")
T2 = TypeVar("T2")

TA1 = tuple[T1, *Ts, T2]
TA1_Spec1 = TA1[*tuple[int, ...]]
TA1_Spec2 = TA1[float, *tuple[int, ...]]
TA1_Spec3 = TA1[*tuple[int, ...], str]
TA1_Spec4 = TA1[float, *tuple[int, ...], str]

TA2 = tuple[*Ts, T1, T2]
TA2_Spec1 = TA2[*tuple[int, ...]]

TA3 = tuple[T1, T2, *Ts]
TA3_Spec1 = TA3[*tuple[int, ...]]

TA4 = tuple[T1, T1, *Ts, T2, T2]
TA4_Spec1 = TA4[*tuple[int, ...]]


def func1(
    ta1_1: TA1_Spec1,
    ta1_2: TA1_Spec2,
    ta1_3: TA1_Spec3,
    ta1_4: TA1_Spec4,
    ta2: TA2_Spec1,
    ta3: TA3_Spec1,
    ta4: TA4_Spec1,
):
    reveal_type(ta1_1, expected_type="tuple[int, *tuple[int, ...], int]")
    reveal_type(ta1_2, expected_type="tuple[float, *tuple[int, ...], int]")
    reveal_type(ta1_3, expected_type="tuple[int, *tuple[int, ...], str]")
    reveal_type(ta1_4, expected_type="tuple[float, *tuple[int, ...], str]")
    reveal_type(ta2, expected_type="tuple[*tuple[int, ...], int, int]")
    reveal_type(ta3, expected_type="tuple[int, int, *tuple[int, ...]]")
    reveal_type(ta4, expected_type="tuple[int, int, *tuple[int, ...], int, int]")
