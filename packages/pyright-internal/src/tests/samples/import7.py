# This sample tests that wildcard imports are not allowed
# outside of the module scope.

from .import5 import *


class A:
    # This should generate an error.
    from .import5 import *


def func1():
    # This should generate an error.
    from .import5 import *
