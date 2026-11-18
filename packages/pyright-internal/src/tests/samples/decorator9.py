# This sample tests classmethod delegation to a callable descriptor's __get__,
# which is supported in Python 3.9 through 3.12.

from __future__ import annotations

import sys
from typing import Callable, Generic, TypeVar
from typing_extensions import assert_type

T = TypeVar("T")


class Bound(Generic[T]):
    value: str = "bound"

    def __init__(self, owner: type[T]) -> None:
        self.owner = owner

    def __call__(self, text: str) -> str:
        return text.upper()


class Wrapper:
    value: int = 1

    def __init__(self, func: Callable[..., int]) -> None:
        self.func = func

    def __call__(self, owner: type, value: int) -> int:
        return self.func(owner, value)

    def __get__(self, instance: type[T], owner: type[T] | None = None) -> Bound[T]:
        return Bound(instance)


class Example:
    @classmethod
    @Wrapper
    def method(cls, value: int) -> int:
        return value


class Child(Example):
    pass


if sys.version_info >= (3, 9) and sys.version_info < (3, 13):
    assert_type(Example.method("text"), str)
    assert_type(Example().method("text"), str)
    assert_type(Child.method("text"), str)
    assert_type(Child().method("text"), str)
    assert_type(Example.method.owner, type[Example])
    assert_type(Example().method.owner, type[Example])
    assert_type(Child.method.owner, type[Child])
    assert_type(Child().method.owner, type[Child])
    assert_type(Example.method.value, str)
    assert_type(Child().method.value, str)

    # This should generate an error because the bound descriptor accepts str.
    Example.method(1)
else:
    assert_type(Example.method(1), int)
    assert_type(Example().method(1), int)
    assert_type(Child.method(1), int)
    assert_type(Child().method(1), int)
    assert_type(Example.method.value, int)
    assert_type(Child().method.value, int)

    # This should generate an error because the wrapped callable accepts int.
    Example.method("text")
