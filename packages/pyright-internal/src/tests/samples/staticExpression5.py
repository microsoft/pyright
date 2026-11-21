# This sample is used in conjunction with staticExpression6.py to test a static
# condition that is read from another module as a bare Final.

import sys
from typing import Final

IS_WINDOWS: Final = sys.platform == "win32"
VERSION_AT_LEAST_3_9: Final = sys.version_info >= (3, 9)

# A Final whose initializer cannot be evaluated statically provides no condition.
DYNAMIC: Final = bool(sys.argv)

# A Final with a declared type keeps its declared type.
ANNOTATED: Final[bool] = sys.platform == "win32"

# A variable that is not Final can be reassigned, so it is not a static condition.
PLAIN: bool = bool(sys.argv)
