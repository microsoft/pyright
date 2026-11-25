# This sample is used in conjunction with staticExpression3.py to test
# reachability of conditions that reference a Final variable.

# pyright: reportUnreachable=true

import sys
from typing import Any, Final, final

from . import staticExpression3
from .staticExpression3 import (
    DYNAMIC,
    IS_WINDOWS,
    IS_WINDOWS_LITERAL,
    PLAIN,
)
from .staticExpression3 import IS_WINDOWS as WIN

IS_WINDOWS_LOCAL: Final = sys.platform == "win32"


@final
class Flags:
    IS_WINDOWS: Final = sys.platform == "win32"


FLAGS: Final = Flags()


def func1() -> int:
    if IS_WINDOWS_LOCAL:
        return ""
    return 1


def func2() -> int:
    if IS_WINDOWS:
        return ""
    return 1


def func3() -> int:
    if not IS_WINDOWS:
        return 1
    return ""


def func4() -> int:
    if WIN:
        return ""
    return 1


def func5() -> int:
    if IS_WINDOWS_LITERAL:
        return ""
    return 1


def func6() -> int:
    if staticExpression3.IS_WINDOWS:
        return ""
    return 1


def func7() -> int:
    if DYNAMIC:
        # This should generate an error.
        return ""
    return 1


def func8() -> int:
    if PLAIN:
        # This should generate an error.
        return ""
    return 1


def func9(flags: Flags) -> int:
    if flags.IS_WINDOWS:
        # This should generate an error.
        return ""
    return 1


def func10(staticExpression3: Any) -> int:
    if staticExpression3.IS_WINDOWS:
        # This should generate an error.
        return ""
    return 1


def func11() -> int:
    if isinstance(FLAGS, int):
        # This should generate an error.
        return ""
    return 1


def func12(flags: Flags) -> int:
    from . import staticExpression3 as module

    if module.IS_WINDOWS:
        return ""
    module = flags
    return 1


def func13(flags: Flags) -> int:
    from . import staticExpression3 as module

    module = flags
    if module.IS_WINDOWS:
        # This should generate an error.
        return ""
    return 1
