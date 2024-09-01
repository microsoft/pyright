# This sample tests the handling of assert_type with TypeForm types.

# pyright: reportMissingModuleSource=false

from types import UnionType
from typing import assert_type
from typing_extensions import TypeForm


def func1[T](x: T) -> T:
    v1 = str
    assert_type(v1, type[str])
    assert_type(v1, TypeForm[str])

    # This should generate an error.
    assert_type(v1, type[str] | type[int])

    # This should generate an error.
    assert_type(v1, TypeForm[str | int])

    v2 = str | T
    assert_type(v2, UnionType)
    assert_type(v2, TypeForm[str | T])

    v3 = list["str | T"] | T
    assert_type(v3, UnionType)
    assert_type(v3, TypeForm[list[str | T] | T])

    return x
