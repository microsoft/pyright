# This sample involves solving type variables that provide a lambda
# its expected type.

# pyright: strict

from typing import Callable, TypeVar

T = TypeVar("T")
U = TypeVar("U")


def func1(lst: list[T], init: U, f: Callable[[U, T], U]) -> U: ...


y = func1([1], 1, lambda x, y: x * y)
