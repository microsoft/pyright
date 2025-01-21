# This sample tests that final variables imported from another module
# cannot be overwritten.

from .final7 import *

# This should generate an error.
var1 = 1

# This should generate an error.
var2 = 1


def func1():
    from .final7 import var1, var2

    # This should generate an error.
    var1 = 1

    # This should generate an error.
    var2 = 1
