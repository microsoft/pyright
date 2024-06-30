# This sample tests the special-case handling of "type" when used
# as an assignment for Type[T].

from typing import Any, TypeVar

T = TypeVar("T")


def f(x: type[T]) -> T: ...


def g() -> type | Any: ...


y = g()

f(y)
