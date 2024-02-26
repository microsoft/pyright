# This sample tests the proper type narrowing of a constrained TypeVar
# within a loop.

from typing import TypeVar

T = TypeVar("T", str, None)


def func1(input_string: T) -> T:
    if input_string is None:
        return input_string

    for bad_char in set(input_string):
        input_string = input_string.replace(bad_char, "")

    return input_string
