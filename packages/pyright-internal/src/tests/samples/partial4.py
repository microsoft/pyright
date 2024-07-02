# This sample tests the case where an overloaded function is passed
# to functools.partial.

from functools import partial
from typing import overload


@overload
def func1(val1: float, val2: float) -> float: ...


@overload
def func1(val1: str, val2: str) -> str: ...


def func1(val1: float | str, val2: float | str) -> float | str:
    return max(val1, val2)


def func2():
    op_float = partial(func1, 1.0)
    v1 = op_float(2.0)
    reveal_type(v1, expected_text="float")

    # This should generate an error.
    op_float("a")

    op_str = partial(func1, "a")
    v2 = op_str("b")
    reveal_type(v2, expected_text="str")

    # This should generate an error.
    op_str(1.0)

    # This should generate an error.
    op_complex = partial(func1, 3j)
