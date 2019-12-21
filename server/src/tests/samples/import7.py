# This sample tests that wildcard imports are not allowed
# outside of the module scope.

from .import5 import *

class Foo:
    # This should generate an error.
    from .import5 import *


def bar():
    # This should generate an error.
    from .import5 import *

