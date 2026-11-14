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
