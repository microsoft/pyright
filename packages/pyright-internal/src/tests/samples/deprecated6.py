# This sample tests the case where a __call__ is marked deprecated.

from typing import Callable, Generic, ParamSpec, TypeVar
from typing_extensions import deprecated  # pyright: ignore[reportMissingModuleSource]


class A:
    @deprecated("Use ClassB instead")
    def __call__(self) -> None: ...


a = A()

# This should generate an error if reportDeprecated is enabled.
a()

P = ParamSpec("P")
R = TypeVar("R")


class B(Generic[P, R]):
    def __init__(self, cb: Callable[P, R]) -> None:
        self.cb = cb

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        return self.cb(*args, **kwargs)


@B
@deprecated("Don't use this.")
def func1(x: int) -> None:
    pass


# This should generate an error if reportDeprecated is enabled.
func1(3)


def deco1(cb: Callable[P, R]) -> B[P, R]:
    return B(cb)


@deco1
@deprecated("Don't use this.")
def func2(x: int) -> None:
    pass


# This should generate an error if reportDeprecated is enabled.
func2(3)
