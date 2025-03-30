# This sample tests specification of generic types.

from typing import Generic, Iterable, List, TypeVar


class A:
    pass


class B(A):
    pass


class C(A):
    pass


_T1 = TypeVar("_T1", A, B)


class Moo(Generic[_T1]):
    pass


class Foo:
    def __init__(self) -> None: ...

    def m1(self, a: Moo[A]) -> None: ...

    def m2(self, b: Moo[B]) -> None: ...


a = Moo[A]()
b = Moo[B]()

y = Foo()

y.m1(a)

# This should generate an error:
# Argument of type 'Moo[B]' cannot be assigned to parameter of type 'Moo[A]'
y.m1(b)

# This should generate an error:
# Argument of type 'Moo[A]' cannot be assigned to parameter of type 'Moo[B]'
y.m2(a)

y.m2(b)


def m3(c: Moo[C]):
    pass


# This should generate an error:
# Type argument 'List[C]' cannot be assigned to type variable '_T1'
def m4(c: Moo[List[C]]):
    pass


class D(Generic[_T1]):
    # This should generate an error:
    # TypeVar constraint types can't be generic.
    _T2 = TypeVar("_T2", Iterable[_T1], int)

    # This should generate an error:
    # TypeVar bound types can't be generic.
    _T3 = TypeVar("_T3", bound=Iterable[_T1])


# This should generate an error:
# TypeVars can't be bound and constrained.
_T4 = TypeVar("_T4", str, int, bound=int)

# This should generate an error:
# TypeVar must include more than one constraint.
_T5 = TypeVar("_T5", str)
