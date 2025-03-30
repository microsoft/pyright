# This sample tests the handling of protocol classes
# that represent callbacks when used with class constructors.

from typing import Protocol


class _BaseClass: ...


class _Protocol1(Protocol):
    def __call__(self, p1: str, p2) -> _BaseClass: ...


def func1(callback: _Protocol1):
    pass


class _Class1(_BaseClass):
    def __init__(self, my_str: str): ...


class _Class2(_BaseClass):
    def __init__(self, p1: str, p2: str): ...


# This should generate an error because the
# parameter types don't match.
func1(_Class1)

func1(_Class2)
