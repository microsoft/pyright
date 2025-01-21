# This sample tests the case where a metaclass __call__ method is present
# and supplies a different bidirectional type inference context than
# the __new__ or __init__ methods.

from typing import TypedDict, TypeVar

T = TypeVar("T")


class TD1(TypedDict):
    x: int


class AMeta(type):
    def __call__(cls, *args, **kwargs):
        super().__call__(*args, **kwargs)


class A(metaclass=AMeta):
    def __init__(self, params: TD1):
        pass


A({"x": 42})


class BMeta(type):
    def __call__(cls: type[T], x: int, y: str) -> T: ...


class B(metaclass=BMeta): ...


def func1(cls: type[B]):
    # This should generate an error.
    cls()
