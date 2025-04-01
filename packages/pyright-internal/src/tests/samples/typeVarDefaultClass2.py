# This sample tests the case where a TypeVar default refers to another
# TypeVar in a class declaration. This sample uses classic TypeVar syntax.
# If you make a change to this file, reflect the change in
# typeVarDefaultClass3.py, which uses PEP 695 syntax.

from typing import Generic, ParamSpec, TypeVar, TypeVarTuple, Unpack


T1 = TypeVar("T1", default=str)
T2 = TypeVar("T2", default=T1)
T3 = TypeVar("T3", default=list[T2])
T4 = TypeVar("T4", default=dict[T1, T2])

# This should generate an error because of the recursive definition.
T5 = TypeVar("T5", default="T5")


class ClassA(dict[T1, T2]): ...


a1 = ClassA[int]()
reveal_type(a1, expected_text="ClassA[int, int]")

a2 = ClassA()
reveal_type(a2, expected_text="ClassA[str, str]")


# This should generate an error because T2 depends on T1.
class ClassC(Generic[T2, T1]): ...


class ClassD(dict[T2, T1], Generic[T1, T2]): ...


d1 = ClassD[int]()
reveal_type(d1, expected_text="ClassD[int, int]")

d2 = ClassD()
reveal_type(d2, expected_text="ClassD[str, str]")


# This should generate an error because T5 refers to itself.
class ClassE(Generic[T5]): ...


class ClassH(Generic[T1, T2, T3]): ...


h1 = ClassH()
reveal_type(h1, expected_text="ClassH[str, str, list[str]]")

h2 = ClassH[int]()
reveal_type(h2, expected_text="ClassH[int, int, list[int]]")

h3 = ClassH[int, float]()
reveal_type(h3, expected_text="ClassH[int, float, list[float]]")


# This should generate an error because T2 depends on T1.
class ClassI(Generic[T2]): ...


# This should generate an error because T4 depends on T2.
class ClassJ(Generic[T1, T4]): ...


class ClassK(Generic[T1]):
    # This should generate an error because T2 depends on T1, which
    # is defined in an outer scope.
    class ClassL(Generic[T2]): ...


class ClassMChild1(Generic[T1]):
    a: T1


class ClassMChild2(Generic[T1]):
    b: T1


class ClassM(ClassMChild1[T1], ClassMChild2[T2]): ...


m1 = ClassM[int]()
reveal_type(m1.a, expected_text="int")
reveal_type(m1.b, expected_text="int")

m2 = ClassM()
reveal_type(m2.a, expected_text="str")
reveal_type(m2.b, expected_text="str")


class ClassNChild(Generic[T1]):
    a: T1


class ClassN(ClassNChild): ...


n1 = ClassN()
reveal_type(n1.a, expected_text="str")


P1 = ParamSpec("P1", default=...)
P2 = ParamSpec("P2", default=P1)
P3 = ParamSpec("P3", default=P2)
P4 = ParamSpec("P4", default=[int, T1])


class ClassPA(Generic[P1, P2, P3]): ...


pa1 = ClassPA()
reveal_type(pa1, expected_text="ClassPA[..., ..., ...]")

pa2 = ClassPA[[str]]()
reveal_type(pa2, expected_text="ClassPA[(str), (str), (str)]")

pa3 = ClassPA[..., [float]]()
reveal_type(pa3, expected_text="ClassPA[..., (float), (float)]")

pa4 = ClassPA[..., [int, int], [float]]()
reveal_type(pa4, expected_text="ClassPA[..., (int, int), (float)]")


# This should generate an error because P1 depends on P2.
class ClassPB(Generic[P2, P1]): ...


class ClassPC(Generic[T1, P4]): ...


pc1 = ClassPC()
reveal_type(pc1, expected_text="ClassPC[str, (int, str)]")

pc2 = ClassPC[float]()
reveal_type(pc2, expected_text="ClassPC[float, (int, float)]")

pc3 = ClassPC[float, ...]()
reveal_type(pc3, expected_text="ClassPC[float, ...]")


# This should generate an error because P4 depends on T1.
class ClassPD(Generic[P4, T1]): ...


Ts1 = TypeVarTuple("Ts1", default=Unpack[tuple[T1, T2]])
Ts2 = TypeVarTuple("Ts2", default=Unpack[tuple[T1, ...]])


class ClassTA(Generic[T1, T2, *Ts1]): ...


ta1 = ClassTA()
reveal_type(ta1, expected_text="ClassTA[str, str, str, str]")

ta2 = ClassTA[int]()
reveal_type(ta2, expected_text="ClassTA[int, int, int, int]")

ta3 = ClassTA[int, float]()
reveal_type(ta3, expected_text="ClassTA[int, float, int, float]")

ta4 = ClassTA[int, float, *tuple[None, ...]]()
reveal_type(ta4, expected_text="ClassTA[int, float, *tuple[None, ...]]")


# This should generate an error because Ts1 depends on T2.
# It should also produce an error because T2 comes after a TypeVarTuple.
class ClassTB(Generic[T1, *Ts1, T2]): ...


class ClassTC(Generic[T1, *Ts2]): ...


tc1 = ClassTC()
reveal_type(tc1, expected_text="ClassTC[str, *tuple[str, ...]]")

tc2 = ClassTC[int]()
reveal_type(tc2, expected_text="ClassTC[int, *tuple[int, ...]]")

tc3 = ClassTC[int, *tuple[()]]()
reveal_type(tc3, expected_text="ClassTC[int]")

tc4 = ClassTC[int, *tuple[None]]()
reveal_type(tc4, expected_text="ClassTC[int, None]")
