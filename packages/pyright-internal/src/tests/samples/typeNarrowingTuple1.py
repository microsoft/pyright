# This sample tests the type narrowing for known-length tuples
# that have an entry with a declared literal type.

from enum import Enum
from typing import Literal

MsgA = tuple[Literal[1], str]
MsgB = tuple[Literal[2], float]

MsgAOrB = MsgA | MsgB


def func1(m: MsgAOrB):
    if m[0] == 1:
        reveal_type(m, expected_text="tuple[Literal[1], str]")
    else:
        reveal_type(m, expected_text="tuple[Literal[2], float]")


def func2(m: MsgAOrB):
    if m[0] != 1:
        reveal_type(m, expected_text="tuple[Literal[2], float]")
    else:
        reveal_type(m, expected_text="tuple[Literal[1], str]")


MsgC = tuple[Literal[True], str]
MsgD = tuple[Literal[False], float]

MsgCOrD = MsgC | MsgD


def func3(m: MsgCOrD):
    if m[0] is True:
        reveal_type(m, expected_text="tuple[Literal[True], str]")
    else:
        reveal_type(m, expected_text="tuple[Literal[False], float]")


def func4(m: MsgCOrD):
    if m[0] is not True:
        reveal_type(m, expected_text="tuple[Literal[False], float]")
    else:
        reveal_type(m, expected_text="tuple[Literal[True], str]")


class MyEnum(Enum):
    A = 0
    B = 1


MsgE = tuple[Literal[MyEnum.A], str]
MsgF = tuple[Literal[MyEnum.B], float]

MsgEOrF = MsgE | MsgF


def func5(m: MsgEOrF):
    if m[0] is MyEnum.A:
        reveal_type(m, expected_text="tuple[Literal[MyEnum.A], str]")
    else:
        reveal_type(m, expected_text="tuple[Literal[MyEnum.B], float]")


def func6(m: MsgEOrF):
    if m[0] is not MyEnum.A:
        reveal_type(m, expected_text="tuple[Literal[MyEnum.B], float]")
    else:
        reveal_type(m, expected_text="tuple[Literal[MyEnum.A], str]")
