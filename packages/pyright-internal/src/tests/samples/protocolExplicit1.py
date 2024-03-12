# This sample tests the logic that validates that a concrete class that
# explicitly derives from a protocol class implements the variables
# and functions defined in the protocol.

from abc import ABC, abstractmethod
from typing import ClassVar, Protocol, final


class Protocol1(Protocol):
    cm1: ClassVar[int]
    cm2: ClassVar[int] = 0

    im1: int
    im2: int = 2
    im3: int

    def __init__(self):
        self.im3 = 3


class Protocol2(Protocol):
    cm10: int


class Protocol3(Protocol2, Protocol):
    cm11: int


class Concrete1(Protocol1): ...


# This should generate an error because some attributes are not implemented.
Concrete1()


class Concrete2(Protocol1):
    cm1 = 3
    im1 = 0


Concrete2()


class Concrete3(Protocol1, Protocol3):
    cm1 = 3

    def __init__(self):
        im1 = 0


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


class Protocol5(Protocol):
    def method1(self) -> int: ...


# This should generate an error because "method1" is
# not implemented and it is marked final.
@final
class Concrete5(Protocol5):
    pass


class Protocol6(Protocol):
    x: int


class Mixin:
    x = 3


@final
class Concrete6(Mixin, Protocol6):
    pass


class Protocol7(Protocol):
    @abstractmethod
    def method1(self): ...


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


class Protocol8(Protocol):
    x: int


class Concrete8(Protocol8):
    # This should generate an error because x is a ClassVar.
    x: ClassVar = 1
