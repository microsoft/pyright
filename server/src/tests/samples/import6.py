# This sample tests wildcard imports.

from .import5 import *

a = foo

# This should generate an error because there is no
# __all__ assignment, and names starting with an underscore
# should not be imported in a wildcard.
b = _foo
c = bar

# This should generate an error because there is no
# __all__ assignment, and names starting with an underscore
# should not be imported in a wildcard.
d = _bar

