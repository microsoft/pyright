# This sample tests the handling of nested calls to generic functions
# when bidirectional type inference is involved.

from typing import Literal, TypeVar

T = TypeVar("T")


def identity(x: T) -> T:
    return x


def identity2(x: T) -> T:
    return x


def test(x: Literal[2]) -> Literal[2]:
    return identity(identity2(x))


v1 = min(1, max(2, 0.5))
reveal_type(v1, expected_text="float")
