# This sample is used in conjunction with staticExpression7.py and
# staticExpression8.py to test static conditions that reference a Final
# accessed through a module rather than imported by name.

from typing import Final

from . import staticExpression7, staticExpression8

x: int

if staticExpression7.IS_WINDOWS:
    # This should not generate an error because the branch is unreachable.
    x = "error!"
else:
    x = 1

if not staticExpression7.IS_WINDOWS:
    x = 1
else:
    # This should not generate an error because the branch is unreachable.
    x = "error!"

if staticExpression7.VERSION_AT_LEAST_3_9:
    x = 1
else:
    # This should not generate an error because the branch is unreachable.
    x = "error!"

# A Final that is re-exported by an intermediate module is also a static
# condition at the place of use.
if staticExpression8.IS_WINDOWS:
    # This should not generate an error because the branch is unreachable.
    x = "error!"
else:
    x = 1

# A Final that cannot be evaluated statically still requires both branches to
# be analyzed, as do a Final with a declared type and a non-Final variable.
if staticExpression7.DYNAMIC:
    # This should generate an error.
    x = "error!"
else:
    x = 1

if staticExpression7.ANNOTATED:
    # This should generate an error.
    x = "error!"
else:
    x = 1

if staticExpression7.PLAIN:
    # This should generate an error.
    x = "error!"
else:
    x = 1

# A member access on something other than a module is not gated, even when the
# accessed attribute is itself a Final.
class NotAModule:
    FLAG: Final[bool] = False


obj = NotAModule()

if obj.FLAG:
    # This should generate an error.
    x = "error!"
else:
    x = 1

# A name that no longer refers to the module is not gated either. The Final with
# the same name in the module does not make this a static condition.
class FakeModule:
    IS_WINDOWS: bool


staticExpression7 = FakeModule()

if staticExpression7.IS_WINDOWS:
    # This should generate an error.
    x = "error!"
else:
    x = 1
