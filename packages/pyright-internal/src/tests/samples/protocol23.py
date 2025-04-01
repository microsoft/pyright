# This sample tests the provision in PEP 544 that a protocol class
# can't be assigned to Type[Proto].

from abc import abstractmethod
from typing import Protocol


class Proto(Protocol):
    @abstractmethod
    def meth(self) -> int: ...


class Concrete:
    def meth(self) -> int:
        return 42


def func1(cls: type[Proto]) -> int:
    return cls().meth()


func1(Concrete)

# This should generate an error because Proto is a protocol class,
# not a concrete class type that implements the protocol.
func1(Proto)

val1: type[Proto]
val1 = Concrete
val1().meth()

# This should generate an error because Proto is a protocol class.
val1 = Proto


def func2() -> type[Proto]: ...


val1 = func2()
