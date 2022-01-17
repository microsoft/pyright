# This sample tests indexing of tuples with slice expressions.

from typing import Tuple


def func1(val1: Tuple[int, str, None], val2: Tuple[int, ...]):
    x1 = val1[:2]
    reveal_type(x1, expected_text="tuple[int, str]")

    x2 = val1[-3:2]
    reveal_type(x2, expected_text="tuple[int, str]")

    x3 = val1[1:]
    reveal_type(x3, expected_text="tuple[str, None]")

    x4 = val1[1:-1]
    reveal_type(x4, expected_text="tuple[str]")

    x5 = val1[:-2]
    reveal_type(x5, expected_text="tuple[int]")

    x6 = val1[0:100]
    reveal_type(x6, expected_text="tuple[int | str | None, ...]")

    x7 = val2[:2]
    reveal_type(x7, expected_text="tuple[int, ...]")
