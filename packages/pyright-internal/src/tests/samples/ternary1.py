# This sample tests the type of a ternary expression whose condition
# is always truthy or always falsy.

from enum import Enum
from typing import Callable, Literal, assert_type


def func1(f: Callable[[], None], a: int, b: str) -> None:
    assert_type(a if f else b, int)


def func2(n: None, a: int, b: str) -> None:
    assert_type(a if n else b, str)


def func3(flag: bool, a: int, b: str) -> None:
    assert_type(a if flag else b, int | str)


class Meta(type):
    def __bool__(cls) -> Literal[False]:
        return False


class FalsyClass(metaclass=Meta):
    pass


class Color(Enum):
    RED = 1


class TruthyWithLen:
    def __bool__(self) -> Literal[True]:
        return True

    def __len__(self) -> int:
        return 0


def func4(a: int, b: str) -> None:
    assert_type(a if FalsyClass else b, str)


def func5(a: int, b: str) -> None:
    assert_type(a if Color else b, int)


def func6(a: int, b: str) -> None:
    assert_type(a if TruthyWithLen else b, int)


def func7(t: TruthyWithLen, a: int, b: str) -> None:
    assert_type(a if t else b, int)
