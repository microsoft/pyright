# This sample tests the handling of TypeVars defined by
# a generic function.

from typing import Generic, TypeVar


class ClassA:
    pass


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", bound=ClassA)
_T2A = TypeVar("_T2A", bound=ClassA)
_T3 = TypeVar("_T3", ClassA, int, str)


class Class1(Generic[_T1]):
    def __init__(self, a: _T1):
        self._a: dict[str, _T1] = {}
        self._b: tuple[_T1, ...] = (a, a, a)
        self._c: tuple[_T1, _T1] = (a, a)
        self._d: list[_T1] = [a]


class Class2(Generic[_T2]):
    def __init__(self, a: _T2):
        self._a: dict[str, _T2] = {}
        self._b: tuple[_T2, ...] = (a, a, a)
        self._c: tuple[_T2, _T2] = (a, a)
        self._d: list[_T2] = [a]


class Class2A(Generic[_T2, _T2A]):
    def __init__(self, a: _T2, b: _T2A):
        self._a1: dict[str, _T2A] = {"a": b}
        self._a2: dict[str, _T2] = {"a": a}
        self._b: tuple[_T2, ...] = (a, a, a)
        self._c: tuple[_T2, _T2] = (a, a)
        self._d: list[_T2] = [a]


class Class3(Generic[_T3]):
    def __init__(self, a: _T3):
        self._a: dict[str, _T3] = {}
        self._b: tuple[_T3, ...] = (a, a, a)
        self._c: tuple[_T3, _T3] = (a, a)
        self._d: list[_T3] = [a]


class Animal:
    pass


class Cow(Animal):
    pass


_TA = TypeVar("_TA", bound=Animal)


def fn(p2: _TA) -> _TA:
    # This should generate an error.
    p2 = Animal()

    if 1 + 1 == 3:
        return p2

    # This should generate an error.
    return Animal()
