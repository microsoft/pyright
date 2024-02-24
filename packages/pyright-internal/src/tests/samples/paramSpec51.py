# This sample tests a case where a method-scoped ParamSpec is used within one
# of several overloads but not in others.

from typing import Callable, Concatenate, overload, Any
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    ParamSpec,
    Self,
)

P = ParamSpec("P")


class A:
    @overload
    def method1(
        self,
        cb: Callable[Concatenate[Self, P], None],
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> None: ...

    @overload
    def method1(
        self, cb: tuple[Callable[..., None], str], *args: Any, **kwargs: Any
    ) -> None: ...

    def method1(self, cb, *args, **kwargs) -> None:
        if isinstance(cb, tuple):
            cb[0](self, *args, **kwargs)
        else:
            cb(self, *args, **kwargs)


def func1(fo: A, x: int) -> None: ...


def func2(fo: A, x: int, /, y: str) -> None: ...


def func3(fo: A, x: int, /, y: str, *, z: tuple[int, int]) -> None: ...


a = A()

a.method1(func1, 1)
a.method1(func2, 3, "f1")
a.method1(func3, 6, "f2", z=(0, 1))

a.method1((func1, "f1"), 1)
a.method1((func2, "f2"), 2, "a")
a.method1((func3, "f3"), 3, "b", z=(0, 1))
