# This sample tests the case where a TypeVar default refers to another
# TypeVar in a class declaration. This sample uses PEP 695 syntax.

from typing import Self, Unpack


class ClassA[T1 = str, T2 = T1](dict[T1, T2]):
    def method1(self) -> Self:
        return self


reveal_type(
    ClassA[int].method1, expected_text="(self: ClassA[int, int]) -> ClassA[int, int]"
)
reveal_type(
    ClassA.method1, expected_text="(self: ClassA[str, str]) -> ClassA[str, str]"
)

a1 = ClassA[int]()
reveal_type(a1, expected_text="ClassA[int, int]")

a2 = ClassA()
reveal_type(a2, expected_text="ClassA[str, str]")


# This should generate an error because T2 depends on T1.
class ClassC[T2 = T1, T1 = str]: ...


class ClassD[T1 = str, T2 = T1](dict[T2, T1]): ...


d1 = ClassD[int]()
reveal_type(d1, expected_text="ClassD[int, int]")

d2 = ClassD()
reveal_type(d2, expected_text="ClassD[str, str]")


# This should generate an error because T5 refers to itself.
class ClassE[T5 = T5]: ...


class ClassH[T1 = str, T2 = T1, T3 = list[T2]]: ...


h1 = ClassH()
reveal_type(h1, expected_text="ClassH[str, str, list[str]]")

h2 = ClassH[int]()
reveal_type(h2, expected_text="ClassH[int, int, list[int]]")

h3 = ClassH[int, float]()
reveal_type(h3, expected_text="ClassH[int, float, list[float]]")


# This should generate an error because T2 depends on T1.
class ClassI[T2 = T1]: ...


# This should generate an error because T4 depends on T2.
class ClassJ[T1 = str, T4 = dict[T1, T2]]: ...


class ClassK[T1 = str]:
    # This should generate an error because T2 depends on T1, which
    # is defined in an outer scope.
    class ClassL[T2 = T1]: ...


class ClassPA[**P1, **P2 = P1, **P3 = P2]: ...


pa1 = ClassPA()
reveal_type(pa1, expected_text="ClassPA[..., ..., ...]")

pa2 = ClassPA[[str]]()
reveal_type(pa2, expected_text="ClassPA[(str), (str), (str)]")

pa3 = ClassPA[..., [float]]()
reveal_type(pa3, expected_text="ClassPA[..., (float), (float)]")

pa4 = ClassPA[..., [int, int], [float]]()
reveal_type(pa4, expected_text="ClassPA[..., (int, int), (float)]")


# This should generate an error because P1 depends on P2.
class ClassPB[**P2 = P1, **P1 = ...]: ...


class ClassPC[T1 = str, **P4 = [int, T1]]: ...


pc1 = ClassPC()
reveal_type(pc1, expected_text="ClassPC[str, (int, str)]")

pc2 = ClassPC[float]()
reveal_type(pc2, expected_text="ClassPC[float, (int, float)]")

pc3 = ClassPC[float, ...]()
reveal_type(pc3, expected_text="ClassPC[float, ...]")


# This should generate an error because P4 depends on T1.
class ClassPD[**P4 = [int, T1], T1 = str]: ...


class ClassTA[T1 = str, T2 = T1, *Ts1 = Unpack[tuple[T1, T2]]]: ...


ta1 = ClassTA()
reveal_type(ta1, expected_text="ClassTA[str, str, str, str]")

ta2 = ClassTA[int]()
reveal_type(ta2, expected_text="ClassTA[int, int, int, int]")

ta3 = ClassTA[int, float]()
reveal_type(ta3, expected_text="ClassTA[int, float, int, float]")

ta4 = ClassTA[int, float, *tuple[None, ...]]()
reveal_type(ta4, expected_text="ClassTA[int, float, *tuple[None, ...]]")


# This should generate an error because Ts1 depends on T2.
# It will generate a second error because T2 follows a TypeVarTuple.
class ClassTB[T1 = str, *Ts1 = Unpack[tuple[T1, T2]], T2 = T1]: ...


class ClassTC[T1 = str, *Ts2 = Unpack[tuple[T1, ...]]]: ...


tc1 = ClassTC()
reveal_type(tc1, expected_text="ClassTC[str, *tuple[str, ...]]")

tc2 = ClassTC[int]()
reveal_type(tc2, expected_text="ClassTC[int, *tuple[int, ...]]")

tc3 = ClassTC[int, *tuple[()]]()
reveal_type(tc3, expected_text="ClassTC[int]")

tc4 = ClassTC[int, *tuple[None]]()
reveal_type(tc4, expected_text="ClassTC[int, None]")
