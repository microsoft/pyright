# This sample tests the type checker's handling of constructors
# that specify a specialized class type.

from typing import Generic, TypeVar, Callable

T = TypeVar("T", bound=float)


class Root(Generic[T]):
    def __init__(self, _lambda: Callable[[T], T]):
        self._lambda = _lambda

    def call(self, val: T) -> T:
        return self._lambda(val)


class Leaf(Root[T]):
    pass


root_int: Root[int] = Root[int](lambda x: x << 2)

# This should generate an error.
root_float: Root[float] = root_int

# This should generate an error.
root_float: Root[float] = Root[int](lambda x: x << 2)
