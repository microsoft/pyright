# This sample tests various aspects of tensor shape type checking.

# pyright: reportMissingModuleSource=false

from typing import Any, Literal, Unpack
from typing_extensions import LiteralInt, LiteralIntTuple
from tensorlib import Size, Tensor, cat, conv2d, randn, sum


def func1[X: LiteralInt, Y: LiteralInt](x: Size[tuple[X, Y]]) -> Size[tuple[X, Y]]:
    return x


def func2[X: LiteralInt](
    s1: Size[tuple[Literal[1], Literal[2]]], s2: Size[tuple[Literal[1], Literal[2], X]]
):
    # This should generate an error.
    func1(s2)

    v1 = func1(s1)
    reveal_type(v1, expected_text="Size[tuple[Literal[1], Literal[2]]]")

    x1, y1 = s1
    reveal_type(x1, expected_text="Literal[1]")
    reveal_type(y1, expected_text="Literal[2]")

    # This should generate an error.
    x2, y2, z2 = s1

    x3, *other3 = s2
    reveal_type(x3, expected_text="Literal[1]")
    reveal_type(other3, expected_text="list[X | Literal[2]]")


def index1[A: LiteralInt, B: LiteralInt, C: LiteralInt](
    t1: Tensor[Any, tuple[A, B, C]],
):
    s1 = t1.shape
    reveal_type(s1, expected_text="Size[tuple[A, B, C]]")

    s2 = s1[2]
    reveal_type(s2, expected_text="C")

    s3 = s1[-3]
    reveal_type(s3, expected_text="A")

    # This should generate an error.
    s4 = s1[-4]

    # This should generate an error.
    s5 = s1[4]


def index2[A: LiteralInt, B: LiteralInt, Other: LiteralIntTuple](
    t1: Tensor[Any, tuple[A, B, Unpack[Other]]],
):
    s1 = t1.shape
    reveal_type(s1, expected_text="Size[tuple[A, B, *Other]]")

    s2 = s1[2]
    reveal_type(s2, expected_text="TupleIndex[tuple[A, B, *Other], Literal[2]]")

    s3 = s1[-3]
    reveal_type(s3, expected_text="TupleIndex[tuple[A, B, *Other], Literal[-3]]")

    s4 = s1[-4]
    reveal_type(s4, expected_text="TupleIndex[tuple[A, B, *Other], Literal[-4]]")

    s5 = s1[4]
    reveal_type(s5, expected_text="TupleIndex[tuple[A, B, *Other], Literal[4]]")

    s6 = s1[0]
    reveal_type(s6, expected_text="A")

    s7 = s1[1]
    reveal_type(s7, expected_text="B")


def concat1[A: LiteralInt, B: LiteralInt, C: LiteralInt](
    t1: Tensor[Any, tuple[A, B, C]], t2: Tensor[Any, tuple[A, Literal[1], C]]
):
    s1 = cat((t1, t2), dim=1)
    reveal_type(s1, expected_text="Tensor[Any, tuple[A, IntAdd[B, Literal[1]], C]]")

    s2 = cat((t1, t2, t2), dim=1)
    reveal_type(s2, expected_text="Tensor[Any, tuple[A, IntAdd[B, Literal[2]], C]]")

    # This should generate an error.
    s3 = cat((t1, t2, t2))

    # This should generate an error.
    s4 = cat((t1, t2, t2), dim=2)

    # This should generate an error.
    s5 = cat((t1, t2, t2), dim=-1)

    # This should generate an error.
    s6 = cat((t1, t2, t2), dim=5)


def conv1[
    N: LiteralInt,
    Cin: LiteralInt,
    Cout: LiteralInt,
    X: LiteralInt,
    Y: LiteralInt,
    Kx: LiteralInt,
    Ky: LiteralInt,
](
    input: Tensor[Any, tuple[N, Cin, Y, X]],
    weight: Tensor[Any, tuple[Cout, Cin, Ky, Kx]],
):
    c1 = conv2d(input, weight)
    reveal_type(
        c1,
        expected_text="Tensor[Any, tuple[N, Cout, IntAdd[IntSub[Y, Ky], Literal[1]], IntAdd[IntSub[X, Kx], Literal[1]]]]",
    )


def conv2[
    B: LiteralInt,
    C: LiteralInt,
    H: LiteralInt,
    W: LiteralInt,
    F1: LiteralInt,
    F2: LiteralInt,
](x: Tensor[Any, tuple[B, C, H, W]], filters: Tensor[Any, tuple[C, C, F1, F2]]):
    return conv2d(x, filters, stride=2)


def conv3():
    filters = randn(4, 4, 5, 5)
    reveal_type(
        filters,
        expected_text="Tensor[Any, tuple[Literal[4], Literal[4], Literal[5], Literal[5]]]",
    )

    c0 = conv2(randn(1, 4, 5, 5), filters)
    reveal_type(
        c0,
        expected_text="Tensor[Any, tuple[Literal[1], Literal[4], Literal[1], Literal[1]]]",
    )

    c1 = conv2(randn(1, 4, 32, 32), filters)
    reveal_type(
        c1,
        expected_text="Tensor[Any, tuple[Literal[1], Literal[4], Literal[14], Literal[14]]]",
    )

    c2 = conv2(randn(1, 4, 53, 32), filters)
    reveal_type(
        c2,
        expected_text="Tensor[Any, tuple[Literal[1], Literal[4], Literal[25], Literal[14]]]",
    )

    c3 = conv2(randn(1, 4, 28, 28), filters)
    reveal_type(
        c3,
        expected_text="Tensor[Any, tuple[Literal[1], Literal[4], Literal[12], Literal[12]]]",
    )


def sum1[A: LiteralInt, B: LiteralInt](t1: Tensor[Any, tuple[A, B]]):
    s1 = sum(t1)
    reveal_type(s1, expected_text="Tensor[Any, tuple[Literal[1]]]")

    s2 = sum(t1, dim=0)
    reveal_type(s2, expected_text="Tensor[Any, tuple[B]]")

    s3 = sum(t1, dim=0, keepdim=True)
    reveal_type(s3, expected_text="Tensor[Any, tuple[Literal[1], B]]")

    s4 = sum(t1, dim=1)
    reveal_type(s4, expected_text="Tensor[Any, tuple[A]]")

    s5 = sum(t1, dim=1, keepdim=True)
    reveal_type(s5, expected_text="Tensor[Any, tuple[A, Literal[1]]]")

    s6 = sum(t1, dim=-1)
    reveal_type(s6, expected_text="Tensor[Any, tuple[A]]")

    s7 = sum(t1, dim=-2)
    reveal_type(s7, expected_text="Tensor[Any, tuple[B]]")

    # This should generate an error.
    s8 = sum(t1, dim=2)

    # This should generate an error.
    s9 = sum(t1, dim=-3)
