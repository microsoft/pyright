# This sample tests static conditions that are expressed through a module-level
# Final variable. Type checkers are required to treat uses of a bare Final that
# is initialized with a literal as if it were replaced by the literal, so a
# branch that contradicts the value is unreachable.

import sys
from typing import Final

x: int

FLAG: Final = False

if FLAG:
    # This should not generate an error because the branch is unreachable.
    x = "error!"
else:
    x = 1

if not FLAG:
    x = 1
else:
    # This should not generate an error because the branch is unreachable.
    x = "error!"

ANNOTATED_FLAG: Final[bool] = False

if ANNOTATED_FLAG:
    # This should not generate an error because the branch is unreachable.
    x = "error!"
else:
    x = 1

# A Final whose initializer is not statically evaluable does not provide a
# static condition, so both branches are analyzed.
DYNAMIC_FLAG: Final[bool] = bool(sys.argv)

if DYNAMIC_FLAG:
    # This should generate an error.
    x = "error!"
else:
    x = 1

BARE_DYNAMIC_FLAG: Final = bool(sys.argv)

if BARE_DYNAMIC_FLAG:
    # This should generate an error.
    x = "error!"
else:
    x = 1

# A mutable variable is never a static condition.
mutable_flag: bool = bool(sys.argv)

if mutable_flag:
    # This should generate an error.
    x = "error!"
else:
    x = 1
