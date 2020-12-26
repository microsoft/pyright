# This sample tests that unspecified type parameters
# for a class instance are "unknown".

from collections import defaultdict
from queue import Queue
from typing import DefaultDict, List, Literal, Type, TypeVar

val1 = Queue()
t1: Literal["Queue[Unknown]"] = reveal_type(val1)

val2 = list()
t2: Literal["list[Unknown]"] = reveal_type(val2)

_T = TypeVar("_T")


def foo(value: Type[_T], b: _T) -> None:
    val1: "DefaultDict[str, list[_T]]" = defaultdict(list)
    t1: Literal["defaultdict[str, list[_T@foo]]"] = reveal_type(val1)

    val2: "DefaultDict[str, list[_T]]" = defaultdict(List[_T])
    t2: Literal["defaultdict[str, list[_T@foo]]"] = reveal_type(val2)

    # This should generate an error because the type is incompatible.
    val3: "DefaultDict[str, list[_T]]" = defaultdict(list[int])
