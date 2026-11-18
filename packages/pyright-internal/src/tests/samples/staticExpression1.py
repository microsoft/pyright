# This sample tests static expression forms that are supported
# in the binder.

import sys
import os
import typing

x: int

if sys.platform == "linux":
    x = 1
else:
    x = "error!"

if "linux" == sys.platform:
    x = 1
else:
    x = "error!"

if sys.version_info >= (3, 9):
    x = 1
else:
    x = "error!"

if (3, 9) <= sys.version_info:
    x = 1
else:
    x = "error!"

if os.name == "posix":
    x = 1
else:
    x = "error!"

if "posix" == os.name:
    x = 1
else:
    x = "error!"

if sys.platform != b"linux":
    x = 1
else:
    x = "error!"

if os.name != b"posix":
    x = 1
else:
    x = "error!"

if sys.platform == f"linux":
    # This should generate an error.
    x = "error!"

if os.name == f"posix":
    # This should generate an error.
    x = "error!"

if True:
    x = 1
else:
    x = "error!"

if not False:
    x = 1
else:
    x = "error!"

DEFINED_TRUE = True
DEFINED_FALSE = False

if DEFINED_TRUE:
    x = 1
else:
    x = "error!"

if not DEFINED_FALSE:
    x = 1
else:
    x = "error!"

DEFINED_STR = "hi!"

if DEFINED_STR == "hi!":
    x = 1
else:
    x = "error!"

if "hi!" == DEFINED_STR:
    x = 1
else:
    x = "error!"


class Dummy:
    DEFINED_FALSE: bool
    DEFINED_TRUE: bool
    DEFINED_STR: str


dummy = Dummy()

if dummy.DEFINED_TRUE:
    x = 1
else:
    x = "error!"

if not dummy.DEFINED_FALSE:
    x = 1
else:
    x = "error!"

if dummy.DEFINED_STR == "hi!":
    x = 1
else:
    x = "error!"

if "hi!" == dummy.DEFINED_STR:
    x = 1
else:
    x = "error!"


class FakeSys:
    version_info = (2, 7)
    platform = "darwin"


class FakeOs:
    name = "java"


class FakeTyping:
    TYPE_CHECKING = False


def func1(sys: FakeSys) -> None:
    if sys.version_info < (3, 0):
        # This should generate an error.
        y: int = "error!"


def func2(sys: FakeSys) -> None:
    if sys.version_info[0] < 3:
        # This should generate an error.
        y: int = "error!"


def func3(sys: FakeSys) -> None:
    if sys.platform == "darwin":
        # This should generate an error.
        y: int = "error!"


def func4(os: FakeOs) -> None:
    if os.name == "java":
        # This should generate an error.
        y: int = "error!"


def func5(sys: FakeSys) -> None:
    y = sys.platform == "darwin"
    reveal_type(y, expected_text="bool")


def func6(typing: FakeTyping) -> None:
    if not typing.TYPE_CHECKING:
        # This should generate an error.
        y: int = "error!"
