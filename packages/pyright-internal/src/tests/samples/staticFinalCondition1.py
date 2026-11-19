# This sample tests module-level Final values initialized from static conditions.

import sys
from typing import Final

IS_WINDOWS: Final[bool] = sys.platform == "win32"

if IS_WINDOWS:
    value: int = "error"
else:
    value: str = 1


def function_scope() -> None:
    # Local Final values should not be treated as module-level static constants.
    local_value: Final[bool] = True
    if local_value:
        local_result: int = "error"


# A function parameter shadows a module-level Final and must not be folded.
FLAG: Final[bool] = True


def shadowed(FLAG: bool) -> None:
    if not FLAG:
        shadowed_result: int = "error"


# Final does not make a mutable container a static constant.
ITEMS: Final[list[int]] = []
ITEMS.append(1)
if ITEMS:
    mutable_result: int = "error"


# A conditional declaration may not be assumed to have executed.
def choose() -> bool:
    return False


if choose():
    conditional_input: Final[bool] = False

if conditional_input:
    conditional_result: int = "error"
