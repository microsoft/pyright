# This sample tests the handling of a specialized function
# used as an argument to a ParamSpec.

from typing import Callable, Generic, Literal, ParamSpec, TypeVar

T = TypeVar("T")
P = ParamSpec("P")


def foo(f: Callable[P, T]) -> Callable[P, T]:
    ...


class Baz(Generic[T]):
    def qux(self, v: T) -> None:
        ...


baz: Baz[int] = Baz()

t1: Literal["(v: int) -> None"] = reveal_type(baz.qux)
t2: Literal["(v: int) -> None"] = reveal_type(foo(baz.qux))
