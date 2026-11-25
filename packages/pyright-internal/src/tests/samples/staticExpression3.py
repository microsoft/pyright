# This sample is used in conjunction with staticExpression4.py to test
# reachability of conditions that reference a Final variable.

import sys
from typing import Final, Literal

IS_WINDOWS: Final = sys.platform == "win32"
IS_WINDOWS_LITERAL: Final[Literal[False]] = False
DYNAMIC: Final = bool(sys.argv)
PLAIN = sys.platform == "win32"
