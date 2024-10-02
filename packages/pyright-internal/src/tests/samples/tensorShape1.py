# This sample tests various aspects of tensor shape type checking.

# pyright: reportMissingModuleSource=false

from tensorlib import Size, Tensor, matmul, randn
from typing_extensions import LiteralInt


def func1[D, A: LiteralInt, B: LiteralInt, C: LiteralInt](
    a: Tensor[D, tuple[A, B]], b: Tensor[D, tuple[B, C]], c: Tensor[D, tuple[B, B]]
):
    v1 = matmul(a, b)
    reveal_type(v1, expected_text="Tensor[D, tuple[A, C]]")

    v2 = matmul(a, c)
    reveal_type(v2, expected_text="Tensor[D, tuple[A, B]]")

    v3 = matmul(c, c)
    reveal_type(v3, expected_text="Tensor[D, tuple[B, B]]")

    v4 = matmul(c, b)
    reveal_type(v4, expected_text="Tensor[D, tuple[B, C]]")

    # This should generate an error.
    v5 = matmul(c, a)

    # This should generate an error.
    v6 = matmul(b, a)


def func2[X: LiteralInt, Y: LiteralInt, Z: LiteralInt](v: Size[tuple[X, Y, Z]]):
    a, b, c = v
    reveal_type(a, expected_text="X")
    reveal_type(b, expected_text="Y")
    reveal_type(c, expected_text="Z")

    d, *x = v
    reveal_type(d, expected_text="X")
    reveal_type(x, expected_text="list[Y | Z]")

    k, j, *m, n = v
    reveal_type(k, expected_text="X")
    reveal_type(j, expected_text="Y")
    reveal_type(m, expected_text="list[Never]")
    reveal_type(n, expected_text="Z")


def func3():
    t1 = randn(1, 4, 5)
    reveal_type(t1)
    reveal_type(t1.rank, expected_text="Literal[3]")
