# This sample tests the type narrowing for known-length tuples
# that have an entry with a declared literal type.

from typing import Tuple, Union, Literal

MsgA = Tuple[Literal[1], str]
MsgB = Tuple[Literal[2], float]

Msg = Union[MsgA, MsgB]


def func1(m: Msg):
    if m[0] == 1:
        reveal_type(m, expected_text="Tuple[Literal[1], str]")
    else:
        reveal_type(m, expected_text="Tuple[Literal[2], float]")


def func2(m: Msg):
    if m[0] != 1:
        reveal_type(m, expected_text="Tuple[Literal[2], float]")
    else:
        reveal_type(m, expected_text="Tuple[Literal[1], str]")
