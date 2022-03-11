# This sample tests the use of a # pyright: ignore comment in conjunction
# with the reportUnnecessaryTypeIgnoreComment mechanism.

from typing import Optional


def foo(self, x: Optional[int]) -> str:
    # This should suppress the error
    x + "hi"  # pyright: ignore - test

    # This is unnecessary
    x + x  # pyright: ignore

    # This will not suppress the error
    # These are both unnecessary
    x + x  # pyright: ignore [foo, bar]

    # This will not suppress the error
    x + x  # pyright: ignore []

    # One of these is unnecessary
    x + "hi"  # pyright: ignore [reportGeneralTypeIssues, foo]

    return 3  # pyright: ignore [reportGeneralTypeIssues]
