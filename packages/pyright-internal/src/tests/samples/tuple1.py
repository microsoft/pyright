# This sample file tests various aspects of type analysis for tuples.

import os
from typing import Any, Callable, Never

from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)

Ts = TypeVarTuple("Ts")


def func1() -> tuple[int, int, int]:
    a = 1, 2, 3

    # This should generate an error because
    # of a tuple size mismatch.
    b, c = a

    b, c, d = a

    # This should generate an error because
    # of a tuple size mismatch.
    (
        b,
        c,
        d,
        e,
    ) = a

    return a


def func2() -> tuple[int, int, str]:
    a = 1, 2, 3

    # This should generate an error because the
    # item types don't match.
    return a


def func3() -> tuple[str, ...]:
    a = "1", 2, 3

    # This should generate an error because the
    # heterogeneous tuple can't be assigned to
    # the homogeneous tuple type.
    return a


def func4() -> tuple[str, ...]:
    a = (1,)

    # This should generate an error because the first
    # item in the tuple isn't a string.
    return a


def func6():
    a = 1, 2, "hello"
    a.index("1")


def func7(a: tuple) -> tuple[()]:
    return ()


def func7_1(a: tuple):
    a.index("1")


# Test the tuple specialization code. This
# should generate no error because split should
# be specialized to return a tuple of str values.
def func8() -> str:
    dirname, fname = os.path.split("dir/file")
    return dirname


def func9(param1: tuple[int, ...]):
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
def func10_1() -> int:
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


# Tests for assignment of tuple list that includes star
# operator both with and without type annotations.
def func12():
    data = ["a", "b"]
    data1 = (*map(str.split, data),)
    data2: tuple[list[str], ...] = (*map(str.split, data),)
    data3 = (*map(str.split, data),)
    data4: tuple[list[str], ...] = (*map(str.split, data),)


# Tests for index-out-of-range error.
def func13(
    a: tuple[int, str],
    b: tuple[()],
    c: tuple[int, ...],
    d: tuple[int] | tuple[str, str] | tuple[int, ...],
    e: tuple[int, Unpack[tuple[str, ...]], float],
    f: tuple[int, Unpack[Ts], float],
    g: tuple[Unpack[Ts]],
):
    v1 = a[0]
    reveal_type(v1, expected_text="int")

    v2 = a[1]
    reveal_type(v2, expected_text="str")

    # This should generate an error.
    v3 = a[2]

    # This should generate an error.
    v4 = b[0]

    v5 = c[100]
    reveal_type(v5, expected_text="int")

    v6 = a[-2]
    reveal_type(v6, expected_text="int")

    v7 = a[-1]
    reveal_type(v7, expected_text="str")

    # This should generate an error.
    v8 = a[-3]
    reveal_type(v8, expected_text="int | str")

    v9 = c[-100]
    reveal_type(v9, expected_text="int")

    v10 = d[0]

    # This should generate an error.
    v11 = d[1]

    # This should generate two errors.
    v12 = d[2]

    v13: tuple[()] = ()
    # This should generate an error.
    v13[0]

    v14 = e[0]
    reveal_type(v14, expected_text="int")

    v15 = e[1]
    reveal_type(v15, expected_text="int | str | float")

    v16 = f[0]
    reveal_type(v16, expected_text="int")

    v17 = f[1]
    reveal_type(v17, expected_text="int | Union[*Ts@func13] | float")

    v18 = f[-1]
    reveal_type(v18, expected_text="float")


def func14():
    list1 = [1, 2, 3]
    v1 = tuple(list1)
    reveal_type(v1, expected_text="tuple[int, ...]")


def func15(var: tuple[()]) -> str:
    raise NotImplementedError


def func16(var: tuple[int, int]) -> str:
    raise NotImplementedError


def func17(var: tuple[int, ...]) -> str:
    raise NotImplementedError


f1: Callable[[tuple[int, ...]], str]

# This should generate an error.
f1 = func15

# This should generate an error.
f1 = func16

f1 = func17


def func18(a: tuple[int, *tuple[Any, ...], str], b: tuple[Any, ...]):
    a1: tuple[int, str] = a
    a2: tuple[int, int, str] = a
    a3: tuple[int, int, str, str] = a
    a4: tuple[int, *tuple[int, ...], str] = a

    # This should generate an error.
    a5: tuple[str, int, str, str] = a

    # This should generate an error.
    a6: tuple[int, int, str, int] = a

    b1: tuple[()] = b
    b2: tuple[int, int, str] = b
    b3: tuple[int, *tuple[int, ...], str] = b


def func19(a: tuple[int, ...], b: tuple[int, *tuple[int, ...]]):
    a1: tuple[*tuple[int, ...]] = a

    # This should generate an error.
    a2: tuple[int, *tuple[int, ...]] = a

    # This should generate an error.
    a3: tuple[int, *tuple[int, ...], int] = a

    # This should generate an error.
    a4: tuple[*tuple[int, ...], int] = a

    b1: tuple[int, ...] = b
    b2: tuple[int, *tuple[int, ...]] = b
    b3: tuple[*tuple[int, ...], int] = b

    # This should generate an error.
    b4: tuple[str, *tuple[int, ...]] = b

    # This should generate an error.
    b5: tuple[int, int, *tuple[int, ...]] = b


def func20(v: tuple[Never]):
    # This should generate an error.
    x1: tuple[Never] = (1,)

    # This should generate an error.
    x2: tuple[Never] = ()

    x3: tuple[Never] = v


def func21(x: tuple[Any, ...], *args: *Ts) -> tuple[*Ts]:
    args = x
    return args


def func22(x: tuple[*tuple[int, ...], float, str]):
    reveal_type(x[0], expected_text="int | float | str")
    reveal_type(x[-1], expected_text="str")
    reveal_type(x[-2], expected_text="float")
    reveal_type(x[-3], expected_text="int")
