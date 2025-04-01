# This sample tests the logic that validates that a concrete class that
# explicitly derives from a protocol class implements the variables
# and functions defined in the protocol. Specifically, this tests
# the case where the parent protocol class is implemented in a stub file.

# pyright: reportMissingModuleSource=false

from abc import ABC
from typing import final
from .protocolExplicit2 import Protocol1, Protocol3, Protocol5, Protocol6, Protocol7


class Concrete1(Protocol1): ...


# This should generate an error because some attributes are not implemented.
Concrete1()


class Concrete2(Protocol1):
    cm1 = 3
    im1 = 0


Concrete2()


class Concrete3(Protocol1, Protocol3):
    cm1 = 3


# This should generate an error.
Concrete3()


class Concrete4(Protocol1, Protocol3):
    cm1 = 3
    cm10 = 3

    def __init__(self):
        self.im1 = 3
        self.im10 = 10
        self.cm11 = 3


Concrete4()


@final
class Concrete5(Protocol5):
    pass


class Mixin:
    x = 3


@final
class Concrete6(Mixin, Protocol6):
    pass


class Mixin7(Protocol7, ABC):
    def method1(self):
        pass


# This should generate an error because it
# does not implement method1 and is marked final.
@final
class Concrete7A(Protocol7):
    pass


@final
class Concrete7B(Mixin7, Protocol7):
    pass
