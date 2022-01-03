# This sample checks the handling of TypeVar matching
# in the case where list and tuple expressions are being
# matched, and those expressions contain literal values.
# We need to validate that the type inference for lists
# is not over-narrowing when matching these literals.

from typing import Callable, List, Tuple, TypeVar


_T = TypeVar("_T")


def extend_if(xs: List[_T], ys: List[Tuple[_T, bool]]) -> List[_T]:
    raise NotImplementedError()


extend_if(["foo"], [("bar", True), ("baz", True)])


def Return(value: _T) -> Callable[[_T], None]:
    ...


def func1() -> Callable[[bool], None]:
    return Return(True)
