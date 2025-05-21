# This sample tests the type analyzer's type narrowing logic for
# conditions of the form "X is ...", "X is not ...",
# "X == .." and "X != ...".

import types
from typing import Any, TypeVar

_T = TypeVar("_T", str, types.EllipsisType)


def func1(val: int | ellipsis):
    if val is not ...:
        reveal_type(val, expected_text="int")
    else:
        reveal_type(val, expected_text="EllipsisType")


def func2(val: _T):
    if val is ...:
        reveal_type(val, expected_text="EllipsisType*")
    else:
        reveal_type(val, expected_text="str*")


def func3(val: int | types.EllipsisType):
    if val != ...:
        reveal_type(val, expected_text="int")
    else:
        reveal_type(val, expected_text="EllipsisType")


def func4(val: int | ellipsis):
    if not val == ...:
        reveal_type(val, expected_text="int")
    else:
        reveal_type(val, expected_text="EllipsisType")


def func5(val: object):
    if val is ...:
        reveal_type(val, expected_text="EllipsisType")
    else:
        reveal_type(val, expected_text="object")


def func6(val: Any | types.EllipsisType):
    if val is not ...:
        reveal_type(val, expected_text="Any")
    else:
        reveal_type(val, expected_text="EllipsisType")
