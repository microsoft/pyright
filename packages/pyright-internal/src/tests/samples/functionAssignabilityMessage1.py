# This sample tests the wording and operand ordering of the function
# assignability diagnostic addendum for positional-parameter count mismatches.

from typing import Callable


def decorator(func: Callable[[int], int]) -> Callable[[int], int]:
    return func


# The decorated function accepts too few positional parameters (0 < 1), so the
# addendum must say "too few" with expected=1 (dest) and received=0 (source).
@decorator
def too_few() -> int:
    return 1


# The decorated function accepts too many positional parameters (2 > 1), so the
# addendum must say "too many" with expected=1 (dest) and received=2 (source).
@decorator
def too_many(a: int, b: int, /) -> int:
    return 1
