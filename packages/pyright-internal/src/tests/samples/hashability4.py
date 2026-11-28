# This sample tests hashability of classes whose __hash__ is
# assigned to an instance.

# pyright: reportIncompatibleMethodOverride=false

from typing import Callable


class ClassWithInstanceHash:
    def __init__(self) -> None:
        self.__hash__: Callable[[object], int] = lambda other: 0


def func1(a: ClassWithInstanceHash):
    s = {a}


class ClassWithoutHash:
    __hash__: None = None


class ClassWithInstanceHashOverNone(ClassWithoutHash):
    def __init__(self) -> None:
        self.__hash__ = None


def func2(a: ClassWithInstanceHashOverNone):
    # This should generate an error.
    s = {a}
