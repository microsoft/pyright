# This sample tests wildcard imports.

from .import5 import *

a = foo

# This should generate an error because there is no
# __all__ assignment, and names starting with a double underscore
# should not be imported in a wildcard.
b = __foo

c = bar

# This should generate an error because there is no __all__ assignment
# and names starting with a single underscore should not be imported
# in a wildcard.
d = _bar
