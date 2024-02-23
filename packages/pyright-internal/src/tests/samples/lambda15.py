# This sample tests the case where a lambda is passed to a constructor
# where both __new__ and __init__ methods are present and have different
# types.

# pyright: strict

from typing import Any, TypeVar, Callable

T = TypeVar("T")


def identity(val: T) -> T:
    return val


class ClassA:
    def __new__(cls, *args: Any, **kwargs: Any) -> "ClassA":
        return super().__new__(*args, **kwargs)

    def __init__(self, x: Callable[[float], float]) -> None:
        self.x = x


ClassA(lambda r: identity(r) + 1)
