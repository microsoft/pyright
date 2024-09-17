# This sample tests the handling of assert_type with TypeForm types.

# pyright: reportMissingModuleSource=false

from types import UnionType
from typing import assert_type
from typing_extensions import TypeForm


def func1[T](x: T) -> T:
    v1 = str
    assert_type(v1, type[str])

    # This should generate an error.
    assert_type(v1, TypeForm[str])

    # This should generate an error.
    assert_type(v1, type[str] | type[int])

    # This should generate an error.
    assert_type(v1, TypeForm[str | int])

    v1_tf: TypeForm[str | int] = str
    assert_type(v1_tf, TypeForm[str])

    # This should generate an error.
    assert_type(v1_tf, type[str])

    return x


def func2[T](x: T) -> T:
    v2 = str | T
    assert_type(v2, UnionType)

    # This should generate an error.
    assert_type(v2, TypeForm[str | T])

    v2_tf: TypeForm[object] = str | T

    # This should generate an error.
    assert_type(v2_tf, UnionType)

    assert_type(v2_tf, TypeForm[str | T])

    return x


def func3[T](x: T) -> T:
    v3 = list["str | T"] | T
    assert_type(v3, UnionType)

    # This should generate an error.
    assert_type(v3, TypeForm[list[str | T] | T])

    v3_tf: TypeForm[object] = list["str | T"] | T
    # This should generate an error.
    assert_type(v3_tf, UnionType)

    assert_type(v3_tf, TypeForm[list[str | T] | T])

    return x
