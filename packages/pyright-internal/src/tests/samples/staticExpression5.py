# This sample tests the literal types of statically-evaluated conditions.

import os
import sys
from typing import TYPE_CHECKING, Literal, assert_type

DEFINED_STR = "hi!"


def func1() -> None:
    assert_type(sys.platform == "win32", Literal[False])
    assert_type(sys.version_info >= (3, 8), Literal[True])
    assert_type(os.name == "nt", Literal[False])
    assert_type(TYPE_CHECKING, Literal[True])
    assert_type(not sys.platform == "win32", Literal[True])


def func2(flag: bool) -> None:
    assert_type(flag or sys.version_info >= (3, 8), Literal[True])


def func3() -> None:
    v = DEFINED_STR
    assert_type(v, Literal["hi!"])


def func4() -> None:
    # This should generate an error.
    v: Literal[True] = sys.platform == "win32"
