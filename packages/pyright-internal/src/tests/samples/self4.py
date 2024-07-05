# This sample tests the case where a method decorator uses an explicit
# type annotation for the "self" parameter.

from typing import Callable, Generic, TypeVar, Any

T = TypeVar("T")
S = TypeVar("S", bound="MyClass[Any]")


def my_generic_wrapper(f: Callable[[S], str]) -> Callable[[S], int]: ...


class MyClass(Generic[T]):
    @my_generic_wrapper
    def do_something(self) -> str: ...
