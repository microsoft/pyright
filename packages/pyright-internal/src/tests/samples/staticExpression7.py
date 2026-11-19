# This sample is used in conjunction with staticExpression8.py and
# staticExpression9.py to test static conditions that are read from another
# module through member access.

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
