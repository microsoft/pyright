# This sample tests the case where a TypeVar requires multiple passes
# to resolve and the first pass it is assigned to a max widened
# type that is a constrained TypeVar.

# The code below is a simplified version of this code:
# import os
# result = filter(os.path.exists, ["hello", "world"])

from typing import Any, Callable, Iterable, Iterator, TypeVar
from functools import reduce

_T1 = TypeVar("_T1")
AnyStr = TypeVar("AnyStr", str, bytes)


def exists2(path: AnyStr) -> bool: ...


def filter2(f: Callable[[_T1], Any], i: Iterable[_T1]) -> Iterator[_T1]: ...


result = filter2(exists2, ["hello", "world"])


_T2 = TypeVar("_T2", set, frozenset)


def merge_sets(sets: Iterable[_T2]) -> _T2:
    return reduce(lambda x, y: x.union(y), sets)
