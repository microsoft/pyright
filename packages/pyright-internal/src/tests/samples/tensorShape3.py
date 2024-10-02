# This sample tests various aspects of tensor shape type checking.

# pyright: reportMissingModuleSource=false

from typing import Annotated, Any, Literal
from typing_extensions import IntEq, IntGt, LiteralInt, Where
from tensorlib import Tensor, linspace, randn, index_select, permute, squeeze, unsqueeze


def broadcast1[
    A: LiteralInt,
    B: LiteralInt,
    X: LiteralInt,
    C: LiteralInt,
    D: LiteralInt,
](
    t1: Tensor[Any, tuple[A, B]],
    t2: Tensor[Any, tuple[X, A, B]],
    t3: Tensor[Any, tuple[X, Literal[1], Literal[1]]],
    t4: Annotated[Tensor[Any, tuple[Literal[1], A, C]], Where(IntEq[C, B])],
    t5: Tensor[Any, tuple[Literal[1], A, D]],
    t6: Tensor[Any, tuple[Literal[3], Literal[1], Literal[4]]],
    t7: Tensor[Any, tuple[Literal[5], Literal[1], Literal[5], Literal[1]]],
):
    d1 = t1.sub(t2)
    reveal_type(d1, expected_text="Tensor[Any, tuple[X, A, B]]")

    d2 = t1 - t2
    reveal_type(d2, expected_text="Tensor[Any, tuple[X, A, B]]")

    d3 = t2 + t3
    reveal_type(d3, expected_text="Tensor[Any, tuple[X, A, B]]")

    d3 = t2 - t3
    reveal_type(d3, expected_text="Tensor[Any, tuple[X, A, B]]")

    d4 = t2 + t4
    reveal_type(d4, expected_text="Tensor[Any, tuple[X, A, B]]")

    # This should generate an error.
    d5 = t2 - t5

    d6 = t6 + t7
    reveal_type(
        d6,
        expected_text="Tensor[Any, tuple[Literal[5], Literal[3], Literal[5], Literal[4]]]",
    )


def linspace1[A: LiteralInt](i1: Annotated[A, Where(IntGt[A, Literal[0]])]):
    t1 = linspace(0, 10, 4)
    reveal_type(t1, expected_text="Tensor[float, tuple[Literal[4]]]")

    t2 = linspace(0, 4, i1)
    reveal_type(t2, expected_text="Tensor[float, tuple[A]]")

    t3_out = randn(2)
    reveal_type(t3_out, expected_text="Tensor[Any, tuple[Literal[2]]]")
    t3 = linspace(0, 4, 2, out=t3_out)
    reveal_type(t3, expected_text="Tensor[Any, tuple[Literal[2]]]")

    # This should generate an error.
    t4 = linspace(0, 4, 3, out=t3_out)

    # This should generate an error.
    t5 = linspace(0, 4, 0)


def index_select1[A: LiteralInt, B: LiteralInt](
    i: Tensor[Any, tuple[A, B]], x: Tensor[Any, tuple[Literal[3]]]
):
    t1 = index_select(i, 0, x)
    reveal_type(t1, expected_text="Tensor[Any, tuple[Literal[3], B]]")

    t2 = index_select(i, 1, x)
    reveal_type(t2, expected_text="Tensor[Any, tuple[A, Literal[3]]]")

    # This should generate an error.
    t3 = index_select(i, 2, x)


def permute1[A: LiteralInt, B: LiteralInt, C: LiteralInt](
    t1: Tensor[Any, tuple[A, B, C]],
):
    p1 = permute(t1, (1, 2, 0))
    reveal_type(p1, expected_text="Tensor[Any, tuple[B, C, A]]")

    p2 = permute(t1, (0, 2, 1))
    reveal_type(p2, expected_text="Tensor[Any, tuple[A, C, B]]")

    # This should generate an error.
    p3 = permute(t1, (0, 2, 0))

    # This should generate an error.
    p4 = permute(t1, (0, 2, 4))

    # This should generate an error.
    p5 = permute(t1, (0, 1, 2, 3))


def squeeze1[A: LiteralInt, B: LiteralInt](
    t1: Tensor[Any, tuple[A, B, Literal[1], Literal[2]]],
):
    s1 = squeeze(t1, 2)
    reveal_type(s1, expected_text="Tensor[Any, tuple[A, B, Literal[2]]]")

    s2 = squeeze(t1, -2)
    reveal_type(s1, expected_text="Tensor[Any, tuple[A, B, Literal[2]]]")

    s3 = squeeze(t1, -1)
    reveal_type(s3, expected_text="Tensor[Any, tuple[A, B, Literal[1], Literal[2]]]")

    # This should generate two errors.
    s4 = squeeze(t1, 5)

    s5 = squeeze(t1, 1)
    reveal_type(s5, expected_text="Tensor[Any, tuple[A, Literal[1], Literal[2]]]")


def squeeze2[A: LiteralInt, B: LiteralInt](
    t1: Tensor[Any, tuple[A, B, Literal[1], Literal[2]]],
):
    s1 = squeeze(t1, (1, 2))
    reveal_type(s1, expected_text="Tensor[Any, tuple[LiteralInt, ...]]")


def unsqueeze1[A: LiteralInt, B: LiteralInt, C: LiteralInt](
    t1: Tensor[Any, tuple[A, B, C]],
):
    u1 = unsqueeze(t1, 1)
    reveal_type(u1, expected_text="Tensor[Any, tuple[A, Literal[1], B, C]]")

    u2 = unsqueeze(t1, 3)
    reveal_type(u2, expected_text="Tensor[Any, tuple[A, B, C, Literal[1]]]")

    u3 = unsqueeze(t1, -1)
    reveal_type(u3, expected_text="Tensor[Any, tuple[A, B, C, Literal[1]]]")

    u4 = unsqueeze(t1, -2)
    reveal_type(u4, expected_text="Tensor[Any, tuple[A, B, Literal[1], C]]")
