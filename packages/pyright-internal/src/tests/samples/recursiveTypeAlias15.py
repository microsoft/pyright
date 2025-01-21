# This sample tests that the computed variance for a recursive type
# alias is correct.

from typing import Callable, TypeAlias, TypeVar


type A[T] = Callable[[A[T]], Callable[[T], None]]


def testA_co(x: A[int]) -> A[int | str]:
    # This should generate an error because A is invariant.
    return x


def testA_cn(x: A[int | str]) -> A[int]:
    # This should generate an error because A is invariant.
    return x


T = TypeVar("T")

B: TypeAlias = "Callable[[B[T]], Callable[[T], None]]"


def testB_co(x: B[int]) -> B[int | str]:
    # This should generate an error because B is invariant.
    return x


def testB_cn(x: B[int | str]) -> B[int]:
    # This should generate an error because B is invariant.
    return x
