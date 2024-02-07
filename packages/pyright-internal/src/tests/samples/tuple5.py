# This sample tests the type checker's handling of
# empty tuples and assignment to empty tuples.

from typing import Sequence, TypeVar


T = TypeVar("T")

a: tuple[()] = ()

# This should generate an error because the assigned
# tuple has one element, but the destination is
# expecting zero.
b: tuple[()] = (1,)

# This should generate an error because the assigned
# tuple has zero elements, but the destination is
# expecting two.
c: tuple[int, str] = ()


def test_seq(x: Sequence[T]) -> Sequence[T]:
    return x


def func1(t1: tuple[()]):
    reveal_type(test_seq(t1), expected_text="Sequence[Never]")
