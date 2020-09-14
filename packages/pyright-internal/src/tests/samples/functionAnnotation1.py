# This sample tests support for comment-style function annotations.

# pyright: strict

from typing import Optional


def func1a(a, b):
    # type: (int, str) -> str
    return ""


def func1b(a, b):  # type: (Optional[str], int) -> str
    return ""


def func1c(
    a,  # type: int
    b,  # type: str
):
    # type: (...) -> str
    return ""


def func1c(
    a,  # type: int
    b,  # type: Foo
):
    # type: (...) -> str
    return ""


def func1c(
    a,  # type: int
    b,  # type: str
):
    # type: (...) -> str
    return ""


# This should generate an error because a is unannotated.
def func1d(a):
    # type: (...) -> str
    return ""


class Foo:
    pass

