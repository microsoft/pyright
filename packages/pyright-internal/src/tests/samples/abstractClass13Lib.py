from abc import ABC, abstractmethod
from typing import Generic, TypeVar


T = TypeVar("T")


class Decorator(Generic[T]):
    def decorate(self, cls: type[T]) -> type[T]:
        return cls


class Base(ABC):
    @abstractmethod
    def method(self) -> None: ...


decorator: Decorator[Base] = Decorator()


@decorator.decorate
class ImportedAbstractClass(Base):
    pass
