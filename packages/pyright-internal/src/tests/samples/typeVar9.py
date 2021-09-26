# This sample tests the reporting of incorrect TypeVar usage within
# a generic function. A TypeVar must appear at least twice to be
# considered legitimate.

# pyright: reportInvalidTypeVarUse=true

from typing import Callable, Dict, Generic, List, TypeVar


_T = TypeVar("_T")
_S = TypeVar("_S")


class Foo(Generic[_T]):
    def m1(self, v1: _T) -> None:
        ...

    # This should generate an error because _S
    # is a local typeVar and appears only once.
    def m2(self, v1: _S) -> None:
        ...

    # This should generate an error because _S
    # is a local typeVar and appears only once.
    def m3(self, v1: _T) -> _S:
        ...


# This should generate an error because _T
# is a local typeVar and appears only once.
def f1(v1: _T) -> None:
    ...


def f2(v1: _T, v2: List[_T]) -> None:
    ...


def f3(v1: _T) -> _T:
    ...


def f4() -> Dict[_T, _T]:
    ...


# This should generate an error because _T
# is a local typeVar and appears only once.
def f5() -> List[_T]:
    ...


_T_Bound = TypeVar("_T_Bound", bound=int)
_T_Constrained = TypeVar("_T_Constrained", int, str)


# Constrained TypeVars are exempt.
def f6(v1: _T_Constrained):
    ...


# Bound TypeVars are not exempt.
def f7(v1: _T_Bound):
    ...


# Bound TypeVars as type arguments are exempt when used in an
# input parameter annotation.
def f8(v1: List[_T_Bound]):
    ...


# Bound TypeVars as type arguments are not exempt when used in a
# return annotation.
def f9() -> List[_T_Bound]:
    ...


# TypeVars used as type args to a generic type alias are exempt.
MyCallable = Callable[[_T], _T]


def f10() -> MyCallable[_T]:
    ...
