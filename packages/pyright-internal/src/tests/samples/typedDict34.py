# This sample tests that narrowed forms of a generic TypedDict with the
# same type arguments are combined at control flow join points, as they
# are for a non-generic TypedDict.

from typing import TypedDict, assert_type


class TD1[T](TypedDict, total=False):
    a: T
    b: T
    c: T
    d: T


def func1(val: int | None) -> TD1[int]:
    td: TD1[int] = {}
    if val is not None:
        td["a"] = val
    if val is not None:
        td["b"] = val
    if val is not None:
        td["c"] = val
    if val is not None:
        td["d"] = val

    assert_type(td, TD1[int])
    return td


def func2(val: bool) -> None:
    td: TD1[int] = {}
    if val:
        td = {"a": 1, "b": 2}
    else:
        td = {"a": 1, "c": 3}

    assert_type(td, TD1[int])


def func3(val: bool) -> None:
    td: TD1[int] | TD1[str]
    if val:
        td = TD1[int](a=1)
    else:
        td = TD1[str](a="")

    assert_type(td, TD1[int] | TD1[str])


def func4[T](val: T, cond: bool) -> TD1[T]:
    td: TD1[T] = {}
    if cond:
        td["a"] = val
    if cond:
        td["b"] = val

    assert_type(td, TD1[T])
    return td


def func5(val: bool) -> None:
    td: TD1[int] = {}
    if val:
        td["a"] = 1

    # This should generate an error because "a" may not be present.
    td["a"]

    if val:
        td["b"] = 1
    else:
        td["b"] = 2

    td["b"]
