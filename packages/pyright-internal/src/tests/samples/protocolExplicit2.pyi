# This sample is a stub file used in conjunction with the protocolExplicit3.py test.

# This sample tests the logic that validates that a concrete class that
# explicitly derives from a protocol class implements the variables
# and functions defined in the protocol.

from abc import abstractmethod
from typing import ClassVar, Protocol

class Protocol1(Protocol):
    cm1: ClassVar[int]
    im1: int

class Protocol2(Protocol):
    cm10: int

class Protocol3(Protocol2, Protocol):
    pass

class Protocol5(Protocol):
    def method1(self) -> int: ...

class Protocol6(Protocol):
    x: int

class Protocol7(Protocol):
    @abstractmethod
    def method1(self): ...
