# This sample tests wildcard imports.

from .import3 import *

a = foo
b = _foo

# This should generate an error because bar isn't
# included in the __all__ assignment.
c = bar
d = _bar

# This should generate an error because a trailing comma
# isn't allowed in a "from import" statement without parens.
from .import3 import foo,
