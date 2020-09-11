# This sample file tests various aspects of type analysis for tuples.

from typing import Tuple
import os


def func1() -> Tuple[int, int, int]:
    a = 1, 2, 3

    # This should generate an error because
    # of a tuple size mismatch.
    b, c = a

    b, c, d = a

    # This should generate an error because
    # of a tuple size mismatch.
    b, c, d, e, = a

    return a


def func2() -> Tuple[int, int, str]:
    a = 1, 2, 3

    # This should generate an error because the
    # item types don't match.
    return a


def func3() -> Tuple[str, ...]:
    a = "1", 2, 3

    # This should generate an error because the
    # heterogenous tuple can't be assigned to
    # the homogenous tuple type.
    return a


def func4() -> Tuple[str, ...]:
    a = (1,)

    # This should generate an error because the first
    # item in the tuple isn't a string.
    return a


def func6():
    a = 1, 2, "hello"
    a.index("1")


def func7(a: Tuple) -> Tuple[()]:
    return ()


def func7(a: tuple):
    a.index("1")


# Test the tuple specialization code. This
# should generate no error because split should
# be specialized to return a tuple of str values.
def func8() -> str:
    dirname, fname = os.path.split("dir/file")
    return dirname


def func9(param1: Tuple[int, ...]):
    pass


def func10() -> tuple[int, ...]:
    return (
        3,
        4,
        5,
    )


func9(func10())
func9((2, 3, 4))
func9((2,))

# Tests for tuple assignments with unpack expressions.
def func10() -> int:
    a = (3, 4, 5)

    c, *d = a
    if c:
        # This should generate an error because
        # d should be an iterable type, not compatible
        # with the declared return type.
        return d

    # This should generate an error because
    # there are not enough elements to populate
    # the variable h.
    e, f, g, h, *i = a

    return e


# Tests for tuple assignments with unpack expressions.
def func11() -> float:
    b = ("hello", 3, 6.7)

    c, *d = b
    if c:
        # This should generate an error because
        # d should be an iterable type, not compatible
        # with the declared return type.
        return d

    return 3

