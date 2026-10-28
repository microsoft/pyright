# This sample tests descriptor-preserving decorators and signature replacements.

from abc import ABC, abstractmethod
from typing import Any, Callable, Self, assert_type


def identity[T](value: T) -> T:
    return value


def replace(value: Any) -> Callable[[int], str]:
    return lambda value: str(value)


def accepts_classmethod(value: classmethod) -> None: ...
def accepts_staticmethod(value: staticmethod) -> None: ...


class Example(ABC):
    @identity
    @classmethod
    def cm(cls) -> Self:
        return cls()

    @staticmethod
    @identity
    def sm(value: int) -> str:
        return str(value)

    @identity
    @staticmethod
    def outer_sm(value: int) -> str:
        return str(value)

    @classmethod
    @abstractmethod
    def abstract(cls, value: int) -> str: ...

    @replace
    @staticmethod
    def replaced(value: str) -> int:
        return len(value)

    @staticmethod
    @replace
    def inner_replaced(value: str) -> int:
        return len(value)

    accepts_classmethod(cm)
    accepts_staticmethod(sm)
    accepts_staticmethod(outer_sm)
    accepts_classmethod(abstract)
    accepts_staticmethod(inner_replaced)
    assert_type(replaced(1), str)
    assert_type(inner_replaced.__func__(1), str)
    saved_cm = cm
    saved_abstract = abstract
    saved_inner = inner_replaced
    accepts_staticmethod(saved_inner)


class Child(Example):
    @classmethod
    def abstract(cls, value: int) -> str:
        return str(value)


assert_type(Child.saved_cm(), Child)
assert_type(Child.sm(1), str)
assert_type(Child.outer_sm(1), str)
assert_type(Child.replaced(1), str)
assert_type(Child.saved_inner(1), str)
