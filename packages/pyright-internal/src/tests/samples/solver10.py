# This sample checks the handling of constraint solving
# in the case where list and tuple expressions are being
# matched, and those expressions contain literal values.
# We need to validate that the type inference for lists
# is not over-narrowing when matching these literals.

from typing import Callable, TypeVar


_T = TypeVar("_T")


def extend_if(xs: list[_T], ys: list[tuple[_T, bool]]) -> list[_T]:
    raise NotImplementedError()


extend_if(["foo"], [("bar", True), ("baz", True)])


def Return(value: _T) -> Callable[[_T], None]:
    ...


def func1() -> Callable[[bool], None]:
    return Return(True)
