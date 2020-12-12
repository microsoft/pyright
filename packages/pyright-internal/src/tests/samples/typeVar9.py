# This sample tests the reporting of incorrect TypeVar usage within
# a generic function. A TypeVar must appear at least twice to be
# considered legitimate.

# pyright: reportInvalidTypeVarUse=true

from typing import Dict, Generic, List, TypeVar


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
def f1(self, v1: _T) -> None:
    ...


def f2(self, v1: _T, v2: List[_T]) -> None:
    ...


def f3(self, v1: _T) -> _T:
    ...


def f4(self) -> Dict[_T, _T]:
    ...


# This should generate an error because _T
# is a local typeVar and appears only once.
def f5(self) -> List[_T]:
    ...
