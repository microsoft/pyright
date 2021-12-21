# This sample tests the custom __call__ method on the EnumMeta class.

from enum import Enum


class Foo(Enum):
    A = 1
    B = 2


Foo(1)

# This should generate an error.
Foo(1, 2, 3, 4)
