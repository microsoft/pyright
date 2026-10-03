# This sample tests that a class whose `__new__` method is declared to return
# instances of other concrete classes can be instantiated even when the class
# itself has abstract members. `pathlib.Path` uses this pattern.

from abc import ABC, abstractmethod
from typing import Any, Never, Protocol, Self, overload


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


class ReturnsTypingSelf(ABC):
    def __new__(cls) -> Self: ...

    @abstractmethod
    def method(self) -> int: ...


# This should generate an error because `Self` is the class itself.
ReturnsTypingSelf()


class ConcreteParent:
    def __new__(cls) -> "ConcreteParent":
        return object.__new__(cls)


class AbstractChild(ConcreteParent, ABC):
    @abstractmethod
    def method(self) -> None: ...


# A base-class return annotation also permits an instance of this abstract child.
AbstractChild()


class AbstractGrandchild(AbstractChild):
    pass


# Indirect inheritance must not bypass the abstract check either.
AbstractGrandchild()


class ReturnsObject(ABC):
    def __new__(cls) -> object:
        return object.__new__(cls)

    @abstractmethod
    def method(self) -> None: ...


# The broad object annotation does not establish a different concrete class.
ReturnsObject()


class Readable(Protocol):
    def read(self) -> str:
        return ""


class AbstractReader(ABC):
    def __new__(cls) -> Readable:
        return object.__new__(cls)

    @abstractmethod
    def read(self) -> str: ...


# Structural compatibility does not prove the factory returns another class.
AbstractReader()


class ReturnsNever(ABC):
    def __new__(cls) -> Never: ...

    @abstractmethod
    def method(self) -> int: ...


# This should generate an error because a `Never` return says nothing about
# which class is instantiated.
ReturnsNever()


class ReturnsNonClass(ABC):
    def __new__(cls) -> Any: ...

    @abstractmethod
    def method(self) -> int: ...


# This does not generate an error. An `Any` return type is not a class
# instance, so this check declines to suppress the diagnostic, but the
# abstract check separately tolerates it. That behavior predates this
# change and is unaffected by it.
ReturnsNonClass()


class OverloadedNew(ABC):
    @overload
    def __new__(cls, x: int) -> Concrete1: ...
    @overload
    def __new__(cls, x: str) -> Concrete2: ...
    def __new__(cls, x: Any) -> "Concrete1 | Concrete2": ...

    @abstractmethod
    def method(self) -> int: ...


# This does not generate an error either. An overloaded `__new__` is left
# to the normal abstract check, which already tolerates it. That behavior
# also predates this change.
OverloadedNew(1)
