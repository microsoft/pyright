# This sample tests that classes created with NewType are treated
# as though they're functions at runtime.

from typing import NewType

MyStr = NewType("MyStr", str)

# This should generate an error.
v1: type = MyStr

# This should generate an error.
MyStr.capitalize

MyStr.__name__ # OK

