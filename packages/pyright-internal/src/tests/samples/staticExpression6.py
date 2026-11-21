# This sample is used in conjunction with staticExpression5.py to test static
# conditions that reference a Final imported from another module.

from .staticExpression5 import ANNOTATED, DYNAMIC, IS_WINDOWS, PLAIN, VERSION_AT_LEAST_3_9

x: int

if IS_WINDOWS:
    # This should not generate an error because the branch is unreachable.
    x = "error!"
else:
    x = 1

if not IS_WINDOWS:
    x = 1
else:
    # This should not generate an error because the branch is unreachable.
    x = "error!"

if VERSION_AT_LEAST_3_9:
    x = 1
else:
    # This should not generate an error because the branch is unreachable.
    x = "error!"

# A Final that cannot be evaluated statically still requires both branches to
# be analyzed, as do a Final with a declared type and a non-Final variable.
if DYNAMIC:
    # This should generate an error.
    x = "error!"
else:
    x = 1

if ANNOTATED:
    # This should generate an error.
    x = "error!"
else:
    x = 1

if PLAIN:
    # This should generate an error.
    x = "error!"
else:
    x = 1
