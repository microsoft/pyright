# This sample tests the type analyzer's type narrowing logic for
# conditions of the form "X is None", "X is not None",
# "X == None" and "X != None".

# pyright: strict, reportUnusedVariable=false

from typing import Any, Literal, Protocol, Self, TypeVar


def func1(x: int | None):
    if x is not None:
        x.bit_length()

    if x != None:
        x.bit_length()

    if x is None:
        pass
    else:
        x.bit_length()

    if x == None:
        pass
    else:
        x.bit_length()


_T1 = TypeVar("_T1", None, str)


def func2(val: _T1) -> _T1:
    if val is not None:
        reveal_type(val, expected_text="str*")
        return val
    else:
        reveal_type(val, expected_text="None*")
        return val


def func3(x: object):
    if x is None:
        reveal_type(x, expected_text="None")
    else:
        reveal_type(x, expected_text="object")


_T2 = TypeVar("_T2")


def func4(x: _T2) -> _T2:
    if x is None:
        reveal_type(x, expected_text="None*")
        raise ValueError()
    else:
        reveal_type(x, expected_text="_T2@func4")
        return x


def func5(x: Any | None):
    if x is None:
        reveal_type(x, expected_text="None")
    else:
        reveal_type(x, expected_text="Any")


def func6(x: Any | object | None):
    if x is None:
        reveal_type(x, expected_text="None")
    else:
        reveal_type(x, expected_text="Any | object")


class NoneProto(Protocol):
    def __bool__(self) -> Literal[False]: ...


def func7(x: NoneProto | None):
    if x is None:
        reveal_type(x, expected_text="None")
    else:
        reveal_type(x, expected_text="NoneProto")


_T3 = TypeVar("_T3", bound=None | int)


def func8(x: _T3) -> _T3:
    if x is None:
        reveal_type(x, expected_text="None*")
    else:
        reveal_type(x, expected_text="int*")
    return x


_T4 = TypeVar("_T4")


def func9(value: type[_T4] | None):
    if value is None:
        reveal_type(value, expected_text="None")
    else:
        reveal_type(value, expected_text="type[_T4@func9]")


class A:
    def __init__(self, parent: Self | None) -> None:
        self.parent = parent

    def get_depth(self) -> int:
        current: Self | None = self
        count = 0
        while current is not None:
            count += 1
            current = current.parent
        return count - 1
