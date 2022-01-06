# This sample tests the case where a method decorator uses an explicit
# type annotation for the "self" parameter.

from typing import Callable, Generic, TypeVar

_T = TypeVar("_T")


def my_generic_wrapper(
    f: Callable[["MyClass[_T]"], str]
) -> Callable[["MyClass[_T]"], int]:
    ...


class MyClass(Generic[_T]):
    @my_generic_wrapper
    def do_something(self) -> str:
        ...
