# This sample tests the reportTypeCommentUsage diagnostic check.

from typing import Optional


# This should generate an error if reportTypeCommentUsage is enabled.
def func1a(a, b):
    # type: (int, str) -> str
    return ""


# This should generate an error if reportTypeCommentUsage is enabled.
def func1b(a, b):  # type: (Optional[str], int) -> str
    return ""


# This should generate an error if reportTypeCommentUsage is enabled.
def func1c(
    a,  # type: int
    b,  # type: str
):
    # type: (...) -> str
    return ""
