# This sample tests various aspects of tensor shape type checking.

# pyright: reportMissingModuleSource=false

from typing import Any, Literal
from typing_extensions import LiteralInt
from tensorlib import Tensor


def transpose1[A: LiteralInt, B: LiteralInt, X: LiteralInt](
    t1: Tensor[Any, tuple[A, B]],
    t2: Tensor[Any, tuple[X, Literal[2], Literal[4]]],
):
    d1 = t1.transpose(0, 1)
    reveal_type(d1, expected_text="Tensor[Any, tuple[B, A]]")

    d2 = t2.transpose(0, -1)
    reveal_type(d2, expected_text="Tensor[Any, tuple[Literal[4], Literal[2], X]]")

    # This should generate an error
    d5 = t1.transpose(0, 3)


def view1[A: LiteralInt, B: LiteralInt, X: LiteralInt](
    t1: Tensor[Any, tuple[A, B]],
    t2: Tensor[Any, tuple[X, Literal[2], Literal[4]]],
    t3: Tensor[Any, tuple[Literal[4], Literal[10], Literal[2], Literal[3]]],
):
    d1 = t3.view(4, 10, 6)
    reveal_type(
        d1, expected_text="Tensor[Any, tuple[Literal[4], Literal[10], Literal[6]]]"
    )

    d2 = t3.view(4, -1)
    reveal_type(d2, expected_text="Tensor[Any, tuple[Literal[4], Literal[60]]]")
