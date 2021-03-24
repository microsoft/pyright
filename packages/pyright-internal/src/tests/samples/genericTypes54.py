# This sample tests the case where a TypeVar requires multiple passes
# to resolve and the first pass it is assigned to a max widened
# type that is a constrained TypeVar.

# The code below is a simplified version of this code:
# import os
# result = filter(os.path.exists, ["hello", "world"])

from typing import Any, Callable, Iterable, Iterator, TypeVar

_T = TypeVar("_T")
AnyStr = TypeVar("AnyStr", str, bytes)


def exists2(path: AnyStr) -> bool:
    ...


def filter2(f: Callable[[_T], Any], i: Iterable[_T]) -> Iterator[_T]:
    ...


result = filter2(exists2, ["hello", "world"])


