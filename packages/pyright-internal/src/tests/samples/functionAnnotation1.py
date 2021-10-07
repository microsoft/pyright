# This sample tests support for comment-style function annotations.

# pyright: strict, reportMissingParameterType=false

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


def func1d(
    a,  # type: int
    b,  # type: Foo
):
    # type: (...) -> str
    return ""


def func1e(
    a,  # type: int
    b,  # type: str
):
    # type: (...) -> str
    return ""


# This should generate an error because a is unannotated.
def func1f(a):
    # type: (...) -> str
    return ""


class Foo:
    pass


def func1g(*args, **kwargs):
    # type: (*int, **float) -> int
    return sum(args) + sum(round(kwarg) for kwarg in kwargs.values())
