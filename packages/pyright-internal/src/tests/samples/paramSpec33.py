# This sample verifies that an error is returned if an inner function
# doesn't use P.args and P.kwargs in its parameter list but is returned
# by an outer function that uses P in its return type.

from typing import Callable, Concatenate

from typing_extensions import ParamSpec

P = ParamSpec("P")


def func1(func: Callable[P, int]) -> Callable[P, int]:
    def inner_func(x: int) -> int:
        # This should generate a type error.
        return func(x)

    # This should generate a type error.
    return inner_func


def func2(
    func: Callable[Concatenate[int, P], int]
) -> Callable[Concatenate[int, P], int]:
    def inner_func(x: int) -> int:
        # This should generate a type error, but it currently
        # does not!
        return func(x)

    # This should generate a type error.
    return inner_func
