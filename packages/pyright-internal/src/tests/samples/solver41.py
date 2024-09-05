# This sample tests the case where a TypeVar is used in a contravariant
# and covariant position and the contravariant position involves a
# union with other types.

from typing import Callable
from decimal import Decimal


def func1[T, U](func: Callable[[str | T], U], d: T) -> U: ...


func1(float, d="1.1")
func1(Decimal, d="1.1")
