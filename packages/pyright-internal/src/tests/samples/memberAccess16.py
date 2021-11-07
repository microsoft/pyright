# This sample tests the case where a member is accessed from a "type"
# instance or a Type[T].

# pyright: strict

from typing import Type, TypeVar

T = TypeVar("T")


def func1(t: Type[T]) -> Type[T]:
    def __repr__(self: T) -> str:
        ...

    t.__repr__ = __repr__
    return t


def func2(t: type) -> type:
    def __repr__(self: object) -> str:
        ...

    t.__repr__ = __repr__
    return t
