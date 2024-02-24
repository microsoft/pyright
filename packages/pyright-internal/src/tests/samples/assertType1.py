# This sample tests the assert_type call.

from typing import Any, Literal
from typing_extensions import assert_type  # pyright: ignore[reportMissingModuleSource]


def func1():
    # This should generate an error.
    assert_type()

    # This should generate an error.
    assert_type(1)

    # This should generate an error.
    assert_type(1, 2, 3)

    # This should generate an error.
    assert_type(*[])


def func2(x: int, y: int | str, z: list):
    assert_type(x, int)

    # This should generate an error.
    assert_type(x, str)

    # This should generate an error.
    assert_type(x, Any)

    x = 3
    assert_type(x, Literal[3])

    # This should generate an error.
    assert_type(x, int)

    assert_type(y, int | str)
    assert_type(y, str | int)

    # This should generate an error.
    assert_type(y, str)

    # This should generate an error.
    assert_type(y, None)

    # This should generate two errors.
    assert_type(y, 3)

    assert_type(z[0], Any)
