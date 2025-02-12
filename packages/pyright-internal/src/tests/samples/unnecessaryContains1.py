# This sample tests the "reportUnnecessaryContains" diagnostic rule.

from enum import Enum
from typing import Literal, TypeVar

T1 = TypeVar("T1")
T2 = TypeVar("T2", bound=str)


def func1(x: str | int):
    if x in ("a",):
        return

    # This should generate an error if "reportUnnecessaryContains" is enabled.
    if x in (b"a",):
        return


def func2(x: Literal[1, 2, 3]):
    if x in ("4", 1):
        return

    # This should generate an error if "reportUnnecessaryContains" is enabled.
    if x not in ("4", "1"):
        pass

    # This should generate an error if "reportUnnecessaryContains" is enabled.
    if x in (4, 5):
        return


def func3(x: list[str]):
    if x in (["hi"], [2, 3]):
        return

    # This should generate an error if "reportUnnecessaryContains" is enabled.
    if x not in ((1, 2), (3,)):
        pass


def func4(x: list[T1]) -> T1:
    if 0 not in x:
        pass
    return x[0]


def func5(x: list[T2]) -> T2:
    # This should generate an error if "reportUnnecessaryContains" is enabled.
    if 0 not in x:
        pass
    return x[0]


class Enum1(Enum):
    a = "a"
    b = "b"
    c = "c"

    @property
    def is_ab(self):
        return self in (Enum1.a, Enum1.b)

    @property
    def is_c(self):
        return self not in (Enum1.a, Enum1.b)
