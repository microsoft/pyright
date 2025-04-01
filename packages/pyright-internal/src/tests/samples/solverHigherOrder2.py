# This sample tests the case where a generic function is passed as
# a parameter to another generic function.

from typing import Any, Callable, Generic, Iterable, TypeVar

T = TypeVar("T")
U = TypeVar("U")


def identity(x: U) -> U:
    return x


def not_identity(x: Any) -> int:
    return 3


class Test(Generic[T]):
    def fun(self, x: Iterable[T], f: Callable[[T], T]): ...

    def caller(self, x: Iterable[T]):
        self.fun(x, identity)

        # This should generate an error.
        self.fun(x, not_identity)
