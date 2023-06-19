# This sample tests that a generic callable passed to a function cannot
# be called with parameters that don't match the generic.

from typing import TypeVar, Callable, Any

T = TypeVar("T")


def func1(cb: Callable[[T], list[T]], param1: T, param2: Any, param3: Any | T) -> None:
    cb(param1)
    cb(param2)
    cb(param3)

    # This should generate an error.
    cb(0)
