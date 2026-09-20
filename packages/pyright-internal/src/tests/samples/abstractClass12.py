# This sample tests that a class whose `__new__` method is declared to return
# instances of other concrete classes can be instantiated even when the class
# itself has abstract members. `pathlib.Path` uses this pattern.

from abc import ABC, abstractmethod


class Base(ABC):
    def __new__(cls) -> "Concrete1 | Concrete2":
        return Concrete1()

    @abstractmethod
    def method(self) -> int: ...


class Concrete1(Base):
    def method(self) -> int:
        return 1


class Concrete2(Base):
    def method(self) -> int:
        return 2


reveal_type(Base(), expected_text="Concrete1 | Concrete2")


class StillAbstract(Base): ...


class ReturnsAbstract(ABC):
    def __new__(cls) -> StillAbstract: ...

    @abstractmethod
    def other(self) -> int: ...


# This should generate an error because StillAbstract is itself abstract.
ReturnsAbstract()


class ReturnsSelf(ABC):
    def __new__(cls) -> "ReturnsSelf": ...

    @abstractmethod
    def method(self) -> int: ...


# This should generate an error because the class instantiates itself.
ReturnsSelf()
