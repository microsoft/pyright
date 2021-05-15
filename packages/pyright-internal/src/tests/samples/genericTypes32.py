# This sample checks the handling of TypeVar matching
# in the case where list and tuple expressions are being
# matched, and those expressions contain literal values.
# We need to validate that the type inference for lists
# is not over-narrowing when matching these literals.

from typing import List, Tuple, TypeVar


T = TypeVar("T")


def extend_if(xs: List[T], ys: List[Tuple[T, bool]]) -> List[T]:
    raise NotImplementedError()


extend_if(["foo"], [("bar", True), ("baz", True)])
