# This sample tests wildcard imports.

from .import3 import *

a = foo
b = _foo

# This should generate an error because bar isn't
# included in the __all__ assigment.
c = bar
d = _bar

