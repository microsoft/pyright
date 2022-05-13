# This sample tests that a generic callable passed to a function cannot
# be called with parameters that don't match the generic.

from typing import TypeVar, Callable, Any, Union

T = TypeVar("T")


def foo(
    mkfoo: Callable[[T], list[T]], param1: T, param2: Any, param3: Union[Any, T]
) -> None:
    mkfoo(param1)
    mkfoo(param2)
    mkfoo(param3)

    # This should generate an error.
    mkfoo(0)
