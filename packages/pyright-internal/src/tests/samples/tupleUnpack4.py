# This sample tests the handling of a TypeVar whose upper bound is
# a tuple when used for an *args parameter.

from typing import TypeVar, Unpack


T = TypeVar("T", bound="tuple[int, ...]")


def func1(*args: Unpack[T]) -> tuple[int, ...]:
    a, *v = args

    reveal_type(a, expected_text="*T@func1")

    b: int = a

    # This should generate an error.
    c: str = a

    reveal_type(v, expected_text="list[*T@func1]")

    return args


S = TypeVar("S", bound=list[int])


# This should generate an error.
def func2(*args: Unpack[S]) -> int:
    return 0
