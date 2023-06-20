# This sample tests the # pyright: ignore comment.

import sys


def func1(self, x: int | None) -> str:
    # This should suppress the error
    x + "hi"  # pyright: ignore - test

    # This should not suppress the error because the rule doesn't match.
    return 3  # pyright: ignore [foo]


if sys.version_info < (3, 8):
    x = 3  # pyright: ignore
