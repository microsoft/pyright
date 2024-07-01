# This sample tests the type evaluator's handling of
# type vars that span multiple parameters - especially when
# the first parameter is a callable (which has parameters
# that are contravariant).

from typing import Any, Callable, Iterable, Iterator, TypeVar

_T = TypeVar("_T")


def is_one(x: int) -> bool:
    return x == 1


v1 = ["a", "b", "c"]


def func1(
    __function: Callable[[_T], Any], __iterable: Iterable[_T]
) -> Iterator[_T]: ...


# This should be flagged as an error because nums is
# not an int array.
ones = func1(is_one, v1)
