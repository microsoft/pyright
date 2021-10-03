# This sample tests the handling of TypeVars defined by
# a generic function.

from typing import Callable, Dict, Generic, Iterable, List, Tuple, TypeVar

T = TypeVar("T")
R = TypeVar("R")


def do_something(
    collection: Iterable[T], zero: R, f: Callable[[R, T], R]
) -> Iterable[R]:
    s = zero
    yield s
    for x in collection:
        s = f(s, x)
        yield s


class Foo:
    pass


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", bound=Foo)
_T2A = TypeVar("_T2A", bound=Foo)
_T3 = TypeVar("_T3", Foo, int, str)


class MyClass1(Generic[_T1]):
    def __init__(self, a: _T1):
        self._a: Dict[str, _T1] = {}
        self._b: Tuple[_T1, ...] = (a, a, a)
        self._c: Tuple[_T1, _T1] = (a, a)
        self._d: List[_T1] = [a]


class MyClass2(Generic[_T2]):
    def __init__(self, a: _T2):
        self._a: Dict[str, _T2] = {}
        self._b: Tuple[_T2, ...] = (a, a, a)
        self._c: Tuple[_T2, _T2] = (a, a)
        self._d: List[_T2] = [a]


class MyClass2A(Generic[_T2, _T2A]):
    def __init__(self, a: _T2, b: _T2A):
        self._a1: Dict[str, _T2A] = {"a": b}
        self._a2: Dict[str, _T2] = {"a": a}
        self._b: Tuple[_T2, ...] = (a, a, a)
        self._c: Tuple[_T2, _T2] = (a, a)
        self._d: List[_T2] = [a]


class MyClass3(Generic[_T3]):
    def __init__(self, a: _T3):
        self._a: Dict[str, _T3] = {}
        self._b: Tuple[_T3, ...] = (a, a, a)
        self._c: Tuple[_T3, _T3] = (a, a)
        self._d: List[_T3] = [a]


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
