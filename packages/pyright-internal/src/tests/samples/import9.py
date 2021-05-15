# This sample tests support for PEP 562's __getattr__ function.

# This should not generate an error because import8 has
# a __getattr__ method.
from .import8 import foo

foo()
