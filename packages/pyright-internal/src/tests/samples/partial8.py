# This sample tests the case where functools.partial is applied to
# a function that includes a positional-only parameter separator.

from functools import partial


def func1(s: int, /, a: int, b: str) -> int: ...


func1_partial = partial(func1, 1, 0, "")
reveal_type(func1_partial(), expected_text="int")

func1_partial_missing = partial(func1, 1)
reveal_type(func1_partial_missing(0, ""), expected_text="int")

# This should generate an error.
partial(func1, s=1)
