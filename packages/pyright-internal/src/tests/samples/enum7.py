# This sample tests the custom __call__ method on the EnumMeta class.

from enum import Enum


class Foo(Enum):
    A = 1
    B = 2


Foo(1)

# This would have previously generated an error prior to Python 3.12,
# but it now does not because of an additional overload on the EnumMeta
# __call__ method.
Foo(1, 2, 3, 4)
