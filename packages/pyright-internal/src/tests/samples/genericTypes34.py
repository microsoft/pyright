# This sample tests the handling of generic type aliases
# with constrained types.

from typing import Callable, Generic, TypeVar

T = TypeVar("T", str, bool, None)


class MyData(Generic[T]):
    def __init__(self, val: T):
        self.val = val


Op = Callable[[MyData[T]], T]


def f_generic1(val: T, op: Op[T]) -> T:
    obj = MyData[T](val)
    return op(obj)


def f_generic2(val: T, op: Op[T]) -> T:
    obj = MyData(val)
    return op(obj)


def f_bool(val: bool) -> bool:
    op: Op[bool] = lambda od: od.val
    r = f_generic1(val, op)
    return r
